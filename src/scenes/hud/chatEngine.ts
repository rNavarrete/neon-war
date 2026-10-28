// LIVE CHAT's model (ZONES.chat, contract hud.chat): one merged feed of the block's neighbours and
// Lux's stream, where every row has a cause on the board. The only chat model on the Live screen
// (hud.chatLog is dropped; every hud.chat.feed row carries its cause and time).
//
// Reactions come from the occurrence stream (src/game/occurrences.ts), bus actions and a few held
// edges on the Frame (errors held 1 s, heavy errors held 2 s, calm held 3 s after a spell, the
// first serve, retries, the surge). Scripted chat ids arrive from cues.ts through postScripted and
// post at once, once each, setting their reaction's cooldown so the generic pool never doubles
// them. Everything else is paced (CHAT_PACE): a minimum gap by the block's error state, 10 posts per
// 30 s, a queue of 4 with anything older than 6 s dropped, and a 2 s quiet after a lesson line
// (bus line {lesson: true}); other band lines do not quiet it. Filler keeps the chat alive after
// 6 to 10 s of silence, from the pool of the block's state (chat.ts), block twice for every stream
// line.
//
// viewersOf is the tiny honest audience (decision D5): 2 until the first serve, 3 from it, 1 after
// 5 s of heavy errors, 3 on recovery, 4 at a held midnight, 0 when the block goes dark; it never
// rises during a surge and never exceeds 4.
//
// Pure: no Phaser, no Date. Time comes in as the HUD clock; randomness from an injected rand.
// stepChat returns the identical state and NO_POSTS on a frame with no edges or events.

import type { Frame } from '../../game/frame';
import type { Occurrence, OccurrenceKind } from '../../game/occurrences';
import type { BannerChoice } from '../../sim/economy';
import { BROWNOUT } from '../../sim/brownout';
import { LINES, type LineId } from '../../strings';
import { type ChatKind, chatEntry, chatOf, fillerDelay, fitRows } from './chat';
import { type ErrorState, errorState } from './format';
import { isLesson } from './lineMeta';

// ---- pace ----

export const CHAT_PACE = Object.freeze({
  /** Minimum seconds between two posts, by the block's error state. */
  minGap: Object.freeze({ ok: 2.5, slow: 1.8, down: 1.2 } as Record<ErrorState, number>),
  /** At most `windowMax` posts in any `windowSeconds`. */
  windowSeconds: 30,
  windowMax: 10,
  /** Reactions waiting to post; the oldest is dropped when a fifth arrives. */
  queueMax: 4,
  /** A queued reaction older than this is dropped. */
  staleSeconds: 6,
  /** No reaction or filler for this long after a lesson line starts. */
  lessonQuiet: 2,
});

/** Error share held this long before the block complains. */
export const ERRORS_HOLD = 1;
/** Error share >= 0.5 held this long before the heavy reactions. */
export const HEAVY_HOLD = 2;
/** A spell of errors at least this long, then this much calm, before the thanks. */
export const SPELL_MIN = 3;
export const CALM_HOLD = 3;
/** Heavy errors held this long before the audience falls to 1. */
export const VIEWERS_HEAVY_HOLD = 5;
/** Retries share edges that earn a reaction. */
export const RETRY_STEPS: readonly number[] = [0.2, 0.4];
/** Rows the feed keeps as history (the view shows the newest five). */
export const FEED_MAX = 40;
/** Rows the view shows. */
export const VISIBLE_ROWS = 5;

// ---- causes and reactions ----

/** Why a row was posted: always set, so the feed is caused (T10). */
export type ChatCause =
  | OccurrenceKind
  | 'firstServed'
  | 'served'
  | 'errorsRising'
  | 'errorsHeavy'
  | 'recovered'
  | 'surgeWarning'
  | 'surgeLanded'
  | 'overclock'
  | 'banner'
  | 'seed'
  | 'cue'
  | 'filler';

