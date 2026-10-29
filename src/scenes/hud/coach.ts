// The tutorial coach (Rolando, 29 Oct 2026: "we should be detecting if a user's struggling"). Session
// 0 is the player's first look at the board, so the coach watches for the moments a first-timer gets
// stuck and helps in three steps that grow with time: the thing to touch lights up (a tray card, a
// part, or a dashed ghost wire along the grid between the two parts to connect), the alert band says
// the step in a few words, and TRIAGE or Lux nudge out loud, each nudge a little more direct than the
// last, further apart each time, and then only the most direct one, now and then.
//
// Why this shape (research, 29 Oct 2026): Plants vs. Zombies' tutorial (George Fan, GDC 2012) shows
// help only to the player doing the wrong thing, keeps it passive (never stops the game) and short,
// and warns that noise teaches players to ignore every message. Navi ("Hey! Listen!") is the classic
// warning about a helper who repeats herself on a timer. Valve's Portal playtests found players
// wanted GLaDOS, but not talking while they worked the puzzle. So the visual cue comes first and
// stays, the voice backs off, and it waits while the player is busy trying.
//
// What counts as stuck (coachProblem, in priority order):
//   place   no server on the board in C1
//   feed    the gateway feeds nothing (before the crew: a server waits; after: the splitter does)
//   store   a server is fed but has no wire on to the database
//   behind  after the crew arrive, a server sits outside the splitter
//   replace a box cooked and waits to be swapped (after the crew; before them a death rewinds)
//   choose  C3: the one box is over its limit and nothing has changed yet (both options light up;
//           the coach never says which one)
//
// The nudges only explain how the board works (drag this onto that). They never give a number or
// a sizing answer: TRIAGE hints, never answers. Pure: no Phaser, no clock; time comes in as `dt`
// (HUD seconds, counted only while the board runs). Allocates only when the step changes.

import type { Part, Wire } from '../../sim/board';
import { capacityOf } from '../../sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../../sim/brownout';
import type { LineId } from '../../strings';

const C = BROWNOUT.challenges;

export type CoachStep = 'place' | 'feed' | 'store' | 'behind' | 'replace' | 'choose';

/** What the coach lights up for a step. */
export interface CoachTargets {
  /** Tray cards to ring ('server', 'overclock'). */
  readonly cards: readonly string[];
  /** Parts to ring. */
  readonly parts: readonly string[];
  /** The connection to make, drawn as a ghost wire from `from`'s out-port to `to`'s in-port. */
  readonly wire: { readonly from: string; readonly to: string } | null;
}

export interface CoachProblem extends CoachTargets {
  readonly step: CoachStep;
  /** Identifies the exact problem: the same step on another part starts over. */
  readonly key: string;
  /** The nudges for it, gentlest first (NUDGES[step], or FEED_SPLITTER after the crew). */
  readonly lines: readonly LineId[];
  /** What the alert band says while it is lit, or null. */
  readonly hint: LineId | null;
}

/** What the coach reads each frame (a Frame fits, plus the HUD's job card flag). */
export interface CoachInput {
  readonly now: number;
  readonly paused: boolean;
  /** The job card is up: nothing to do yet but read it. */
  readonly cardOpen: boolean;
  readonly waitingForFirstBuild: boolean;
  readonly rescued: boolean;
  readonly parts: readonly Part[];
  readonly wires: readonly Wire[];
  readonly dead: readonly string[];
  readonly offline: readonly string[];
  readonly load: Readonly<Record<string, number>>;
  readonly dropped: number;
}

/** How long a problem lasts before each kind of help, and how often the nudge comes back. */
export const COACH_TIMING = Object.freeze({
  /** Seconds stuck before the highlight shows (the band's hint shows with it). */
  highlightAfter: 3,
  /** Seconds stuck before the first nudge. */
  firstNudge: 6,
  /** Seconds between the nudges after that, one per gap; past the last gap, `repeat`. */
  gaps: [9, 12] as readonly number[],
  /** Seconds between reminders once every nudge has been said (the most direct one, again). */
  repeat: 25,
  /** A nudge never comes sooner than this after the player's last drag or click on the board. */
  quietAfterInput: 5,
});

/** Steps whose highlight and first nudge come at other times than COACH_TIMING's. */
const STEP_TIMING: Readonly<Partial<Record<CoachStep, { highlightAfter: number; firstNudge: number }>>> = {
  // The first drag is the very first thing anyone does: give them a moment to look around first.
  place: { highlightAfter: 4, firstNudge: 8 },
  // A box going over its limit is the C3 puzzle: help late, and only with "look at the tray".
  choose: { highlightAfter: 3, firstNudge: 4 },
};

