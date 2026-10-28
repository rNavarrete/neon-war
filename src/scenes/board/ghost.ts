// The what-if ghost (board-8, LRN-6): while a card is dragged over a pad or a server, how much room
// the wired boxes would have after the drop, so the player sees the consequence before spending.
// It tells the truth about wiring: a new box only adds room when a free feed can wire it (the
// gateway feeds one part, so once its out-wire is taken a second box adds nothing until the crew's
// splitter arrives). The number is wiredCapacity, the same rule the ROOM LEFT bar, the gauge's band
// and the channel's ROOM tick read, on the board as it would be. Pure: no Phaser, no clock; time
// comes in as `now`.

import { wiredCapacity } from '../../game/frame';
import type { BoardRules, Part, Wire } from '../../sim/board';
import { BROWNOUT } from '../../sim/brownout';
import { DEMAND_SCALE_MAX } from '../hud/thresholds';
import { LABELS, ghostPlate } from '../hud/labels';
import { type PadState, dropLegal } from './layout';

/** The id the ghost's box goes by on the what-if board. */
export const GHOST_ID = 'ghost';

/** The board the ghost reasons over. */
export interface GhostBoard {
  readonly parts: readonly Part[];
  readonly wires: readonly Wire[];
}

/**
 * The only free feed a new box could be wired from: the gateway while its out-wire is free (it feeds
 * one part), else a splitter on the board; null when nothing can feed it.
 */
export function freeFeed(board: GhostBoard, rules: BoardRules): string | null {
  let gateway: string | null = null;
  let balancer: string | null = null;
  for (const p of board.parts) {
    if (p.kind === 'gateway' && gateway === null) gateway = p.id;
    if (p.kind === 'balancer' && balancer === null) balancer = p.id;
  }
  if (gateway !== null) {
    let outs = 0;
    for (const w of board.wires) if (w.from === gateway) outs++;
    const max = rules.maxOut.gateway;
    if (max === undefined || outs < max) return gateway;
  }
  return balancer;
}

/**
 * Req/s the wired boxes could serve with `card` dropped on `pad` (a server slot) and wired along the
 * only free feed: wiredCapacity of the board as it would be.
 *
 * - A server on an empty pad stands there wired from the free feed and on to the database; with no
 *   free feed it is racked and fed by nothing, so the number does not move.
 * - A server on a dead box replaces it on the same wires (and is no longer offline).
 * - The kit on a server doubles it; a server nothing feeds still adds nothing.
 * - Anything else (the splitter, a taken pad) leaves the number as it is.
 *
 * The new box's 3 s boot is not counted against it: the ghost shows where the room settles.
 */
export function ghostCapacity(
  board: GhostBoard,
  rules: BoardRules,
  offline: readonly string[],
  card: string,
  pad: string,
): number {
  const now = wiredCapacity(board.parts, board.wires, offline);
  let on: Part | null = null;
  for (const p of board.parts) if (p.slot === pad) on = p;
  if (card === 'server') {
    if (on === null) {
      const feed = freeFeed(board, rules);
      const db = databaseOf(board);
      if (feed === null || db === null) return now;
      const parts = [...board.parts, { id: GHOST_ID, kind: 'server' as const, slot: pad }];
      const wires = [...board.wires, { from: feed, to: GHOST_ID }, { from: GHOST_ID, to: db }];
      return wiredCapacity(parts, wires, offline);
    }
    if (on.kind === 'server' && offline.includes(on.id)) {
      // A replacement: a fresh box in the dead one's place, on the same wires.
      const old = on.id;
      const parts = board.parts.map((p) =>
        p.id === old ? { id: GHOST_ID, kind: 'server' as const, slot: pad } : p,
      );
      const wires = board.wires.map((w) => ({
        from: w.from === old ? GHOST_ID : w.from,
        to: w.to === old ? GHOST_ID : w.to,
      }));
      return wiredCapacity(parts, wires, offline);
    }
    return now;
  }
  if (card === 'overclock' && on !== null && on.kind === 'server' && on.boost === undefined) {
    const factor = rules.upgrade?.factor ?? 1;
    const id = on.id;
    const parts = board.parts.map((p) => (p.id === id ? { ...p, boost: factor } : p));
    return wiredCapacity(parts, board.wires, offline);
  }
  return now;
}

function databaseOf(board: GhostBoard): string | null {
  for (const p of board.parts) if (p.kind === 'database') return p.id;
  return null;
}

/** What the ghost shows over one target, and what the hook mirrors as board.ghost. */
export interface GhostInfo {
  /** The tray card dragged. */
  readonly card: string;
  /** What it is over: a slot id ('s1'..'s6', 'lb') or a part id. */
  readonly over: string;
  /** The drop would do something (dropLegal). */
  readonly legal: boolean;
  /** The pad's legality. */
  readonly state: PadState;
  /** Req/s the wired boxes serve now, and would serve after the drop. */
  readonly wired: number;
  readonly capacity: number;
  /** What the drop adds: capacity - wired (0 when nothing feeds the new box). */
  readonly adds: number;
  /** The plate beside the ghost: "+60 room · boots 3 s · -80 cr" or "+0 room · nothing feeds it"; null when the drop would do nothing (a short purse still shows). */
  readonly plate: string | null;
  /** The what-if level on the channel's 0..400 bank (capacity / 400); null when the drop would do nothing (a short purse still shows). */
  readonly whatIf: number | null;
  /** The label beside the what-if tick, "ROOM +60", only when the drop adds room. */
  readonly tick: string | null;
}

/**
 * The ghost for `card` over `over` (a slot id; `pad` is the server slot it lands in, or null) in
 * this state, or null when the gate is shut. Only a drop that would do something (or would, with the credits) gets a plate and a what-if level.
 */
export function ghostInfo(
  board: GhostBoard,
  rules: BoardRules,
  offline: readonly string[],
  card: string,
  over: string,
  pad: string | null,
  state: PadState,
  gate: boolean,
): GhostInfo | null {
  if (!gate) return null;
  const legal = dropLegal(card, state);
  // A pad the credits fall short for still shows what the box would add: only the drop is refused.
  const shows = legal || state === 'poor';
  const wired = wiredCapacity(board.parts, board.wires, offline);
  const capacity = shows && pad !== null ? ghostCapacity(board, rules, offline, card, pad) : wired;
  const adds = Math.max(0, capacity - wired);
  let plate: string | null = null;
  if (shows) {
    plate =
      card === 'overclock'
        ? ghostPlate(adds, BROWNOUT.overclock.rebootSeconds, BROWNOUT.overclock.cost)
        : ghostPlate(adds, BROWNOUT.server.bootSeconds, BROWNOUT.server.cost);
  }
  return {
    card,
    over,
    legal,
    state,
    wired,
    capacity,
    adds,
    plate,
    whatIf: shows ? capacity / DEMAND_SCALE_MAX : null,
    tick: shows && adds > 0 ? `${LABELS.gauge.room} +${Math.round(adds)}` : null,
  };
}
