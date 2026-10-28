// The debrief (C8): the night's raw results, which of Rei's grade lines they earn, and the grey
// "you saw it at" line under each term the taught trace has an entry for. Pure: the results and the
// trace come in as data. There are no letter grades; each category is shown as its raw number.

import { TERM_GROUP, TERM_KEYS, type TermGroup, type TermKey } from '../scenes/hud/lineMeta';
import type { MomentKind, TaughtEntry, TaughtTrace } from '../scenes/hud/taught';
import { twelveHour } from '../scenes/hud/format';
import { BROWNOUT } from '../sim/brownout';
import type { BannerChoice, Session } from '../sim/economy';
import { LINES, type LineId, line } from '../strings';
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

/** Rei's grade lines for these results, in the order docs/SCRIPT.md lists them. */
export function debriefLines(r: DebriefResults): LineId[] {
  const lines: LineId[] = ['C8.rei.open'];
  // Graded on what was built (GAME.md "Final sizing"): midnight held without boxes that only cost.
  const sizedRight = r.midnightHeld && r.serversAtMidnight < BROWNOUT.finalSizing.waste;
  lines.push(sizedRight ? 'C8.rei.sizing.good' : 'C8.rei.sizing.bad');
  lines.push(r.banner === 'pay' ? 'C8.rei.banner.pay' : 'C8.rei.banner.skip');
  if (r.ozzieTab > BROWNOUT.ozzie.front) lines.push('C8.rei.debt', 'C8.ozzie.debt');
  if (r.serversAtMidnight >= BROWNOUT.finalSizing.waste) lines.push('C8.rei.waste');
  if (r.scaledDown) lines.push('C8.rei.down');
  lines.push('C8.rei.close');
  return lines;
}

/** Build the results from the run's session plus what only ENG-503's sim knows. */
export function debriefResults(session: Session, pending: PendingResults): DebriefResults {
  return {
    ...pending,
    trustLeft: session.trust,
    banner: session.banner?.choice ?? null,
    ozzieTab: (session.ozzie.fronted ? BROWNOUT.ozzie.front : 0) + session.ozzie.debt,
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

// ---- the moment each term was seen (learning-4, decision D10) ----

/** The three C8.terms lines, in the order the debrief names their groups. */
const TERM_LINES = ['C8.terms.sizing', 'C8.terms.scaling', 'C8.terms.failure'] as const;

/**
 * The debrief's bold terms by code key, as C8.terms.* print them (lineMeta's TERM_KEYS follow the
 * same order; tests/teaching.test.ts pins it).
 */
export const TERM_NAMES: Readonly<Record<TermKey, string>> = (() => {
  const bold = TERM_LINES.flatMap((id) => [...LINES[id].text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]));
  const out = {} as Record<TermKey, string>;
  TERM_KEYS.forEach((k, i) => {
    // "health checks" is bold mid-sentence; as a heading it starts with a capital.
    const name = bold[i] ?? k;
    out[k] = name.charAt(0).toUpperCase() + name.slice(1);
  });
  return out;
})();

/**
 * DRAFT pending D8 (the owner approves the wording): what each moment was, in the crew's words, for
 * the grey line under its term. `n` is the number the moment carries (the boxes).
 */
export const MOMENT_WORDS: Readonly<Record<MomentKind, (n: number | null) => string>> = {
  firstLive: () => 'your first box went live',
  kitFitted: () => 'you fitted the kit to a box',
  secondBox: () => 'a second box went on the rack',
  splitterRacked: () => 'the crew racked the splitter',
  firstSkipped: () => 'the splitter stepped over a dark box',
  bigBoxDark: () => 'the big box went dark',
  retriesRising: () => 'refreshes piled on top',
  laundryCut: () => 'you cut the laundry floor loose',
  diesInAtMidnight: () => 'a box read DIES IN at midnight',
  heldWithSpare: (n) => `midnight held on ${n ?? '?'} boxes, one of them dark`,
  decommission: () => 'you switched a box off',
};

/** One grey line in the debrief, printed under `name` (the bold term) in its group's column. */
export interface SeenLine {
  readonly term: TermKey;
  readonly group: TermGroup;
  readonly name: string;
  readonly text: string;
}

/** DRAFT pending D8: "you saw it at h:mm:ss AM/PM: <line>" for one trace entry; a spoken line in quotes. */
export function seenText(e: TaughtEntry): string {
  const what =
    e.line !== null ? `“${line(e.line)}”` : e.moment !== null ? MOMENT_WORDS[e.moment](e.value) : '';
  return `you saw it at ${twelveHour(e.clock)}: ${what}`;
}

/**
 * The grey lines the debrief prints: one per term that has an entry in the trace (its first
 * sighting), in the debrief's term order. A term with no entry gets no line.
 */
export function seenLines(trace: TaughtTrace): SeenLine[] {
  const out: SeenLine[] = [];
  for (const term of TERM_KEYS) {
    const e = trace.find((t) => t.term === term);
    if (e) out.push({ term, group: TERM_GROUP[term], name: TERM_NAMES[term], text: seenText(e) });
  }
  return out;
}