/** The nudges for each step, gentlest first; past the last, the last one comes back now and then. */
export const NUDGES: Readonly<Record<CoachStep, readonly LineId[]>> = {
  place: ['C1.triage.nudge.place.1', 'C1.triage.nudge.place.2', 'C1.lux.nudge.place'],
  feed: ['C1.triage.nudge.feed.1', 'C1.triage.nudge.feed.2', 'C1.lux.nudge.feed'],
  store: ['C1.triage.nudge.store.1', 'C1.triage.nudge.store.2', 'C1.lux.nudge.store'],
  behind: ['C5.triage.nudge.behind.1', 'C5.triage.nudge.behind.2', 'C5.lux.nudge.behind'],
  replace: ['C5.triage.nudge.replace.1', 'C5.lux.nudge.replace'],
  choose: ['C3.triage.nudge.choose.1', 'C3.triage.nudge.choose.2'],
};

/** The gateway-to-splitter nudge: the feed step after the crew arrive. */
export const FEED_SPLITTER: readonly LineId[] = ['C5.triage.nudge.splitter', 'C5.lux.nudge.splitter'];

/** What the alert band says while a step is lit (it never covers a real alert). */
export const COACH_HINT: Readonly<Record<CoachStep, LineId | null>> = {
  place: 'C1.alert.place',
  feed: 'C1.alert.feed',
  store: 'C1.alert.store',
  behind: 'C5.alert.behind',
  replace: 'C5.alert.replace',
  choose: null,
};

const NO_IDS: readonly string[] = Object.freeze([]);

function problem(
  step: CoachStep,
  key: string,
  cards: readonly string[],
  parts: readonly string[],
  wire: { from: string; to: string } | null,
  lines: readonly LineId[] = NUDGES[step],
  hint: LineId | null = COACH_HINT[step],
): CoachProblem {
  return { step, key, cards, parts, wire, lines, hint };
}

function wired(wires: readonly Wire[], from: string, to: string): boolean {
  for (let i = 0; i < wires.length; i++) if (wires[i].from === from && wires[i].to === to) return true;
  return false;
}

function feeds(wires: readonly Wire[], from: string): string | null {
  for (let i = 0; i < wires.length; i++) if (wires[i].from === from) return wires[i].to;
  return null;
}

/**
 * Which problem the player is stuck on right now, or null. Reads the board only: the clock decides
 * how long it has lasted (stepCoach). Nothing while the job card is up or before C1, nor once the
 * night is over.
 */
export function coachProblem(f: CoachInput): CoachProblem | null {
  if (f.cardOpen || f.now < C.c1 || f.now >= C.c7) return null;
  const servers: Part[] = [];
  let lb: Part | null = null;
  for (const p of f.parts) {
    if (p.kind === 'server' && p.slot !== null) servers.push(p);
    if (p.kind === 'balancer' && lb === null) lb = p;
  }
  if (servers.length === 0) {
    return f.waitingForFirstBuild || f.now < C.c2
      ? problem('place', 'place', ['server'], NO_IDS, null)
      : null;
  }
  const live = servers.filter((s) => !f.dead.includes(s.id));
  const fedFrom = lb ?? null;
  const gwTo = feeds(f.wires, 'gateway');

  if (lb) {
    // After the crew: gateway into the splitter, the splitter into every box, every box on to the database.
    if (gwTo !== lb.id)
      return problem(
        'feed',
        `feed:${lb.id}`,
        NO_IDS,
        [lb.id],
        { from: 'gateway', to: lb.id },
        FEED_SPLITTER,
        'C5.alert.splitter',
      );
  } else if (gwTo === null) {
    // Before the crew: the gateway feeds one box. Point at the box already wired to the database if
    // there is one, else the first one placed.
    const target = live.find((s) => wired(f.wires, s.id, 'database')) ?? live[0] ?? servers[0];
    return problem('feed', `feed:${target.id}`, NO_IDS, [target.id], { from: 'gateway', to: target.id });
  }

  // A fed box with no way on to the database.
  for (const s of live) {
    const fed = fedFrom ? wired(f.wires, fedFrom.id, s.id) : gwTo === s.id;
    if (fed && !wired(f.wires, s.id, 'database'))
      return problem('store', `store:${s.id}`, NO_IDS, [s.id], { from: s.id, to: 'database' });
  }

  if (lb) {
    for (const s of live) {
      if (!wired(f.wires, lb.id, s.id))
        return problem('behind', `behind:${s.id}`, NO_IDS, [s.id], { from: lb.id, to: s.id });
    }
    for (const s of servers) {
      if (f.dead.includes(s.id)) return problem('replace', `replace:${s.id}`, ['server'], [s.id], null);
    }
  }

  // C3: the box the gateway feeds is over its limit and drops calls, with no bigger box yet.
  if (!f.rescued && f.now >= C.c3 && f.now < C.c4 && f.dropped > 0 && gwTo !== null) {
    const box = servers.find((s) => s.id === gwTo);
    if (
      box &&
      box.boost === undefined &&
      !f.offline.includes(box.id) &&
      (f.load[box.id] ?? 0) >= capacityOf(box, BROWNOUT_RULES) - 1e-6
    )
      return problem('choose', 'choose', ['overclock', 'server'], [box.id], null);
  }
  return null;
}

