// Where the HUD's pieces sit, in 1920x1080 game space. Every number here is computed from the Live
// screen's contract (src/scenes/live/layout.ts ZONES and CARDS, docs/LIVE.md): a piece is placed
// from its zone's corner, so moving a zone moves its pieces. Only the job card, the Solace banner,
// the dial card and the sizing prompt (and the dip warning, on its part or its fallback card) cover
// the feed, and only while open. HUD_RECTS lists each piece's box and the zone or card it must stay
// inside, for tests/hud-layout.test.ts. Pure: no Phaser.

import { speakerName } from '../../game/portraits';
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

// ---- the top strip: title, alert, clock ----

const title = Z.title;
const alert = Z.alert;
const clock = Z.clock;

export const TOP = {
  /** Lux's avatar in a ring, top-left of the title zone. */
  avatar: { x: title.x + 56, y: title.y + 50, r: 36 },
  /** The LIVE dot and its word. */
  live: { x: title.x + 112, y: title.y + 26, r: 7 },
  liveText: { x: title.x + 126, y: title.y + 26 },
  /** The trust and credits chips: an icon on the left, the number after it. */
  trust: { x: title.x + 104, y: title.y + 48, w: 150, h: 40 },
  credits: { x: title.x + 268, y: title.y + 48, w: 164, h: 40 },
  /** The alert band fills its zone: the headline from (540, 16), the number chip ending at x 1470. */
  alert: { x: alert.x, y: alert.y, w: alert.w, h: alert.h },
  alertIcon: { x: alert.x + 40, y: alert.y + alert.h / 2, size: 44 },
  alertHeadline: { x: alert.x + 80, y: alert.y + 8, w: 640, h: 68 },
  alertChip: { right: alert.x + alert.w - 30, y: alert.y + alert.h / 2, w: 250, h: 44 },
  /** The in-world clock and the countdown under it; the pause button (1850, 52) is OverlayScene's. */
  clockText: { x: clock.x, y: clock.y + 20, w: 200, h: 44 },
  countdown: { x: clock.x, y: clock.y + 64, w: 240, h: 28 },
  clockPanel: { x: clock.x + 216, y: clock.y + 12, size: 76 },
};

// ---- the left column: the scope ----

const scope = Z.scope;

export const LEFT = {
  /** The chart's panel is the scope zone; the plot is x 46-400, y 905-1050. */
  chart: { x: scope.x, y: scope.y, w: scope.w, h: scope.h },
  plot: { left: scope.x + 30, right: scope.x + 384, top: scope.y + 15, bottom: scope.y + 160 },
  /** The y-axis top, right-aligned over the plot's top-right corner. */
  chartTop: { right: scope.x + 384, y: scope.y + 1, w: 90, h: 16 },
  /** The demand and room numbers under the plot. */
  chartLegend: { x: scope.x + 30, y: scope.y + 163, w: 354, h: 16 },
};

// ---- the right: the dial card and the chat ----

const dialCard = K.dialCard;
const dialCentre = centreOf(dialCard);
const chat = Z.chat;

export const RIGHT = {
  dialCard: { x: dialCard.x, y: dialCard.y, w: dialCard.w, h: dialCard.h },
  /** The 230 px dial, centred on its card (the painted art is 823x835). */
  dial: { x: dialCentre.x, y: dialCentre.y, size: 230 },
  dialLabel: { x: dialCentre.x, y: dialCard.y + 4, w: 200, h: 22 },
  dialMinus: { x: dialCard.x + 28, y: dialCard.y + dialCard.h - 28, r: 26 },
  dialPlus: { x: dialCard.x + dialCard.w - 28, y: dialCard.y + dialCard.h - 28, r: 26 },
  /** The one chat column (block and stream merged): its panel is the zone, the rows the body. */
  chat: { x: chat.x, y: chat.y, w: chat.w, h: chat.h },
  chatTitle: { x: chat.x + 22, y: chat.y + 14 },
  chatBody: { x: chat.x + 20, y: chat.y + 40, w: chat.w - 40, h: 220, rows: 5 },
};

