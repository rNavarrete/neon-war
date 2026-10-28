import { type Page, expect, test } from '@playwright/test';
import type { BoardTestState } from '../../src/scenes/board/hook';
import type { LiveTestState } from '../../src/scenes/live/hook';
import type { Rect } from '../../src/scenes/live/layout';
import { inboundLaneRates } from '../../src/scenes/board/channel';
import { openBoard as liveOpen, reach as liveReach } from './live/reach';

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

async function openBoard(page: Page, query = ''): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`/?test&scene=board${query}`);
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

type BoardPart = BoardTestState['parts'][number];
const part = async (page: Page, id: string): Promise<BoardPart | undefined> =>
  (await board(page)).parts.find((p) => p.id === id);

async function wire(page: Page, from: string, to: string): Promise<void> {
  await drag(page, (await part(page, from))!, (await part(page, to))!);
  await expect
    .poll(async () => (await board(page)).wires.some((w) => w.from === from && w.to === to))
    .toBe(true);
}

test('C1 (board-4, board-6): the clock holds and the board shows why; bank marks, level on 0..400, the ROOM tick on wired capacity, no chevrons', async ({
  page,
}) => {
  await openBoard(page, '&speed=4');
  let b = await board(page);
  const c = b.channel;
  // The five bank labels at the mouth, bottom to top.
  expect(c.max).toBe(400);
  expect(c.marks.map((m) => m.label)).toEqual(['0', '1/4', '1/2', '3/4', 'MAX']);
  for (let i = 1; i < c.marks.length; i++) expect(c.marks[i].y).toBeLessThan(c.marks[i - 1].y);
  for (const m of c.marks) expect(m.x).toBeGreaterThanOrEqual(b.area.x - 0.1);
  expect(c.chevrons).toBe(0);
  // The fill is min(1, demand / 400), the cubes follow the session rate map.
  expect(c.level).toBeCloseTo(Math.min(1, c.demand / 400), 2);
  expect(c.lanePps).toBeCloseTo(inboundLaneRates(c.demand), 2);
  expect(c.lanes.reduce((a, x) => a + x, 0)).toBeCloseTo(c.lanePps, 1);
  expect(c.capacityLevel).toBe(0);

  // board-6: the clock holds in C1 until the first box is wired, and the board shows why: the
  // gateway's out-port blinks, the cubes with nowhere to go tumble off it, the empty pads pulse.
  const held = b.now;
  const lit = new Set<boolean>();
  let tumbled = 0;
  for (let i = 0; i < 40; i++) {
    const x = await board(page);
    expect(x.now, 'the clock holds').toBe(held);
    expect(x.waiting.first).toBe(true);
    expect(x.waiting.crew).toBe(false);
    expect(x.waiting.blinking).toBe(true);
    expect(x.waiting.port).not.toBeNull();
    expect(x.waiting.pulsing.sort()).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    for (const p of x.pads) expect(p.pulsing).toBe(p.slot !== 'lb');
    lit.add(x.waiting.portLit);
    tumbled = Math.max(tumbled, x.waiting.tumbled);
    await page.waitForTimeout(40);
  }
  expect([...lit].sort(), 'the port blinks').toEqual([false, true]);
  expect(tumbled, 'cubes tumble off the port').toBeGreaterThan(0);
  const gw = b.parts.find((p) => p.kind === 'gateway')!;
  expect(b.waiting.port!.x).toBeGreaterThan(gw.x);

  // Racked only (the clock holds in C1 until the first build): the ROOM tick stays at 0.
  const id = await placeServer(page, 's1');
  b = await board(page);
  expect(b.channel.capacityLevel).toBe(0);
  expect(b.channel.wired).toBe(0);
  expect(b.waiting.first).toBe(true);
  expect(b.waiting.pulsing.sort()).toEqual(['s2', 's3', 's4', 's5', 's6']);

  // Wired gateway -> server -> database and online: the tick moves to 60 / 400.
  await wire(page, 'gateway', id);
  await wire(page, id, 'database');
  await expect
    .poll(async () => (await board(page)).channel.capacityLevel, { timeout: 20_000 })
    .toBeCloseTo(0.15, 3);
  b = await board(page);
  // Wired: the wait is over, the clock runs, nothing blinks or pulses for it any more.
  expect(b.waiting).toMatchObject({ first: false, crew: false, port: null, portLit: false, pulsing: [] });
  expect(b.now).toBeGreaterThan(held);
  expect(b.channel.wired).toBe(60);
  expect(b.channel.roomY).toBeLessThan(b.channel.marks[0].y);
  expect(b.channel.roomY).toBeGreaterThan(b.channel.marks[1].y);
  expect(b.channel.level).toBeCloseTo(Math.min(1, b.channel.demand / 400), 2);

  // A second server racked and up but fed by nothing: the tick never moves for it.
  const idle = await placeServer(page, 's2');
  await expect.poll(async () => (await part(page, idle))?.status, { timeout: 20_000 }).toBe('online');
  for (let i = 0; i < 3; i++) {
    b = await board(page);
    expect(b.channel.capacityLevel).toBeCloseTo(0.15, 3);
    expect(b.channel.wired).toBe(60);
  }

  // Cut the feed: the tick falls back to 0.
  const w = b.wires.find((x) => x.from === 'gateway')!;
  await page.mouse.click(w.x, w.y);
  await expect.poll(async () => (await board(page)).selectedWire).toBe(w.key);
  const cut = (await board(page)).cutButton!;
  await page.mouse.click(cut.x, cut.y);
  await expect.poll(async () => (await board(page)).channel.capacityLevel).toBe(0);
  expect((await board(page)).channel.wired).toBe(0);
});

