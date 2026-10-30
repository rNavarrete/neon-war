import { type Page, expect, test } from '@playwright/test';
import { BROWNOUT } from '../../src/sim/brownout';
import type { BoardTestState } from '../../src/scenes/board/hook';
import { SERVER_SLOTS } from '../../src/sim/tick';

// The playable board (ENG-504). Every test drives the mouse with positions from the test hook
// (page CSS pixels) and asserts on window.__neonTest.state.board.

type Pt = { x: number; y: number };

// Headless Chromium draws WebGL in software and can run at a few frames a second on a busy box.
test.describe.configure({ timeout: 90_000 });

async function board(page: Page): Promise<BoardTestState> {
  return page.evaluate(() => window.__neonTest!.state.board!);
}

/** The HUD (another stream) may open the job card over the board: click it away if it is open. */
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

async function openBoard(page: Page, query = ''): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`/?test&scene=board${query}`);
  await expect
    .poll(() => page.evaluate(() => window.__neonTest?.state.ready ?? false), { timeout: 15_000 })
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

const tray = async (page: Page, id: string) => (await board(page)).tray.find((t) => t.id === id)!;
const slot = async (page: Page, id: string) => (await board(page)).slots.find((s) => s.id === id)!;
const part = async (page: Page, id: string) => (await board(page)).parts.find((p) => p.id === id);
const partIn = async (page: Page, slotId: string) => (await board(page)).parts.find((p) => p.slot === slotId);

async function placeServer(page: Page, slotId: string): Promise<string> {
  await drag(page, await tray(page, 'server'), await slot(page, slotId));
  await expect.poll(async () => (await partIn(page, slotId))?.id).toBeDefined();
  return (await partIn(page, slotId))!.id;
}

async function wire(page: Page, from: string, to: string): Promise<void> {
  await drag(page, (await part(page, from))!, (await part(page, to))!);
}

async function waitOnline(page: Page, id: string): Promise<void> {
  await expect.poll(async () => (await part(page, id))?.status, { timeout: 20_000 }).toBe('online');
}

test('holding a placed server lifts it: it moves to a free spot with every wire kept, and stays put when set down off the table', async ({
  page,
}) => {
  await openBoard(page);
  const id = await placeServer(page, SERVER_SLOTS[0]);
  await wire(page, 'gateway', id);
  await wire(page, id, 'database');
  const wiresOf = async () =>
    (await board(page)).wires
      .filter((w) => w.from === id || w.to === id)
      .map((w) => w.key)
      .sort();
  await expect.poll(wiresOf).toEqual([`${id}>database`, `gateway>${id}`].sort());
  const credits = (await board(page)).credits;

  // Press and hold still: the server lifts (a quick drag would draw a wire instead).
  const from = (await part(page, id))!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await expect.poll(async () => (await board(page)).dragging, { timeout: 5000 }).toBe('move');
  const to = await slot(page, SERVER_SLOTS[2]);
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.screenshot({ path: 'test-results/screens/board-move-carry.png' });
  await page.mouse.up();
  await expect.poll(async () => (await part(page, id))?.slot).toBe(SERVER_SLOTS[2]);
  expect(await wiresOf()).toEqual([`${id}>database`, `gateway>${id}`].sort());
  // Free: only a moment's upkeep comes off.
  expect((await board(page)).credits).toBeGreaterThan(credits - 1);
  expect((await board(page)).dragging).toBeNull();

  // Set down off the table (over the tray), it stays where it was.
  const again = (await part(page, id))!;
  const gate = await tray(page, 'server');
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await expect.poll(async () => (await board(page)).dragging, { timeout: 5000 }).toBe('move');
  await page.mouse.move(gate.x, gate.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await board(page)).dragging).toBeNull();
  expect((await part(page, id))?.slot).toBe(SERVER_SLOTS[2]);
  expect(await wiresOf()).toEqual([`${id}>database`, `gateway>${id}`].sort());
});

