// The COMING /s gauge in the instrument panel (ZONES.gauge), as pure rules. A fixed 0..400 arc with
// ticks every 100: a cyan ROOM band to the wired capacity (the room that is actually fed), a dashed
// extension for wired boxes still booting, the amber needle easing toward demand, a red wedge from
// what is served to what is coming while calls drop. Words come from labels.ts in the crew's terms: COMING /s, ROOM, "room
// N/s", NO ROOM YET before anything is wired and OVER BY n/s once more comes than the room takes.
//
// Pure: no Phaser, no clock. Time comes in as `dt` (the HUD clock's step) and the run as a Frame.

import type { Frame } from '../../game/frame';
import { type Part, type Wire, capacityOf } from '../../sim/board';
import { BROWNOUT_RULES } from '../../sim/brownout';
import type { Rect } from '../live/layout';
import { clamp } from './format';
import { LABELS, gaugeSubLine, overBy } from './labels';
import { DEMAND_SCALE_MAX } from './thresholds';

/** The top of the gauge's scale, req/s: the shared demand scale (contract 'thresholds'). */
export const GAUGE_MAX = DEMAND_SCALE_MAX;

/** A tick and its number every 100 req/s. */
export const GAUGE_TICK_STEP = 100;

/** The needle's time constant, in HUD seconds: it covers about 63% of the way in 0.18 s. */
export const NEEDLE_EASE_SECONDS = 0.18;

/** Closer than this, the needle sits exactly on demand. */
const NEEDLE_SNAP = 0.01;

/** Calls dropping counts only above half a call a second (the board's own rounding). */
export const DROPPING_FROM = 0.5;

/** The arc runs from the left (value 0) over the top to the right (GAUGE_MAX), in screen radians. */
export const ARC_START = Math.PI;
export const ARC_END = 2 * Math.PI;

/**
 * The needle's angle for `v` req/s, linear over 0..GAUGE_MAX and clamped to the arc: PI at 0, 1.5 PI
 * (straight up) at 200, 2 PI at 400. Screen angles: y points down, so these sweep over the top.
 */
export function gaugeAngle(v: number): number {
  return ARC_START + (clamp(v, 0, GAUGE_MAX) / GAUGE_MAX) * (ARC_END - ARC_START);
}

/** The tick values, 0, 100, ... 400. */
export const GAUGE_TICKS: readonly number[] = Array.from(
  { length: GAUGE_MAX / GAUGE_TICK_STEP + 1 },
  (_, i) => i * GAUGE_TICK_STEP,
);

/**
 * One step of the needle toward `target` over `dt` HUD seconds: exponential with a 0.18 s time
 * constant, exact once within 0.01. dt 0 (the board held) leaves it where it is.
 */
export function easeNeedle(current: number, target: number, dt: number): number {
  if (!Number.isFinite(current)) return target;
  if (dt <= 0) return current;
  const next = current + (target - current) * (1 - Math.exp(-dt / NEEDLE_EASE_SECONDS));
  return Math.abs(target - next) < NEEDLE_SNAP ? target : next;
}

/** Whether a wire runs into `id` from the gateway, or from a balancer the gateway feeds. */
function fedFromGateway(parts: readonly Part[], wires: readonly Wire[], id: string): boolean {
  for (const w of wires) {
    if (w.to !== id) continue;
    if (w.from === 'gateway') return true;
    let balancer = false;
    for (const p of parts) if (p.id === w.from && p.kind === 'balancer') balancer = true;
    if (!balancer) continue;
    for (const g of wires) if (g.from === 'gateway' && g.to === w.from) return true;
  }
  return false;
}

/** Whether `id` has a wire out to the database. */
function outToDatabase(wires: readonly Wire[], id: string): boolean {
  for (const w of wires) if (w.from === id && w.to === 'database') return true;
  return false;
}

/**
 * Req/s the wired servers still booting or rebooting will add once they are up: a server that is
 * offline with a time to come back (partLook's 'booting' / 'rebooting' status) and wired through
 * the same way Frame.wiredCapacity counts. Dead and dark boxes have no time to come back and add
 * nothing. Allocates nothing.
 */
export function bootingCapacity(
  parts: readonly Part[],
  wires: readonly Wire[],
  offline: readonly string[],
  offlineUntil: Readonly<Record<string, number>>,
  now: number,
): number {
  let total = 0;
  for (const p of parts) {
    if (p.kind !== 'server' || !offline.includes(p.id)) continue;
    const until = offlineUntil[p.id];
    if (until === undefined || until <= now) continue;
    if (fedFromGateway(parts, wires, p.id) && outToDatabase(wires, p.id))
      total += capacityOf(p, BROWNOUT_RULES);
  }
  return total;
}

