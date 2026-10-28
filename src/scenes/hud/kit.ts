// The Live screen's frame language as pure geometry: where each picked piece of the panel kit
// (docs/ART-REQUESTS.md batch 4) lands on a panel, cut from which part of its file and drawn at what
// size. The views bake these once per panel into one texture (panel.ts bakePanel), so the frame, its
// four bracket corners, the label tab, the dividers and the map's painted base cost one display
// object, however many pieces they are.
//
// Every piece is drawn at its file's size or smaller. The nine-sliced plates (panel-frame and
// alert-plate, k 0.5 in the request) draw their corners and ornaments at k and stretch only their
// plain rails along the long axis; an ornament on an edge (the frame's lamps, the alert plate's
// notch and tape) is kept whole at k with a rail either side, so nothing painted gets smeared.
// corner-marks is a 96x96 set of all four brackets, one per 48x48 quadrant: each panel corner draws
// its own quadrant, unturned, at 48 px or smaller.
//
// Pure: no Phaser. tests/hud-kit.test.ts checks the geometry against the art manifest's cut sizes.

import type { Rect } from '../live/layout';

/** The picked kit pieces this lane draws, by art key (src/game/artManifest.ts). */
export const KIT = {
  frame: 'hud/live/panel-frame',
  corner: 'hud/live/corner-marks',
  tab: 'hud/live/label-tab',
  chip: 'hud/live/tag-chip',
  divider: 'hud/live/divider',
  pill: 'hud/live/live-pill',
  keyIdle: 'hud/live/keycap-idle',
  keyReady: 'hud/live/keycap-ready',
  keyPressed: 'hud/live/keycap-pressed',
  alertPlate: 'hud/live/alert-plate',
  alertEndcap: 'hud/live/alert-endcap',
  play: 'hud/icons/play',
  cityGrid: 'hud/city-grid',
} as const;

export type KitKey = (typeof KIT)[keyof typeof KIT];

/** Every kit key, for preloadArt. */
export const KIT_KEYS: readonly KitKey[] = Object.values(KIT);

/** The size of each picked file, in its own pixels (the manifest's cut; tests check they agree). */
export const KIT_FILE: Readonly<Record<KitKey, { readonly w: number; readonly h: number }>> = {
  'hud/live/panel-frame': { w: 192, h: 192 },
  // All four brackets, one per 48x48 quadrant (top-left, top-right, bottom-left, bottom-right).
  'hud/live/corner-marks': { w: 96, h: 96 },
  'hud/live/label-tab': { w: 380, h: 72 },
  'hud/live/tag-chip': { w: 216, h: 72 },
  'hud/live/divider': { w: 8, h: 160 },
  'hud/live/live-pill': { w: 189, h: 56 },
  'hud/live/keycap-idle': { w: 160, h: 128 },
  'hud/live/keycap-ready': { w: 160, h: 128 },
  'hud/live/keycap-pressed': { w: 160, h: 128 },
  'hud/live/alert-plate': { w: 1040, h: 168 },
  'hud/live/alert-endcap': { w: 135, h: 168 },
  'hud/icons/play': { w: 128, h: 123 },
  'hud/city-grid': { w: 816, h: 620 },
};

/** The nine-slice corner scale the requests give (panel-frame, alert-plate, keycaps). */
export const KIT_K = 0.5;