/** Poll the board until `done`, handing every read to `see`; fails after `timeout` ms naming `what`. */
async function watch(
  page: Page,
  what: string,
  done: (b: BoardTestState) => boolean,
  see: (b: BoardTestState) => void = () => undefined,
  timeout = 40_000,
): Promise<BoardTestState> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const b = await board(page);
    see(b);
    if (done(b)) return b;
    if (Date.now() > deadline)
      throw new Error(
        `watch: ${what} not seen within ${timeout / 1000} s (board.now ${b.now}, paused ${b.paused}, ` +
          `clock ${b.clock}, pads ${JSON.stringify(b.pads)}, parts ${JSON.stringify(b.parts.map((p) => [p.id, p.status, p.label, p.tags]))})`,
      );
    await page.waitForTimeout(15);
  }
}

test('C3 (board-5, board-6): an idle second box reads UNFED with no packets; the hot one counts DIES IN to 0', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openBoard(page, '&speed=20');
  const s1 = await placeServer(page, 's1');
  await wire(page, 'gateway', s1);
  await wire(page, s1, 'database');

  // A second box racked before the climb: nothing can feed it (the gateway feeds one part only).
  await watch(page, 'board.now >= 150', (b) => b.now >= 150);
  const s2 = await placeServer(page, 's2');
  const idle = await watch(page, 'the second box online in C3', (b) => {
    const p = b.parts.find((x) => x.id === s2);
    return b.now >= 180 && p?.status === 'online';
  });
  for (let i = 0; i < 4; i++) {
    const b = i === 0 ? idle : await board(page);
    if (b.now >= 210) break;
    const p = b.parts.find((x) => x.id === s2)!;
    expect(p.unfed, 'the idle box is UNFED').toBe(true);
    expect(p.tags).toEqual(['UNFED']);
    expect(p.load).toBe(0);
    expect(p.packetsIn, 'no packets head into the idle box').toBe(0);
    expect(b.wires.some((w) => w.to === s2)).toBe(false);
    // The fed one is not.
    expect(b.parts.find((x) => x.id === s1)!.unfed).toBe(false);
  }

  // The climb passes 60: the fed box runs over 100%, shows a red bar and the triangle, and counts
  // DIES IN down to 0 on the tick the sim kills it.
  type Sample = {
    diesIn: number | null;
    warning: boolean;
    bar: number;
    barColour: string;
    tags: string[];
    status: string;
    now: number;
  };
  const samples: Sample[] = [];
  const end = await watch(
    page,
    'the overloaded box dead',
    (b) => b.parts.find((x) => x.id === s1)?.status === 'dead',
    (b) => {
      const p = b.parts.find((x) => x.id === s1);
      if (p)
        samples.push({
          diesIn: p.diesIn,
          warning: p.warning,
          bar: p.bar,
          barColour: p.barColour,
          tags: p.tags,
          status: p.status,
          now: b.now,
        });
    },
  );
  const hot = samples.filter((x) => x.status === 'online' && x.diesIn !== null);
  expect(hot.length, 'DIES IN samples').toBeGreaterThan(0);
  for (const x of hot) {
    expect(x.warning).toBe(true);
    expect(x.barColour).toBe('red');
    expect(x.bar).toBe(1);
    expect(x.tags[0]).toBe('DIES IN');
    expect(x.diesIn!).toBeGreaterThanOrEqual(0);
    expect(x.diesIn!).toBeLessThanOrEqual(8);
  }
  for (let i = 1; i < hot.length; i++) expect(hot[i].diesIn!).toBeLessThanOrEqual(hot[i - 1].diesIn!);
  const dead = end.parts.find((x) => x.id === s1)!;
  expect(dead.diesIn).toBe(0);
  expect(dead.label).toBe('DEAD');
});