// ---- the bottom: the comms band and the deck ----

const comms = Z.comms;
const deck = Z.deck;

const SLOT_NAMES = ['TRIAGE', 'REI', 'MIKA', 'OZZIE', 'HOUSE'] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

const KEY_LABELS = [
  { digit: '1', word: 'REGROUP' },
  { digit: '2', word: 'CUT 3F' },
  { digit: '3', word: 'SET' },
] as const;

export const BOTTOM = {
  comms: { x: comms.x, y: comms.y, w: comms.w, h: comms.h },
  commsTitle: { x: comms.x + 22, y: comms.y + 8 },
  /** The crew's five slots, r 42 at y 720, x 517 + 98 i, each named under its circle. */
  slots: SLOT_NAMES.map((name, i) => ({ name, x: comms.x + 62 + 98 * i, y: comms.y + 75, r: 42 })),
  slotLabelY: comms.y + 122,
  /** The face shown in the speaking slot, fitted inside the circle. */
  slotFace: 58,
  divider: { x: comms.x + 520, top: comms.y + 14, bottom: comms.y + comms.h - 14 },
  /** The current line: the speaker over the words, from x 1000, wrapped to 760 px. */
  lineName: { x: comms.x + 545, y: comms.y + 12 },
  lineText: { x: comms.x + 545, y: comms.y + 38, w: 760, h: 100 },
  /** The deck's keys, 80x64 at (1272, 1022), (1360, 1022), (1448, 1022). */
  keys: KEY_LABELS.map((k, i) => ({ ...k, x: deck.x + 817 + 88 * i, y: deck.y + 52, w: 80, h: 64 })),
};

export const KEY = { regroup: 0, cut: 1, set: 2 } as const;

/** The slot a speaker's line lights: the crew by name, anyone else (Lux, the TV, the door) HOUSE. */
export function slotFor(speaker: string): number {
  const name = speakerName(speaker).toUpperCase();
  const i = BOTTOM.slots.findIndex((s) => s.name === name);
  return i >= 0 ? i : BOTTOM.slots.length - 1;
}

// ---- cards over the feed ----

/** The painted sizes of the job card and the Solace banner art. */
export const JOB_ART = { w: 864, h: 1252 } as const;
export const BANNER_ART = { w: 1431, h: 700 } as const;

const jobCard = K.jobCard;
const jobCentre = centreOf(K.jobCard);
const banner = centreOf(K.banner);
const sizing = K.sizingPrompt;

