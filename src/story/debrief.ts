// The debrief (C8): the night's raw results and which of Rei's grade lines they earn. Pure: the
// results come in as data. There are no letter grades; each category is shown as its raw number.

import type { RunNotes } from '../game/run';
import { BROWNOUT } from '../sim/brownout';
import type { BannerChoice, Session } from '../sim/economy';
import type { LineId } from '../strings';
import { LABELS } from './labels';

export interface DebriefResults {
  /** Requests the block dropped over the session. */
  readonly droppedRequests: number;
  /** Credits spent on capacity nobody needed. */
  readonly wastedCredits: number;
  /** The neighbours' trust at the end, 0 to 100. */
  readonly trustLeft: number;
  /** The Solace banner answer, or null if it was never answered. */
  readonly banner: BannerChoice | null;
  /** What the player owes Ozzie: his front at the rescue plus what he covered at midnight. */
  readonly ozzieTab: number;
  /** Whether the player decommissioned down after midnight (C7). */
  readonly scaledDown: boolean;
  /** The C1 estimate dial in req/s, or null if never set. */
  readonly estimate: number | null;
  /** Whether the block stayed lit at midnight. */
  readonly midnightHeld: boolean;
  /** Servers running at midnight. */
  readonly serversAtMidnight: number;
}

/** The results ENG-503's sim knows and the run does not track yet. */
export type PendingResults = Pick<
  DebriefResults,
  'droppedRequests' | 'wastedCredits' | 'scaledDown' | 'midnightHeld' | 'serversAtMidnight'
>;

/**
 * PLACEHOLDER: "estimate close" has no threshold yet (GAME.md: the debrief's grade thresholds are
 * not set). This borrows the C1 dial's "about right" band from docs/SCRIPT.md (C1.triage.03: the
 * player sets 25 to 35). Rolando to confirm.
 */
export const ESTIMATE_CLOSE_RANGE = { min: 25, max: 35 } as const;

export function estimateClose(estimate: number | null): boolean {
  return estimate !== null && estimate >= ESTIMATE_CLOSE_RANGE.min && estimate <= ESTIMATE_CLOSE_RANGE.max;
}

/** Rei's grade lines for these results, in the order docs/SCRIPT.md lists them. */
export function debriefLines(r: DebriefResults): LineId[] {
  const lines: LineId[] = ['C8.rei.open'];
  lines.push(estimateClose(r.estimate) && r.midnightHeld ? 'C8.rei.sizing.good' : 'C8.rei.sizing.bad');
  lines.push(r.banner === 'pay' ? 'C8.rei.banner.pay' : 'C8.rei.banner.skip');
  if (r.ozzieTab > BROWNOUT.ozzie.front) lines.push('C8.rei.debt', 'C8.ozzie.debt');
  if (r.serversAtMidnight >= BROWNOUT.finalSizing.waste) lines.push('C8.rei.waste');
  if (r.scaledDown) lines.push('C8.rei.down');
  lines.push('C8.rei.close');
  return lines;
}

/** Build the results from the run's session and notes plus what only ENG-503's sim knows. */
export function debriefResults(session: Session, notes: RunNotes, pending: PendingResults): DebriefResults {
  return {
    ...pending,
    trustLeft: session.trust,
    banner: session.banner?.choice ?? null,
    ozzieTab: (session.ozzie.fronted ? BROWNOUT.ozzie.front : 0) + session.ozzie.debt,
    estimate: notes.estimate,
  };
}

const BANNER_LABEL: Record<BannerChoice, string> = {
  pay: LABELS.bannerPay,
  ignore: LABELS.bannerIgnore,
  bin: LABELS.bannerBin,
};

/** The raw results, one row per category, as shown in the debrief. */
export function resultRows(r: DebriefResults): { label: string; value: string }[] {
  return [
    { label: LABELS.dropped, value: String(Math.round(r.droppedRequests)) },
    { label: LABELS.wasted, value: String(Math.round(r.wastedCredits)) },
    { label: LABELS.trust, value: String(Math.round(r.trustLeft)) },
    { label: LABELS.banner, value: r.banner ? BANNER_LABEL[r.banner] : LABELS.bannerNone },
    { label: LABELS.ozzie, value: String(Math.round(r.ozzieTab)) },
    { label: LABELS.scaledDown, value: r.scaledDown ? LABELS.yes : LABELS.no },
  ];
}
