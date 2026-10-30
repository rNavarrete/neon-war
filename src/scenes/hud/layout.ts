// Where the HUD's pieces sit, in 1920x1080 game space. Every number here is computed from the Live
// screen's contract (src/scenes/live/layout.ts ZONES and CARDS, docs/LIVE.md): a piece is placed
// from its zone's corner, so moving a zone moves its pieces. Only the job card and the Solace banner
// (and the dip warning, on its part or its fallback card) cover the feed, and only while open. HUD_RECTS lists each piece's box and the zone or card it must stay
// inside, for tests/hud-layout.test.ts. Pure: no Phaser.

import { CARDS, type CardId, type Rect, SCREEN_RECT, ZONES, type ZoneId, centreOf } from '../live/layout';

export const FONT = 'ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace';
export const FONT_SANS = 'system-ui, "Segoe UI", Roboto, "DejaVu Sans", Arial, sans-serif';

/**
 * Amber is the one hero colour (the live line, the lit key, the number to watch); red is kept for
 * over and dropped only. Cyan frames, magenta marks what the player set.
 */
export const COLORS = {
  cyan: 0x2de2e6,
  cyanText: '#2de2e6',
  amber: 0xffa62b,
  amberText: '#ffa62b',
  /** The hero colour: amber. */
  hero: 0xffa62b,
  heroText: '#ffa62b',
  magenta: 0xff4fd8,
  magentaText: '#ff6be0',
  white: '#e8f1ff',
  dim: '#8aa0c8',
  /** Over and dropped only. */
  red: 0xff4d4d,
  redText: '#ff6b6b',
  ink: 0x05070f,
  /** A key or slot that is not lit. */
  unlit: 0x55556a,
};

const Z = ZONES;
const K = CARDS;

/** A box of size w x h centred on (cx, cy). */
export const boxAround = (cx: number, cy: number, w: number, h: number): Rect => ({
  x: cx - w / 2,
  y: cy - h / 2,
  w,
  h,
});

// ---- the top strip ----
// The title cluster and the clock are TitleView's (title.ts), the alert band AlertView's (alerts.ts):
// each places its pieces from its own zone, so nothing for the top strip is left here.

// ---- the right: the chat ----

const chat = Z.chat;

export const RIGHT = {
  /** The one chat column (block and stream merged): its panel is the zone, the rows the body. */
  chat: { x: chat.x, y: chat.y, w: chat.w, h: chat.h },
  chatTitle: { x: chat.x + 22, y: chat.y + 14 },
  /** The rows fill the tall column (layout A, Rolando 30 Oct 2026: "following the chat is really fun"). */
  chatBody: { x: chat.x + 20, y: chat.y + 40, w: chat.w - 40, h: chat.h - 60, rows: 16 },
};

// ---- the bottom: the comms band's slots and the deck ----
// The comms band itself is CommsView's (comms.ts commsLayout); only the five slots stay here.

const comms = Z.comms;
const deck = Z.deck;

const SLOT_NAMES = ['TRIAGE', 'REI', 'MIKA', 'OZZIE', 'HOUSE'] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

const KEY_LABELS = [
  { digit: '1', word: 'REGROUP' },
  { digit: '2', word: 'CUT 3F' },
] as const;

export const BOTTOM = {
  /**
   * The crew's five slots in the caller column, r 42 along its bottom, overlapping like a call's
   * participant stack: y 512, x 1616 + 61 i (comms.ts commsLayout matches them).
   */
  slots: SLOT_NAMES.map((name, i) => ({
    name,
    x: Math.round(comms.x + 50 + ((comms.w - 100) / (SLOT_NAMES.length - 1)) * i),
    y: comms.y + comms.h - 64,
    r: 42,
  })),
  /** The deck's keys, 120x52, side by side across the strip under the tray; each shows only while it can act. */
  keys: KEY_LABELS.map((k, i) => ({
    ...k,
    x: deck.x + deck.w / 2 + (i - 0.5) * 132,
    y: deck.y + deck.h / 2 + 4,
    w: 120,
    h: 52,
  })),
};

export const KEY = { regroup: 0, cut: 1 } as const;

// ---- cards over the feed ----

/** The painted sizes of the job card and the Solace banner art. */
export const JOB_ART = { w: 864, h: 1252 } as const;
export const BANNER_ART = { w: 1431, h: 700 } as const;

const jobCard = K.jobCard;
const jobCentre = centreOf(K.jobCard);
const banner = centreOf(K.banner);

