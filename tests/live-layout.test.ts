import liveDoc from '../docs/LIVE.md?raw';
import { toPage } from '../src/scenes/board/layout';
import { CENTRE } from '../src/scenes/hud/layout';
import {
  CARDS,
  CARD_IDS,
  LAYOUT_VERSION,
  type Rect,
  SCREEN,
  SCREEN_RECT,
  ZONES,
  ZONE_IDS,
  centreOf,
  inside,
  overlaps,
  pagePoint,
  pageRect,
  rectToArea,
} from '../src/scenes/live/layout';

// The Live screen's layout contract (docs/LIVE.md): the zone table, the cards over the feed and
// the page mapping every lane's hook uses.
describe('live layout contract', () => {
  it('is version 1 of a 1920x1080 screen', () => {
    expect(LAYOUT_VERSION).toBe(1);
    expect(SCREEN).toEqual({ width: 1920, height: 1080 });
  });

  it('has the twelve zones of the plan, exactly', () => {
    expect(ZONES).toEqual({
      title: { x: 0, y: 0, w: 440, h: 100 },
      alert: { x: 460, y: 8, w: 1040, h: 84 },
      clock: { x: 1520, y: 0, w: 400, h: 100 },
      map: { x: 16, y: 110, w: 408, h: 310 },
      cam: { x: 16, y: 430, w: 408, h: 270 },
      gauge: { x: 16, y: 710, w: 408, h: 170 },
      scope: { x: 16, y: 890, w: 408, h: 180 },
      feed: { x: 455, y: 110, w: 1455, h: 530 },
      comms: { x: 455, y: 645, w: 1455, h: 150 },
      inventory: { x: 455, y: 800, w: 1055, h: 165 },
      deck: { x: 455, y: 970, w: 1055, h: 105 },
      chat: { x: 1525, y: 800, w: 385, h: 275 },
    });
    expect(ZONE_IDS).toEqual([
      'title',
      'alert',
      'clock',
      'map',
      'cam',
      'gauge',
      'scope',
      'feed',
      'comms',
      'inventory',
      'deck',
      'chat',
    ]);
  });

  it('keeps every zone inside the screen with whole-pixel edges', () => {
    for (const id of ZONE_IDS) {
      const z: Rect = ZONES[id];
      expect(inside(z, SCREEN_RECT), id).toBe(true);
      expect(z.w, id).toBeGreaterThan(0);
      expect(z.h, id).toBeGreaterThan(0);
      for (const n of [z.x, z.y, z.w, z.h]) expect(Number.isInteger(n), id).toBe(true);
    }
  });

  it('lets no two zones overlap', () => {
    for (let i = 0; i < ZONE_IDS.length; i++) {
      for (let j = i + 1; j < ZONE_IDS.length; j++) {
        const a = ZONE_IDS[i];
        const b = ZONE_IDS[j];
        expect(overlaps(ZONES[a], ZONES[b]), `${a} overlaps ${b}`).toBe(false);
      }
    }
    // The helper itself: a shared edge is not an overlap, a shared pixel is.
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 10, h: 10 })).toBe(true);
  });

  it('gives the board its areas as edges', () => {
    expect(rectToArea(ZONES.feed)).toEqual({ left: 455, right: 1910, top: 110, bottom: 640 });
    expect(rectToArea(ZONES.inventory)).toEqual({ left: 455, right: 1510, top: 800, bottom: 965 });
  });

  it('lists the cards over the feed: the banner, the job card and the dip fallback', () => {
    // The dial card and the sizing prompt went with the estimate step: the feed's top right is clear.
    expect(CARD_IDS).toEqual(['banner', 'jobCard', 'dipFallback']);
  });

  it("keeps the banner, job card and dip fallback on today's HUD centres, over the feed", () => {
    expect(centreOf(CARDS.banner)).toEqual({ x: CENTRE.banner.x, y: CENTRE.banner.y });
    expect(centreOf(CARDS.jobCard)).toEqual({ x: CENTRE.jobCard.x, y: CENTRE.jobCard.y });
    expect(centreOf(CARDS.dipFallback)).toEqual(CENTRE.dipFallback);
    // The painted art at the HUD's scale (to the nearest even size so the corner stays a whole pixel):
    // the Solace banner is 1431x700 at 0.45, the job card 864x1252 at 0.6.
    const even = (n: number) => Math.round(n / 2) * 2;
    expect(CARDS.banner.w).toBe(even(1431 * CENTRE.banner.scale));
    expect(CARDS.banner.h).toBe(even(700 * CENTRE.banner.scale));
    expect(CARDS.jobCard.w).toBe(even(864 * CENTRE.jobCard.scale));
    expect(CARDS.jobCard.h).toBe(even(1252 * CENTRE.jobCard.scale));
    for (const id of ['banner', 'jobCard', 'dipFallback'] as const) {
      expect(overlaps(CARDS[id], ZONES.feed), id).toBe(true);
      expect(inside(CARDS[id], SCREEN_RECT), id).toBe(true);
      for (const n of [CARDS[id].x, CARDS[id].y]) expect(Number.isInteger(n), id).toBe(true);
    }
  });

  it('maps game pixels to page pixels exactly as toPage in the board layout', () => {
    // A 1280x720 viewport with the canvas filling it, and a letterboxed one with an offset.
    const canvases = [
      { left: 0, top: 0, width: 1280, height: 720 },
      { left: 37.5, top: 12, width: 1205, height: 677.8 },
    ];
    const game = { width: SCREEN.width, height: SCREEN.height };
    for (const c of canvases) {
      for (const id of ZONE_IDS) {
        const z = ZONES[id];
        const corner = { x: z.x, y: z.y };
        const far = { x: z.x + z.w, y: z.y + z.h };
        expect(pagePoint(corner, c)).toEqual(toPage(corner, c, game));
        expect(pagePoint(far, c)).toEqual(toPage(far, c, game));
        const r = pageRect(z, c);
        expect({ x: r.x, y: r.y }).toEqual(toPage(corner, c, game));
        // The far corner, reached through the size, lands within the tenth both round to.
        const end = toPage(far, c, game);
        expect(Math.abs(r.x + r.w - end.x)).toBeLessThanOrEqual(0.1 + 1e-9);
        expect(Math.abs(r.y + r.h - end.y)).toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
    expect(pageRect(ZONES.feed, canvases[0])).toEqual({ x: 303.3, y: 73.3, w: 970, h: 353.3 });
  });

  it('publishes every card rect in the docs/LIVE.md Cards table', () => {
    for (const id of CARD_IDS) {
      const row = new RegExp(
        `^\\| \`${id}\`\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+), (\\d+)`,
        'm',
      ).exec(liveDoc);
      expect(row, id).not.toBeNull();
      const [x, y, w, h, cx, cy] = row!.slice(1).map(Number);
      expect({ x, y, w, h }, id).toEqual(CARDS[id]);
      expect({ x: cx, y: cy }, id).toEqual(centreOf(CARDS[id]));
    }
  });
});