export type ReactionKey =
  | 'placed'
  | 'wired'
  | 'overclock'
  | 'bannerPay'
  | 'bannerIgnore'
  | 'bannerBin'
  | 'servedBlock'
  | 'servedStream'
  | 'errorsBlock'
  | 'errorsStream'
  | 'heavyBlock'
  | 'heavyStream'
  | 'recoveredBlock'
  | 'recoveredStream'
  | 'rejoin'
  | 'retriesBlock'
  | 'retriesStream'
  | 'hot'
  | 'died'
  | 'dip'
  | 'skipped'
  | 'laundryBlock'
  | 'laundryStream'
  | 'surgeWarning'
  | 'surgeBlock'
  | 'surgeStream'
  | 'rescued'
  | 'heldBlock'
  | 'heldStream';

export interface Reaction {
  /** The id prefix of its own lines (chat-2 writes them into the chat anchor). */
  readonly pool: string;
  /** A pinned filler pool standing in while its own pool is empty, or null to stay silent. */
  readonly fallback: string | null;
  /** Seconds before the same reaction may post again (Infinity: once per run). */
  readonly cap: number;
  /** A neighbour complaining about the service: posted only while the block has errors. */
  readonly complaint?: true;
  /** A neighbour thanking: posted only after a spell ends and calm holds. */
  readonly thanks?: true;
  /** Dropped at post time if the block has no errors by then (keeps slow and down lines honest). */
  readonly whileErrors?: true;
}

const R = (
  pool: string,
  fallback: string | null,
  cap: number,
  flags: Partial<Pick<Reaction, 'complaint' | 'thanks' | 'whileErrors'>> = {},
): Reaction => Object.freeze({ pool, fallback, cap, ...flags });

const SO = 'fill.stream.ok.';
const BO = 'fill.block.ok.';

/**
 * Every reaction, from 05-comms "Live chat". Each draws from its own pool, written by chat-2 into the
 * chat anchor of docs/SCRIPT.md and src/strings.ts. The fallback stands in only if a pool is ever
 * emptied: the calm ones borrow the pinned all-fine filler and the error ones the some-errors or
 * heavy-errors filler (posted only while the block has errors); reactions with no honest stand-in
 * (a hot, dead or dark box, the laundry, the surge landing) stay silent then.
 */
export const REACTIONS: Readonly<Record<ReactionKey, Reaction>> = Object.freeze({
  placed: R('fill.stream.placed.', SO, 12),
  wired: R('fill.stream.wired.', SO, 12),
  overclock: R('fill.stream.overclock.', SO, 60),
  bannerPay: R('fill.stream.pay.', SO, 60),
  bannerIgnore: R('fill.stream.ignore.', SO, 60),
  bannerBin: R('fill.stream.bin.', SO, 60),
  servedBlock: R('fill.block.served.', BO, 30),
  servedStream: R('fill.stream.served.', SO, 30),
  errorsBlock: R('fill.block.errors.', 'fill.block.slow.', 15, { complaint: true, whileErrors: true }),
  errorsStream: R('fill.stream.errors.', 'fill.stream.slow.', 15, { whileErrors: true }),
  heavyBlock: R('fill.block.heavy.', 'fill.block.down.', 20, { complaint: true, whileErrors: true }),
  heavyStream: R('fill.stream.heavy.', 'fill.stream.down.', 20, { whileErrors: true }),
  recoveredBlock: R('fill.block.recovered.', BO, 20, { thanks: true }),
  recoveredStream: R('fill.stream.recovered.', SO, 20),
  rejoin: R('fill.block.rejoin.', null, 20),
  retriesBlock: R('fill.block.retries.', null, 25, { complaint: true, whileErrors: true }),
  retriesStream: R('fill.stream.retries.', null, 25),
  hot: R('fill.stream.hot.', null, 20),
  died: R('fill.stream.died.', null, 20),
  dip: R('fill.stream.dip.', null, 15),
  skipped: R('fill.stream.skipped.', SO, Infinity),
  laundryBlock: R('fill.block.laundry.', null, 60),
  laundryStream: R('fill.stream.laundry.', null, 60),
  surgeWarning: R('fill.stream.warning.', SO, 20),
  surgeBlock: R('fill.block.surge.', null, 20),
  surgeStream: R('fill.stream.surge.', null, 20),
  rescued: R('fill.stream.rescue.', SO, 60),
  heldBlock: R('fill.block.held.', BO, 60),
  heldStream: R('fill.stream.held.', SO, 60),
});

