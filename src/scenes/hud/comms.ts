// The comms band's model (ZONES.comms): which line the crew is saying now, what waits, what was
// said. Lines arrive from the cue table (src/scenes/hud/cues.ts) and play one at a time; each line's
// tag (HINT, WARNING, CREW, LUX, HOUSE) and lesson flag come from src/scenes/hud/lineMeta.ts.
//
// The rules (05-comms.md, lead.json notes_for_writers):
// - one line at a time, FIFO, at most COMMS_QUEUE_MAX waiting;
// - a line dwells max(4, 1 + chars/cps + 1.5, voice + 0.6) seconds, no upper clamp;
// - a WARNING enqueued 1.5 s or more after a HINT started ends that HINT at that clock and plays
//   next; enqueued earlier it waits at the front. It never cuts a CREW line, another WARNING or a
//   lesson line;
// - a queued HINT, CREW or HOUSE line older than its staleAfter is dropped unshown; LUX, WARNING and
//   lesson lines are never stale-dropped;
// - the line's words fade over FADE_SECONDS once the queue runs dry.
//
// Pure: plain data in, new state out (the same object back when nothing changed), the HUD clock in
// seconds passed in. No Phaser, no timers.

import { speakerName } from '../../game/portraits';
import { LINES, type LineId } from '../../strings';
import { typedChars } from '../../story/scripts';
import { BARK_HISTORY, BARK_SECONDS } from './barks';
import { CUES } from './cues';
import { type LineTag, isLesson, tagOf } from './lineMeta';

export { BARK_SECONDS };

/** The band's five slots, left to right (decision D4). Lux has her own cam, so no slot. */
export const COMMS_SLOTS = ['TRIAGE', 'REI', 'MIKA', 'OZZIE', 'HOUSE'] as const;
export type CommsSlot = (typeof COMMS_SLOTS)[number];

/** A HINT shown at least this long can be cut short by a WARNING. */
export const WARNING_PREEMPT_AFTER = 1.5;
/** Seconds a line stays after its voice ends. */
export const VOICE_TAIL = 0.6;
/** Seconds of reading time on top of the typing: 1 s to notice, 1.5 s after the last word. */
export const READ_LEAD = 1;
export const READ_TAIL = 1.5;
/** Lines waiting at most. */
export const COMMS_QUEUE_MAX = 5;
/** Shown lines the model remembers (the hook's history). */
export const COMMS_HISTORY = BARK_HISTORY;
/** A queued HINT, CREW or HOUSE line goes stale after this long. */
export const STALE_SECONDS = 12;
/** ...or this long for a line that follows another by a delay (its cue `follows` something). */
export const STALE_CHAINED_SECONDS = 20;
/** The line's words fade out over this long when nothing follows. */
export const FADE_SECONDS = 0.25;

/** The band tag for a line (from lineMeta). */
export function tag(id: LineId): LineTag {
  return tagOf(id);
}

/** The slot a line's speaker lights, or null for Lux (her cam answers instead). */
export function slotOf(speaker: string): CommsSlot | null {
  const name = speakerName(speaker);
  if (name === 'TRIAGE') return 'TRIAGE';
  if (name === 'Rei') return 'REI';
  if (name === 'Mika') return 'MIKA';
  if (name === 'Ozzie') return 'OZZIE';
  if (name === 'Lux') return null;
  return 'HOUSE';
}

/** The nameplate over the line: TRIAGE, REI, LUX, GRANDMA, TV DOWNSTAIRS. */
export function nameOf(id: LineId): string {
  return speakerName(LINES[id].speaker).toUpperCase();
}

/** TRIAGE's mood for a line ('eager', 'panicking', ...), or null for anyone else. */
export function triageMood(id: LineId): string | null {
  const s = LINES[id].speaker;
  if (speakerName(s) !== 'TRIAGE') return null;
  return /\(([^)]+)\)/.exec(s)?.[1] ?? 'eager';
}

/** Lines whose cue waits on another line by a delay. */
const CHAINED: ReadonlySet<string> = new Set(
  CUES.filter((c) => (c.follows?.length ?? 0) > 0).map((c) => c.id),
);

/** Seconds a queued line may wait before it is dropped unshown, or null if it never goes stale. */
export function staleAfter(id: LineId): number | null {
  const t = tag(id);
  if (t === 'LUX' || t === 'WARNING' || isLesson(id)) return null;
  return CHAINED.has(id) ? STALE_CHAINED_SECONDS : STALE_SECONDS;
}

