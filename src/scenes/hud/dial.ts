// The estimate dial. In C1 it sets the expected requests per second; for the midnight sizing prompt
// (C6) the same dial counts servers. Pure model plus the two notes it writes into the run.

import type { Run } from '../../game/run';
import { BROWNOUT } from '../../sim/brownout';
import { clamp } from './format';

export type DialMode = 'reqps' | 'servers';

export interface DialSpec {
  readonly max: number;
  readonly step: number;
}

export const DIAL: Readonly<Record<DialMode, DialSpec>> = {
  reqps: { max: 600, step: 5 },
  servers: { max: 8, step: 1 },
};

/** The dial counts servers from the moment the midnight forecast and sizing prompt appear. */
export const SERVER_MODE_FROM = BROWNOUT.challenges.c6 - BROWNOUT.demand.forecastLeadSeconds;

export function dialModeAt(now: number): DialMode {
  return now >= SERVER_MODE_FROM ? 'servers' : 'reqps';
}

/** The dial value after `steps` clicks (negative turns it down), kept on the dial's scale. */
export function turnDial(value: number, steps: number, mode: DialMode): number {
  const s = DIAL[mode];
  return clamp(Math.round(value / s.step + steps) * s.step, 0, s.max);
}

/** How far round the dial a value sits, from 0 to 1. */
export function dialFraction(value: number, mode: DialMode): number {
  return clamp(value / DIAL[mode].max, 0, 1);
}

/** The value for a fraction of the way round, snapped to the dial's step. */
export function dialValueAt(fraction: number, mode: DialMode): number {
  const s = DIAL[mode];
  return clamp(Math.round((clamp(fraction, 0, 1) * s.max) / s.step) * s.step, 0, s.max);
}

/**
 * Record the player's C1 estimate (req/s). Only a note for the chart and the debrief: a wrong
 * guess costs nothing, so credits, trust and the board are untouched. The first answer stands.
 */
export function applyEstimate(r: Run, value: number): boolean {
  if (r.notes.estimate !== null) return false;
  r.notes = { ...r.notes, estimate: value };
  return true;
}

/** Record the C6 sizing answer (servers for midnight) for the debrief. The first answer stands. */
export function applySizing(r: Run, servers: number): boolean {
  if (r.notes.sizing !== null) return false;
  r.notes = { ...r.notes, sizing: servers };
  return true;
}

/**
 * What the C1 dial card reads once the player has wired something before answering: the guess still
 * costs nothing, so the card dims and says so, and SET still records it. WIRING(learning): this
 * micro-copy moves to src/scenes/hud/labels.ts when learning-1 lands it.
 */
export const DIAL_FREE_NOTE = 'your guess stays free';

/**
 * Whether the dial card is dimmed: the C1 question (req/s) is still open and the player has already
 * wired a part. The card stays open (hud.dial.visible) until SET; only its look changes.
 */
export function dialDimmed(mode: DialMode, estimate: number | null, wiredSinceAsked: boolean): boolean {
  return mode === 'reqps' && estimate === null && wiredSinceAsked;
}

/** The label the dial card shows: the question, or the free-guess note while dimmed. */
export function dialLabel(question: string, dimmed: boolean): string {
  return dimmed ? DIAL_FREE_NOTE : question;
}

/** True when an estimate is close enough that TRIAGE owns up to it (25 to 35 req/s). */
export function estimateClose(value: number): boolean {
  return value >= 25 && value <= 35;
}