/** The reaction each scripted chat id stands in for: posting it starts that reaction's cooldown. */
export const SCRIPTED_REACTION: Readonly<Partial<Record<LineId, ReactionKey>>> = Object.freeze({
  'C1.chat.01': 'servedBlock',
  'C1.chat.02': 'servedStream',
  'C3.chat.01': 'surgeWarning',
  'C3.chat.02': 'surgeBlock',
  'C3.chat.03': 'died',
  'C4.chat.01': 'errorsBlock',
  'C4.chat.02': 'retriesBlock',
  'C4.chat.04': 'heavyStream',
  'C4.chat.cut': 'laundryBlock',
  'C5.chat.01': 'recoveredBlock',
  'C6.chat.hold.01': 'heldBlock',
  'C6.chat.hold.02': 'heldBlock',
  'C7.chat.01': 'heldBlock',
});

/** The cause a reaction's rows carry. */
const CAUSE_OF: Readonly<Record<ReactionKey, ChatCause>> = {
  placed: 'placed',
  wired: 'wired',
  overclock: 'overclock',
  bannerPay: 'banner',
  bannerIgnore: 'banner',
  bannerBin: 'banner',
  servedBlock: 'served',
  servedStream: 'served',
  errorsBlock: 'errorsRising',
  errorsStream: 'errorsRising',
  heavyBlock: 'errorsHeavy',
  heavyStream: 'errorsHeavy',
  recoveredBlock: 'recovered',
  recoveredStream: 'recovered',
  rejoin: 'recovered',
  retriesBlock: 'retriesRising',
  retriesStream: 'retriesRising',
  hot: 'hot',
  died: 'died',
  dip: 'dip',
  skipped: 'skipped',
  laundryBlock: 'laundryCut',
  laundryStream: 'laundryCut',
  surgeWarning: 'surgeWarning',
  surgeBlock: 'surgeLanded',
  surgeStream: 'surgeLanded',
  rescued: 'rescued',
  heldBlock: 'held',
  heldStream: 'held',
};

/** Scripted lines in which a neighbour leaves the chat, and who. Filler never speaks for them. */
export const LEAVERS: Readonly<Partial<Record<LineId, string>>> = Object.freeze({
  'C4.chat.03': 'mrs okafor',
});

/** The stage direction for a dark midnight: the chat falls silent, no row. */
export const SILENCE_ID: LineId = 'C6.fail.chat';

/** The phone messages the chat opens with when the board opens. */
export const SEED_IDS: readonly LineId[] = ['C0.chat.01', 'C0.chat.02', 'C0.chat.03', 'C0.chat.04'];

const ALL_IDS = Object.keys(LINES) as LineId[];
const poolCache = new Map<string, readonly LineId[]>();

/** The lines whose id starts with `prefix`, in script order (cached). */
export function linesOf(prefix: string): readonly LineId[] {
  let pool = poolCache.get(prefix);
  if (!pool) {
    pool = Object.freeze(ALL_IDS.filter((id) => id.startsWith(prefix)));
    poolCache.set(prefix, pool);
  }
  return pool;
}

/** The lines a reaction draws from today: its own pool, else its fallback, else none. */
export function reactionLines(key: ReactionKey): readonly LineId[] {
  const r = REACTIONS[key];
  const own = linesOf(r.pool);
  if (own.length > 0 || r.fallback === null) return own;
  return linesOf(r.fallback);
}

// ---- rows, inputs, state ----

export interface ChatRow {
  readonly id: LineId;
  readonly chat: ChatKind;
  readonly who: string;
  readonly text: string;
  readonly cause: ChatCause;
  /** HUD clock it posted. */
  readonly at: number;
  readonly scripted: boolean;
  readonly complaint: boolean;
  readonly thanks: boolean;
  /** A system row (someone left or rejoined; the block's own notices). */
  readonly system: boolean;
}

/** What the chat reads from the Frame each step, flattened to primitives. */
export interface ChatInputs {
  /** The HUD clock. */
  readonly clock: number;
  /** Sim seconds. */
  readonly now: number;
  readonly errorShare: number;
  /** Frame.retry. */
  readonly retry: number;
  /** Frame.served (req/s served). */
  readonly served: number;
  /** Servers with load > 0 (Frame.flow.load). */
  readonly servingBoxes: number;
  /** Frame.surge?.surge.startsAt, or null. */
  readonly surgeAt: number | null;
  /** Frame.midnight?.held. */
  readonly midnightHeld: boolean;
  /** Frame.midnight set and not held: the block is dark. */
  readonly midnightDark: boolean;
  /** Frame.rewinds.length. */
  readonly rewinds: number;
}

