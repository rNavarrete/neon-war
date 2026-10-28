// The CITY GRID map (ZONES.map) as pure rules and geometry: where the block's calls come from. Lux's
// block with its 12 x 10 window lights, four neighbour blocks to the left, three streets carrying
// amber dots toward the block. The dots follow what the block sends before retries (blockDemand)
// only: retries are the same people calling again, so they never show up as new people on the
// streets (the raid outlines and the window lights carry the surge). No numbers: the map answers
// "where from", the gauge and the bar answer "how many".
//
// Pure: no Phaser, no clock. MapView.ts draws what these return; tests/hud-map.test.ts checks them.

import { BROWNOUT } from '../../sim/brownout';
import { PACKETS_PER_REQUEST } from '../board/packets';
import type { Rect } from '../live/layout';
import { LABELS } from './labels';

const C = BROWNOUT.challenges;

// ---- the map's words ----

/**
 * The words the map prints, in the crew's plain terms: LABELS.map of labels.ts, under the name
 * tests/hud-map.test.ts scans for the debrief's terms.
 */
export const MAP_WORDS = LABELS.map;

// ---- dot rates ----

/** Requests per second one dot a second stands for. */
export const REQUESTS_PER_DOT = 12;
/** Most dots a second the whole map shows, so the surge stays readable. */
export const MAX_DOTS_PER_SECOND = 32;

/** Dots a second for the block sending `reqps` requests a second: clamp(reqps / 12, 0, 32). */
export function mapDotsPerSecond(reqps: number): number {
  if (!(reqps > 0)) return 0;
  return Math.min(MAX_DOTS_PER_SECOND, reqps / REQUESTS_PER_DOT);
}

/**
 * The share of the block's calls that come up the district road: from the district surge until the
 * final surge, everything over the evening climb is the neighbours calling through Lux's block.
 */
export function districtDemand(now: number, blockDemand: number): number {
  if (now < C.c4 || now >= C.c6) return 0;
  return Math.max(0, blockDemand - BROWNOUT.demand.climb);
}

/** The three streets dots travel along, in draw order: Lux's two streets and the district road. */
export type StreetId = 'north' | 'west' | 'district';
export const STREET_IDS: readonly StreetId[] = ['north', 'west', 'district'];

/** Dots a second on each street. */
export type StreetDots = Record<StreetId, number>;

/** A fresh, all-zero StreetDots, for a view to keep and refill. */
export function noStreetDots(): StreetDots {
  return { north: 0, west: 0, district: 0 };
}

/**
 * Refill `out` with this frame's dots a second per street and return it: mapDotsPerSecond of the
 * block's demand in all, the district road carrying the neighbours' share and Lux's two streets
 * splitting the rest. Allocates nothing.
 */
export function fillStreetDots(out: StreetDots, now: number, blockDemand: number): StreetDots {
  const total = mapDotsPerSecond(blockDemand);
  const district = Math.min(total, mapDotsPerSecond(districtDemand(now, blockDemand)));
  const lux = total - district;
  out.north = lux / 2;
  out.west = lux / 2;
  out.district = district;
  return out;
}

/**
 * The rate to hand the PacketPool (src/scenes/board/packets.ts) so it spawns `dotsPerSecond` dots a
 * second: the pool turns req/s into packets at PACKETS_PER_REQUEST.
 */
export function poolRate(dotsPerSecond: number): number {
  return dotsPerSecond / PACKETS_PER_REQUEST;
}

/** How fast a dot moves along its street, in game pixels per sim second. */
export const DOT_SPEED = 110;

// ---- the map's state ----

/** What the map shows besides the dots; the lights and outlines redraw only when this changes. */
export interface MapState {
  /** The district surge is on: the neighbours' outlines pulse red. */
  raid: boolean;
  /** The neighbours are cut off and call through Lux's block (from the surge until the final surge). */
  neighboursCut: boolean;
  /** Floors of Lux's block with their windows lit, 0..10: round(10 x (1 - error share)). */
  litFloors: number;
  /** The laundry floor was cut loose: its windows are grey. */
  laundryDark: boolean;
  /** The clock reached midnight: every window warm if the block held, dark if it did not. */
  midnight: boolean;
}

/** What mapState reads: a Frame (src/game/frame.ts) fits. */
export interface MapInput {
  readonly now: number;
  readonly errorShare: number;
  readonly laundryCut: { readonly at: number } | null;
  readonly rescued: boolean;
  readonly surge: { readonly surge: { readonly startsAt: number } } | null;
  readonly midnight: { readonly held: boolean } | null;
}

