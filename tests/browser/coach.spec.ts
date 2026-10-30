import { type Page, expect, test } from '@playwright/test';
import type { BoardTestState } from '../../src/scenes/board/hook';
import type { HudTestState } from '../../src/scenes/hud/hook';
import { SERVER_SLOTS } from '../../src/sim/tick';

// The tutorial coach (src/scenes/hud/coach.ts), played with the mouse: a first-timer who does
// nothing gets the SERVER card lit, then nudges; a box left unwired gets a ghost wire from the
// gateway, then one on to the database, each with the step on the alert band; once the box is
// wired through, the coach lets go. Asserts on the test hook, never on pixels.

type Pt = { x: number; y: number };

test.describe.configure({ timeout: 120_000 });

const board = (page: Page): Promise<BoardTestState> => page.evaluate(() => window.__neonTest!.state.board!);
const hud = (page: Page): Promise<HudTestState> =>
  page.evaluate(() => (window.__neonTest!.state as unknown as { hud: HudTestState }).hud);

async function openBoard(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // Speed 4 runs the HUD clock four times as fast, so nudges 8 s and 17 s in come in a few seconds.
  await page.goto('/?test&scene=board&speed=4');
  await expect
    .poll(() => page.evaluate(() => window.__neonTest?.state.ready ?? false), { timeout: 15_000 })
    .toBe(true);
  await expect.poll(async () => (await hud(page))?.jobCard?.open, { timeout: 5_000 }).toBe(true);
  const card = (await hud(page)).jobCard;
  await page.mouse.click(card.x, card.y);
  await expect.poll(async () => (await hud(page)).jobCard.open).toBe(false);
  expect(errors).toEqual([]);
}

async function drag(page: Page, from: Pt, to: Pt): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

const tray = async (page: Page, id: string) => (await board(page)).tray.find((t) => t.id === id)!;
const slot = async (page: Page, id: string) => (await board(page)).slots.find((s) => s.id === id)!;
const part = async (page: Page, id: string) => (await board(page)).parts.find((p) => p.id === id)!;

test('a first-timer who does nothing gets the SERVER card lit, then TRIAGE nudges', async ({ page }) => {
  await openBoard(page);
  await expect.poll(async () => (await hud(page)).coach.lit, { timeout: 20_000 }).toBe(true);
  const c = await hud(page);
  expect(c.coach.step).toBe('place');
  expect(c.coach.cards).toEqual(['server']);
  expect(c.coach.hint).toBe('C1.alert.place');
  expect((await board(page)).coach).toMatchObject({ step: 'place', cards: ['server'], wire: null });
  await expect.poll(async () => (await hud(page)).coach.said.length, { timeout: 20_000 }).toBe(1);
  expect((await hud(page)).coach.said).toEqual(['C1.triage.nudge.place.1']);
  await expect
    .poll(async () => (await hud(page)).bark.history.includes('C1.triage.nudge.place.1'), { timeout: 20_000 })
    .toBe(true);
  await page.screenshot({ path: 'test-results/screens/coach-place.png' });
});

test('an unwired box gets a ghost wire from the gateway, then one on to the database, then nothing', async ({
  page,
}) => {
  await openBoard(page);
  await drag(page, await tray(page, 'server'), await slot(page, SERVER_SLOTS[0]));
  await expect.poll(async () => (await board(page)).parts.filter((p) => p.kind === 'server').length).toBe(1);
  const id = (await board(page)).parts.find((p) => p.kind === 'server')!.id;

  // Step 1: feed it from the gateway.
  await expect.poll(async () => (await hud(page)).coach.lit, { timeout: 20_000 }).toBe(true);
  expect((await hud(page)).coach).toMatchObject({
    step: 'feed',
    key: `feed:${id}`,
    hint: 'C1.alert.feed',
    wire: { from: 'gateway', to: id },
  });
  await expect.poll(async () => (await board(page)).coach?.path?.length ?? 0).toBe(2);
  expect((await board(page)).coach).toMatchObject({
    step: 'feed',
    parts: [id],
    wire: { from: 'gateway', to: id },
  });
  await expect.poll(async () => (await hud(page)).coach.said.length, { timeout: 20_000 }).toBe(1);
  expect((await hud(page)).coach.said).toEqual(['C1.triage.nudge.feed.1']);
  await page.screenshot({ path: 'test-results/screens/coach-feed.png' });

  await drag(page, await part(page, 'gateway'), await part(page, id));
  await expect
    .poll(async () => (await board(page)).wires.some((w) => w.from === 'gateway' && w.to === id))
    .toBe(true);

  // Step 2: on to the database.
  await expect.poll(async () => (await hud(page)).coach.key, { timeout: 10_000 }).toBe(`store:${id}`);
  await expect.poll(async () => (await hud(page)).coach.lit, { timeout: 20_000 }).toBe(true);
  expect((await hud(page)).coach).toMatchObject({
    step: 'store',
    hint: 'C1.alert.store',
    wire: { from: id, to: 'database' },
  });
  await page.screenshot({ path: 'test-results/screens/coach-store.png' });
  await drag(page, await part(page, id), await part(page, 'database'));

  // Wired through: the coach lets go and the board's highlight is gone.
  await expect.poll(async () => (await hud(page)).coach.step, { timeout: 10_000 }).toBe(null);
  await expect.poll(async () => (await board(page)).coach).toBe(null);
});