/** What else happened this frame: the occurrences, the band line that started, a board action. */
export type ChatEvent =
  | { readonly kind: 'occurrence'; readonly occurrence: Occurrence }
  | { readonly kind: 'line'; readonly id: LineId; readonly lesson?: boolean }
  | { readonly kind: 'action'; readonly type: 'overclock' }
  | { readonly kind: 'action'; readonly type: 'banner'; readonly choice: BannerChoice };

export interface QueuedReaction {
  readonly key: ReactionKey;
  readonly at: number;
}

export type ChatFilter = 'all' | 'block';

export interface ChatState {
  readonly feed: readonly ChatRow[];
  readonly queue: readonly QueuedReaction[];
  /** Post times inside the last window (pruned when a post is considered). */
  readonly recent: readonly number[];
  readonly lastPostAt: number;
  readonly nextFillerAt: number;
  readonly fillers: number;
  readonly lastFiller: LineId | null;
  readonly quietUntil: number;
  readonly cooldown: Readonly<Partial<Record<ReactionKey, number>>>;
  /** Scripted ids already posted this run. */
  readonly scripted: readonly LineId[];
  readonly silenced: boolean;
  readonly left: readonly string[];
  readonly filter: ChatFilter;
  readonly watching: number;
  // Edge memory on the HUD clock.
  readonly errSince: number | null;
  readonly heavySince: number | null;
  readonly calmSince: number | null;
  /** The last spell of errors: when it started and whether it lasted SPELL_MIN. */
  readonly spellLong: boolean;
  readonly complained: boolean;
  readonly heavied: boolean;
  readonly servedOnce: boolean;
  readonly servingMax: number;
  readonly retryStep: number;
  readonly surgeAt: number | null;
  readonly surgeLanded: number | null;
  readonly rewinds: number;
}

export interface ChatStep {
  readonly state: ChatState;
  readonly posts: readonly ChatRow[];
}

export const NO_POSTS: readonly ChatRow[] = Object.freeze([]);

/** A fresh chat at HUD clock `clock`. */
export function initialChat(clock: number, rand: () => number, rewinds = 0): ChatState {
  return {
    feed: [],
    queue: [],
    recent: [],
    lastPostAt: -Infinity,
    nextFillerAt: clock + fillerDelay(rand),
    fillers: 0,
    lastFiller: null,
    quietUntil: -Infinity,
    cooldown: {},
    scripted: [],
    silenced: false,
    left: [],
    filter: 'all',
    watching: 2,
    errSince: null,
    heavySince: null,
    calmSince: clock,
    spellLong: false,
    complained: false,
    heavied: false,
    servedOnce: false,
    servingMax: 0,
    retryStep: 0,
    surgeAt: null,
    surgeLanded: null,
    rewinds,
  };
}

// ---- the audience ----

/** The sim-time windows of the surges the audience never grows in: the district surge and midnight's. */
export const SURGE_WINDOWS: readonly (readonly [number, number])[] = [
  [BROWNOUT.challenges.c4, BROWNOUT.challenges.c5],
  [BROWNOUT.challenges.c6, BROWNOUT.challenges.c7],
];

export const inSurge = (now: number): boolean => SURGE_WINDOWS.some(([a, b]) => now >= a && now < b);

/** The facts the audience follows. */
export interface ViewerFacts {
  readonly now: number;
  readonly servedOnce: boolean;
  /** Seconds error share has been >= 0.5, or 0. */
  readonly heavyFor: number;
  /** Seconds error share has been 0 (after the last spell), or 0 while errors last. */
  readonly calmFor: number;
  readonly held: boolean;
  readonly dark: boolean;
}

/**
 * How many are watching after `prev`: 2 until the first serve, 3 from it, 1 after 5 s of heavy
 * errors, 3 once calm holds 3 s, 4 at a held midnight, 0 when dark. Never above 4, and never
 * rising inside a surge window (the held midnight aside: it ends the night at 4).
 */