/** Floors of Lux's block, and windows per floor. */
export const FLOORS = 10;
export const WINDOWS_PER_FLOOR = 12;
/** The laundry floor, counted from the ground floor as 1 (the deck key reads CUT 3F). */
export const LAUNDRY_FLOOR = 3;

/** A fresh state for before the first frame. */
export function emptyMapState(): MapState {
  return { raid: false, neighboursCut: false, litFloors: FLOORS, laundryDark: false, midnight: false };
}

/** Refill `out` from a frame and return it. Allocates nothing. */
export function fillMapState(out: MapState, f: MapInput): MapState {
  const now = f.now;
  const midnight = now >= C.c7;
  out.raid = f.surge?.surge.startsAt === C.c4 || (now >= C.c4 && now < C.c5 && !f.rescued);
  out.neighboursCut = out.raid || (now >= C.c4 && now < C.c6);
  out.midnight = midnight;
  if (midnight) out.litFloors = f.midnight && !f.midnight.held ? 0 : FLOORS;
  else out.litFloors = Math.max(0, Math.min(FLOORS, Math.round(FLOORS * (1 - f.errorShare))));
  out.laundryDark = f.laundryCut !== null;
  return out;
}

/** The map's state for a frame, as a new object. */
export function mapState(f: MapInput): MapState {
  return fillMapState(emptyMapState(), f);
}

/** Copy `from` into `to`. */
export function copyMapState(to: MapState, from: MapState): void {
  to.raid = from.raid;
  to.neighboursCut = from.neighboursCut;
  to.litFloors = from.litFloors;
  to.laundryDark = from.laundryDark;
  to.midnight = from.midnight;
}

/** The window lights need redrawing. */
export const REDRAW_LIGHTS = 1;
/** The neighbour outlines need redrawing. */
export const REDRAW_OUTLINES = 2;

/**
 * What changed between two map states, as REDRAW_* bits (0 when nothing did): the lights on lit
 * floors, the laundry floor or midnight; the outlines on the raid or the neighbours' cut. A null
 * `prev` (nothing drawn yet) redraws both.
 */
export function mapDiff(prev: MapState | null, next: MapState): number {
  if (prev === null) return REDRAW_LIGHTS | REDRAW_OUTLINES;
  let bits = 0;
  if (
    prev.litFloors !== next.litFloors ||
    prev.laundryDark !== next.laundryDark ||
    prev.midnight !== next.midnight
  )
    bits |= REDRAW_LIGHTS;
  if (prev.raid !== next.raid || prev.neighboursCut !== next.neighboursCut) bits |= REDRAW_OUTLINES;
  return bits;
}

/** What a window looks like: lit amber, warm at midnight, grey on the cut laundry floor, or off. */
export type WindowLook = 'lit' | 'warm' | 'grey' | 'off';

/** The look of every window on `floor` (1 is the ground floor) in a state. */
export function windowLook(s: MapState, floor: number): WindowLook {
  if (s.midnight) return s.litFloors > 0 ? 'warm' : 'off';
  if (s.laundryDark && floor === LAUNDRY_FLOOR) return 'grey';
  return floor <= s.litFloors ? 'lit' : 'off';
}

/** The raid outlines' alpha at HUD time t: a 1 Hz pulse, steady when flicker is reduced. */
export function raidPulse(t: number, steady: boolean): number {
  if (steady) return 1;
  return 0.6 + 0.4 * Math.cos(2 * Math.PI * t);
}

/** Seconds the six midnight sparkles stay up. */
export const SPARKLE_SECONDS = 1.5;

/** The sparkles' alpha `since` seconds after midnight struck (0 once they are gone). */
export function sparkleAlpha(since: number): number {
  if (!(since >= 0) || since >= SPARKLE_SECONDS) return 0;
  return 1 - since / SPARKLE_SECONDS;
}

// ---- geometry ----

export interface MapPoint {
  x: number;
  y: number;
}

/** A street: its points from where the calls start to Lux's block, and its length in game pixels. */
export interface Street {
  readonly id: StreetId;
  readonly points: readonly MapPoint[];
  /** The distance from the first point to each point (the first is 0, the last the length). */
  readonly along: readonly number[];
  readonly length: number;
}

