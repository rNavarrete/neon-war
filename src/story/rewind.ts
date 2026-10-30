// Losing is gentle: a failure rewinds instead of ending the game. Which rewind plays and where it
// goes back to, as pure functions of the session clock (seconds since 23:54:25).

import { BROWNOUT } from '../sim/brownout';

/** TRIAGE's stream replay (before the crew), Rei's surge rewind, or Rei's midnight rewind. */
export type RewindKind = 'replay' | 'rei-surge' | 'rei-midnight';

const C = BROWNOUT.challenges;

/**
 * Which rewind a failure at `now` gets. Before the rescue it is TRIAGE's replay; after it, Rei's,
 * back to the surge or, from the midnight challenge on, to 23:59.
 */
export function rewindKindFor(now: number, rescued: boolean): RewindKind {
  if (!rescued) return 'replay';
  return now >= C.c6 ? 'rei-midnight' : 'rei-surge';
}

/** The clock time a rewind returns to. TRIAGE's replay goes back to the start of the current challenge. */
export function rewindTarget(kind: RewindKind, now: number): number {
  if (kind === 'rei-surge') return C.c4;
  if (kind === 'rei-midnight') return C.c6;
  if (now >= C.c3) return C.c3;
  if (now >= C.c2) return C.c2;
  return C.c1;
}