export function viewersOf(prev: number, f: ViewerFacts): number {
  if (f.dark) return 0;
  if (f.held) return 4;
  let n = prev === 0 ? (f.servedOnce ? 3 : 2) : prev;
  if (f.heavyFor >= VIEWERS_HEAVY_HOLD - 1e-9) n = Math.min(n, 1);
  const mayRise = !inSurge(f.now);
  if (mayRise && n === 2 && f.servedOnce) n = 3;
  if (mayRise && n === 1 && f.calmFor >= CALM_HOLD - 1e-9) n = 3;
  return Math.max(0, Math.min(4, n));
}

// ---- helpers ----

const EPS = 1e-9;

function rowFor(id: LineId, cause: ChatCause, at: number, scripted: boolean, r?: Reaction): ChatRow {
  const e = chatEntry(id);
  const speaker = LINES[id].speaker;
  return {
    id,
    chat: chatOf(id) ?? 'block',
    who: e.who,
    text: e.text,
    cause,
    at,
    scripted,
    complaint: r?.complaint === true,
    thanks: r?.thanks === true,
    system: speaker.includes('(system)'),
  };
}

const pushFeed = (feed: readonly ChatRow[], row: ChatRow): ChatRow[] => {
  const next = [...feed, row];
  return next.length > FEED_MAX ? next.slice(next.length - FEED_MAX) : next;
};

/** Posts inside the window ending at `clock`. */
function windowCount(recent: readonly number[], clock: number): number {
  let n = 0;
  for (const t of recent) if (clock - t < CHAT_PACE.windowSeconds - EPS) n++;
  return n;
}

const pickFrom = (pool: readonly LineId[], rand: () => number): LineId =>
  pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];

/** Which filler pool the block's error share picks (chat.ts's ok, slow, down). */
export function chatSetFor(errorShare: number): ErrorState {
  return errorState(errorShare);
}

/** Whether filler may post at `clock`: not silenced, not quiet, nothing waiting and the delay run out. */
export function fillerAllowed(s: ChatState, clock: number): boolean {
  return (
    !s.silenced &&
    clock >= s.quietUntil - EPS &&
    s.queue.length === 0 &&
    clock >= s.nextFillerAt - EPS &&
    windowCount(s.recent, clock) < CHAT_PACE.windowMax
  );
}

/** Mutable draft of a step; copied once, only when something changes. */
type Draft = { -readonly [K in keyof ChatState]: ChatState[K] };

function enqueue(d: Draft, key: ReactionKey, clock: number): void {
  const until = d.cooldown[key];
  if (until !== undefined && clock < until - EPS) return;
  if (d.queue.some((q) => q.key === key)) return;
  const q = [...d.queue, { key, at: clock }];
  d.queue = q.length > CHAT_PACE.queueMax ? q.slice(q.length - CHAT_PACE.queueMax) : q;
}

function post(d: Draft, row: ChatRow, clock: number, rand: () => number): void {
  d.feed = pushFeed(d.feed, row);
  d.recent = [...d.recent.filter((t) => clock - t < CHAT_PACE.windowSeconds - EPS), clock];
  d.lastPostAt = clock;
  d.nextFillerAt = clock + fillerDelay(rand);
}

// ---- the step ----

/**
 * One frame of the chat. Returns the identical state and NO_POSTS when nothing happened: no event,
 * no edge on the inputs, nothing due in the queue or the filler. Never mutates its inputs.
 */