export const CENTRE = {
  /** The 864x1252 job card art at 0.6, centred on its card (the card is the art rounded to even pixels). */
  jobCard: { x: jobCentre.x, y: jobCentre.y, scale: 0.6 },
  /** The OK button along the job card's bottom edge (the whole card also clicks away). */
  jobCardOk: { x: jobCentre.x, y: jobCard.y + jobCard.h - 35, w: 150, h: 50 },
  /** The 1431x700 Solace banner art at 0.45, centred on its card (the art rounded to even pixels). */
  banner: { x: banner.x, y: banner.y, scale: 0.45 },
  /** The C6 sizing prompt, beside the dial card, its arrow pointing at the dial. */
  sizing: { x: sizing.x, y: sizing.y, w: sizing.w, h: sizing.h },
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
  { id: 'title.avatar', rect: circle(TOP.avatar), home: 'title' },
  { id: 'title.live', rect: { x: TOP.live.x - TOP.live.r, y: TOP.live.y - 12, w: 80, h: 24 }, home: 'title' },
  { id: 'title.trust', rect: TOP.trust, home: 'title' },
  { id: 'title.credits', rect: TOP.credits, home: 'title' },
  { id: 'alert.band', rect: TOP.alert, home: 'alert' },
  {
    id: 'alert.icon',
    rect: boxAround(TOP.alertIcon.x, TOP.alertIcon.y, TOP.alertIcon.size, TOP.alertIcon.size),
    home: 'alert',
  },
  { id: 'alert.headline', rect: TOP.alertHeadline, home: 'alert' },
  {
    id: 'alert.chip',
    rect: {
      x: TOP.alertChip.right - TOP.alertChip.w,
      y: TOP.alertChip.y - TOP.alertChip.h / 2,
      w: TOP.alertChip.w,
      h: TOP.alertChip.h,
    },
    home: 'alert',
  },
  { id: 'clock.text', rect: TOP.clockText, home: 'clock' },
  { id: 'clock.countdown', rect: TOP.countdown, home: 'clock' },
  {
    id: 'clock.panel',
    rect: { x: TOP.clockPanel.x, y: TOP.clockPanel.y, w: TOP.clockPanel.size, h: TOP.clockPanel.size },
    home: 'clock',
  },
  { id: 'scope.panel', rect: LEFT.chart, home: 'scope' },
  {
    id: 'scope.plot',
    rect: {
      x: LEFT.plot.left,
      y: LEFT.plot.top,
      w: LEFT.plot.right - LEFT.plot.left,
      h: LEFT.plot.bottom - LEFT.plot.top,
    },
    home: 'scope',
  },
  {
    id: 'scope.top',
    rect: {
      x: LEFT.chartTop.right - LEFT.chartTop.w,
      y: LEFT.chartTop.y,
      w: LEFT.chartTop.w,
      h: LEFT.chartTop.h,
    },
    home: 'scope',
  },
  { id: 'scope.legend', rect: LEFT.chartLegend, home: 'scope' },
  { id: 'dial.card', rect: RIGHT.dialCard, home: 'dialCard' },
  {
    id: 'dial.face',
    rect: boxAround(RIGHT.dial.x, RIGHT.dial.y, RIGHT.dial.size, RIGHT.dial.size * (835 / 823)),
    home: 'dialCard',
  },
  { id: 'dial.label', rect: boxAround(RIGHT.dialLabel.x, RIGHT.dialLabel.y + 11, 200, 22), home: 'dialCard' },
  { id: 'dial.minus', rect: circle(RIGHT.dialMinus), home: 'dialCard' },
  { id: 'dial.plus', rect: circle(RIGHT.dialPlus), home: 'dialCard' },
  { id: 'sizing.prompt', rect: CENTRE.sizing, home: 'sizingPrompt' },
  { id: 'chat.panel', rect: RIGHT.chat, home: 'chat' },
  { id: 'chat.body', rect: RIGHT.chatBody, home: 'chat' },
  { id: 'comms.band', rect: BOTTOM.comms, home: 'comms' },
  ...BOTTOM.slots.map((s): HudRect => ({ id: `comms.slot.${s.name}`, rect: circle(s), home: 'comms' })),
  ...BOTTOM.slots.map((s): HudRect => ({
    id: `comms.label.${s.name}`,
    rect: boxAround(s.x, BOTTOM.slotLabelY + 8, 84, 16),
    home: 'comms',
  })),
  {
    id: 'comms.line',
    rect: {
      x: BOTTOM.lineName.x,
      y: BOTTOM.lineName.y,
      w: BOTTOM.lineText.w,
      h: BOTTOM.lineText.y + BOTTOM.lineText.h - BOTTOM.lineName.y,
    },
    home: 'comms',
  },
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
export const FEED_CARDS: readonly Home[] = ['jobCard', 'banner', 'dialCard', 'sizingPrompt', 'dipFallback'];

/** The rect a home names. */
export function homeRect(home: Home): Rect {
  if (home === 'screen') return SCREEN_RECT;
  return home in ZONES ? ZONES[home as ZoneId] : CARDS[home as CardId];
}