test('the tray shows the server, the kit and a locked load balancer, and the rest of the catalog locked', async ({
  page,
}) => {
  await openBoard(page);
  const b = await board(page);
  const byId = Object.fromEntries(b.tray.map((t) => [t.id, t]));
  expect(byId.server.locked).toBe(false);
  expect(byId.overclock.locked).toBe(false);
  expect(byId.balancer.locked).toBe(true);
  const others = b.tray.filter((t) => !['server', 'overclock', 'balancer'].includes(t.id));
  expect(others.length).toBe(20);
  expect(others.every((t) => t.locked)).toBe(true);
  // No padlocked pad on the table: the locked balancer stays in the drawer, and every spot is open.
  expect(b.slots.every((s) => !s.locked)).toBe(true);
  expect(b.parts.some((p) => p.kind === 'balancer')).toBe(false);

  // Trying the locked balancer says why.
  await page.mouse.click(byId.balancer.x, byId.balancer.y);
  await expect
    .poll(async () => (await board(page)).refusal)
    .toMatch(/the crew hasn't given you a load balancer yet/i);
});

test('dragging a scrap server to a slot places it, spends 80 credits and shows it booting for 3 s', async ({
  page,
}) => {
  await openBoard(page);
  const before = (await board(page)).credits;
  const id = await placeServer(page, SERVER_SLOTS[0]);
  const placed = await board(page);
  const server = placed.parts.find((p) => p.id === id)!;
  expect(server.kind).toBe('server');
  // 80 for the box, plus a few frames of upkeep (5 credits a minute).
  expect(placed.credits).toBeLessThanOrEqual(before - 80);
  expect(placed.credits).toBeGreaterThan(before - 81);
  expect(server.status).toBe('booting');
  expect(server.left).toBeGreaterThan(2);
  expect(server.left).toBeLessThanOrEqual(3);
  expect(server.dark).toBe(true);
  expect(server.label).toMatch(/BOOTING/);
  expect(placed.offline).toContain(id);

  const bootStart = placed.now - (3 - server.left);
  // C1's clock waits for the first server wired gateway -> server -> database, then the boot runs.
  await wire(page, 'gateway', id);
  await wire(page, id, 'database');
  await waitOnline(page, id);
  const online = await board(page);
  expect(online.now - bootStart).toBeGreaterThanOrEqual(3);
  expect(online.offline).not.toContain(id);
  expect(online.parts.find((p) => p.id === id)!.dark).toBe(false);
});

test('dragging part to part wires them, and a refused wire shows its reason', async ({ page }) => {
  await openBoard(page);
  const s1 = await placeServer(page, SERVER_SLOTS[0]);
  const s2 = await placeServer(page, SERVER_SLOTS[1]);

  await wire(page, 'gateway', s1);
  await expect.poll(async () => (await board(page)).wires.map((w) => w.key)).toEqual([`gateway>${s1}`]);

  // The gateway feeds one part only.
  await wire(page, 'gateway', s2);
  await expect.poll(async () => (await board(page)).refusal).toMatch(/feeds one part only/i);
  expect((await board(page)).wires.map((w) => w.key)).toEqual([`gateway>${s1}`]);

  await wire(page, s1, 'database');
  await expect
    .poll(async () => (await board(page)).wires.map((w) => w.key))
    .toEqual([`gateway>${s1}`, `${s1}>database`]);
});

test('clicking a wire and choosing cut removes it; decommissioning refunds half the price', async ({
  page,
}) => {
  await openBoard(page);
  const s1 = await placeServer(page, SERVER_SLOTS[0]);
  const s2 = await placeServer(page, SERVER_SLOTS[1]);
  // s1 serves before it is sold, so it refunds half; a server that never served refunds in full
  // (the idle-server fix after Rolando's C3 playtest, 30 Oct 2026), which s2 checks below.
  await wire(page, 'gateway', s1);
  await wire(page, s1, 'database');
  await expect.poll(async () => (await board(page)).wires.length).toBe(2);
  await waitOnline(page, s1);
  await expect
    .poll(async () => (await board(page)).parts.find((p) => p.id === s1)?.load ?? 0)
    .toBeGreaterThan(0);

  const w = (await board(page)).wires.find((x) => x.key.startsWith(`${s1}>`))!;
  await page.mouse.click(w.x, w.y);
  await expect.poll(async () => (await board(page)).selectedWire).toBe(w.key);
  const cut = (await board(page)).cutButton!;
  expect(cut).not.toBeNull();
  await page.mouse.click(cut.x, cut.y);
  await expect.poll(async () => (await board(page)).wires.length).toBe(1);

  // Click a server, then its bin button.
  const before = (await board(page)).credits;
  const p1 = (await part(page, s1))!;
  await page.mouse.click(p1.x, p1.y);
  await expect.poll(async () => (await board(page)).binButton).not.toBeNull();
  const bin = (await board(page)).binButton!;
  await page.mouse.click(bin.x, bin.y);
  await expect.poll(async () => (await part(page, s1))?.id).toBeUndefined();
  const after = (await board(page)).credits;
  expect(after).toBeGreaterThan(before + 39);
  expect(after).toBeLessThanOrEqual(before + 40);

  // Right-click decommissions too.
  const p2 = (await part(page, s2))!;
  await page.mouse.click(p2.x, p2.y, { button: 'right' });
  await expect.poll(async () => (await part(page, s2))?.id).toBeUndefined();
  expect((await board(page)).credits).toBeGreaterThan(after + 39);
  // s2 never served: the whole 80 comes back.
  expect((await board(page)).credits).toBeGreaterThanOrEqual(after + 80);
});

test('dropping the overclock kit on a server makes it 120 req/s, spends 60 and reboots it for 3 s', async ({
  page,
}) => {
  await openBoard(page);
  const s1 = await placeServer(page, SERVER_SLOTS[0]);
  await wire(page, 'gateway', s1);
  await wire(page, s1, 'database');
  await waitOnline(page, s1);
  const before = (await board(page)).credits;

  await drag(page, await tray(page, 'overclock'), (await part(page, s1))!);
  await expect.poll(async () => (await part(page, s1))?.boosted).toBe(true);
  const b = await board(page);
  const server = b.parts.find((p) => p.id === s1)!;
  expect(server.capacity).toBe(120);
  expect(server.art).toBe('server-overclocked');
  expect(server.status).toBe('rebooting');
  expect(server.left).toBeGreaterThan(2);
  expect(server.left).toBeLessThanOrEqual(3);
  expect(server.label).toMatch(/REBOOTING/);
  expect(b.credits).toBeLessThanOrEqual(before - 60);
  expect(b.credits).toBeGreaterThan(before - 61);
  await waitOnline(page, s1);

  // The kit refuses anything but a server.
  await drag(page, await tray(page, 'overclock'), (await part(page, 'gateway'))!);
  await expect.poll(async () => (await board(page)).refusal).toMatch(/can't be upgraded/i);
});

test('packets follow each wire, load shows on each part, and the packet pool stops growing', async ({
  page,
}) => {
  await openBoard(page);
  const s1 = await placeServer(page, SERVER_SLOTS[0]);
  await wire(page, 'gateway', s1);
  await wire(page, s1, 'database');
  await expect.poll(async () => (await board(page)).wires.length).toBe(2);
  await waitOnline(page, s1);
  // Requests dropped while the server booted come back as retries for a moment: let them settle.
  await expect
    .poll(async () => Math.round((await board(page)).demand * 100) / 100, { timeout: 30_000 })
    .toBe(30);

  const b = await board(page);
  for (const w of b.wires) expect(w.rate).toBeCloseTo(b.demand, 3);
  const server = b.parts.find((p) => p.id === s1)!;
  expect(server.load).toBeCloseTo(b.demand, 3);
  expect(server.capacity).toBe(60);
  expect(server.share).toBeCloseTo(b.demand / 60, 3);
  expect(server.label).toMatch(/%/);
  expect(b.parts.find((p) => p.id === 'database')!.share).toBeCloseTo(b.demand / 200, 3);
  expect(b.offline).toEqual([]);
  expect(b.skipped).toEqual([]);
  expect(b.wires.every((w) => !w.skipped)).toBe(true);

  await page.screenshot({ path: 'test-results/screens/board-built.png' });

  // Demand holds at the block's 30 req/s before C3: the pool fills, then stays put.
  await page.waitForTimeout(10_000);
  const first = await board(page);
  expect(first.demand).toBe(b.demand);
  expect(first.packets.active).toBeGreaterThan(0);
  expect(first.packets.pool).toBeGreaterThanOrEqual(first.packets.active);
  await page.waitForTimeout(4_000);
  const second = await board(page);
  expect(second.demand).toBe(b.demand);
  expect(second.packets.pool).toBe(first.packets.pool);
  expect(second.packets.active).toBeGreaterThan(0);
});

test('?test&speed=N runs the board N times faster: C3 in under 30 s', async ({ page }) => {
  await openBoard(page, '&speed=20');
  // Build gateway -> server -> database so the block is served on the way.
  const s1 = await placeServer(page, SERVER_SLOTS[0]);
  await wire(page, 'gateway', s1);
  await wire(page, s1, 'database');
  const start = await board(page);
  expect(start.speed).toBe(20);
  const t0 = Date.now();
  await page.waitForTimeout(1_000);
  const mid = await board(page);
  const rate = (mid.now - start.now) / ((Date.now() - t0) / 1000);
  // About 20 sim seconds per real second (frames and the evaluate round trip blur it a little).
  expect(rate).toBeGreaterThan(10);
  expect(rate).toBeLessThan(22);
  await expect
    .poll(async () => (await board(page)).now, { timeout: 25_000 })
    .toBeGreaterThanOrEqual(BROWNOUT.challenges.c3);
  expect(Date.now() - t0).toBeLessThan(30_000);
});
