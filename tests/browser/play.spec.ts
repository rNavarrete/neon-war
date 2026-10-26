import { type Page, expect, test } from '@playwright/test';
import type { TestSnapshot } from '../../src/testHook';

const state = (page: Page) => page.evaluate(() => window.__neonTest!.state as TestSnapshot);

async function start(page: Page, speed = 1) {
  await page.goto(`/?test&speed=${speed}`);
  await expect.poll(async () => (await state(page)).ready, { timeout: 15_000 }).toBe(true);
}

async function click(page: Page, [x, y]: [number, number]) {
  await page.mouse.click(x, y);
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 5 });
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

/** Drag the cache into a slot and return its node id. */
async function placeCache(page: Page, slot = 'slot-2'): Promise<string> {
  const s = await state(page);
  await drag(page, s.at!.tray.cache, s.at!.slots[slot]);
  await expect
    .poll(async () => (await state(page)).mission!.nodes.some((n) => n.kind === 'cache'))
    .toBe(true);
  return (await state(page)).mission!.nodes.find((n) => n.kind === 'cache')!.id;
}

async function wire(page: Page, from: string, to: string) {
  const s = await state(page);
  await click(page, s.at!.nodes[from]);
  await click(page, s.at!.nodes[to]);
  await expect
    .poll(async () => (await state(page)).mission!.links.some((l) => l.from === from && l.to === to))
    .toBe(true);
}

test('dragging the cache into a slot spends its credits', async ({ page }) => {
  await start(page);
  const cache = await placeCache(page);
  const s = await state(page);
  expect(s.mission!.nodes.find((n) => n.id === cache)!.slot).toBe('slot-2');
  expect(s.mission!.credits).toBe(100);
  expect(s.partner!.said).toContain('cache-placed');
});

test('a card dropped away from every slot places nothing', async ({ page }) => {
  await start(page);
  const s = await state(page);
  const [x, y] = s.at!.tray.cache;
  await drag(page, [x, y], [x + 10, y - 160]);
  const after = await state(page);
  expect(after.mission!.nodes.some((n) => n.kind === 'cache')).toBe(false);
  expect(after.mission!.credits).toBe(400);
});

test('wiring the cache from both servers into the database wins, and Retry starts over', async ({ page }) => {
  await start(page, 8);
  const cache = await placeCache(page);
  await wire(page, 'server-1', cache);
  await wire(page, 'server-2', cache);
  await wire(page, cache, 'database');

  await expect.poll(async () => (await state(page)).mission!.outcome, { timeout: 20_000 }).toBe('won');
  const won = await state(page);
  expect(won.mission!.dbLoad).toBeLessThan(1);
  expect(won.partner!.mood).toBe('relieved');
  await page.screenshot({ path: 'test-results/screens/won.png' });

  await click(page, won.at!.retry!);
  await expect.poll(async () => (await state(page)).mission?.time ?? 99).toBeLessThan(5);
  const fresh = await state(page);
  expect(fresh.mission!.outcome).toBe('playing');
  expect(fresh.mission!.credits).toBe(400);
  expect(fresh.mission!.nodes.some((n) => n.kind === 'cache')).toBe(false);
});

test('doing nothing loses the city with the database overloaded', async ({ page }) => {
  await start(page, 8);
  await expect
    .poll(async () => (await state(page)).mission!.backlog, { timeout: 10_000 })
    .toBeGreaterThan(150);
  await page.screenshot({ path: 'test-results/screens/overloaded.png' });
  await expect.poll(async () => (await state(page)).mission!.outcome, { timeout: 20_000 }).toBe('lost');
  const lost = await state(page);
  expect(lost.mission!.dbLoad).toBeGreaterThan(1);
  expect(lost.partner!.said).toEqual(expect.arrayContaining(['spike', 'db-hot', 'lost']));
  await page.screenshot({ path: 'test-results/screens/lost.png' });
});

test('a link can be cut, and a refused link explains why', async ({ page }) => {
  await start(page);
  let s = await state(page);
  await click(page, s.at!.cut['server-1>database']);
  await expect
    .poll(async () =>
      (await state(page)).mission!.links.some((l) => l.from === 'server-1' && l.to === 'database'),
    )
    .toBe(false);

  s = await state(page);
  await click(page, s.at!.nodes.gateway);
  await click(page, s.at!.nodes.database);
  await expect.poll(async () => (await state(page)).toast).toContain("can't send traffic");
});

test('a placed cache can be decommissioned for half its cost', async ({ page }) => {
  await start(page);
  const cache = await placeCache(page);
  const s = await state(page);
  await click(page, s.at!.remove[cache]);
  await expect.poll(async () => (await state(page)).mission!.nodes.some((n) => n.id === cache)).toBe(false);
  expect((await state(page)).mission!.credits).toBe(250);
});