/** How long a line shows: max(4, 1 + chars/cps + 1.5, voice + 0.6). `voiceSeconds` 0 means unvoiced. */
export function dwellFor(id: LineId, cps: number, voiceSeconds = 0): number {
  const chars = LINES[id].text.length;
  const read = READ_LEAD + chars / Math.max(1, cps) + READ_TAIL;
  const voice = voiceSeconds > 0 ? voiceSeconds + VOICE_TAIL : 0;
  return Math.max(BARK_SECONDS, read, voice);
}

export interface QueuedLine {
  readonly id: LineId;
  /** HUD clock it was enqueued at. */
  readonly at: number;
}

export interface CurrentLine {
  readonly id: LineId;
  /** HUD clock it started. */
  readonly since: number;
  /** HUD clock it ends. */
  readonly until: number;
  /** A voice clip started for it (voiceStart), so `until` covers the clip. */
  readonly voiced: boolean;
}

export interface CommsState {
  readonly current: CurrentLine | null;
  readonly queue: readonly QueuedLine[];
  /** Lines shown so far, oldest first, at most COMMS_HISTORY; a dropped line never appears. */
  readonly history: readonly LineId[];
  /** Lines dropped stale, oldest first, at most COMMS_HISTORY (for tests). */
  readonly dropped: readonly LineId[];
  /** HUD clock the last line ended with nothing to follow it; null while a line shows or before any. */
  readonly idleSince: number | null;
}

export const NO_COMMS: CommsState = { current: null, queue: [], history: [], dropped: [], idleSince: null };

const keepLast = <T>(xs: readonly T[], n: number): readonly T[] =>
  xs.length > n ? xs.slice(xs.length - n) : xs;

/** Never cut short or dropped from a full queue: LUX, lesson and WARNING lines. */
const protectedLine = (id: LineId): boolean => staleAfter(id) === null;

/**
 * Add a line to the band at `clock`. A line already showing or waiting is ignored. A WARNING goes
 * to the front (behind any WARNING already waiting) and ends a HINT that has shown at least 1.5 s
 * at `clock`, unless that HINT is a lesson line. A full queue drops its oldest unprotected line.
 */
export function enqueueComms(s: CommsState, id: LineId, clock: number): CommsState {
  if (s.current?.id === id || s.queue.some((q) => q.id === id)) return s;
  const item: QueuedLine = { id, at: clock };
  let queue: QueuedLine[];
  let current = s.current;
  if (tag(id) === 'WARNING') {
    const front = s.queue.findIndex((q) => tag(q.id) !== 'WARNING');
    const at = front < 0 ? s.queue.length : front;
    queue = [...s.queue.slice(0, at), item, ...s.queue.slice(at)];
    if (
      current &&
      clock < current.until &&
      tag(current.id) === 'HINT' &&
      !isLesson(current.id) &&
      clock - current.since >= WARNING_PREEMPT_AFTER
    ) {
      current = { ...current, until: clock };
    }
  } else {
    queue = [...s.queue, item];
  }
  while (queue.length > COMMS_QUEUE_MAX) {
    const drop = queue.findIndex((q) => !protectedLine(q.id));
    if (drop < 0) break;
    queue = [...queue.slice(0, drop), ...queue.slice(drop + 1)];
  }
  return { ...s, current, queue };
}

/**
 * The band at `clock`: ends the current line when its time is up, drops stale lines, and starts the
 * next one with its dwell at `cps` characters a second. Returns `s` itself when nothing changed.
 */
export function stepComms(s: CommsState, clock: number, cps: number): CommsState {
  if (s.current && clock < s.current.until) return s;
  let dropped = s.dropped;
  let queue = s.queue;
  if (queue.some((q) => isStale(q, clock))) {
    const gone = queue.filter((q) => isStale(q, clock));
    queue = queue.filter((q) => !isStale(q, clock));
    dropped = keepLast([...dropped, ...gone.map((q) => q.id)], COMMS_HISTORY);
  }
  if (queue.length === 0) {
    if (!s.current && queue === s.queue) return s;
    return { ...s, current: null, queue, dropped, idleSince: s.current ? s.current.until : s.idleSince };
  }
  const [next, ...rest] = queue;
  return {
    current: { id: next.id, since: clock, until: clock + dwellFor(next.id, cps), voiced: false },
    queue: rest,
    history: keepLast([...s.history, next.id], COMMS_HISTORY),
    dropped,
    idleSince: null,
  };
}

function isStale(q: QueuedLine, clock: number): boolean {
  const after = staleAfter(q.id);
  return after !== null && clock - q.at > after;
}