export function stepChat(
  s: ChatState,
  inp: ChatInputs,
  events: readonly ChatEvent[],
  rand: () => number,
): ChatStep {
  const c = inp.clock;
  let d: Draft | null = null;
  const draft = (): Draft => (d ??= { ...s });
  // Allocated only on a frame that posts.
  let posts: ChatRow[] | null = null;

  // A rewind reseeds: the block is back, the queue and the silence go, the trackers restart.
  if (inp.rewinds > s.rewinds) {
    const x = draft();
    x.rewinds = inp.rewinds;
    x.queue = [];
    x.silenced = false;
    x.errSince = null;
    x.heavySince = null;
    x.calmSince = c;
    x.spellLong = false;
    x.complained = false;
    x.heavied = false;
    x.retryStep = 0;
    x.surgeAt = null;
    x.surgeLanded = null;
    x.quietUntil = -Infinity;
  }

  // Events.
  for (const e of events) {
    const x = draft();
    if (e.kind === 'line') {
      if (e.lesson ?? isLesson(e.id)) x.quietUntil = Math.max(x.quietUntil, c + CHAT_PACE.lessonQuiet);
      continue;
    }
    if (e.kind === 'action') {
      if (e.type === 'overclock') enqueue(x, 'overclock', c);
      else
        enqueue(
          x,
          e.choice === 'pay' ? 'bannerPay' : e.choice === 'ignore' ? 'bannerIgnore' : 'bannerBin',
          c,
        );
      continue;
    }
    const o = e.occurrence;
    switch (o.kind) {
      case 'placed':
      case 'wired':
      case 'hot':
      case 'died':
      case 'dip':
      case 'skipped':
      case 'rescued':
        enqueue(x, o.kind, c);
        break;
      case 'laundryCut':
        enqueue(x, 'laundryBlock', c);
        enqueue(x, 'laundryStream', c);
        break;
      case 'held':
        enqueue(x, 'heldBlock', c);
        enqueue(x, 'heldStream', c);
        break;
      case 'dark':
        if (o.id === undefined) {
          x.silenced = true;
          x.queue = [];
        }
        break;
      default:
        break;
    }
  }

  // Held edges on the Frame.
  const base: ChatState = d ?? s;
  const errOn = inp.errorShare > 0;
  const errSince = errOn ? (base.errSince ?? c) : null;
  const heavySince = inp.errorShare >= 0.5 ? (base.heavySince ?? c) : null;
  const calmSince = errOn ? null : (base.calmSince ?? c);
  if (errSince !== base.errSince || heavySince !== base.heavySince || calmSince !== base.calmSince) {
    const x = draft();
    // A spell just ended: remember whether it was long enough to thank for.
    if (base.errSince !== null && !errOn) x.spellLong = c - base.errSince >= SPELL_MIN - EPS;
    if (errOn && base.errSince === null) {
      x.complained = false;
      x.heavied = false;
      x.spellLong = false;
    }
    x.errSince = errSince;
    x.heavySince = heavySince;
    x.calmSince = calmSince;
  }
  const cur = (): ChatState => d ?? s;
  if (errSince !== null && !cur().complained && c - errSince >= ERRORS_HOLD - EPS) {
    const x = draft();
    x.complained = true;
    enqueue(x, 'errorsBlock', c);
    enqueue(x, 'errorsStream', c);
  }
  if (heavySince !== null && !cur().heavied && c - heavySince >= HEAVY_HOLD - EPS) {
    const x = draft();
    x.heavied = true;
    enqueue(x, 'heavyBlock', c);
    enqueue(x, 'heavyStream', c);
  }
  if (calmSince !== null && cur().spellLong && c - calmSince >= CALM_HOLD - EPS) {
    const x = draft();
    x.spellLong = false;
    enqueue(x, 'recoveredBlock', c);
    enqueue(x, 'recoveredStream', c);
    if (x.left.length > 0) enqueue(x, 'rejoin', c);
  }
  if (inp.served > 0 && !cur().servedOnce) {
    const x = draft();
    x.servedOnce = true;
    enqueue(x, 'servedBlock', c);
    enqueue(x, 'servedStream', c);
  }
  if (inp.servingBoxes > cur().servingMax) {
    const x = draft();
    if (x.servingMax > 0) {
      enqueue(x, 'servedBlock', c);
      enqueue(x, 'servedStream', c);
    }
    x.servingMax = inp.servingBoxes;
  }
  const step = cur().retryStep;
  if (step < RETRY_STEPS.length && inp.retry >= RETRY_STEPS[step] - EPS) {
    const x = draft();
    let n = step;
    while (n < RETRY_STEPS.length && inp.retry >= RETRY_STEPS[n] - EPS) n++;
    x.retryStep = n;
    enqueue(x, 'retriesBlock', c);
    enqueue(x, 'retriesStream', c);
  }
  if (inp.surgeAt !== cur().surgeAt) {
    const x = draft();
    if (inp.surgeAt !== null) enqueue(x, 'surgeWarning', c);
    x.surgeAt = inp.surgeAt;
  }
  const sa = cur().surgeAt;
  if (sa !== null && inp.now >= sa && cur().surgeLanded !== sa) {
    const x = draft();
    x.surgeLanded = sa;
    enqueue(x, 'surgeBlock', c);
    enqueue(x, 'surgeStream', c);
  }

  // The audience.
  const now = cur();
  const watching = viewersOf(now.watching, {
    now: inp.now,
    servedOnce: now.servedOnce,
    heavyFor: heavySince === null ? 0 : c - heavySince,
    calmFor: calmSince === null || now.errSince !== null ? 0 : c - calmSince,
    held: inp.midnightHeld,
    dark: inp.midnightDark || now.silenced,
  });
  if (watching !== now.watching) draft().watching = watching;

  // The queue: stale and cooled-down reactions drop out (an edge in time: copy only then).
  const q0 = cur().queue;
  if (q0.length > 0) {
    let keep = 0;
    for (const q of q0) if (fresh(q, cur(), c)) keep++;
    if (keep !== q0.length) {
      const x = draft();
      x.queue = q0.filter((q) => fresh(q, x, c));
    }
  }

  // Post at most one reaction, then filler if nothing else is due.
  const st = cur();
  const gap = CHAT_PACE.minGap[errorState(inp.errorShare)];
  const open =
    !st.silenced &&
    c >= st.quietUntil - EPS &&
    c - st.lastPostAt >= gap - EPS &&
    windowCount(st.recent, c) < CHAT_PACE.windowMax;
  if (open && st.queue.length > 0) {
    const x = draft();
    while (x.queue.length > 0) {
      const head = x.queue[0];
      x.queue = x.queue.slice(1);
      const r = REACTIONS[head.key];
      if (r.whileErrors && inp.errorShare <= 0) continue;
      const pool = reactionLines(head.key).filter((id) => !speaksForLeaver(id, x.left));
      if (pool.length === 0) continue;
      const id = pickFrom(pool, rand);
      const row = rowFor(id, CAUSE_OF[head.key], c, false, r);
      post(x, row, c, rand);
      x.cooldown = { ...x.cooldown, [head.key]: c + r.cap };
      if (head.key === 'rejoin') x.left = [];
      (posts ??= []).push(row);
      break;
    }
  } else if (open && fillerAllowed(st, c)) {
    const x = draft();
    const chat: ChatKind = x.fillers % 3 === 2 ? 'stream' : 'block';
    const state = chatSetFor(inp.errorShare);
    const pool = linesOf(`fill.${chat}.${state}.`).filter(
      (id) => id !== x.lastFiller && !speaksForLeaver(id, x.left),
    );
    if (pool.length > 0) {
      const id = pickFrom(pool, rand);
      const row = rowFor(id, 'filler', c, false);
      post(x, row, c, rand);
      x.fillers += 1;
      x.lastFiller = id;
      (posts ??= []).push(row);
    } else {
      x.nextFillerAt = c + fillerDelay(rand);
    }
  }

  if (d === null) return { state: s, posts: NO_POSTS };
  return { state: d, posts: posts ?? NO_POSTS };
}

