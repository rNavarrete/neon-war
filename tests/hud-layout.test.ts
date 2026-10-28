import {
  BOTTOM,
  CENTRE,
  COLORS,
  FEED_CARDS,
  HUD_RECTS,
  KEY,
  LEFT,
  RIGHT,
  homeRect,
} from '../src/scenes/hud/layout';
import { dialQuestionOpen, sizingPromptOpen } from '../src/scenes/hud/jobCard';
import { SERVER_MODE_FROM } from '../src/scenes/hud/dial';
import { CARDS, ZONES, centreOf, inside, overlaps } from '../src/scenes/live/layout';
import { BROWNOUT } from '../src/sim/brownout';

// tech-4: the legacy HUD restaged into the Live screen's zones. Every piece's box in
// src/scenes/hud/layout.ts lies inside its zone or card, nothing but the cards covers the feed, and
// the owner-fixed internals land where frame 54 puts them. Pure: no Phaser.

describe('hud layout inside the zones', () => {
  it('puts every rect inside the zone or card it belongs to', () => {
    // 30 once the title cluster's, the alert band's, the clock's and the comms band's own rows were
    // retired with the legacy code that drew them (TitleView, AlertView and CommsView place theirs).
    expect(HUD_RECTS.length).toBeGreaterThanOrEqual(20);
    for (const { id, rect, home } of HUD_RECTS) {
      expect(inside(rect, homeRect(home)), `${id} in ${home}`).toBe(true);
    }
  });

  it('lets only the job card’s dimmer cover the whole screen', () => {
    expect(HUD_RECTS.filter((r) => r.home === 'screen').map((r) => r.id)).toEqual(['card.dim']);
  });

  it('keeps everything but the cards off the feed', () => {
    for (const { id, rect, home } of HUD_RECTS) {
      if (FEED_CARDS.includes(home) || home === 'screen') continue;
      expect(overlaps(rect, ZONES.feed), `${id} overlaps the feed`).toBe(false);
    }
    // The cards allowed over the feed are the job card, the banner, the dial card and the sizing
    // prompt, plus the dip warning's fallback.
    expect([...FEED_CARDS].sort()).toEqual(['banner', 'dialCard', 'dipFallback', 'jobCard', 'sizingPrompt']);
  });

  it('places a piece in every zone it fills', () => {
    const homes = new Set(HUD_RECTS.map((r) => r.home));
    // title, alert and clock are drawn by their views from their own layouts (title.ts, alerts.ts),
    // not from this file any more: their rows tested deleted code and are gone.
    for (const zone of ['scope', 'comms', 'deck', 'chat'] as const) {
      expect(homes.has(zone), zone).toBe(true);
    }
    for (const card of ['dialCard', 'sizingPrompt', 'jobCard', 'banner', 'dipFallback'] as const) {
      expect(homes.has(card), card).toBe(true);
    }
  });
});

