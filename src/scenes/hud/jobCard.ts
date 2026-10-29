// The job card's place in the run: it opens when the board first shows in C1 (before the banner),
// holds the board still until the player clicks it away, and does not open again in the same run.

import type { Run } from '../../game/run';
import { BROWNOUT } from '../../sim/brownout';

export const JOB_CARD_HOLD = 'job-card';

const dismissed = new WeakSet<Run>();

/** Whether the job card should open now for this run. */
export function jobCardDue(r: Run): boolean {
  return r.now < BROWNOUT.challenges.c2 && !dismissed.has(r);
}

export function jobCardDismissed(r: Run): boolean {
  return dismissed.has(r);
}

/** Hold the board while the card is open. */
export function openJobCard(r: Run): void {
  r.hold(JOB_CARD_HOLD);
}

/** Click the card away: C1 starts (the clock moves to C1 if the board opened before it). */
export function dismissJobCard(r: Run): void {
  dismissed.add(r);
  if (r.now < BROWNOUT.challenges.c1) r.now = BROWNOUT.challenges.c1;
  r.release(JOB_CARD_HOLD);
}
