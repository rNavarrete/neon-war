import {
  BOTTOM,
  CENTRE,
  COLORS,
  FEED_CARDS,
  HUD_RECTS,
  KEY,
  RIGHT,
  homeRect,
} from '../src/scenes/hud/layout';
import { CARDS, ZONES, centreOf, inside, overlaps } from '../src/scenes/live/layout';

// tech-4: the legacy HUD restaged into the Live screen's zones. Every piece's box in
// src/scenes/hud/layout.ts lies inside its zone or card, nothing but the cards covers the feed, and
// the owner-fixed internals land where frame 54 puts them. Pure: no Phaser.

describe('hud layout inside the zones', () => {
  it('puts every rect inside the zone or card it belongs to', () => {
    // 30 once the title cluster's, the alert band's, the clock's and the comms band's own rows were
    // retired with the legacy code that drew them (TitleView, AlertView and CommsView place theirs).
    // 17 since the scope's four rows went with the LAST 60 s chart (30 Oct 2026).
    expect(HUD_RECTS.length).toBeGreaterThanOrEqual(17);
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
    // The cards allowed over the feed are the job card and the banner, plus the dip warning's
    // fallback (the dial card and the sizing prompt went with the estimate step).
    expect([...FEED_CARDS].sort()).toEqual(['banner', 'dipFallback', 'jobCard']);
  });

  it('places a piece in every zone it fills', () => {
    const homes = new Set(HUD_RECTS.map((r) => r.home));
    // title, alert and clock are drawn by their views from their own layouts (title.ts, alerts.ts),
    // not from this file any more: their rows tested deleted code and are gone.
    // No scope: the LAST 60 s chart is gone (30 Oct 2026).
    for (const zone of ['comms', 'deck', 'chat'] as const) {
      expect(homes.has(zone), zone).toBe(true);
    }
    for (const card of ['jobCard', 'banner', 'dipFallback'] as const) {
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

  it("has no chart: the gauge took the scope's space (Rolando, 30 Oct 2026)", () => {
    expect(Object.keys(ZONES)).not.toContain('scope');
    expect(ZONES.gauge).toEqual({ x: 16, y: 710, w: 408, h: 360 });
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

  it('puts the keys 80x64 at (1272, 1022) and (1360, 1022) labelled 1 REGROUP and 2 CUT 3F', () => {
    expect(BOTTOM.keys.map((k) => [k.x, k.y, k.w, k.h])).toEqual([
      [1272, 1022, 80, 64],
      [1360, 1022, 80, 64],
    ]);
    expect(BOTTOM.keys.map((k) => `${k.digit} ${k.word}`)).toEqual(['1 REGROUP', '2 CUT 3F']);
    expect(KEY).toEqual({ regroup: 0, cut: 1 });
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