describe('hud layout owner-fixed internals', () => {
  it('keeps no legacy piece in the top strip or on the comms band line', () => {
    // The legacy title cluster, alert band and clock (TOP) and the comms band's own rows (BOTTOM.comms,
    // the line, the labels, slotFor) were deleted with the code that drew them; their assertions
    // tested deleted code. Nothing in HUD_RECTS sits in the title, alert or clock zones now.
    for (const { id, home } of HUD_RECTS) expect(['title', 'alert', 'clock'], id).not.toContain(home);
    expect(HUD_RECTS.filter((r) => r.home === 'comms').map((r) => r.id)).toEqual(
      ['TRIAGE', 'REI', 'MIKA', 'OZZIE', 'HOUSE'].map((n) => `comms.slot.${n}`),
    );
  });

  it('puts the chart in the scope with the plot at x 46-400, y 905-1050', () => {
    expect(LEFT.chart).toEqual(ZONES.scope);
    expect(LEFT.plot).toEqual({ left: 46, right: 400, top: 905, bottom: 1050 });
  });

  it('puts the 230 px dial on its card and the sizing prompt beside it', () => {
    expect(RIGHT.dialCard).toEqual(CARDS.dialCard);
    expect({ x: RIGHT.dial.x, y: RIGHT.dial.y }).toEqual(centreOf(CARDS.dialCard));
    expect(RIGHT.dial.size).toBe(230);
    expect(CENTRE.sizing).toEqual(CARDS.sizingPrompt);
  });

  it('merges both chats into one column with the body at x 1545-1890, y 840-1060', () => {
    expect(RIGHT.chat).toEqual(ZONES.chat);
    const b = RIGHT.chatBody;
    expect([b.x, b.x + b.w, b.y, b.y + b.h]).toEqual([1545, 1890, 840, 1060]);
    expect(b.rows).toBe(5);
  });

  it('keeps the comms band’s five slots r 42 at y 720, x 517 + 98 i', () => {
    expect(BOTTOM.slots).toEqual(
      ['TRIAGE', 'REI', 'MIKA', 'OZZIE', 'HOUSE'].map((name, i) => ({
        name,
        x: 517 + 98 * i,
        y: 720,
        r: 42,
      })),
    );
  });

  it('puts the keys 80x64 at (1272, 1022), (1360, 1022), (1448, 1022) labelled 1 REGROUP, 2 CUT 3F, 3 SET', () => {
    expect(BOTTOM.keys.map((k) => [k.x, k.y, k.w, k.h])).toEqual([
      [1272, 1022, 80, 64],
      [1360, 1022, 80, 64],
      [1448, 1022, 80, 64],
    ]);
    expect(BOTTOM.keys.map((k) => `${k.digit} ${k.word}`)).toEqual(['1 REGROUP', '2 CUT 3F', '3 SET']);
    expect(KEY).toEqual({ regroup: 0, cut: 1, set: 2 });
  });

  it('keeps the job card and banner centred where hud.spec clicks them', () => {
    expect({ x: CENTRE.jobCard.x, y: CENTRE.jobCard.y }).toEqual(centreOf(CARDS.jobCard));
    expect({ x: CENTRE.banner.x, y: CENTRE.banner.y }).toEqual(centreOf(CARDS.banner));
    expect(CENTRE.jobCard.scale).toBeCloseTo(0.6, 2);
    expect(CENTRE.banner.scale).toBeCloseTo(0.45, 3);
    expect(CENTRE.dipFallback).toEqual(centreOf(CARDS.dipFallback));
  });

  it('makes amber the hero and keeps red apart for over and dropped', () => {
    expect(COLORS.hero).toBe(COLORS.amber);
    expect(COLORS.heroText).toBe(COLORS.amberText);
    expect(COLORS.red).not.toBe(COLORS.hero);
  });
});

describe('the dial question', () => {
  const C = BROWNOUT.challenges;
  const ask = (
    now: number,
    o: Partial<{ cardOpen: boolean; estimate: number | null; sizing: number | null }> = {},
  ) => ({
    now,
    cardOpen: false,
    estimate: null,
    sizing: null,
    ...o,
  });

  it('is closed while the job card is up', () => {
    expect(dialQuestionOpen(ask(C.c1, { cardOpen: true }))).toBe(false);
    expect(dialQuestionOpen(ask(0, { cardOpen: true }))).toBe(false);
  });

  it('opens when the job card closes and stays open until the estimate is SET', () => {
    expect(dialQuestionOpen(ask(C.c1))).toBe(true);
    expect(dialQuestionOpen(ask(C.c3))).toBe(true);
    expect(dialQuestionOpen(ask(C.c1, { estimate: 30 }))).toBe(false);
    expect(dialQuestionOpen(ask(C.c4, { estimate: 30 }))).toBe(false);
  });

  it('opens again exactly while the sizing prompt is open, until SET or midnight', () => {
    const t = SERVER_MODE_FROM;
    expect(sizingPromptOpen(ask(t - 1, { estimate: 30 }))).toBe(false);
    expect(dialQuestionOpen(ask(t - 1, { estimate: 30 }))).toBe(false);
    for (const now of [t, t + 20, BROWNOUT.clock.midnight - 0.1]) {
      const a = ask(now, { estimate: 30 });
      expect(sizingPromptOpen(a)).toBe(true);
      expect(dialQuestionOpen(a)).toBe(true);
    }
    expect(dialQuestionOpen(ask(t + 20, { estimate: 30, sizing: 4 }))).toBe(false);
    expect(sizingPromptOpen(ask(t + 20, { estimate: 30, sizing: 4 }))).toBe(false);
    expect(dialQuestionOpen(ask(BROWNOUT.clock.midnight, { estimate: 30 }))).toBe(false);
    expect(dialQuestionOpen(ask(t + 20, { estimate: 30, cardOpen: true }))).toBe(false);
  });
});