test('after C4 (board-5, board-6): DARK counts down, never DEAD; SKIPPED stays a second; reduce flicker blinks nothing', async ({
  page,
}) => {
  test.setTimeout(150_000);
  // Reduce flicker on before the game reads its settings.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'neon-war.settings',
      JSON.stringify({ volume: 0, textSpeed: 'fast', reduceFlicker: true }),
    );
  });
  await openBoard(page, '&speed=20');
  // GAME.md's best play before the crew: one box wired, the kit on it.
  const s1 = await placeServer(page, 's1');
  await wire(page, 'gateway', s1);
  await wire(page, s1, 'database');
  await drag(page, b0(await board(page), 'overclock'), (await part(page, s1))!);
  await expect.poll(async () => (await part(page, s1))?.boosted).toBe(true);

  type StoryHook = {
    active: boolean;
    skip: { visible: boolean; x: number; y: number };
    click: Pt | null;
    finished: string[];
  };
  const story = () =>
    page.evaluate(() => (window.__neonTest!.state as unknown as { story?: StoryHook }).story ?? null);
  const darkSeen: { label: string; darkLeft: number | null; tags: string[]; status: string }[] = [];
  const lanes: { demand: number; lanePps: number }[] = [];
  let flickerOk = true;
  let reduceOk = true;
  const look = (b: BoardTestState) => {
    reduceOk &&= b.reduceFlicker && !b.waiting.blinking && (b.waiting.port === null || b.waiting.portLit);
    for (const p of b.parts) {
      flickerOk &&= p.flickerLit;
      if (p.status === 'dark')
        darkSeen.push({ label: p.label, darkLeft: p.darkLeft, tags: p.tags, status: p.status });
      if (p.id === s1 && p.status === 'dark') expect(p.label).not.toMatch(/DEAD/);
    }
    lanes.push({ demand: b.channel.demand, lanePps: b.channel.lanePps });
  };
  // Run on through the surge and its power dip to the crew, clicking the rescue scene through.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const b = await board(page);
    look(b);
    const s = await story();
    if (s?.finished.includes('C5') && !s.active && b.parts.some((p) => p.kind === 'balancer')) break;
    if (Date.now() > deadline) throw new Error(`the rescue never came (board.now ${b.now})`);
    if (s?.active) {
      const p = s.skip.visible ? s.skip : s.click;
      if (p) await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(60);
    } else {
      await page.waitForTimeout(15);
    }
  }
  expect(darkSeen.length, 'a server seen dark in the dip').toBeGreaterThan(0);
  for (const d of darkSeen) {
    expect(d.label).toMatch(/^DARK \d+ s$/);
    expect(d.label).not.toMatch(/DEAD/);
    expect(d.darkLeft!).toBeGreaterThan(0);
    expect(d.darkLeft!).toBeLessThanOrEqual(20);
    expect(d.tags).toContain('DARK');
  }
  // The cubes follow the rate map at every demand seen, and more demand means more cubes.
  for (const l of lanes) expect(l.lanePps).toBeCloseTo(inboundLaneRates(l.demand), 1);
  const lo = lanes.reduce((a, l) => (l.demand < a.demand ? l : a));
  const hi = lanes.reduce((a, l) => (l.demand > a.demand ? l : a));
  expect(hi.demand).toBeGreaterThan(240);
  expect(hi.lanePps).toBeGreaterThan(lo.lanePps);

  // board-6: the crew's balancer feeds the one stock box, so the clock waits for the player's
  // build and the board shows it: the balancer's out-port lit (steady under reduce flicker), the
  // empty pads, and the chip by the balancer reading what the boxes behind it cover of 120.
  const crew = await watch(page, 'board.waiting.crew', (x) => x.waiting.crew);
  expect(crew.waiting).toMatchObject({ first: false, behind: 60, need: 120, chip: '60/120', portLit: true });
  expect(crew.waiting.blinking, 'no blink under reduce flicker').toBe(false);
  const lb = crew.parts.find((p) => p.kind === 'balancer')!;
  expect(crew.waiting.port!.x).toBeGreaterThan(lb.x);
  expect(crew.waiting.pulsing.sort()).toEqual(['s2', 's3', 's4', 's5', 's6']);
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(100);
    const x = await board(page);
    expect(x.now, 'the clock holds in the crew wait').toBe(crew.now);
    expect(x.waiting.crew).toBe(true);
    expect(x.waiting.portLit).toBe(true);
  }

  // Rack a box behind the balancer: it is booting (the clock holds, so it stays booting), so the
  // balancer skips it: the pad goes grey and dashed with SKIPPED on it.
  const s2 = await placeServer(page, 's2');
  await wire(page, 'balancer', s2);
  let b = await watch(page, 'the s2 pad SKIPPED', (x) => x.pads.find((p) => p.slot === 's2')!.dashed);
  let pad = b.pads.find((p) => p.slot === 's2')!;
  expect(pad.skipped).toBe(true);
  expect(pad.part).toBe(s2);
  expect(b.parts.find((p) => p.id === s2)!.tags).toContain('SKIPPED');
  expect(b.parts.find((p) => p.id === s2)!.status).toBe('booting');
  await page.screenshot({ path: 'test-results/screens/live-m2-board.png' });

  // Cut the balancer's wire to it: the skip clears, and the tag stays on the pad at least 1 s more.
  const lbWire = b.wires.find((w) => w.from === 'balancer' && w.to === s2)!;
  await page.mouse.click(lbWire.x, lbWire.y);
  await expect.poll(async () => (await board(page)).selectedWire).toBe(lbWire.key);
  const cut = (await board(page)).cutButton!;
  let lastSkipped = (await board(page)).clock;
  await page.mouse.click(cut.x, cut.y);
  b = await watch(
    page,
    'the skip on s2 cleared',
    (x) => !x.pads.find((p) => p.slot === 's2')!.skipped,
    (x) => {
      if (x.pads.find((p) => p.slot === 's2')!.skipped) lastSkipped = x.clock;
    },
  );
  pad = b.pads.find((p) => p.slot === 's2')!;
  expect(pad.dashed, 'SKIPPED still on the pad just after the skip cleared').toBe(true);
  expect(pad.skipTagUntil!).toBeGreaterThanOrEqual(lastSkipped + 1 - 0.001);
  b = await watch(page, 'the SKIPPED tag gone', (x) => !x.pads.find((p) => p.slot === 's2')!.dashed);
  expect(b.clock - lastSkipped, 'the tag stayed at least 1 s').toBeGreaterThanOrEqual(1 - 0.05);

  // The wait lasts until the boxes behind the balancer cover 120: wired on to the database it is
  // still 60, then the balancer's wire back makes 120 and the clock runs again.
  expect(b.waiting).toMatchObject({ crew: true, behind: 60, chip: '60/120' });
  await wire(page, s2, 'database');
  b = await board(page);
  expect(b.waiting).toMatchObject({ crew: true, behind: 60 });
  expect(b.now).toBe(crew.now);
  await wire(page, 'balancer', s2);
  b = await watch(page, 'the crew wait over', (x) => !x.waiting.crew);
  expect(b.waiting).toMatchObject({ first: false, crew: false, port: null, chip: null, pulsing: [] });
  await expect.poll(async () => (await board(page)).now).toBeGreaterThan(crew.now);

  // Reduce flicker: nothing blinked on any read.
  expect(reduceOk).toBe(true);
  expect(flickerOk).toBe(true);
});

