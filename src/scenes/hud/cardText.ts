// The words on the HUD host's cards over the feed (the C1 job card and the C2 Solace banner), as
// pure specs, so the two cards can share one set of Text objects (docs/LIVE.md "Budgets": the
// host's cards get 13 texts). The job card is only ever up before the banner (the banner waits for
// it to close), so the host makes CARD_TEXT_POOL texts once and dresses them for whichever card
// shows. HOST_TEXTS counts every text the host makes. Pure: no Phaser.

import { type LineId, line } from '../../strings';
import { BANNER_BUTTONS, CENTRE, COLORS, FONT, FONT_SANS, JOB_ART } from './layout';

/** One text on a card: where it sits (in its card container's space) and how it looks. */
export interface CardTextSpec {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly family: string;
  readonly size: number;
  readonly color: string;
  readonly bold: boolean;
  /** Wrap width in px, or null for none. */
  readonly wrap: number | null;
  readonly originX: number;
  readonly originY: number;
}

const spec = (
  x: number,
  y: number,
  text: string,
  size: number,
  color: string,
  more: Partial<CardTextSpec> = {},
): CardTextSpec => ({
  x,
  y,
  text,
  family: FONT_SANS,
  size,
  color,
  bold: false,
  wrap: null,
  originX: 0.5,
  originY: 0.5,
  ...more,
});

/**
 * The job card's seven texts in game space (its container sits at 0, 0): the alarm mark, the title,
 * the three numbered steps, the goal, and LET'S GO on its button. No numbers to work out: C1 is the
 * hook (Rolando, 30 Oct 2026), and the debrief names the sum. Positions are inside the 864x1252 art,
 * scaled.
 */
export function jobCardTexts(): CardTextSpec[] {
  const j = CENTRE.jobCard;
  const k = j.scale;
  const at = (ax: number, ay: number, s: string, size: number, color: string, wrap: number) =>
    spec(j.x + (ax - JOB_ART.w / 2) * k, j.y + (ay - JOB_ART.h / 2) * k, s, size, color, { wrap: wrap * k });
  const id = (x: LineId): string => line(x);
  return [
    at(153, 200, '!', 72, COLORS.amberText, 190),
    at(540, 200, id('C1.card.title'), 34, COLORS.cyanText, 480),
    at(419, 466, `1   ${id('C1.card.step1')}`, 26, COLORS.white, 680),
    at(419, 679, `2   ${id('C1.card.step2')}`, 26, COLORS.white, 680),
    at(419, 886, `3   ${id('C1.card.step3')}`, 26, COLORS.white, 680),
    at(432, 1107, id('C1.card.goal'), 26, COLORS.amberText, 560),
    spec(CENTRE.jobCardOk.x, CENTRE.jobCardOk.y, id('C1.card.go'), 24, COLORS.cyanText, { family: FONT }),
  ];
}

/** The banner's five texts in its container's space (centred on the art): title, body, 3 buttons. */
export function bannerTexts(): CardTextSpec[] {
  const k = CENTRE.banner.scale;
  const ink = '#2a3b55';
  const labels = line('C2.banner.buttons').split(' / ');
  const buttons = (['pay', 'ignore', 'bin'] as const).map((choice, i) => {
    const p = BANNER_BUTTONS[choice];
    const bin = choice === 'bin';
    return spec(p.dx * k, p.dy * k + (bin ? 26 : 0), labels[i] ?? choice, bin ? 13 : 17, ink);
  });
  return [
    spec(83, -112, line('C2.banner.title'), 24, '#1d4f8f', { bold: true, originY: 0 }),
    spec(83, -70, line('C2.banner.body'), 19, ink, { wrap: 400, originY: 0 }),
    ...buttons,
  ];
}

/** Texts the job card and the banner share: as many as the wordier card needs. */
export const CARD_TEXT_POOL = Math.max(jobCardTexts().length, bannerTexts().length);

/**
 * Every Text the HUD host makes (perf.host.texts): the shared card pool and the dip warning's one
 * line.
 */
export const HOST_TEXTS = { cards: CARD_TEXT_POOL, dip: 1 } as const;

/** The host's text budget in docs/LIVE.md's table. */
export const HOST_TEXT_BUDGET = 13;

/** What dressCardText needs of a text: the setters a Phaser Text has. */
export interface DressableText {
  setText(value: string): unknown;
  setPosition(x: number, y: number): unknown;
  setOrigin(x: number, y: number): unknown;
  setFontFamily(family: string): unknown;
  setFontSize(size: string): unknown;
  setFontStyle(style: string): unknown;
  setColor(color: string): unknown;
  setAlign(align: string): unknown;
  setWordWrapWidth(width: number | null): unknown;
  setVisible(visible: boolean): unknown;
}

/**
 * Dress one pooled text as `s` (or hide it with no spec). Runs only when a card opens, never per
 * frame.
 */
export function dressCardText(t: DressableText, s: CardTextSpec | undefined): void {
  if (!s) {
    t.setVisible(false);
    return;
  }
  t.setFontFamily(s.family);
  t.setFontSize(`${s.size}px`);
  t.setFontStyle(s.bold ? 'bold' : '');
  t.setColor(s.color);
  t.setAlign('center');
  t.setWordWrapWidth(s.wrap);
  t.setText(s.text);
  t.setOrigin(s.originX, s.originY);
  t.setPosition(s.x, s.y);
  t.setVisible(true);
}
