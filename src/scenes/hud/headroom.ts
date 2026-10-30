// The room-left bar in the deck (ZONES.deck), as pure rules. The bar shows how much room the wired
// boxes have left over what is coming: 30 segments of room left, draining from the right as load
// (demand / wired capacity) grows; green while 30% or more is left, amber down to none, all red once
// more comes than they can serve. It is labelled in the crew's words, "ROOM LEFT 25% · 90 of 120",
// always with the absolute numbers so the fill and the words agree; the debrief is the first place
// the real term is named. The bar keeps no history: the scope draws the past, this draws now.
//
// Wired capacity counts only servers that can serve: not offline (booting, dead, dark) and wired
// from the gateway (or a balancer the gateway feeds) through to the database. A racked box with no
// feed adds nothing. Pure: no Phaser, time comes in as `now`.

import { wiredCapacity } from '../../game/frame';
import type { Part, Wire } from '../../sim/board';
import { clamp } from './format';
import { HEADROOM_AMBER_FROM, HEADROOM_RED_OVER, HEADROOM_SEGMENTS } from './thresholds';

/** The bar's colour state: green while 30% or more is left, amber down to none, red when over. */
export type HeadroomColour = 'green' | 'amber' | 'red';

/** Req/s the wired, online servers can serve (the same rule as Frame.wiredCapacity). */
export function wiredCapacityOf(
  board: { readonly parts: readonly Part[]; readonly wires: readonly Wire[] },
  offline: readonly string[],
): number {
  return wiredCapacity(board.parts, board.wires, offline);
}

/** Load: demand over wired capacity. Infinite when something is coming and nothing is wired. */
export function headroomLoad(demand: number, wired: number): number {
  if (wired > 0) return demand / wired;
  return demand > 0 ? Infinity : 0;
}

/** Room left in percent, round((1 - demand / wired) x 100): negative when over; null with nothing wired. */
export function headroomPct(demand: number, wired: number): number | null {
  return wired > 0 ? Math.round((1 - demand / wired) * 100) : null;
}

/** Green under 0.7 load, amber from 0.7 to 1.0, red over 1.0. */
export function headroomColour(load: number): HeadroomColour {
  if (load > HEADROOM_RED_OVER) return 'red';
  if (load >= HEADROOM_AMBER_FROM) return 'amber';
  return 'green';
}

/** Segments of room left, lit from the left: round(clamp(1 - demand / wired, 0, 1) x 30); none unwired. */
export function litSegments(demand: number, wired: number): number {
  if (wired <= 0) return 0;
  return Math.round(clamp(1 - demand / wired, 0, 1) * HEADROOM_SEGMENTS);
}

/** Req/s coming beyond what the wired boxes serve, rounded up; 0 when not over. */
export function overBy(demand: number, wired: number): number {
  return demand > wired ? Math.ceil(demand - wired - 1e-9) : 0;
}

/** The bar's words: "HEADROOM 25% · 90 of 120", or the over and no-server cases. */
export function headroomLabel(demand: number, wired: number): string {
  if (wired <= 0) return 'HEADROOM · NO SERVER';
  const over = overBy(demand, wired);
  if (over > 0) return `HEADROOM · OVER +${over} req/s`;
  return `HEADROOM ${headroomPct(demand, wired)}% · ${Math.round(demand)} of ${Math.round(wired)}`;
}

/** What the hook mirrors as hud.headroom; also the view's per-frame state, refilled in place. */
export interface HeadroomState {
  /** round((1 - demand / wiredCapacity) x 100); null with nothing wired. */
  pct: number | null;
  /** demand / wiredCapacity; null with nothing wired. */
  load: number | null;
  /** Req/s every live server could serve, wired or not (the scope's dotted line). */
  capacity: number;
  /** Req/s the wired, online servers can serve: what the bar measures against. */
  wiredCapacity: number;
  demand: number;
  state: HeadroomColour;
  /** Sim time the bar last turned red, while it stays red; null otherwise. */
  redSince: number | null;
  /** Segments of room left lit, 0..30. */
  lit: number;
}

export interface HeadroomInput {
  readonly demand: number;
  readonly capacity: number;
  readonly wiredCapacity: number;
}

export function emptyHeadroom(): HeadroomState {
  return {
    pct: null,
    load: null,
    capacity: 0,
    wiredCapacity: 0,
    demand: 0,
    state: 'green',
    redSince: null,
    lit: 0,
  };
}

/**
 * Bring `out` in line with this frame, in place (no allocation), and say whether the bar has just
 * turned red. `redSince` holds while it stays red, and starts again if time ran backwards (a rewind).
 */
export function stepHeadroom(out: HeadroomState, f: HeadroomInput, now: number): boolean {
  const wired = f.wiredCapacity;
  const load = headroomLoad(f.demand, wired);
  const state = headroomColour(load);
  const wasRed = out.state === 'red' && out.redSince !== null && now >= out.redSince;
  out.pct = headroomPct(f.demand, wired);
  out.load = wired > 0 ? load : null;
  out.capacity = f.capacity;
  out.wiredCapacity = wired;
  out.demand = f.demand;
  out.state = state;
  out.lit = litSegments(f.demand, wired);
  if (state !== 'red') {
    out.redSince = null;
    return false;
  }
  if (wasRed) return false;
  out.redSince = now;
  return true;
}

/** A fresh state for one frame (tests; the view refills one state in place). */
export function headroomState(f: HeadroomInput, now: number, prev?: HeadroomState): HeadroomState {
  const out = prev ? { ...prev } : emptyHeadroom();
  stepHeadroom(out, f, now);
  return out;
}

/** How long the headroom-red sound waits before it may play again, in HUD seconds. */
export const RED_SOUND_GAP = 10;

/** Whether the red sound may play on entering red at HUD time `t`, given when it last played. */
export function redSoundDue(t: number, lastPlayed: number | null): boolean {
  return lastPlayed === null || t < lastPlayed || t - lastPlayed >= RED_SOUND_GAP;
}
