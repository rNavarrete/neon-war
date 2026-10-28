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

import { type ArtRequest, artRequest, isPicked, requestFile } from '../../game/artManifest';
import { speakerName } from '../../game/portraits';
import { LINES, type LineId } from '../../strings';
import { typedChars } from '../../story/scripts';
import { fileTexture } from '../plates';
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

// ---- TRIAGE's iris, the speaker's glow, the crew light-up (comms-4) ----

/** TRIAGE's six moods as docs/SCRIPT.md writes them in her speaker brackets. */
export const TRIAGE_MOODS = [
  'eager',
  'happy',
  'thinking',
  'sheepish',
  'wrong-and-proud',
  'panicking',
] as const;
export type TriageMood = (typeof TRIAGE_MOODS)[number];

/** Her mood when she is not speaking (and for a bracket the table does not know). */
export const IDLE_MOOD: TriageMood = 'eager';

/** The panicking jitter's rate (Hz). */
export const PANIC_JITTER_HZ = 12;

/** The iris as drawn over TRIAGE's lens: an offset from the slot centre, a radius and the lid (1 open). */
export interface Iris {
  readonly dx: number;
  readonly dy: number;
  readonly r: number;
  readonly open: number;
}

/** Each mood's one motion: a resting look, a radius, an optional sway and a blink period. */
interface IrisSpec {
  /** Resting offset from the lens centre (px). */
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** A sway around the resting look: amplitude (px) and rate (Hz) on each axis. */
  readonly ax: number;
  readonly ay: number;
  readonly hz: number;
  /** Seconds between blinks, or 0 for none. */
  readonly blink: number;
}

const IRIS: Readonly<Record<TriageMood, IrisSpec>> = {
  // Bright and forward, a small bob.
  eager: { x: 0, y: 0, r: 10, ax: 0, ay: 2, hz: 0.8, blink: 3.7 },
  // Wide and easy, a slow sway.
  happy: { x: 0, y: -1, r: 11, ax: 2, ay: 0, hz: 0.5, blink: 4.3 },
  // Up and to the side, drifting.
  thinking: { x: -5, y: -5, r: 9, ax: 2, ay: 1, hz: 0.3, blink: 5.1 },
  // Down and away, small.
  sheepish: { x: 5, y: 6, r: 8, ax: 1, ay: 0, hz: 0.4, blink: 2.9 },
  // Chin up, steady.
  'wrong-and-proud': { x: 0, y: -4, r: 12, ax: 0, ay: 0, hz: 0, blink: 4.7 },
  // Blown wide and shaking; she never blinks.
  panicking: { x: 0, y: 0, r: 14, ax: 3, ay: 3, hz: PANIC_JITTER_HZ, blink: 0 },
};

/** A blink closes the lid for this long. */
const BLINK_SECONDS = 0.12;
/** The lid's opening at the bottom of a blink. */
const BLINK_CLOSED = 0.1;

/** The mood a bracket names, or IDLE_MOOD. */
export function moodOf(mood: string | null): TriageMood {
  return (TRIAGE_MOODS as readonly string[]).includes(mood ?? '') ? (mood as TriageMood) : IDLE_MOOD;
}

/**
 * TRIAGE's iris at time `t` (seconds) in `mood`: one motion per mood (panicking jitters at 12 Hz).
 * Under reduce flicker every sway, jitter and blink is off and the iris rests at the mood's look.
 * The radius is the mood's alone, so it never changes with `t`. Pure.
 */
export function irisFor(mood: string, t: number, reduceFlicker: boolean): Iris {
  const s = IRIS[moodOf(mood)];
  if (reduceFlicker || s.hz === 0)
    return { dx: s.x, dy: s.y, r: s.r, open: reduceFlicker || !s.blink ? 1 : blinkAt(s.blink, t) };
  const w = 2 * Math.PI * s.hz * t;
  // The panic jitter runs its axes out of step, so the iris shakes rather than circles.
  const dx = s.x + s.ax * Math.sin(w);
  const dy = s.y + s.ay * (moodOf(mood) === 'panicking' ? Math.sin(w * 1.37 + 1) : Math.cos(w));
  return { dx, dy, r: s.r, open: s.blink ? blinkAt(s.blink, t) : 1 };
}

function blinkAt(period: number, t: number): number {
  const p = ((t % period) + period) % period;
  return p < BLINK_SECONDS ? BLINK_CLOSED : 1;
}

/** The speaker's ring glows at this rate (Hz). */
export const RING_HZ = 1.2;
/** The ring's alpha at the bottom and top of its glow, and held steady under reduce flicker. */
export const RING_LOW = 0.45;
export const RING_HIGH = 1;
export const RING_STEADY = 0.9;
/** Slots that are not speaking sit back while a line shows. */
export const OTHER_RING_ALPHA = 0.25;

/**
 * The speaker's ring alpha `t` seconds into the line: a 1.2 Hz glow from RING_HIGH down to RING_LOW
 * and back, or steady under reduce flicker (the calm variant). Pure; the band's local stand-in for
 * motion.ts speakRing until art3d-3 lands.
 */
