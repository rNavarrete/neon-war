import liveDoc from '../docs/LIVE.md?raw';
import { toPage } from '../src/scenes/board/layout';
import { CENTRE } from '../src/scenes/hud/layout';
import {
  CARDS,
  CARD_IDS,
  FEED_SHOWN,
  FEED_VIEW,
  FEED_WORLD,
  LAYOUT_VERSION,
  type Rect,
  SCREEN,
  SCREEN_RECT,
  ZONES,
  TRAY_VIEW,
  TRAY_WORLD,
  ZONE_IDS,
  boardRectToScreen,
  boardToScreen,
  centreOf,
  inside,
  overlaps,
  pagePoint,
  pageRect,
  rectToArea,
  screenToBoard,
} from '../src/scenes/live/layout';

// The Live screen's layout contract (docs/LIVE.md): the zone table, the cards over the feed and
// the page mapping every lane's hook uses.
describe('live layout contract', () => {
  // Version 2 is layout A, the streamer column (Rolando, 30 Oct 2026): the zones below moved with it.
  it('is version 2 of a 1920x1080 screen', () => {
    // 3 since option 2 (Rolando, 30 Oct 2026) moved the right column's zones.
    expect(LAYOUT_VERSION).toBe(3);
    expect(SCREEN).toEqual({ width: 1920, height: 1080 });
  });

  it("has the eleven zones of the plan, exactly (the gauge took the scope's space, 30 Oct 2026)", () => {
    // Layout A2 (Rolando, 30 Oct 2026): Lux's cam and chat in a slim left column, the board in the
    // middle with its sky, the callers' cams, the gauge and the map in a right column.
    expect(ZONES).toEqual({
      title: { x: 0, y: 0, w: 440, h: 100 },
      alert: { x: 450, y: 8, w: 1070, h: 84 },
      // Option 2 (Rolando, 30 Oct 2026: "too much wasted space"): the clock on its painted plate, then the taller
      // caller cam, the gauge and the map down to the bottom edge.
      clock: { x: 1566, y: 0, w: 344, h: 125 },
      map: { x: 1632, y: 913, w: 212, h: 160 },
      cam: { x: 6, y: 110, w: 410, h: 270 },
      gauge: { x: 1566, y: 645, w: 344, h: 260 },
      feed: { x: 426, y: 120, w: 1128, h: 706 },
      comms: { x: 1566, y: 135, w: 344, h: 500 },
      inventory: { x: 426, y: 834, w: 1055, h: 165 },
      deck: { x: 426, y: 1005, w: 1128, h: 65 },
      chat: { x: 6, y: 390, w: 410, h: 680 },
    });
    expect(ZONE_IDS).toEqual([
      'title',
      'alert',
      'clock',
      'map',
      'cam',
      'gauge',
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
    // Since layout A (Rolando, 30 Oct 2026) the board draws in its own space and views show it in the
    // zones: the areas are that space's boxes, the ones the table was painted for.
    expect(rectToArea(FEED_WORLD)).toEqual({ left: 455, right: 1910, top: 110, bottom: 640 });
    expect(rectToArea(TRAY_WORLD)).toEqual({ left: 455, right: 1510, top: 800, bottom: 965 });
    expect(rectToArea(ZONES.feed)).toEqual({ left: 426, right: 1554, top: 120, bottom: 826 });
    expect(rectToArea(ZONES.inventory)).toEqual({ left: 426, right: 1481, top: 834, bottom: 999 });
  });

  it("shows the board's space in its zones through one-scale views, both ways", () => {
    // The feed shows FEED_WORLD with the painted sky above it (FEED_SHOWN), keeping its shape (to
    // within a pixel); the tray draws at its own size.
    expect(FEED_VIEW.world).toEqual(FEED_SHOWN);
    expect(FEED_SHOWN.x).toBe(FEED_WORLD.x);
    expect(FEED_SHOWN.w).toBe(FEED_WORLD.w);
    expect(FEED_SHOWN.y + FEED_SHOWN.h).toBe(FEED_WORLD.y + FEED_WORLD.h);
    expect(FEED_VIEW.scale).toBeCloseTo(1128 / 1455, 9);
    expect(Math.abs(FEED_SHOWN.h * FEED_VIEW.scale - ZONES.feed.h)).toBeLessThan(1);
    expect(TRAY_VIEW.scale).toBe(1);
    expect(boardToScreen({ x: 455, y: -271 })).toEqual({ x: 426, y: 120 });
    expect(boardToScreen({ x: 455, y: 800 })).toEqual({ x: 426, y: 834 });
    for (const p of [
      { x: 700, y: 300 },
      { x: 1900, y: 630 },
      { x: 600, y: 900 },
    ]) {
      const back = screenToBoard(boardToScreen(p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
    const r = boardRectToScreen(FEED_WORLD);
    expect(r.x).toBe(426);
    expect(r.w).toBeCloseTo(1128, 6);
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
    // toPage takes board-space points (it maps them through the views first, since layout A): the
    // zones are screen rects, so their corners go in as the board-space points that land on them.
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
        // Only the board's zones show its space; any other zone's corner maps straight.
        const board = id === 'feed' || id === 'inventory';
        const page = (q: { x: number; y: number }) =>
          board ? toPage(screenToBoard(q), c, game) : pagePoint(q, c);
        expect(pagePoint(corner, c)).toEqual(page(corner));
        expect(pagePoint(far, c)).toEqual(page(far));
        const r = pageRect(z, c);
        expect({ x: r.x, y: r.y }).toEqual(page(corner));
        // The far corner, reached through the size, lands within the tenth both round to.
        const end = page(far);
        expect(Math.abs(r.x + r.w - end.x)).toBeLessThanOrEqual(0.1 + 1e-9);
        expect(Math.abs(r.y + r.h - end.y)).toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
    expect(pageRect(ZONES.feed, canvases[0])).toEqual({ x: 284, y: 80, w: 752, h: 470.7 });
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
