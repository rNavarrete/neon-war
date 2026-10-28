// The Live screen's geometry contract: where every zone and card sits in 1920x1080 game space.
// This is the only geometry source for the Live screen (docs/LIVE.md). Every lane draws inside
// its own zone's rect and never hard-codes a pixel outside it; the HUD and board layouts derive
// their numbers from here. Pure: no Phaser, so the contract is unit-tested in node.
//
// LAYOUT_VERSION is bumped only by a tech PR that moves a zone; views and tests read it from the
// hook (live.layoutVersion) so a stale screenshot or spec can be told from a real regression.

export const LAYOUT_VERSION = 1;

/** The game's drawing surface. The board and HUD are built at this size and scaled to fit. */
export const SCREEN = { width: 1920, height: 1080 } as const;

/** An axis-aligned box given by its top-left corner and size, in game pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The same box as edges, the form src/scenes/board/layout.ts keeps BOARD_AREA and TRAY_AREA in. */
export interface Area {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rect of size w x h whose centre is (cx, cy). */
const centred = (cx: number, cy: number, w: number, h: number): Rect => ({
  x: cx - w / 2,
  y: cy - h / 2,
  w,
  h,
});

/**
 * The twelve zones of the Live screen (frame 54 of the picked mockup). Zones never overlap and
 * together they leave only the gutters between them. Each is owned by one lane (docs/LIVE.md).
 */
export const ZONES = {
  /** Top-left: Lux's avatar, the stream title and the viewer count. */
  title: { x: 0, y: 0, w: 440, h: 100 },
  /** Top centre: the one-at-a-time alert band (surge, fall, dip). */
  alert: { x: 460, y: 8, w: 1040, h: 84 },
  /** Top-right: the in-world clock, the countdown, trust and credits. */
  clock: { x: 1520, y: 0, w: 400, h: 100 },
  /** Left column, top: the city map with the block's dots. */
  map: { x: 16, y: 110, w: 408, h: 310 },
  /** Left column, middle: Lux's cam frame. */
  cam: { x: 16, y: 430, w: 408, h: 270 },
  /** Left column, lower: the demand gauge. */
  gauge: { x: 16, y: 710, w: 408, h: 170 },
  /** Left column, bottom: the scope, the chart with the demand and capacity lines. */
  scope: { x: 16, y: 890, w: 408, h: 180 },
  /** Centre: the board itself, Lux's feed of the block's traffic. */
  feed: { x: 455, y: 110, w: 1455, h: 530 },
  /** Under the feed: the comms band with the crew's slots and the current line. */
  comms: { x: 455, y: 645, w: 1455, h: 150 },
  /** Bottom centre: the board's inventory (the tray of parts). */
  inventory: { x: 455, y: 800, w: 1055, h: 165 },
  /** Bottom strip under the inventory: the deck of keys and the headroom bar. */
  deck: { x: 455, y: 970, w: 1055, h: 105 },
  /** Bottom-right: Lux's stream chat. */
  chat: { x: 1525, y: 800, w: 385, h: 275 },
} as const satisfies Record<string, Rect>;

export type ZoneId = keyof typeof ZONES;

/** Every zone id, in the order of the table above. */
export const ZONE_IDS: readonly ZoneId[] = Object.keys(ZONES) as ZoneId[];

/**
 * Cards drawn over the feed only while something asks for them. The banner, job card and dip
 * fallback keep the exact centres today's HudScene uses (src/scenes/hud/layout.ts CENTRE), so every
 * click point tests/browser/hud.spec.ts reads from the hook still lands.
 */
export const CARDS = {
  /** The Solace banner (1431x700 art at 0.45), centred where the HUD slides it in today. */
  banner: centred(960, 330, 644, 316),
  /** The C1 job card (864x1252 art at 0.6), centred where the HUD opens it today. */
  jobCard: centred(960, 532, 518, 752),
  /** Where the power-dip warning sits when the board can't say where the part is. */
  dipFallback: centred(960, 300, 200, 120),
} as const satisfies Record<string, Rect>;

export type CardId = keyof typeof CARDS;

/** Every card id, in the order of the table above. */
export const CARD_IDS: readonly CardId[] = Object.keys(CARDS) as CardId[];

/** A rect as edges: {left, right, top, bottom}. */
export function rectToArea(r: Rect): Area {
  return { left: r.x, right: r.x + r.w, top: r.y, bottom: r.y + r.h };
}

/** The centre of a rect. */
export function centreOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Whether two rects share any area (touching edges don't count). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Whether `r` lies entirely inside `outer` (edges may touch). */
export function inside(r: Rect, outer: Rect): boolean {
  return r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
}

/** The whole screen as a rect. */
export const SCREEN_RECT: Rect = { x: 0, y: 0, w: SCREEN.width, h: SCREEN.height };

/** The canvas's bounding box on the page, in CSS pixels (a DOMRect fits). */
export interface CanvasRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Page pixels are kept to a tenth, the same as toPage in src/scenes/board/layout.ts. */
const tenth = (n: number): number => Math.round(n * 10) / 10;

/**
 * Map a game-space point to page CSS pixels, identically to toPage in src/scenes/board/layout.ts
 * (which the board's hook uses), so a test can click what either hook reports.
 */
export function pagePoint(p: Point, canvas: CanvasRect): Point {
  return {
    x: tenth(canvas.left + (p.x * canvas.width) / SCREEN.width),
    y: tenth(canvas.top + (p.y * canvas.height) / SCREEN.height),
  };
}

/** Map a game-space rect to page CSS pixels: its corner through pagePoint, its size scaled the same way. */
export function pageRect(r: Rect, canvas: CanvasRect): Rect {
  const corner = pagePoint(r, canvas);
  return {
    x: corner.x,
    y: corner.y,
    w: tenth((r.w * canvas.width) / SCREEN.width),
    h: tenth((r.h * canvas.height) / SCREEN.height),
  };
}
