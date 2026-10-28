import { type Page, expect, test } from '@playwright/test';
import type { BoardTestState } from '../../src/scenes/board/hook';
import type { LiveTestState } from '../../src/scenes/live/hook';
import type { Rect } from '../../src/scenes/live/layout';

// The board on the Live screen (board lane, M1): the feed's tilted table, its parts and slots inside
// the feed zone, the skyline above it and no goggles overlay. Positions come from the test hook in
// page CSS pixels; nothing here reads pixels.

type Pt = { x: number; y: number };
type Sections = { board: BoardTestState; live: LiveTestState };

// Headless Chromium draws WebGL in software and can run at a few frames a second on a busy box.
test.describe.configure({ timeout: 90_000 });

async function sections(page: Page): Promise<Sections> {
  return page.evaluate(() => {
    const s = window.__neonTest!.state as unknown as Partial<Sections>;
    return { board: s.board!, live: s.live! };
  });
}

const board = async (page: Page) => (await sections(page)).board;

/** The HUD may open the job card over the board: click it away if it is open. */
async function dismissJobCard(page: Page): Promise<void> {
  type Hud = { hud?: { jobCard?: { open: boolean; x: number; y: number } } };
  const hud = () => page.evaluate(() => (window.__neonTest!.state as Hud).hud);
  await expect
    .poll(hud, { timeout: 1500 })
    .toBeDefined()
    .catch(() => undefined);
  const card = (await hud())?.jobCard;
  if (!card?.open) return;
  await page.mouse.click(card.x, card.y);
  await expect.poll(async () => (await hud())?.jobCard?.open).toBe(false);
}

async function openBoard(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/?test&scene=board');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = window.__neonTest?.state as unknown as Partial<Sections> & { ready?: boolean };
          return Boolean(s?.ready && s.live && s.board);
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  await dismissJobCard(page);
  expect(errors).toEqual([]);
}

async function drag(page: Page, from: Pt, to: Pt): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

async function placeServer(page: Page, slotId: string): Promise<string> {
  const b = await board(page);
  const card = b.tray.find((t) => t.id === 'server')!;
  const slot = b.slots.find((s) => s.id === slotId)!;
  await drag(page, card, slot);
  await expect.poll(async () => (await board(page)).parts.find((p) => p.slot === slotId)?.id).toBeDefined();
  return (await board(page)).parts.find((p) => p.slot === slotId)!.id;
}

/** Page pixels are rounded to a tenth, so allow a tenth on each edge. */
function expectInside(r: Rect, outer: Rect, what: string): void {
  expect(r.x, `${what} left`).toBeGreaterThanOrEqual(outer.x - 0.1);
  expect(r.y, `${what} top`).toBeGreaterThanOrEqual(outer.y - 0.1);
  expect(r.x + r.w, `${what} right`).toBeLessThanOrEqual(outer.x + outer.w + 0.1);
  expect(r.y + r.h, `${what} bottom`).toBeLessThanOrEqual(outer.y + outer.h + 0.1);
}

test('the feed: every part and slot inside the feed zone, the skyline above the table, no goggles', async ({
  page,
}) => {
  await openBoard(page);
  // One server on the far row and one on the near row, so both ends of the rack's depth are checked.
  await placeServer(page, 's1');
  await placeServer(page, 's6');

  const { board: b, live } = await sections(page);
  const feed = live.zones.feed;
  expect(b.area).toEqual(feed);

  expect(b.slots.map((s) => s.id).sort()).toEqual(['lb', 's1', 's2', 's3', 's4', 's5', 's6']);
  for (const s of b.slots) {
    expectInside(s.rect, feed, `slot ${s.id}`);
    // The slot's pad centre (where a drop lands) is inside its own drop box.
    expect(s.x).toBeGreaterThanOrEqual(s.rect.x);
    expect(s.x).toBeLessThanOrEqual(s.rect.x + s.rect.w);
    expect(s.y).toBeGreaterThanOrEqual(s.rect.y);
    expect(s.y).toBeLessThanOrEqual(s.rect.y + s.rect.h);
  }
  expect(b.parts.map((p) => p.kind).sort()).toEqual(['database', 'gateway', 'server', 'server']);
  for (const p of b.parts) expectInside(p.rect, feed, `part ${p.id}`);
  // The near row draws bigger than the far row.
  const far = b.parts.find((p) => p.slot === 's1')!;
  const near = b.parts.find((p) => p.slot === 's6')!;
  expect(near.rect.h).toBeGreaterThan(far.rect.h);
  expect(near.y).toBeGreaterThan(far.y);

  // The skyline shows across the top of the feed, above the table; Lux's goggles are gone.
  expect(b.backdrop.goggles).toBe(false);
  const sky = b.backdrop.skyline!;
  expect(sky).not.toBeNull();
  expectInside(sky, feed, 'skyline');
  expect(sky.y).toBeCloseTo(feed.y, 0);
  expect(sky.h).toBeGreaterThan(feed.h * 0.15);
  for (const p of b.parts) expect(p.rect.y).toBeGreaterThan(sky.y + sky.h);

  await page.screenshot({ path: 'test-results/screens/board-live-c1.png' });
});