const b0 = (b: BoardTestState, id: string) => b.tray.find((t) => t.id === id)!;

// ---- M3: packets v2 (board-7) -----------------------------------------------------------------

test('the surge (board-7): packets crawl into the hot box, red retries are born at the dropping part and come back to the mouth, the pool stays bounded', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Best play to the district surge at speed 20: one box, overclocked, on the gateway.
  await reachSurge(page);
  type Seen = { b: BoardTestState };
  let slow: Seen | null = null;
  let red: Seen | null = null;
  let maxPool = 0;
  let firstPool = -1;
  const deadline = Date.now() + 10_000;
  // Ten seconds from the surge on (a scene may hold the board on the way; it is clicked through).
  while (Date.now() < deadline) {
    const b = await board(page);
    if (firstPool < 0) firstPool = b.packets.pool;
    maxPool = Math.max(maxPool, b.packets.pool);
    expect(b.packets.pool, 'the pool never passes what the flow needs').toBeLessThanOrEqual(b.packets.need);
    const hot = b.parts
      .filter((p) => p.share !== null && p.share > 1 && p.status === 'online')
      .map((p) => p.id);
    if (!slow && hot.length > 0 && b.wires.some((w) => hot.includes(w.to))) slow = { b };
    if (!red && b.channel.retryShare > 0 && b.packets.red > 0) red = { b };
    await clickStoryOn(page);
    await page.waitForTimeout(25);
  }

  // Half speed on every wire into an overloaded box, full speed elsewhere.
  expect(slow, 'a box over 100% with a wire into it').not.toBeNull();
  const s = slow!.b;
  for (const w of s.wires) {
    const to = s.parts.find((p) => p.id === w.to)!;
    const over = to.status === 'online' && to.share !== null && to.share > 1;
    expect(w.speed, `${w.key} speed`).toBe(over ? 0.5 : 1);
  }

  // Retries: red cubes on the board, every one born at a part that is dropping (hot or dark), and
  // never spawned at the mouth: the red ones coming in again are only ever those that went back.
  expect(red, 'retryShare > 0 and packets.red > 0 at the surge').not.toBeNull();
  const r = red!.b;
  expect(r.channel.retryShare).toBeGreaterThan(0);
  expect(r.packets.red).toBeGreaterThan(0);
  expect(r.packets.born).toBeGreaterThan(0);
  expect(r.packets.retryFrom.length).toBeGreaterThan(0);
  for (const id of r.packets.retryFrom) {
    const p = r.parts.find((x) => x.id === id)!;
    expect(p, `retries born at ${id}`).toBeDefined();
    const dropping = p.status !== 'online' || (p.share !== null && p.share > 1) || p.kind === 'gateway';
    expect(dropping, `${id} drops what it gets`).toBe(true);
  }
  expect(r.packets.red).toBeLessThanOrEqual(r.packets.returning + r.packets.reentered);
  // Retry cubes reach the mouth and come in again (they move in real time, a few seconds back;
  // a scene holding the board stops them, so it is clicked through).
  const back = Date.now() + 40_000;
  for (;;) {
    const b = await board(page);
    expect(b.packets.pool).toBeLessThanOrEqual(b.packets.need);
    if (b.packets.reentered > 0) break;
    if (Date.now() > back) throw new Error(`no retry re-entered: ${JSON.stringify(b.packets)}`);
    await clickStoryOn(page);
    await page.waitForTimeout(80);
  }

  // Bounded: over the ten seconds the pool never passed the flow's need, and stays modest.
  expect(maxPool).toBeLessThan(600);
  expect(firstPool).toBeGreaterThan(0);
});

/** Open with autopilot at speed 20 and run to the district surge (tests/browser/live/reach.ts). */
async function reachSurge(page: Page): Promise<void> {
  await liveOpen(page);
  await liveReach(page, 'surge');
}

/** If a story scene holds the board, click it on (Skip when shown). */
async function clickStoryOn(page: Page): Promise<void> {
  type StoryHook = { active: boolean; skip: { visible: boolean; x: number; y: number }; click: Pt | null };
  const s = await page.evaluate(
    () => (window.__neonTest!.state as unknown as { story?: StoryHook }).story ?? null,
  );
  if (!s?.active) return;
  const p = s.skip.visible ? s.skip : s.click;
  if (p) await page.mouse.click(p.x, p.y);
}