export function speakRing(t: number, reduceFlicker: boolean): number {
  if (reduceFlicker) return RING_STEADY;
  const c = 0.5 + 0.5 * Math.cos(2 * Math.PI * RING_HZ * Math.max(0, t));
  return RING_LOW + (RING_HIGH - RING_LOW) * c;
}

/** A new speaker's face ticks up this much and back over SWAP_TICK_SECONDS. */
export const SWAP_TICK_SECONDS = 0.18;
export const SWAP_TICK_SCALE = 1.08;

/** The speaking face's scale `t` seconds after the speaker changed: a 180 ms tick, then 1. Pure. */
export function swapTick(t: number): number {
  if (t < 0 || t >= SWAP_TICK_SECONDS) return 1;
  return 1 + (SWAP_TICK_SCALE - 1) * Math.sin((Math.PI * t) / SWAP_TICK_SECONDS);
}

/** The crew's slots light over this long once they are in (run().rescued). */
export const CREW_LIGHT_SECONDS = 0.4;
/** Crew slots before the rescue: dark silhouettes (lead conflict 'Crew slots before the rescue'). */
export const DARK_TINT = 0x55556a;
export const DARK_ALPHA = 0.3;

/** How lit the crew are: 0 dark, 1 lit; `since` is the HUD clock they came in, null while out. Pure. */
export function crewLight(since: number | null, clock: number): number {
  if (since === null) return 0;
  return Math.max(0, Math.min(1, (clock - since) / CREW_LIGHT_SECONDS));
}

/** The crew face's tint and alpha at light `k` (0 dark, 1 lit): the silhouette eased to white. Pure. */
export function crewTint(k: number): { tint: number; alpha: number } {
  const e = Math.max(0, Math.min(1, k));
  const ch = (shift: number): number => {
    const from = (DARK_TINT >> shift) & 0xff;
    return Math.round(from + (0xff - from) * e) << shift;
  };
  return { tint: ch(16) | ch(8) | ch(0), alpha: DARK_ALPHA + (1 - DARK_ALPHA) * e };
}

// ---- art through the manifest (comms-9) ----

/** The band plate's manifest key (docs/ART-REQUESTS.md, batch 2), cut at the band's 1455x150. */
export const COMMS_PLATE = 'hud/comms-plate';
/** The HUD's own text-box plate, nine-sliced: the plate's fallback when its reused file isn't loaded. */
export const LEGACY_PLATE = 'hud:textbox';
/** The HOUSE chips' display size (the manifest's 64x64, never upscaled). */
export const CHIP_SIZE = 64;

/** Where a piece of the band's art comes from: the picked file, a reused picked file, or code. */
export type ArtUse = 'picked' | 'reuse' | 'code';

export interface PlateArt {
  readonly use: ArtUse;
  /** The texture to draw, or null for the code plate. */
  readonly texture: string | null;
  /** Nine-sliced (a reused frame stretched to the band) or drawn as is (the picked plate, cut to size). */
  readonly nine: boolean;
  readonly tint: number;
  readonly alpha: number;
}

/**
 * The band plate: the picked comms-plate once the manifest carries its cut and its texture loaded;
 * else its fallback, the text-box plate nine-sliced (the reused file, or the HUD's own copy of it);
 * else a code rectangle. `exists` is the scene's texture check; `request` is the manifest's entry,
 * passed in by tests to stand for a pick that has landed. Pure.
 */
export function plateArt(
  exists: (texture: string) => boolean,
  request: ArtRequest | undefined = artRequest(COMMS_PLATE),
): PlateArt {
  if (request && isPicked(request)) {
    const texture = fileTexture(requestFile(request.key));
    if (exists(texture)) return { use: 'picked', texture, nine: false, tint: 0xffffff, alpha: 1 };
  }
  const f = request?.fallback;
  const tint = f?.kind === 'reuse' ? f.tint : 0xffffff;
  const alpha = f?.alpha ?? 1;
  if (f?.kind === 'reuse' && exists(fileTexture(f.file)))
    return { use: 'reuse', texture: fileTexture(f.file), nine: true, tint, alpha };
  if (exists(LEGACY_PLATE)) return { use: 'reuse', texture: LEGACY_PLATE, nine: true, tint, alpha };
  return { use: 'code', texture: null, nine: false, tint, alpha };
}

/** The picked file a plate request loads from, or null while it is not picked. Pure. */
export function plateFile(request: ArtRequest | undefined = artRequest(COMMS_PLATE)): string | null {
  return request && isPicked(request) ? requestFile(request.key) : null;
}

export interface ChipArt {
  readonly key: string;
  readonly use: ArtUse;
  /** The picked chip's texture, or null for the code glyph (a door or a TV). */
  readonly texture: string | null;
}

/**
 * A HOUSE chip (hud/icons/door or hud/icons/tv): its picked file once the manifest carries its cut
 * and the texture loaded, else the code glyph. Its baked stand-in is a blank disc, so the glyph
 * says more until the pick lands. Pure.
 */
export function chipArt(
  key: string,
  exists: (texture: string) => boolean,
  request: ArtRequest | undefined = artRequest(key),
): ChipArt {
  if (request && isPicked(request)) {
    const texture = fileTexture(requestFile(key));
    if (exists(texture)) return { key, use: 'picked', texture };
  }
  return { key, use: 'code', texture: null };
}