/** The voice for the current line started at `clock` and runs `seconds`: hold the line until it ends + 0.6 s. */
export function extendForVoice(s: CommsState, id: LineId, clock: number, seconds: number): CommsState {
  const c = s.current;
  if (!c || c.id !== id) return s;
  const until = Math.max(c.until, clock + seconds + VOICE_TAIL);
  if (until === c.until && c.voiced) return s;
  return { ...s, current: { ...c, until, voiced: true } };
}

/** The last `n` shown lines, newest last, the current one included. */
export function logLines(history: readonly LineId[], current: CurrentLine | null, n = 3): LineId[] {
  const all = current && history[history.length - 1] !== current.id ? [...history, current.id] : [...history];
  return all.slice(Math.max(0, all.length - n));
}

/** The line's opacity: 1 while it shows, fading to 0 over FADE_SECONDS once the band goes idle. */
export function bandAlpha(s: CommsState, clock: number): number {
  if (s.current) return 1;
  if (s.idleSince === null) return 0;
  return Math.max(0, Math.min(1, 1 - (clock - s.idleSince) / FADE_SECONDS));
}

/** Characters of the current line typed at `clock`, at `cps`. */
export function typedOf(c: CurrentLine, clock: number, cps: number): number {
  return typedChars(clock - c.since, cps, LINES[c.id].text.length);
}

// ---- geometry: where the band's pieces sit inside its zone ----

export interface CommsRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The band's pieces from its zone's rect (owner-fixed internals in 01-zones.md: slots r 42 at
 * y 720, x 517 + 98 i; divider x 975; the line from x 1000 wrapped to 760; log rows at y 664, 704,
 * 744). Pure; computed once at create.
 */
export function commsLayout(r: CommsRect) {
  const right = r.x + r.w;
  return {
    title: { x: r.x + 22, y: r.y + 8 },
    slots: COMMS_SLOTS.map((name, i) => ({ name, x: r.x + 62 + 98 * i, y: r.y + 75, r: 42 })),
    slotLabelY: r.y + 122,
    divider: { x: r.x + 520, top: r.y + 14, bottom: r.y + r.h - 14 },
    name: { x: r.x + 545, y: r.y + 12 },
    /** The tag pill, right of the nameplate. */
    tag: { x: r.x + 545, y: r.y + 12, h: 20 },
    text: { x: r.x + 545, y: r.y + 40, w: 760 },
    /** The reread log's three rows, oldest first. */
    log: [r.y + 19, r.y + 59, r.y + 99].map((y) => ({ x: r.x + 545, y, w: 760 })),
    /** The replay glyph, right of the newest row. */
    replay: { x: right - 90, y: r.y + 99, w: 60, h: 34 },
  };
}

export type CommsLayout = ReturnType<typeof commsLayout>;

// ---- the reread log (comms-3) ----

/** A hover this long (real seconds) opens the log. */
export const LOG_HOVER_SECONDS = 0.4;
/** Rows the log shows. */
export const LOG_ROWS = 3;

export interface LogState {
  /** Real seconds the pointer came to rest over the band (not dragging), or null. */
  readonly hoverSince: number | null;
  /** A click pinned the log open. */
  readonly pinned: boolean;
}

export const LOG_CLOSED: LogState = { hoverSince: null, pinned: false };

/**
 * The hover at real time `now`: over the band and not dragging starts (or keeps) the hover; leaving
 * the band or dragging something across it drops it. Returns `s` when nothing changed.
 */
export function stepLog(s: LogState, over: boolean, dragging: boolean, now: number): LogState {
  const hovering = over && !dragging;
  if (hovering) return s.hoverSince === null ? { ...s, hoverSince: now } : s;
  return s.hoverSince === null ? s : { ...s, hoverSince: null };
}

/**
 * A click: on the band it pins the log, and the next click on the band unpins it. Clicks elsewhere
 * (the board, the dial, the keys) leave it as it is, so the player can play with the log pinned.
 */
export function clickLog(s: LogState, onBand: boolean): LogState {
  return onBand ? { ...s, pinned: !s.pinned } : s;
}

/** Whether the log shows at real time `now`: pinned, or hovered for LOG_HOVER_SECONDS. */
export function logOpen(s: LogState, now: number): boolean {
  return s.pinned || (s.hoverSince !== null && now - s.hoverSince >= LOG_HOVER_SECONDS - 1e-9);
}

/** Whether a game point lies on a rect (edges included). */
export function onRect(r: CommsRect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