/** A part of a file, in the file's pixels. */
export interface Src {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One piece to draw: a part of a key's file into a box, turned about the box's centre. */
export interface Stamp {
  readonly key: KitKey;
  readonly src: Src;
  /** The box, in panel-local pixels (0,0 is the panel's top-left), whole pixels. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Radians, clockwise on screen. */
  readonly rotation: number;
  /** A nine-slice rail: stretched along its edge by design. Every other stamp is at or under 1:1. */
  readonly stretch: boolean;
}

// ---- the panel frame: 192 x 192, 48 px corners, a lamp on each edge ----

/** The frame's corner inset in its file. */
export const FRAME_INSET = 48;
/** Drawn corner and border size: the inset at k (24 px). */
export const FRAME_EDGE = Math.round(FRAME_INSET * KIT_K);

/** The lamp housing on each edge, as [from, to] along that edge in the file (measured off the pick). */
export const FRAME_ORNAMENTS = {
  top: [72, 122],
  bottom: [78, 118],
  left: [52, 80],
  right: [54, 78],
} as const;

type Edge = keyof typeof FRAME_ORNAMENTS;

/**
 * Split a run of `dest` px along an edge into rail, ornament, rail: the ornament at k, the rails
 * sharing what is left in proportion to their length in the file. Returns [r1, o, r2] (r1 + o + r2
 * = dest). A run too short for the ornament at k stretches as one rail ([dest, 0, 0]).
 */
export function edgeRun(
  dest: number,
  from: number,
  to: number,
  mid0: number,
  mid1: number,
  k: number,
): [number, number, number] {
  const o = Math.round((to - from) * k);
  const left = dest - o;
  const s1 = from - mid0;
  const s2 = mid1 - to;
  if (left < 0 || s1 + s2 <= 0) return [dest, 0, 0];
  const r1 = Math.round((left * s1) / (s1 + s2));
  return [r1, o, left - r1];
}

/** The frame around a w x h panel: four corners at k, each edge as rail, lamp, rail. */
export function frameStamps(w: number, h: number): Stamp[] {
  const key = KIT.frame;
  const F = KIT_FILE[key].w;
  const I = FRAME_INSET;
  const E = FRAME_EDGE;
  const out: Stamp[] = [];
  const put = (src: Src, x: number, y: number, dw: number, dh: number, stretch: boolean): void => {
    if (dw > 0 && dh > 0 && src.w > 0 && src.h > 0)
      out.push({ key, src, x, y, w: dw, h: dh, rotation: 0, stretch });
  };
  // Corners.
  put({ x: 0, y: 0, w: I, h: I }, 0, 0, E, E, false);
  put({ x: F - I, y: 0, w: I, h: I }, w - E, 0, E, E, false);
  put({ x: 0, y: F - I, w: I, h: I }, 0, h - E, E, E, false);
  put({ x: F - I, y: F - I, w: I, h: I }, w - E, h - E, E, E, false);
  // Edges: along x for top and bottom, along y for left and right.
  const along = (edge: Edge, dest: number): void => {
    const [from, to] = FRAME_ORNAMENTS[edge];
    const [r1, o, r2] = edgeRun(dest, from, to, I, F - I, KIT_K);
    const parts: [number, number, number][] =
      o > 0
        ? [
            [I, from - I, r1],
            [from, to - from, o],
            [to, F - I - to, r2],
          ]
        : [[I, F - 2 * I, r1]];
    let at = E;
    for (let i = 0; i < parts.length; i++) {
      const [s, len, d] = parts[i];
      const rail = !(o > 0 && i === 1);
      if (edge === 'top') put({ x: s, y: 0, w: len, h: I }, at, 0, d, E, rail);
      else if (edge === 'bottom') put({ x: s, y: F - I, w: len, h: I }, at, h - E, d, E, rail);
      else if (edge === 'left') put({ x: 0, y: s, w: I, h: len }, 0, at, E, d, rail);
      else put({ x: F - I, y: s, w: I, h: len }, w - E, at, E, d, rail);
      at += d;
    }
  };
  along('top', w - 2 * E);
  along('bottom', w - 2 * E);
  along('left', h - 2 * E);
  along('right', h - 2 * E);
  return out;
}

// ---- the bracket corners ----

/** The bracket corners' drawn size on a panel (each bracket is a 48 px quadrant of the 96 px set). */
export const CORNER_SIZE = 30;

/** One bracket's quadrant of the corner-marks set, in its file's pixels. */
export const CORNER_QUADRANT = 48;

/**
 * The four bracket corners of a w x h panel, `size` px (at most the 48 px quadrant): each corner
 * draws its own quadrant of the set, unturned, in the order top-left, top-right, bottom-right,
 * bottom-left.
 */
export function cornerStamps(w: number, h: number, size: number = CORNER_SIZE): Stamp[] {
  const key = KIT.corner;
  const q = CORNER_QUADRANT;
  const s = Math.min(size, q);
  const at = (qx: number, qy: number, x: number, y: number): Stamp => ({
    key,
    src: { x: qx * q, y: qy * q, w: q, h: q },
    x,
    y,
    w: s,
    h: s,
    rotation: 0,
    stretch: false,
  });
  return [at(0, 0, 0, 0), at(1, 0, w - s, 0), at(1, 1, w - s, h - s), at(0, 1, 0, h - s)];
}

// ---- single pieces ----

/** A whole file scaled uniformly to `h` px tall (never past 1:1), top-left at (x, y). */
export function wholeStamp(key: KitKey, x: number, y: number, h: number): Stamp {
  const f = KIT_FILE[key];
  const k = Math.min(1, h / f.h);
  return {
    key,
    src: { x: 0, y: 0, w: f.w, h: f.h },
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(f.w * k),
    h: Math.round(f.h * k),
    rotation: 0,
    stretch: false,
  };
}

/** The divider rule at k across (4 px), `h` px long (at most the file's 160), top-left at (x, y). */
export function dividerStamp(x: number, y: number, h: number): Stamp {
  const key = KIT.divider;
  const f = KIT_FILE[key];
  return {
    key,
    src: { x: 0, y: 0, w: f.w, h: f.h },
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(f.w * KIT_K),
    h: Math.round(Math.min(h, f.h)),
    rotation: 0,
    stretch: false,
  };
}

// ---- a panel ----

/** What a panel's bake holds; positions are game pixels, as the views' layouts give them. */
export interface PanelSpec {
  /** The panel-frame nine-slice round the rect. */
  readonly frame?: boolean;
  /** Bracket corners, at this size (0 or absent: none). */
  readonly corners?: number;
  /** A label tab under a panel title: its top-left and height. */
  readonly tab?: { readonly x: number; readonly y: number; readonly h: number };
  /** Divider rules: top-left and length. */
  readonly dividers?: readonly { readonly x: number; readonly y: number; readonly h: number }[];
  /** A painted base filling the rect (the map's city grid). */
  readonly base?: KitKey;
  /** The alert plate nine-sliced over the rect, and its hazard end cap at the right end. */
  readonly alert?: { readonly endcap: boolean };
}

/** The fixed stamps of a panel over `rect`, in panel-local pixels, back to front. */
export function panelStamps(rect: Rect, spec: PanelSpec): Stamp[] {
  const out: Stamp[] = [];
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  if (spec.base) {
    const f = KIT_FILE[spec.base];
    out.push({
      key: spec.base,
      src: { x: 0, y: 0, w: f.w, h: f.h },
      x: 0,
      y: 0,
      w,
      h,
      rotation: 0,
      stretch: false,
    });
  }
  if (spec.alert) {
    out.push(...alertPlateStamps(w, h));
    if (spec.alert.endcap) {
      const e = alertEndcap({ x: 0, y: 0, w, h });
      const f = KIT_FILE[KIT.alertEndcap];
      out.push({
        key: KIT.alertEndcap,
        src: { x: 0, y: 0, w: f.w, h: f.h },
        ...e,
        rotation: 0,
        stretch: false,
      });
    }
  }
  for (const d of spec.dividers ?? []) out.push(dividerStamp(d.x - rect.x, d.y - rect.y, d.h));
  if (spec.frame) out.push(...frameStamps(w, h));
  if (spec.tab) out.push(wholeStamp(KIT.tab, spec.tab.x - rect.x, spec.tab.y - rect.y, spec.tab.h));
  if (spec.corners) out.push(...cornerStamps(w, h, spec.corners));
  return out;
}

/** The base stamps (under the view's own static drawing) and the rest (over it). */
export function isBase(s: Stamp): boolean {
  return s.key === KIT.cityGrid;
}

/** The largest scale any non-rail stamp draws its file at (1 is 1:1); 0 with none. */
export function maxScale(stamps: readonly Stamp[]): number {
  let m = 0;
  for (const s of stamps) if (!s.stretch) m = Math.max(m, s.w / s.src.w, s.h / s.src.h);
  return m;
}

/** Every distinct key among `stamps`, in first-drawn order. */
export function stampKeys(stamps: readonly Stamp[]): KitKey[] {
  const out: KitKey[] = [];
  for (const s of stamps) if (!out.includes(s.key)) out.push(s.key);
  return out;
}

// ---- the alert plate: 1040 x 168, nine-sliced at k into 84 px tall ----

/** The plate's ends in its file, kept whole at k: the left hazard and notch, the right bar, tape and hazard. */
export const ALERT_ENDS = { left: 250, right: 780 } as const;

/** The alert plate stretched to a w x h band: both ends at k, the plain middle stretched. */
export function alertPlateStamps(w: number, h: number): Stamp[] {
  const key = KIT.alertPlate;
  const f = KIT_FILE[key];
  const k = h / f.h;
  const lw = Math.round(ALERT_ENDS.left * k);
  const rw = Math.round((f.w - ALERT_ENDS.right) * k);
  const mid = w - lw - rw;
  const row = (sx: number, sw: number, x: number, dw: number, stretch: boolean): Stamp => ({
    key,
    src: { x: sx, y: 0, w: sw, h: f.h },
    x,
    y: 0,
    w: dw,
    h,
    rotation: 0,
    stretch,
  });
  return [
    row(0, ALERT_ENDS.left, 0, lw, false),
    row(ALERT_ENDS.left, ALERT_ENDS.right - ALERT_ENDS.left, lw, mid, true),
    row(ALERT_ENDS.right, f.w - ALERT_ENDS.right, lw + mid, rw, false),
  ];
}

/** The hazard end cap at the band's right end, uniform at h / 168 (68 x 84 on the 84 px band). */
export function alertEndcap(rect: Rect): { x: number; y: number; w: number; h: number } {
  const f = KIT_FILE[KIT.alertEndcap];
  const k = Math.min(1, rect.h / f.h);
  const w = Math.round(f.w * k);
  const h = Math.round(f.h * k);
  return { x: rect.x + rect.w - w, y: rect.y + Math.round((rect.h - h) / 2), w, h };
}

// ---- keys ----

/** The deck key's cap for its state: ready when lit, pressed for a moment after a press that acted. */
export type KeyCap = typeof KIT.keyIdle | typeof KIT.keyReady | typeof KIT.keyPressed;

/** How long a key shows pressed after a press that acted, in HUD seconds. */
export const PRESSED_SECONDS = 0.15;

/** The cap a key shows: pressed for PRESSED_SECONDS after `pressedAt`, else ready when lit, else idle. */
export function keyCap(lit: boolean, now: number, pressedAt: number | null): KeyCap {
  if (pressedAt !== null && now >= pressedAt && now - pressedAt < PRESSED_SECONDS) return KIT.keyPressed;
  return lit ? KIT.keyReady : KIT.keyIdle;
}

/** The play glyph on the SET key: right of its digit, `size` px (the file is 128 x 123). */
export const PLAY_SIZE = 24;

/** The live pill under the title's LIVE word: 95 x 28 (the 189 x 56 file at k), top-left at (x, y). */
export function livePill(x: number, y: number): { x: number; y: number; w: number; h: number } {
  const f = KIT_FILE[KIT.pill];
  return { x, y, w: Math.round(f.w * KIT_K), h: Math.round(f.h * KIT_K) };
}
