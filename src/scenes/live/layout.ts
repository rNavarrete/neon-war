// The Live screen's geometry contract: where every zone and card sits in 1920x1080 game space.
// This is the only geometry source for the Live screen (docs/LIVE.md). Every lane draws inside
// its own zone's rect and never hard-codes a pixel outside it; the HUD and board layouts derive
// their numbers from here. Pure: no Phaser, so the contract is unit-tested in node.
//
// LAYOUT_VERSION is bumped only by a tech PR that moves a zone; views and tests read it from the
// hook (live.layoutVersion) so a stale screenshot or spec can be told from a real regression.

export const LAYOUT_VERSION = 3;

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
 * The eleven zones of the Live screen. Zones never overlap and together they leave only the gutters
 * between them. Each is owned by one lane (docs/LIVE.md).
 *
 * Version 2 (Rolando, 30 Oct 2026, layout "A2"): three columns. Left, Lux's world: her cam over her
 * stream chat, slim so the board gets the room. Middle: the board, drawn at FEED_VIEW's scale with
 * the city's sky above it, and the tray under it. Right: the cams of whoever is talking to Lux, popping
 * in and out (the comms zone), with the smaller gauge and the city map under them. The deck's keys
 * show only while one can be pressed (the laundry cut, in the surge).
 *
 * Rolando, 30 Oct 2026 ("too much wasted space", option 2): the clock sits on its painted plate at
 * the top of the right column, and the caller cam, the gauge and the map fill the column down to the
 * bottom edge, the cam taller so the last caller stays big on screen.
 */
export const ZONES = {
  /** Top-left: Lux's avatar, the stream title and the viewer count. */
  title: { x: 0, y: 0, w: 440, h: 100 },
  /** Top centre, over the board: the one-at-a-time alert band (surge, fall, dip). */
  alert: { x: 450, y: 8, w: 1070, h: 84 },
  /** Top-right: the in-world clock, the countdown and the pause button. */
  clock: { x: 1566, y: 0, w: 344, h: 125 },
  /**
   * Right column, bottom: the city map with the block's dots, at its painting's shape (816x620 at
   * about 0.26) so the city is never squashed.
   */
  map: { x: 1632, y: 913, w: 212, h: 160 },
  /** Left column, top: Lux's cam frame, above her chat like a streamer's webcam. */
  cam: { x: 6, y: 110, w: 410, h: 270 },
  /** Right column, under the callers: the demand gauge, the one demand widget (smaller since A2). */
  gauge: { x: 1566, y: 645, w: 344, h: 260 },
  /** Middle: the board itself, Lux's feed of the block's traffic, with the sky above the table. */
  feed: { x: 426, y: 120, w: 1128, h: 706 },
  /** Right column, top: the cam of whoever is talking to Lux, popping in and out with their line. */
  comms: { x: 1566, y: 135, w: 344, h: 500 },
  /** Middle, under the board: the board's inventory (the tray of parts). */
  inventory: { x: 426, y: 834, w: 1055, h: 165 },
  /** Middle, under the tray: the deck's keys, shown only while one can be pressed. */
  deck: { x: 426, y: 1005, w: 1128, h: 65 },
  /** Left column, under the cam: Lux's stream chat, nearly full height. */
  chat: { x: 6, y: 390, w: 410, h: 680 },
} as const satisfies Record<string, Rect>;

export type ZoneId = keyof typeof ZONES;

/** Every zone id, in the order of the table above. */
export const ZONE_IDS: readonly ZoneId[] = Object.keys(ZONES) as ZoneId[];

/** The feed's centre line, where the cards over it are centred across. */
const FEED_CX = ZONES.feed.x + ZONES.feed.w / 2;

/**
 * Cards drawn over the feed only while something asks for them, centred across the feed. Tests
 * click them from the points the hook reports (src/scenes/hud/layout.ts CENTRE).
 */
export const CARDS = {
  /** The Solace banner (1431x700 art at 0.45). */
  banner: centred(FEED_CX, 330, 644, 316),
  /** The C1 job card (864x1252 art at 0.6). */
  jobCard: centred(FEED_CX, 532, 518, 752),
  /** Where the power-dip warning sits when the board can't say where the part is. */
  dipFallback: centred(FEED_CX, 300, 200, 120),
} as const satisfies Record<string, Rect>;

// ---- the board's own space ----
// BoardScene draws the feed and the tray in their own coordinates (the space the table, the grid and
// every part's place were painted and measured in), and two cameras show them in their zones. A
// view maps a box of that space onto a zone at one scale: the feed keeps its painted shape.

/** The board's drawing space for the feed: the table and its skyline were painted for this box. */
export const FEED_WORLD: Rect = { x: 455, y: 110, w: 1455, h: 530 };
/**
 * What the feed's camera shows: FEED_WORLD with the rest of the painted sky above it (the skyline art
 * is 1536x1024, drawn 1455 wide with its horizon at y 214, so its top is at y 214 - 485 = -271).
 */
export const FEED_SHOWN: Rect = { x: 455, y: -271, w: 1455, h: 911 };
/** The board's drawing space for the tray of parts. */
export const TRAY_WORLD: Rect = { x: 455, y: 800, w: 1055, h: 165 };

/** How a box of the board's space shows on screen: drawn at `scale` with its corner at the zone's. */
export interface View {
  readonly world: Rect;
  readonly screen: Rect;
  readonly scale: number;
}

const viewOf = (world: Rect, screen: Rect): View => ({ world, screen, scale: screen.w / world.w });

/** The feed's view: FEED_SHOWN onto ZONES.feed (the same shape, so one scale fits both ways). */
export const FEED_VIEW: View = viewOf(FEED_SHOWN, ZONES.feed);
/** The tray's view: TRAY_WORLD onto ZONES.inventory. */
export const TRAY_VIEW: View = viewOf(TRAY_WORLD, ZONES.inventory);

const within = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** A point of the board's space on screen: through the tray's view inside TRAY_WORLD, else the feed's. */
export function boardToScreen(p: Point): Point {
  const v = within(TRAY_WORLD, p.x, p.y) ? TRAY_VIEW : FEED_VIEW;
  return { x: v.screen.x + (p.x - v.world.x) * v.scale, y: v.screen.y + (p.y - v.world.y) * v.scale };
}

/** A screen point in the board's space: through the tray's view over its zone, else the feed's. */
export function screenToBoard(p: Point): Point {
  const v = within(TRAY_VIEW.screen, p.x, p.y) ? TRAY_VIEW : FEED_VIEW;
  return { x: v.world.x + (p.x - v.screen.x) / v.scale, y: v.world.y + (p.y - v.screen.y) / v.scale };
}

/** A box of the board's space on screen (its corner through boardToScreen, its size at that view's scale). */
export function boardRectToScreen(r: Rect): Rect {
  const v = within(TRAY_WORLD, r.x, r.y) ? TRAY_VIEW : FEED_VIEW;
  const c = boardToScreen(r);
  return { x: c.x, y: c.y, w: r.w * v.scale, h: r.h * v.scale };
}

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
