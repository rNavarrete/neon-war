// Calm-weather step for Session 0: demand, routing, trust and upkeep over dt seconds. Pure; the
// game calls it every frame. Failures (overheating, retries, power dips, the rescue) are B1b's and
// replace or wrap this step when they land.

import { type Flow, type Part, capacityOf, errorShare } from './board';
import { BROWNOUT, BROWNOUT_RULES } from './brownout';
import { demandAt } from './demand';
import { type Session, chargeUpkeep, createSession, offlineAt, routeSession, trustAfter } from './economy';

/** Server slots on Session 0's board, left to right. */
export const SERVER_SLOTS: readonly string[] = ['s1', 's2', 's3', 's4', 's5', 's6'];

/** Parts the session starts with: the block's gateway and the residents' database. */
export const STARTING_PARTS: readonly Part[] = [
  { id: 'gateway', kind: 'gateway', slot: null },
  { id: 'database', kind: 'database', slot: null },
];

export function brownoutSession(): Session {
  return createSession({ slots: SERVER_SLOTS, parts: STARTING_PARTS });
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