test('the inventory row: cards with prices and counts in the inventory zone, the drawer not for tonight', async ({
  page,
}) => {
  await openBoard(page);
  const { board: b, live } = await sections(page);
  const zone = live.zones.inventory;
  expect(b.inventory.area).toEqual(zone);
  for (const t of b.tray) {
    expect(t.x, t.id).toBeGreaterThanOrEqual(zone.x);
    expect(t.x, t.id).toBeLessThanOrEqual(zone.x + zone.w);
    expect(t.y, t.id).toBeGreaterThanOrEqual(zone.y);
    expect(t.y, t.id).toBeLessThanOrEqual(zone.y + zone.h);
  }

  const byId = Object.fromEntries(b.tray.map((t) => [t.id, t]));
  // 400 credits buy five 80-credit servers; no server to fit a kit to yet; the balancer not given.
  expect(byId.server).toMatchObject({ price: 80, count: 5, locked: false });
  expect(byId.overclock).toMatchObject({ price: 60, count: 0, locked: false });
  expect(byId.balancer).toMatchObject({ price: 0, count: 0, locked: true });
  expect(b.inventory.counts).toEqual({ server: 5, overclock: 0, balancer: 0 });
  const minis = b.tray.filter((t) => !['server', 'overclock', 'balancer'].includes(t.id));
  expect(minis).toHaveLength(20);
  for (const m of minis) expect(m).toMatchObject({ price: null, count: 0, locked: true });

  // Placing a server spends 80 (and upkeep drips a little more): the server count follows the
  // credits, and there is now one server to fit a kit to.
  await placeServer(page, 's1');
  await expect.poll(async () => (await board(page)).inventory.counts.overclock).toBe(1);
  const after = await board(page);
  const servers = Math.min(Math.floor(after.credits / 80), 5);
  expect([3, 4]).toContain(servers);
  expect(after.inventory.counts).toEqual({ server: servers, overclock: 1, balancer: 0 });
  expect(after.tray.find((t) => t.id === 'server')!.count).toBe(servers);
  expect(after.tray.find((t) => t.id === 'overclock')!.count).toBe(1);

  // A drawer mini is not for tonight, and says so without naming its kind.
  const mini = minis[5];
  await page.mouse.click(mini.x, mini.y);
  await expect.poll(async () => (await board(page)).refusal).toMatch(/not tonight/i);
  expect((await board(page)).refusal!.toLowerCase()).not.toContain(mini.label);

  await page.screenshot({ path: 'test-results/screens/board-live-inventory.png' });
});

test('one read of the run per frame: the board draws from the shared Frame it read this frame', async ({
  page,
}) => {
  await openBoard(page);
  const id = await placeServer(page, 's1');
  const before = await board(page);
  const gateway = before.parts.find((p) => p.kind === 'gateway')!;
  const server = before.parts.find((p) => p.id === id)!;
  await drag(page, gateway, server);
  await expect.poll(async () => (await board(page)).wires.length).toBe(1);

  // On every hook read the snapshot was taken on the board's latest frame, and frames keep coming.
  const first = await board(page);
  expect(first.snapshotFrame).toBe(first.frame);
  await expect.poll(async () => (await board(page)).frame).toBeGreaterThan(first.frame + 5);
  for (let i = 0; i < 5; i++) {
    const b = await board(page);
    expect(b.snapshotFrame).toBe(b.frame);
    // The sim moved under the board (a part placed, a wire laid), so the Frame changed, but never
    // more than once a frame.
    expect(b.snapshotChanges).toBeGreaterThan(1);
    expect(b.snapshotChanges).toBeLessThanOrEqual(b.frame);
  }
  // Between frames the board's Frame is the very object frame() hands every other view.
  await expect.poll(async () => (await board(page)).snapshotCurrent).toBe(true);
});
