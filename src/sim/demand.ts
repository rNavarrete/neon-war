// Session 0's demand schedule and the estimate, as pure functions of the session clock.
// t is seconds since the clock opened at 23:51:30; every number comes from BROWNOUT.

import { BROWNOUT } from './brownout';

const C = BROWNOUT.challenges;
const D = BROWNOUT.demand;

/** Back-of-the-envelope estimate: users times how often each calls, in req/s. */
export function estimateDemand(users: number, callEverySeconds: number): number {
  return users / callEverySeconds;
}

/** The block's base demand: 120 flats each calling every 4 s. */
export function baseDemand(): number {
  return estimateDemand(BROWNOUT.block.flats, BROWNOUT.block.callEverySeconds);
}

/** How many servers of the given capacity a demand needs, as a fraction (150 ÷ 60 = 2.5). */
export function serversFor(demand: number, capacity: number = BROWNOUT.server.capacity): number {
  return demand / capacity;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * Math.min(1, Math.max(0, k));

/**
 * Requests per second the block sends at time t. The block's base load through C2, the evening
 * climb in C3, the district surge in C4, the surge tail in C5, the final surge rising to its peak
 * at midnight in C6, then the fall after midnight. Retries and the laundry cut are B1b's.
 */
export function demandAt(t: number): number {
  const base = baseDemand();
  if (t < C.c3) return base;
  if (t < C.c4) return lerp(base, D.climb, (t - C.c3) / D.climbRampSeconds);
  if (t < C.c5) return D.surge;
  if (t < C.c6) return D.tail;
  if (t <= C.c7) return lerp(D.tail, D.final, (t - C.c6) / (C.c7 - C.c6));
  return lerp(D.final, D.afterMidnight, (t - C.c7) / D.afterMidnightFallSeconds);
}

export interface Surge {
  /** Seconds since the clock opened when the surge starts. */
  readonly startsAt: number;
  /** The surge's number, in req/s. */
  readonly demand: number;
}

/** The rises the board forecasts: the evening climb, the district surge and the final surge. */
export const SURGES: readonly Surge[] = [
  { startsAt: C.c3, demand: D.climb },
  { startsAt: C.c4, demand: D.surge },
  { startsAt: C.c6, demand: D.final },
];

/**
 * The surge forecast at time t: the next surge once it is within the forecast lead (10 s), or
 * null when none is coming that soon.
 */
export function forecastAt(t: number, surges: readonly Surge[] = SURGES): Surge | null {
  const next = surges.find((s) => s.startsAt > t);
  if (!next || next.startsAt - t > D.forecastLeadSeconds) return null;
  return next;
}