/** The gauge's state for one frame: what the view draws and what the hook mirrors as hud.gauge. */
export interface GaugeState {
  /** Req/s coming now (the sim's demand). */
  demand: number;
  /** Req/s served now. */
  served: number;
  /** Req/s dropping: flow.dropped while it is over 0.5, else 0. */
  dropped: number;
  /** Req/s the wired, online boxes can serve: the ROOM band (equal to hud.headroom.wiredCapacity). */
  capacity: number;
  /** Req/s the wired boxes still booting will add: the dashed extension past the band. */
  booting: number;
  /** The needle's eased value, req/s. */
  needle: number;
  /** The top of the scale. */
  max: number;
  /** NO ROOM YET with nothing wired, OVER BY n/s when more comes than the room takes, else null. */
  strip: string | null;
  /** The line under the big number: "capacity N req/s", "dropping N req/s" or "no server yet". */
  sub: string;
}

export function emptyGauge(): GaugeState {
  return {
    demand: 0,
    served: 0,
    dropped: 0,
    capacity: 0,
    booting: 0,
    needle: 0,
    max: GAUGE_MAX,
    strip: LABELS.gauge.noRoom,
    sub: gaugeSubLine(0, 0),
  };
}

/** The strip's words: NO CAPACITY YET before anything is wired, OVER BY n/s when over, else null. */
export function gaugeStrip(demand: number, wired: number): string | null {
  if (wired <= 0) return LABELS.gauge.noRoom;
  return overBy(demand, wired);
}

/** What gaugeState reads from a frame. */
export type GaugeInput = Pick<
  Frame,
  'now' | 'demand' | 'served' | 'dropped' | 'wiredCapacity' | 'parts' | 'wires' | 'offline' | 'offlineUntil'
>;

/** What the strip's words depend on: -1 with nothing wired, else the rounded req/s over (0 when not). */
export function stripKey(demand: number, wired: number): number {
  if (wired <= 0) return -1;
  return Math.max(0, Math.round(demand - wired));
}

/** What the sub-line's words depend on: -1 with nothing wired, the rounded room, or the drop (negated). */
export function subKey(wired: number, dropped: number): number {
  if (wired <= 0) return -1;
  return dropped > DROPPING_FROM ? -2 - Math.round(dropped) : Math.round(wired);
}

/** The words' memo: rebuilt only when a key changes, so a quiet frame allocates nothing. */
export interface GaugeMemo {
  stripKey: number;
  subKey: number;
}

export function emptyGaugeMemo(): GaugeMemo {
  return { stripKey: -1, subKey: -1 };
}

/** Fill `out` with this frame's gauge and ease the needle by `dt` HUD seconds. */
export function stepGauge(out: GaugeState, memo: GaugeMemo, f: GaugeInput, dt: number): GaugeState {
  const wired = f.wiredCapacity;
  const dropped = f.dropped > DROPPING_FROM ? f.dropped : 0;
  out.demand = f.demand;
  out.served = f.served;
  out.dropped = dropped;
  out.capacity = wired;
  out.booting = bootingCapacity(f.parts, f.wires, f.offline, f.offlineUntil, f.now);
  out.needle = easeNeedle(out.needle, f.demand, dt);
  out.max = GAUGE_MAX;
  const sk = stripKey(f.demand, wired);
  if (sk !== memo.stripKey) {
    memo.stripKey = sk;
    out.strip = gaugeStrip(f.demand, wired);
  }
  const bk = subKey(wired, dropped);
  if (bk !== memo.subKey) {
    memo.subKey = bk;
    out.sub = gaugeSubLine(wired, dropped);
  }
  return out;
}

/** The gauge for one frame from scratch, the needle already settled on demand (for tests). */
export function gaugeState(f: GaugeInput): GaugeState {
  const st = emptyGauge();
  st.needle = f.demand;
  return stepGauge(st, emptyGaugeMemo(), f, 0);
}