function fresh(q: QueuedReaction, s: ChatState, clock: number): boolean {
  if (clock - q.at > CHAT_PACE.staleSeconds + EPS) return false;
  const until = s.cooldown[q.key];
  return until === undefined || clock >= until - EPS;
}

/** Whether a line is spoken by a neighbour who has left. */
function speaksForLeaver(id: LineId, left: readonly string[]): boolean {
  if (left.length === 0) return false;
  return left.includes(chatEntry(id).who.toLowerCase());
}

// ---- scripted lines, seeding, the filter ----

/**
 * Post a scripted chat id (a cue from cues.ts) at once, regardless of pace and quiet, and only once
 * per run. It starts its reaction's cooldown so the generic pool does not double it. The dark
 * midnight's stage direction silences the chat instead of posting a row.
 */
export function postScripted(
  s: ChatState,
  id: LineId,
  clock: number,
  rand: () => number,
  cause?: ChatCause,
): ChatStep {
  if (s.scripted.includes(id) || chatOf(id) === null) return { state: s, posts: NO_POSTS };
  const d: Draft = { ...s, scripted: [...s.scripted, id] };
  if (id === SILENCE_ID) {
    d.silenced = true;
    d.queue = [];
    return { state: d, posts: NO_POSTS };
  }
  const key = SCRIPTED_REACTION[id];
  const r = key ? REACTIONS[key] : undefined;
  const row = rowFor(id, cause ?? (key ? CAUSE_OF[key] : 'cue'), clock, true, r);
  post(d, row, clock, rand);
  if (key && r) {
    d.cooldown = { ...d.cooldown, [key]: clock + r.cap };
    d.queue = d.queue.filter((q) => q.key !== key);
  }
  const leaver = LEAVERS[id];
  if (leaver && !d.left.includes(leaver)) d.left = [...d.left, leaver];
  return { state: d, posts: [row] };
}