export interface CoachState {
  /** The problem being timed, or null. */
  readonly problem: CoachProblem | null;
  /** Board-running seconds it has lasted. */
  readonly stuckFor: number;
  /** Nudges said for it so far. */
  readonly nudges: number;
  /** stuckFor at which the next nudge is due. */
  readonly nextNudge: number;
  /** Every nudge said this run, for the test hook. */
  readonly said: number;
}

export const NEW_COACH: CoachState = Object.freeze({
  problem: null,
  stuckFor: 0,
  nudges: 0,
  nextNudge: COACH_TIMING.firstNudge,
  said: 0,
});

function timingOf(step: CoachStep): { highlightAfter: number; firstNudge: number } {
  return STEP_TIMING[step] ?? COACH_TIMING;
}

/** The nudge to say as the `n`th (0-based) for a problem: down the list, then the last one again. */
export function nudgeFor(p: CoachProblem, n: number): LineId {
  const list = p.lines;
  return list[Math.min(n, list.length - 1)];
}

/** Seconds from the `n`th nudge (0-based) to the next one. */
export function gapAfter(n: number): number {
  const g = COACH_TIMING.gaps;
  return n < g.length ? g[n] : COACH_TIMING.repeat;
}

/**
 * The player just dragged or clicked on the board: they are trying, so the next nudge waits until
 * at least COACH_TIMING.quietAfterInput seconds from now. The highlight is left as it is.
 */
export function quietCoach(s: CoachState): CoachState {
  if (s.problem === null) return s;
  const earliest = s.stuckFor + COACH_TIMING.quietAfterInput;
  return s.nextNudge >= earliest ? s : { ...s, nextNudge: earliest };
}

export interface CoachStepResult {
  readonly state: CoachState;
  /** A nudge to say this frame, or null. */
  readonly nudge: LineId | null;
}

/**
 * One frame of the coach: the problem now (from coachProblem), timed over `dt` seconds. The timer
 * runs only while the board runs (a card, a scene or the pause menu stop it), restarts when the
 * problem changes, and says a nudge when one is due. Returns `s` itself when nothing changed.
 */
export function stepCoach(
  s: CoachState,
  p: CoachProblem | null,
  dt: number,
  paused: boolean,
): CoachStepResult {
  if (p === null) {
    if (s.problem === null) return { state: s, nudge: null };
    return { state: { ...NEW_COACH, said: s.said }, nudge: null };
  }
  if (s.problem === null || s.problem.key !== p.key) {
    return {
      state: { problem: p, stuckFor: 0, nudges: 0, nextNudge: timingOf(p.step).firstNudge, said: s.said },
      nudge: null,
    };
  }
  if (paused || dt <= 0) return { state: s.problem === p ? s : { ...s, problem: p }, nudge: null };
  const stuckFor = s.stuckFor + dt;
  if (stuckFor + 1e-9 < s.nextNudge) return { state: { ...s, problem: p, stuckFor }, nudge: null };
  const nudge = nudgeFor(p, s.nudges);
  return {
    state: {
      problem: p,
      stuckFor,
      nudges: s.nudges + 1,
      nextNudge: stuckFor + gapAfter(s.nudges),
      said: s.said + 1,
    },
    nudge,
  };
}

/** Whether the highlight (and the band's hint) is showing: the problem has lasted long enough. */
export function coachLit(s: CoachState): boolean {
  return s.problem !== null && s.stuckFor + 1e-9 >= timingOf(s.problem.step).highlightAfter;
}

/** The band's hint for the coach now, or null (nothing lit, or a step with no hint). */
export function coachHint(s: CoachState): LineId | null {
  return coachLit(s) && s.problem ? s.problem.hint : null;
}
