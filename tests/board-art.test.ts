import boardSource from '../src/scenes/BoardScene.ts?raw';
import inventorySource from '../src/scenes/board/InventoryView.ts?raw';
import { ART_REQUESTS, artRequest, isPicked } from '../src/game/artManifest';
import { resolveArt } from '../src/scenes/plates';
import {
  BOARD_ART_KEYS,
  BOOT_FRAME_HZ,
  CARD_FRAME,
  CARD_FRAME_K,
  CARD_FRAME_SLICE,
  CHANNEL_PLATE_KEY,
  COUNT_BADGE_KEY,
  PART_ART,
  PING_ICON_KEY,
  SKIPPED_ICON_KEY,
  TABLE_PLATE_KEY,
  TABLE_TRAPEZOID,
  badgeScale,
  bootFrameKey,
  cardFrameKey,
  channelPlatePlace,
  isPartArtKey,
  markScale,
  pingLampKey,
  tablePlatePlace,
} from '../src/scenes/board/art';
import { BOARD_AREA, CHANNEL, DATABASE, GATEWAY, TABLE } from '../src/scenes/board/layout';

const cutOf = (key: string) => artRequest(key)!.cut!;

describe('board-12: the board resolves its art through the manifest', () => {
  it('asks for exactly the board lane keys the ticket swaps in, each a known request', () => {
    expect([...BOARD_ART_KEYS].sort()).toEqual(
      [
        'board/table-plate',
        'board/server-dark',
        'board/server-booting-a',
        'board/server-booting-b',
        'board/server-overclocked-dark',
        'board/balancer-ping-a',
        'board/balancer-ping-b',
        'board/channel-plate',
        'hud/live/card-frame-idle',
        'hud/live/card-frame-ready',
        'hud/live/card-frame-locked',
        'hud/live/count-badge',
        'hud/icons/ping',
        'hud/icons/skipped',
      ].sort(),
    );
    for (const key of BOARD_ART_KEYS) {
      const r = artRequest(key);
      expect(r, key).toBeDefined();
      expect(ART_REQUESTS).toContain(r);
    }
    for (const k of Object.values(PART_ART)) expect(isPartArtKey(k)).toBe(true);
    expect(isPartArtKey('server')).toBe(false);
  });

  it('every key resolves to its picked file under public/art (no network, no stand-in) now they have landed', () => {
    for (const key of BOARD_ART_KEYS) {
      expect(isPicked(artRequest(key)!), key).toBe(true);
      const r = resolveArt(key);
      expect(r.fallback, key).toBe(false);
      expect(r.texture).toBe(`art:${key}`);
    }
  });

  it('BoardScene loads them only through preloadArt and resolveArt, and nothing from the network', () => {
    expect(boardSource).toMatch(/preloadArt\(this, BOARD_ART_KEYS\)/);
    expect(boardSource).toMatch(/resolveArt\(key\)/);
    for (const src of [boardSource, inventorySource]) {
      expect(src).not.toMatch(/https?:\/\//);
      expect(src).not.toMatch(/window\.__neonTest/);
      expect(src).not.toMatch(/\bfetch\(/);
    }
    // The picked keys are never put into BoardScene's own file map.
    for (const key of BOARD_ART_KEYS) expect(boardSource).not.toContain(`art/${key}.webp`);
  });
});

describe('board-12: nothing upscales', () => {
  it('the table plate draws at most at its file size, inside the feed, under the trapezoid', () => {
    const cut = cutOf(TABLE_PLATE_KEY);
    const p = tablePlatePlace(cut);
    expect(p.scale).toBeLessThanOrEqual(1);
    expect(p.w).toBeLessThanOrEqual(cut.w);
    expect(p.h).toBeLessThanOrEqual(cut.h);
    expect(p.w).toBeCloseTo(cut.w * p.scale);
    // Inside the feed zone and the trapezoid's width, centred on it, its foot on the feed's floor.
    expect(p.x).toBeGreaterThanOrEqual(TABLE_TRAPEZOID.left);
    expect(p.x + p.w).toBeLessThanOrEqual(TABLE_TRAPEZOID.right);
    expect(p.x + p.w / 2).toBeCloseTo((TABLE.near.left + TABLE.near.right) / 2);
    expect(p.y + p.h).toBeCloseTo(BOARD_AREA.bottom);
    expect(p.y).toBeGreaterThanOrEqual(BOARD_AREA.top);
    // The far rim sits at the trapezoid's far edge (within the plate's painted rim).
    expect(Math.abs(p.y - TABLE.far.y)).toBeLessThanOrEqual(12);
    // The gateway and the database stand over it.
    for (const c of [GATEWAY, DATABASE]) {
      expect(c.x).toBeGreaterThan(p.x);
      expect(c.x).toBeLessThan(p.x + p.w);
    }
  });

  it('a plate larger than the trapezoid is scaled down to fit, never up', () => {
    const big = tablePlatePlace({ w: 3072, h: 832 });
    expect(big.scale).toBeLessThan(1);
    expect(big.w).toBeLessThanOrEqual(TABLE_TRAPEZOID.right - TABLE_TRAPEZOID.left + 1e-9);
    expect(big.h).toBeLessThanOrEqual(BOARD_AREA.bottom - TABLE_TRAPEZOID.top + 1e-9);
    expect(tablePlatePlace({ w: 100, h: 40 }).scale).toBe(1);
  });

  it('the channel plate sits on the mouth inside its 150 x 200 box, at most its file size', () => {
    const cut = cutOf(CHANNEL_PLATE_KEY);
    const p = channelPlatePlace(cut);
    expect(p.scale).toBeLessThanOrEqual(1);
    expect(p.w).toBeLessThanOrEqual(150);
    expect(p.h).toBeLessThanOrEqual(200);
    expect(p.x).toBe(CHANNEL.mouth.x);
    expect(p.y + p.h / 2).toBeCloseTo((CHANNEL.mouth.top + CHANNEL.mouth.bottom) / 2);
    expect(p.y).toBeGreaterThanOrEqual(BOARD_AREA.top);
    expect(p.y + p.h).toBeLessThanOrEqual(BOARD_AREA.bottom);
  });

  it('card frames nine-slice at k 0.5 with corners inside every file and every card', () => {
    expect(CARD_FRAME_K).toBe(artRequest(CARD_FRAME.idle)!.nineSlice!.k);
    for (const key of Object.values(CARD_FRAME)) {
      const cut = cutOf(key);
      expect(artRequest(key)!.nineSlice!.k).toBe(0.5);
      expect(2 * CARD_FRAME_SLICE).toBeLessThan(Math.min(cut.w, cut.h));
    }
    // The smallest card (a drawer mini, 40 x 72) still fits two drawn corners.
    expect(2 * CARD_FRAME_SLICE * CARD_FRAME_K).toBeLessThanOrEqual(40);
  });

  it('the count badge and the two marks draw at most at their file size', () => {
    const badge = cutOf(COUNT_BADGE_KEY);
    const s = badgeScale(badge);
    expect(s).toBeLessThanOrEqual(1);
    expect(badge.w * s).toBeLessThanOrEqual(40);
    expect(badge.h * s).toBeLessThanOrEqual(28);
    for (const [key, px] of [
      [PING_ICON_KEY, 44],
      [SKIPPED_ICON_KEY, 64 * 1.06],
    ] as const) {
      const cut = cutOf(key);
      const m = markScale(cut, px);
      expect(m).toBeLessThanOrEqual(1);
      expect(Math.max(cut.w, cut.h) * m).toBeCloseTo(px);
    }
    expect(markScale({ w: 20, h: 20 }, 44)).toBe(1);
  });
});

describe('board-12: which frame shows', () => {
  it('cards: locked wears the locked frame, a card with some to use the ready one, else idle', () => {
    expect(cardFrameKey(true, 3)).toBe(CARD_FRAME.locked);
    expect(cardFrameKey(false, 2)).toBe(CARD_FRAME.ready);
    expect(cardFrameKey(false, 0)).toBe(CARD_FRAME.idle);
    expect(cardFrameKey(false, -1)).toBe(CARD_FRAME.idle);
  });

  it('boot frames swap 4 times a second in full and hold on A when calm', () => {
    expect(BOOT_FRAME_HZ).toBe(4);
    expect(bootFrameKey(0, false)).toBe(PART_ART.bootA);
    expect(bootFrameKey(0.26, false)).toBe(PART_ART.bootB);
    expect(bootFrameKey(0.51, false)).toBe(PART_ART.bootA);
    for (const t of [0, 0.26, 0.51, 0.76, 3.3]) expect(bootFrameKey(t, true)).toBe(PART_ART.bootA);
  });

  it('the ping lamp is lit for the first half of each ping in full and steady lit when calm', () => {
    expect(pingLampKey(0.1, false)).toBe(PART_ART.pingB);
    expect(pingLampKey(0.6, false)).toBe(PART_ART.pingA);
    expect(pingLampKey(1.1, false)).toBe(PART_ART.pingB);
    for (const t of [0.1, 0.6, 1.1, 7.7]) expect(pingLampKey(t, true)).toBe(PART_ART.pingB);
  });
});