/** The gauge's geometry inside its zone, in game pixels. */
export interface GaugeLayout {
  /** The plate: the whole zone. */
  readonly plate: Rect;
  /** The arc's centre and radii: the band between inner and outer, the needle's length. */
  readonly centre: { readonly x: number; readonly y: number };
  readonly outer: number;
  readonly inner: number;
  readonly needle: number;
  /** Where the tick numbers sit, as a radius. */
  readonly numbers: number;
  /** The title, top-left. */
  readonly title: { readonly x: number; readonly y: number };
  /**
   * Under the dial, centred on `x`, top to bottom: the big number, the headroom line (it was the
   * deck's bar), the sub-line and the strip. Each point is the top centre of its text.
   */
  readonly readout: { readonly x: number; readonly y: number };
  readonly room: { readonly x: number; readonly y: number };
  readonly sub: { readonly x: number; readonly y: number };
  readonly strip: { readonly x: number; readonly y: number };
  /** The painted face's and needle's scale (GAUGE_ART_K at full size). */
  readonly k: number;
  /** The text's scale against the full-size dial's font sizes. */
  readonly text: number;
}

/**
 * The gauge laid out in `rect`. The full-size dial (a zone 360 px tall or more, as before layout A)
 * centres its arc at (rect.x + w / 2, rect.y + 198) with outer radius 154 and a 123 px needle, the
 * readout stacked under it. A shorter zone (layout A's 344 x 260, Rolando 30 Oct 2026: "the gauge
 * doesn't have to be that big") draws the same dial at GAUGE_COMPACT of that size.
 */
export function gaugeLayout(rect: Rect): GaugeLayout {
  const f = rect.h >= 360 ? 1 : GAUGE_COMPACT;
  const at = (n: number): number => Math.round(n * f);
  const cx = rect.x + Math.round(rect.w / 2);
  const cy = rect.y + at(198) - (f < 1 ? 2 : 0);
  return {
    plate: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    centre: { x: cx, y: cy },
    outer: at(154),
    inner: at(132),
    needle: at(123),
    numbers: at(106),
    title: { x: rect.x + 12, y: rect.y + (f < 1 ? 6 : 8) },
    readout: { x: cx, y: cy + at(34) },
    room: { x: cx, y: cy + at(88) },
    sub: { x: cx, y: cy + at(114) },
    strip: { x: cx, y: cy + at(136) },
    k: GAUGE_ART_K * f,
    text: f,
  };
}

/** The share of full size the dial draws at in a zone under 360 px tall. */
export const GAUGE_COMPACT = 0.72;

/** A point on the arc at value `v` and radius `r` from the layout's centre. */
export function arcPoint(L: GaugeLayout, v: number, r: number): { x: number; y: number } {
  const a = gaugeAngle(v);
  return { x: L.centre.x + Math.cos(a) * r, y: L.centre.y + Math.sin(a) * r };
}

// ---- the picked dial (batch 5): the painted face and needle, drawn at 0.7 of their files ----

/** The painted dial face (480 x 269) and its needle (24 x 162), by art key. */
export const GAUGE_FACE_KEY = 'hud/gauge-face'; // KIT.gaugeFace: baked into the plate
export const GAUGE_NEEDLE_KEY = 'hud/gauge-needle';
/** Both are drawn at 0.7 of their file size (under 1:1): the face 336 x 188.3, the needle 16.8 x 113.4. */
export const GAUGE_ART_K = 0.7;
/** The face file's size and the dial's centre in it (where the 0 and 400 ticks meet under 200). */
export const FACE_FILE = { w: 480, h: 269 } as const;
export const FACE_HUB = { x: 241, y: 225 } as const;
/** The needle file's size, and its pivot (the hub's centre) as a share of it. */
export const NEEDLE_FILE = { w: 24, h: 162 } as const;
export const NEEDLE_PIVOT = { x: 0.5, y: 150 / 162 } as const;

/**
 * Where the face draws at GAUGE_ART_K: its hub on the arc's centre, kept inside the plate. Its
 * height is the file's at k (188.3), so the face is never drawn above its file's size. Pure.
 */
export function gaugeFacePlace(L: GaugeLayout): { x: number; y: number; w: number; h: number } {
  const w = FACE_FILE.w * L.k;
  const h = FACE_FILE.h * L.k;
  const p = L.plate;
  const x = Math.max(p.x, Math.round(L.centre.x - FACE_HUB.x * L.k));
  const y = Math.min(p.y + p.h - Math.ceil(h), Math.round(L.centre.y - FACE_HUB.y * L.k));
  return { x, y, w, h };
}

/** The needle image's rotation for `v` req/s: the file points up, so the arc's angle plus a quarter turn. */
export function needleRotation(v: number): number {
  return gaugeAngle(v) + Math.PI / 2;
}
