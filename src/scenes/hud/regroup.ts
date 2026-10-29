// Regroup's effect as the HUD runs it: once pressed, quarter speed for 10 s of (test-scaled) real
// time, then the button greys out. ENG-503 owns when the charge is handed over (pending503.ts).
// Pure: time is the HUD clock in seconds, passed in.

import { BROWNOUT } from '../../sim/brownout';

export interface RegroupState {
  /** HUD clock time Regroup started, or null if it hasn't been used. */
  readonly startedAt: number | null;
}

export const REGROUP_UNUSED: RegroupState = { startedAt: null };

export function startRegroup(s: RegroupState, clock: number): RegroupState {
  return s.startedAt === null ? { startedAt: clock } : s;
}

export function regroupActive(s: RegroupState, clock: number): boolean {
  return s.startedAt !== null && clock < s.startedAt + BROWNOUT.regroup.seconds;
}

/** The run's time scale Regroup asks for at `clock`: 0.25 while active, otherwise 1. */
export function regroupTimeScale(s: RegroupState, clock: number): number {
  return regroupActive(s, clock) ? BROWNOUT.regroup.speed : 1;
}

/** Spent once used and finished (the button greys out). */
export function regroupSpent(s: RegroupState, clock: number): boolean {
  return s.startedAt !== null && !regroupActive(s, clock);
}