/** Everything the map draws, in game pixels, from its zone. */
export interface MapLayout {
  readonly plate: Rect;
  readonly title: MapPoint;
  /** Lux's block, the window grid inside it and its label above. */
  readonly lux: Rect;
  readonly luxLabel: MapPoint;
  readonly windows: {
    readonly x: number;
    readonly y: number;
    readonly pitchX: number;
    readonly pitchY: number;
    readonly w: number;
    readonly h: number;
  };
  /** The four neighbour blocks, top to bottom, and the CUT OFF words beside them. */
  readonly neighbours: readonly Rect[];
  readonly cutOffLabel: MapPoint;
  /** The quiet blocks drawn into the base for texture. */
  readonly blocks: readonly Rect[];
  readonly streets: readonly Street[];
  /** Where the six midnight sparkles go. */
  readonly sparkles: readonly MapPoint[];
}

function street(id: StreetId, points: MapPoint[]): Street {
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    along.push(along[i - 1] + Math.hypot(dx, dy));
  }
  return { id, points, along, length: along[along.length - 1] };
}

/** The map's layout in its zone `r` (408 x 310 in frame 54); computed once at create. */
export function mapLayout(r: Rect): MapLayout {
  const at = (fx: number, fy: number): MapPoint => ({ x: r.x + fx * r.w, y: r.y + fy * r.h });
  const box = (fx: number, fy: number, fw: number, fh: number): Rect => ({
    x: r.x + fx * r.w,
    y: r.y + fy * r.h,
    w: fw * r.w,
    h: fh * r.h,
  });
  // Lux's block right of centre, low; its windows inset 6 px with 12 columns and 10 floors.
  const lux = box(0.68, 0.48, 0.2, 0.34);
  const inset = 6;
  const pitchX = (lux.w - 2 * inset) / WINDOWS_PER_FLOOR;
  const pitchY = (lux.h - 2 * inset) / FLOORS;
  const neighbours: Rect[] = [];
  for (let i = 0; i < 4; i++) neighbours.push(box(0.05, 0.2 + i * 0.185, 0.15, 0.15));
  const blocks: Rect[] = [];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 3; col++) {
      const b = box(0.3 + col * 0.12, 0.15 + row * 0.2, 0.09, 0.14);
      // Leave Lux's block and the space around it clear.
      if (b.x + b.w > lux.x - 8 && b.y + b.h > lux.y - 30) continue;
      blocks.push(b);
    }
  const luxIn = (fx: number, fy: number): MapPoint => ({ x: lux.x + fx * lux.w, y: lux.y + fy * lux.h });
  const streets = [
    // From the top of the district down to the block's roof.
    street('north', [at(0.86, 0.1), at(0.82, 0.3), luxIn(0.55, 0)]),
    // From the bottom-left corner along the lower road to the block's west side.
    street('west', [at(0.03, 0.95), at(0.4, 0.9), luxIn(0, 0.8)]),
    // From the neighbours' blocks across the middle to the block's west side.
    street('district', [at(0.22, 0.45), at(0.45, 0.52), luxIn(0, 0.35)]),
  ];
  const sparkles: MapPoint[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 2 * Math.PI;
    sparkles.push({
      x: lux.x + lux.w / 2 + Math.cos(a) * lux.w * 0.75,
      y: lux.y + lux.h / 2 + Math.sin(a) * lux.h * 0.65,
    });
  }
  return {
    plate: r,
    title: { x: r.x + 12, y: r.y + 8 },
    lux,
    luxLabel: { x: lux.x, y: lux.y - 22 },
    windows: { x: lux.x + inset, y: lux.y + inset, pitchX, pitchY, w: pitchX * 0.6, h: pitchY * 0.6 },
    neighbours,
    cutOffLabel: { x: neighbours[0].x, y: neighbours[0].y - 20 },
    blocks,
    streets,
    sparkles,
  };
}

/** The window rect of `col` (0 at the left) on `floor` (1 is the ground floor), into `out`. */
export function windowRect(L: MapLayout, col: number, floor: number, out: MapPoint): MapPoint {
  const w = L.windows;
  out.x = w.x + col * w.pitchX + (w.pitchX - w.w) / 2;
  out.y = w.y + (FLOORS - floor) * w.pitchY + (w.pitchY - w.h) / 2;
  return out;
}

/** Where a dot `progress` (0..1) along `s` is, written into `out`. Allocates nothing. */
export function pointAlong(s: Street, progress: number, out: MapPoint): MapPoint {
  const d = Math.max(0, Math.min(1, progress)) * s.length;
  const pts = s.points;
  let i = 1;
  while (i < pts.length - 1 && s.along[i] < d) i++;
  const seg = s.along[i] - s.along[i - 1];
  const k = seg > 0 ? (d - s.along[i - 1]) / seg : 0;
  out.x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k;
  out.y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k;
  return out;
}

/** Seconds a dot takes to walk a street. */
export function streetSeconds(s: Street): number {
  return Math.max(0.5, s.length / DOT_SPEED);
}