/** The four phone messages the chat opens with, posted as scripted rows with cause 'seed'. */
export function seedChat(s: ChatState, clock: number, rand: () => number): ChatStep {
  let state = s;
  const posts: ChatRow[] = [];
  for (const id of SEED_IDS) {
    const step = postScripted(state, id, clock, rand, 'seed');
    state = step.state;
    posts.push(...step.posts);
  }
  return { state, posts: posts.length > 0 ? posts : NO_POSTS };
}

/** The header click: BLOCK + STREAM <-> BLOCK ONLY. */
export function toggleFilter(s: ChatState): ChatState {
  return { ...s, filter: s.filter === 'all' ? 'block' : 'all' };
}

/**
 * The rows on show, oldest first (the view lays them out bottom-up).
 *
 * - `visibleRows(state, n)`: the newest `n` rows the state's filter lets through.
 * - `visibleRows(feed, filter)`: what the LIVE CHAT panel draws: the newest of those rows that fit
 *   the 220 px body (chat.ts fitRows), four or five. hud.chat.shown is its length.
 */
export function visibleRows(s: ChatState, n?: number): ChatRow[];
export function visibleRows(feed: readonly ChatRow[], filter: ChatFilter): ChatRow[];
export function visibleRows(a: ChatState | readonly ChatRow[], b?: number | ChatFilter): ChatRow[] {
  if (isFeed(a)) {
    const filter = b === 'block' ? 'block' : 'all';
    return fitRows(filtered(a, filter), VISIBLE_ROWS);
  }
  const n = typeof b === 'number' ? b : VISIBLE_ROWS;
  const rows = filtered(a.feed, a.filter);
  return rows.slice(Math.max(0, rows.length - n));
}

const isFeed = (a: ChatState | readonly ChatRow[]): a is readonly ChatRow[] => Array.isArray(a);

const filtered = (feed: readonly ChatRow[], filter: ChatFilter): readonly ChatRow[] =>
  filter === 'block' ? feed.filter((r) => r.chat === 'block') : feed;

// ---- the Frame, flattened ----

/** ChatInputs the host fills in place each frame. */
export type ChatInputsDraft = { -readonly [K in keyof ChatInputs]: ChatInputs[K] };

/** A ChatInputs to fill with chatInputsOf; one per view, reused every frame. */
export function emptyChatInputs(): ChatInputsDraft {
  return {
    clock: 0,
    now: 0,
    errorShare: 0,
    retry: 0,
    served: 0,
    servingBoxes: 0,
    surgeAt: null,
    midnightHeld: false,
    midnightDark: false,
    rewinds: 0,
  };
}

/**
 * What the chat reads from this frame, written into `out` (no allocation): the shared Frame's
 * routing (read once per sim change by frame()), never run().flow.
 */
export function chatInputsOf(f: Frame, clock: number, out: ChatInputsDraft): ChatInputsDraft {
  const flow = f.flow;
  let serving = 0;
  for (let i = 0; i < f.parts.length; i++) {
    const p = f.parts[i];
    if (p.kind === 'server' && (flow.load[p.id] ?? 0) > 0) serving++;
  }
  out.clock = clock;
  out.now = f.now;
  out.errorShare = f.errorShare;
  out.retry = f.retry;
  out.served = f.served;
  out.servingBoxes = serving;
  out.surgeAt = f.surge ? f.surge.surge.startsAt : null;
  out.midnightHeld = f.midnight !== null && f.midnight.held;
  out.midnightDark = f.midnight !== null && !f.midnight.held;
  out.rewinds = f.rewinds.length;
  return out;
}
