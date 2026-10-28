// Calm-weather step for Session 0: demand, routing, trust and upkeep over dt seconds. Pure; the
// game calls it every frame. Failures (overheating, retries, power dips, the rescue) are B1b's and
// replace or wrap this step when they land.

import { type Flow, type Part, capacityOf, errorShare } from './board';
import { BROWNOUT, BROWNOUT_RULES } from './brownout';
import { demandAt } from './demand';
import { type Session, chargeUpkeep, createSession, offlineAt, routeSession, trustAfter } from './economy';
import { BOARD_CELLS, SERVER_SPOTS } from './grid';

/** Every cell of Session 0's table a part may stand on: the board's slots (grid.ts). */
export const BOARD_SLOTS: readonly string[] = BOARD_CELLS;

/**
 * Good server spots (anchor cells) on Session 0's table, spread across the four racks, in the order
 * the autopilot fills them and the board suggests them. Any free 2 x 2 footprint works as well.
 */
export const SERVER_SLOTS: readonly string[] = SERVER_SPOTS;

/** Parts the session starts with: the block's gateway and the residents' database. */
export const STARTING_PARTS: readonly Part[] = [
  { id: 'gateway', kind: 'gateway', slot: null },
  { id: 'database', kind: 'database', slot: null },
];

export function brownoutSession(): Session {
  return createSession({ slots: BOARD_SLOTS, parts: STARTING_PARTS });
}

export interface Moment {
  readonly session: Session;
  /** Seconds since the clock opened at 23:51:30. */
  readonly now: number;
  readonly demand: number;
  readonly flow: Flow;
}

/** Total req/s the live servers can serve at `now` (booting and offline ones count zero). */
export function liveCapacity(session: Session, now: number): number {
  const off = offlineAt(session, now);
  return session.board.parts
    .filter((p) => p.kind === 'server' && !off.includes(p.id))
    .reduce((sum, p) => sum + capacityOf(p, BROWNOUT_RULES), 0);
}

/** The session after dt seconds of calm weather, from `now`. */
export function stepCalm(session: Session, now: number, dt: number): Moment {
  const t = now + dt;
  const demand = demandAt(t);
  const flow = routeSession(session, demand, t);
  const share = errorShare(flow, demand);
  const charged = chargeUpkeep(session, dt);
  return { session: { ...charged, trust: trustAfter(session.trust, share, dt) }, now: t, demand, flow };
}

export const SESSION_END = BROWNOUT.challenges.c8;