export const CENTRE = {
  /** The 864x1252 job card art at 0.6, centred on its card (the card is the art rounded to even pixels). */
  jobCard: { x: jobCentre.x, y: jobCentre.y, scale: 0.6 },
  /** The OK button along the job card's bottom edge (the whole card also clicks away). */
  jobCardOk: { x: jobCentre.x, y: jobCard.y + jobCard.h - 35, w: 150, h: 50 },
  /** The 1431x700 Solace banner art at 0.45, centred on its card (the art rounded to even pixels). */
  banner: { x: banner.x, y: banner.y, scale: 0.45 },
  /** WIRING(board): where the dip warning goes when the board hasn't said where the part is. */
  dipFallback: centreOf(K.dipFallback),
};

/** Where on the painted Solace banner (1431x700) its three buttons sit, from its centre. */
export const BANNER_BUTTONS = {
  pay: { dx: 166, dy: 275, w: 250, h: 72 },
  ignore: { dx: 438, dy: 275, w: 250, h: 72 },
  bin: { dx: 632, dy: 275, w: 80, h: 80 },
} as const;

// ---- every piece's box, for the layout test ----

/** What a piece must stay inside: its zone, its card, or (the job card's dimmer only) the screen. */
export type Home = ZoneId | CardId | 'screen';

export interface HudRect {
  readonly id: string;
  readonly rect: Rect;
  readonly home: Home;
}

const circle = (c: { x: number; y: number; r: number }): Rect => boxAround(c.x, c.y, c.r * 2, c.r * 2);

/** The job card's art at its scale, and the banner's. */
/** The cards are their art's size rounded to even pixels (tests/live-layout.test.ts), so the art is too. */
const even = (n: number): number => Math.round(n / 2) * 2;
const jobArt = boxAround(
  CENTRE.jobCard.x,
  CENTRE.jobCard.y,
  even(JOB_ART.w * CENTRE.jobCard.scale),
  even(JOB_ART.h * CENTRE.jobCard.scale),
);
const bannerArt = boxAround(
  CENTRE.banner.x,
  CENTRE.banner.y,
  even(BANNER_ART.w * CENTRE.banner.scale),
  even(BANNER_ART.h * CENTRE.banner.scale),
);

export const HUD_RECTS: readonly HudRect[] = [
  { id: 'chat.panel', rect: RIGHT.chat, home: 'chat' },
  { id: 'chat.body', rect: RIGHT.chatBody, home: 'chat' },
  ...BOTTOM.slots.map((s): HudRect => ({ id: `comms.slot.${s.name}`, rect: circle(s), home: 'comms' })),
  ...BOTTOM.keys.map((k): HudRect => ({
    id: `deck.key.${k.digit}`,
    rect: boxAround(k.x, k.y, k.w, k.h),
    home: 'deck',
  })),
  { id: 'card.dim', rect: SCREEN_RECT, home: 'screen' },
  { id: 'card.job', rect: jobArt, home: 'jobCard' },
  {
    id: 'card.jobOk',
    rect: boxAround(CENTRE.jobCardOk.x, CENTRE.jobCardOk.y, CENTRE.jobCardOk.w, CENTRE.jobCardOk.h),
    home: 'jobCard',
  },
  { id: 'card.banner', rect: bannerArt, home: 'banner' },
  ...(['pay', 'ignore', 'bin'] as const).map((c): HudRect => ({
    id: `card.banner.${c}`,
    rect: boxAround(
      CENTRE.banner.x + BANNER_BUTTONS[c].dx * CENTRE.banner.scale,
      CENTRE.banner.y + BANNER_BUTTONS[c].dy * CENTRE.banner.scale,
      BANNER_BUTTONS[c].w * CENTRE.banner.scale + 8,
      BANNER_BUTTONS[c].h * CENTRE.banner.scale + 8,
    ),
    home: 'banner',
  })),
  {
    id: 'card.dipFallback',
    rect: boxAround(CENTRE.dipFallback.x, CENTRE.dipFallback.y, 200, 120),
    home: 'dipFallback',
  },
];

/** The cards allowed over the feed while open. */
export const FEED_CARDS: readonly Home[] = ['jobCard', 'banner', 'dipFallback'];

/** The rect a home names. */
export function homeRect(home: Home): Rect {
  if (home === 'screen') return SCREEN_RECT;
  return home in ZONES ? ZONES[home as ZoneId] : CARDS[home as CardId];
}
