// The job card's place in the run: it opens when the board first shows in C1 (before the banner),
// holds the board still until the player clicks it away, and does not open again in the same run.

import type { Run } from '../../game/run';
import { BROWNOUT } from '../../sim/brownout';
import { dialModeAt } from './dial';

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

/** What the dial question depends on at a moment. */
export interface DialAsk {
  readonly now: number;
  readonly cardOpen: boolean;
  readonly estimate: number | null;
  readonly sizing: number | null;
}

/**
 * Whether the C6 sizing prompt is open: the dial counts boxes, no answer yet, before midnight, and
 * the job card is not up.
 */
export function sizingPromptOpen(a: DialAsk): boolean {
  return (
    dialModeAt(a.now) === 'servers' && a.sizing === null && a.now < BROWNOUT.clock.midnight && !a.cardOpen
  );
}

/**
 * Whether a dial question is open, so the dial card (and the SET key) shows: from the moment the job
 * card closes until the C1 estimate is SET, and again while the sizing prompt is open.
 */
export function dialQuestionOpen(a: DialAsk): boolean {
  if (a.cardOpen) return false;
  if (dialModeAt(a.now) === 'reqps') return a.estimate === null;
  return sizingPromptOpen(a);
}
