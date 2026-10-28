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

// ---- board-9: a recorder of what the board animates ------------------------------------------

/** What the in-page recorder saw: each animation name's first and last page time (ms), when each part first read dead, and more. */
interface AnimRecord {
  seen: Record<string, { first: number; last: number }>;
  dead: Record<string, number>;
  dark: { label: string; darkLeft: number | null; tags: string[]; status: string; id: string }[];
  pools: number[];
  peak: number;
  frames: number;
  /** board-10: every effect key the shell heard asked for (shell.recentSfx), new skips seen, refund floats seen. */
  sfx: string[];
  skipEdges: number;
  floats: string[];
}

/**
 * Read the board's hook once every animation frame in the page (after the game's own update, so
 * every drawn frame is seen once) and keep what it animated. At speed 20 a state can last a single
 * frame, so polling from the test would miss it; this never does.
 */
async function recordAnims(page: Page): Promise<void> {
  await page.evaluate(() => {
    type B = {
      anims: string[];
      parts: {
        id: string;
        status: string;
        label: string;
        darkLeft: number | null;
        tags: string[];
      }[];
      particles: { pool: number; peak: number };
      skipped: string[];
      floats: string[];
    };
    const rec = {
      seen: {},
      dead: {},
      dark: [],
      pools: [],
      peak: 0,
      frames: 0,
      sfx: [],
      skipEdges: 0,
      floats: [],
    } as {
      seen: Record<string, { first: number; last: number }>;
      dead: Record<string, number>;
      dark: { label: string; darkLeft: number | null; tags: string[]; status: string; id: string }[];
      pools: number[];
      peak: number;
      frames: number;
      sfx: string[];
      skipEdges: number;
      floats: string[];
    };
    (window as unknown as { __boardAnims: typeof rec }).__boardAnims = rec;
    let lastSkipped: string[] = [];
    const tick = () => {
      const st = window.__neonTest?.state as unknown as
        { board?: B; shell?: { recentSfx: string[] } } | undefined;
      const b = st?.board;
      for (const k of st?.shell?.recentSfx ?? []) if (!rec.sfx.includes(k)) rec.sfx.push(k);
      if (b) {
        for (const k of b.skipped) if (!lastSkipped.includes(k)) rec.skipEdges++;
        lastSkipped = b.skipped;
        for (const f of b.floats) if (!rec.floats.includes(f)) rec.floats.push(f);
        const t = performance.now();
        rec.frames++;
        for (const n of b.anims) {
          const e = rec.seen[n] ?? (rec.seen[n] = { first: t, last: t });
          e.last = t;
        }
        for (const p of b.parts) {
          if (p.status === 'dead' && rec.dead[p.id] === undefined) rec.dead[p.id] = t;
          if (p.status === 'dark' && rec.dark.length < 400)
            rec.dark.push({ label: p.label, darkLeft: p.darkLeft, tags: p.tags, status: p.status, id: p.id });
        }
        if (!rec.pools.includes(b.particles.pool)) rec.pools.push(b.particles.pool);
        rec.peak = Math.max(rec.peak, b.particles.peak);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function animRecord(page: Page): Promise<AnimRecord> {
  return page.evaluate(() => (window as unknown as { __boardAnims: AnimRecord }).__boardAnims);
}

/**
 * Every animation the board logged that has ended finished within its stated duration (plus one
 * frame: the animation clock steps at most 0.25 s a frame).
 */
function expectWithinDurations(b: BoardTestState): void {
  for (const e of b.animLog) {
    if (e.end === null || e.ms === null) continue;
    expect(e.end - e.start, `${e.name} took ${e.end - e.start} s for ${e.ms} ms`).toBeLessThanOrEqual(
      e.ms / 1000 + 0.26,
    );
  }
}

test('C3 (board-5, board-6): an idle second box reads UNFED with no packets; the hot one counts DIES IN to 0', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await openBoard(page, '&speed=20');
  await recordAnims(page);
  const s1 = await placeServer(page, 's1');
  await wire(page, 'gateway', s1);
  await wire(page, s1, 'database');

  // A second box racked before the climb: nothing can feed it (the gateway feeds one part only).
  // It goes on s4, beside the C2 banner: the banner (still open, unanswered) covers s2 and takes
  // the drop.
  await watch(page, 'board.now >= 150', (b) => b.now >= 150);
  const s2 = await placeServer(page, 's4');
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

  // board-9: every event on the way had its animation. The box dropped onto its pad, its wires drew
  // on, its boot finished with a ring, the heat haze hung over it while it ran over 100%, and it
  // died: listed within a second, with the white flash (full variant, reduce flicker is off).
  let rec = await animRecord(page);
  for (const name of [
    `place:${s1}`,
    `wire:gateway>${s1}`,
    `wire:${s1}>database`,
    `boot:${s1}`,
    `haze:${s1}`,
    `death:${s1}`,
    'flash',
  ]) {
    expect(rec.seen[name], `the board animated ${name}`).toBeDefined();
  }
  const diedAt = rec.dead[s1];
  expect(diedAt, 'the recorder saw the box dead').toBeDefined();
  expect(rec.seen[`death:${s1}`].first - diedAt, 'death:<id> listed within 1 s').toBeLessThanOrEqual(1000);
  // The death fails the board before the crew: TRIAGE's replay covers it at once and the board
  // stands still under it. Clicked through, the rewind puts the board back and clears the
  // animations with it; every sprite stands where its state puts it.
  const rewound = Date.now() + 30_000;
  for (;;) {
    const x = await board(page);
    if (x.rewinds.length > 0 && !x.paused) break;
    if (Date.now() > rewound) throw new Error(`the rewind never came back to the board (paused ${x.paused})`);
    await clickStoryOn(page);
    await page.waitForTimeout(60);
  }
  const back = Date.now();
  await expect.poll(async () => (await board(page)).anims, { timeout: 2_000 }).not.toContain(`death:${s1}`);
  expect(Date.now() - back, 'cleared within 2 s of the board coming back').toBeLessThanOrEqual(2_000);
  await expect
    .poll(async () => (await board(page)).parts.every((p) => p.motion === 'idle'), { timeout: 3_000 })
    .toBe(true);
  const after = await board(page);
  for (const p of after.parts) expect(p.drawn, `${p.id} at rest`).toEqual(p.pose);
  expectWithinDurations(after);
  // The particles are one pool made once (no growth); nothing went wrong in the page.
  rec = await animRecord(page);
  expect(rec.pools).toEqual([96]);
  expect(rec.peak).toBeLessThanOrEqual(96);
  expect(pageErrors).toEqual([]);
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
  await recordAnims(page);
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
  // The dip can last a single frame at speed 20 before the crew comes; the in-page recorder reads
  // every frame, so add what it saw (each read is checked the same way below).
  for (const d of (await animRecord(page)).dark) darkSeen.push(d);
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

  // board-9 under reduce flicker: every animation played its calm variant and nothing flashed or
  // threw sparks; the dip took the box dark, the crew's cable lowered the balancer onto its pad,
  // and the cut trace faded.
  const rec = await animRecord(page);
  const names = Object.keys(rec.seen);
  expect(
    names.filter((n) => n === 'flash' || n === 'sparks'),
    'no flash, no sparks',
  ).toEqual([]);
  expect(rec.seen[`dip:${s1}`], 'the dip').toBeDefined();
  expect(rec.seen['cable'], 'the cable').toBeDefined();
  expect(rec.seen[`cut:${lbWire.key}`], 'the cut').toBeDefined();
  expect(rec.seen[`overclock:${s1}`], 'the kit flew on').toBeDefined();
  b = await board(page);
  expect(b.anims).not.toContain('cable');
  const lbNow = b.parts.find((p) => p.kind === 'balancer')!;
  const lbSlot = b.slots.find((x) => x.id === 'lb')!;
  expect(lbNow.drawn, 'the balancer landed on its pad').toEqual({ dy: 0, scale: 1, alpha: 1 });
  expect(Math.abs(lbNow.x - lbSlot.x)).toBeLessThanOrEqual(1);
  expect(lbNow.motion).toBe('idle');
  const logged = b.animLog.filter((e) => e.name !== 'ping');
  expect(logged.length).toBeGreaterThan(0);
  for (const e of b.animLog) expect(e.calm, `${e.name} played calm`).toBe(true);
  expectWithinDurations(b);

  // board-10: the board's own sounds. The boots chimed, the hot box crackled no more than once
  // per half second, the skip blipped once per new skip; only the three keys, each one that exists.
  // The sounds the board always made (placing, wiring, cutting, the heat, the dip) still play.
  expectBoardSounds(b, rec);
  expect(b.sfx.counts['server-online'], 'a boot chimed').toBeGreaterThan(0);
  expect(b.sfx.counts['packet-drop'], 'the surge crackled').toBeGreaterThan(0);
  expect(b.sfx.counts['health-skip'], 'the skip blipped').toBeGreaterThan(0);
  for (const k of ['place-part', 'wire-connect', 'wire-cut', 'credits', 'server-hot', 'power-dip']) {
    expect(rec.sfx, `the shell still hears ${k}`).toContain(k);
  }
});

/** The Live effects the audio lane added (LIVE_SFX_KEYS in src/game/mixer.ts) that the board asks for. */
const BOARD_SFX_KEYS = ['server-online', 'packet-drop', 'health-skip'];

/** Each board sound only for a key that exists, the crackle at most once per 0.5 s, a blip at most once per new skip. */
function expectBoardSounds(b: BoardTestState, rec: AnimRecord): void {
  for (const e of b.sfx.log) expect(BOARD_SFX_KEYS, e.key).toContain(e.key);
  for (const k of Object.keys(b.sfx.counts)) expect(BOARD_SFX_KEYS).toContain(k);
  const drops = b.sfx.log.filter((e) => e.key === 'packet-drop').map((e) => e.at);
  for (let i = 1; i < drops.length; i++) {
    expect(drops[i] - drops[i - 1], 'packet-drop at most once per 0.5 s').toBeGreaterThanOrEqual(0.5 - 0.001);
  }
  expect(b.sfx.counts['health-skip'] ?? 0, 'one blip per new skip at most').toBeLessThanOrEqual(
    rec.skipEdges,
  );
  // What the board asked for reached the shell.
  for (const k of Object.keys(b.sfx.counts)) expect(rec.sfx, `the shell heard ${k}`).toContain(k);
}

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

// ---- M3: interactions v2 (board-8) ------------------------------------------------------------

type Shell = { paused: boolean };
type HudBits = {
  notes: { estimate: number | null; sizing: number | null };
  sizingPrompt: { open: boolean };
  dial: { visible: boolean };
};
const shell = (page: Page) =>
  page.evaluate(() => (window.__neonTest!.state as unknown as { shell?: Shell }).shell ?? null);
const hudBits = (page: Page) =>
  page.evaluate(() => (window.__neonTest!.state as unknown as { hud?: HudBits }).hud ?? null);

/** Press on a tray card and carry it to `to` without letting go. */
async function hold(page: Page, from: Pt, to: Pt): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
}

/** The debrief's words a plate must never print (docs/SCRIPT.md C8.terms, the four the ticket names). */
const DEBRIEF_WORDS = ['capacity', 'headroom', 'health check', 'load balancer'];

test('C1 to C3 (board-8): legality tints, the ghost waits for SET then tells the truth about the feed, plates, Esc and Delete, keys 1/2/3 left alone', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openBoard(page);
  let b = await board(page);
  expect(b.keys.sort()).toEqual(['Backspace', 'Delete', 'Escape']);
  const card = b0(b, 'server');
  const s1Pad = b.slots.find((s) => s.id === 's1')!;
  const lbPad = b.slots.find((s) => s.id === 'lb')!;
  const credits = b.credits;

  // A card drag tints every pad by legality and reports what it is over; in C1 the estimate is not
  // SET yet, so there is no ghost and no what-if tick.
  await hold(page, card, s1Pad);
  b = await board(page);
  expect(b.dragging).toBe('server');
  expect(b.dragOver).toMatchObject({
    kind: 'card',
    card: 'server',
    over: 's1',
    overKind: 'pad',
    state: 'legal',
    legal: true,
  });
  const legality = Object.fromEntries(b.pads.map((p) => [p.slot, p.legality]));
  expect(legality).toEqual({
    lb: 'wrong',
    s1: 'legal',
    s2: 'legal',
    s3: 'legal',
    s4: 'legal',
    s5: 'legal',
    s6: 'legal',
  });
  expect(b.ghost, 'no ghost until the estimate is SET').toBeNull();
  expect(b.channel.whatIf).toBeNull();
  await page.mouse.move(lbPad.x, lbPad.y, { steps: 3 });
  await expect.poll(async () => (await board(page)).dragOver?.over).toBe('lb');
  expect((await board(page)).dragOver).toMatchObject({ state: 'wrong', legal: false });

  // Esc cancels the drag (and the pause menu stays shut); nothing was placed or spent.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await board(page)).dragging).toBeNull();
  await page.mouse.up();
  b = await board(page);
  expect(b.dragOver).toBeNull();
  expect(b.parts.some((p) => p.kind === 'server')).toBe(false);
  expect(b.pads.every((p) => p.legality === null)).toBe(true);
  expect((await shell(page))?.paused, 'Esc during a drag does not open the pause menu').toBe(false);

  // Key 3 reaches the deck through the board: it SETs the estimate.
  expect((await hudBits(page))!.notes.estimate).toBeNull();
  await page.keyboard.press('3');
  await expect.poll(async () => (await hudBits(page))!.notes.estimate).not.toBeNull();

  // Now the ghost shows: over s1 with the gateway free it adds 60, the what-if tick reads ROOM +60,
  // and no credits are spent while it hovers.
  await hold(page, card, s1Pad);
  b = await expectGhost(page, 's1');
  expect(b.ghost).toMatchObject({
    card: 'server',
    over: 's1',
    legal: true,
    adds: 60,
    tick: 'ROOM +60',
    plateShown: true,
  });
  expect(b.ghost!.plate).toBe('+60 room · boots 3 s · -80 cr');
  expect(b.channel.whatIf).toBeCloseTo(0.15, 3);
  expect(b.credits).toBeGreaterThan(credits - 1);
  await page.screenshot({ path: 'test-results/screens/live-m3-board-ghost-c1.png' });
  await page.mouse.up();
  await expect.poll(async () => (await board(page)).parts.find((p) => p.slot === 's1')?.id).toBeDefined();
  const s1 = (await board(page)).parts.find((p) => p.slot === 's1')!.id;
  expect((await board(page)).ghost).toBeNull();

  // Wire it in; once it is up, the ghost over the second pad tells the truth: nothing feeds it, and
  // its what-if level is the wired room the ROOM tick stands on.
  await wire(page, 'gateway', s1);
  await wire(page, s1, 'database');
  await expect.poll(async () => (await board(page)).channel.wired, { timeout: 20_000 }).toBe(60);
  const s2Pad = (await board(page)).slots.find((s) => s.id === 's2')!;
  await hold(page, card, s2Pad);
  b = await expectGhost(page, 's2');
  expect(b.ghost).toMatchObject({ legal: true, adds: 0, capacity: 60, wired: 60, tick: null });
  expect(b.ghost!.plate).toBe('+0 room · nothing feeds it');
  expect(b.channel.whatIf).toBeCloseTo(b.channel.capacityLevel, 3);
  // Let go back over the tray: nothing placed.
  await page.mouse.move(card.x, card.y, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await board(page)).dragging).toBeNull();
  expect((await board(page)).parts.filter((p) => p.kind === 'server')).toHaveLength(1);

  // Hovering a part shows its numbers and state in the script's words, never the debrief's.
  for (const id of ['gateway', s1, 'database']) {
    const p = (await part(page, id))!;
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await expect.poll(async () => (await board(page)).hover.target).toBe(id);
    const text = (await board(page)).hover.text!;
    expect(text).toMatch(/a second/);
    for (const word of DEBRIEF_WORDS) expect(text.toLowerCase()).not.toContain(word);
  }
  const hovered = (await board(page)).hover;
  expect(hovered.pinned).toBe(false);
  const sp = (await part(page, s1))!;
  await page.mouse.move(sp.x, sp.y, { steps: 2 });
  await expect.poll(async () => (await board(page)).hover.text).toMatch(/^SERVER · \d+\/60 a second · \d+%/);

  // Click pins the plate; it stays when the pointer leaves; Esc clears the selection (no pause).
  await page.mouse.click(sp.x, sp.y);
  await expect.poll(async () => (await board(page)).selectedPart).toBe(s1);
  await page.mouse.move(card.x, card.y - 200, { steps: 2 });
  await expect.poll(async () => (await board(page)).hover).toMatchObject({ target: s1, pinned: true });
  // Keys 1 and 2 go to the deck untouched: the selection stays.
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  expect((await board(page)).selectedPart).toBe(s1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await board(page)).selectedPart).toBeNull();
  expect((await board(page)).hover.text).toBeNull();
  expect((await shell(page))?.paused).toBe(false);

  // Delete cuts the selected wire.
  const gw = (await board(page)).wires.find((x) => x.from === 'gateway')!;
  await page.mouse.click(gw.x, gw.y);
  await expect.poll(async () => (await board(page)).selectedWire).toBe(gw.key);
  await expect.poll(async () => (await board(page)).hover.pinned).toBe(true);
  expect((await board(page)).hover.text).toMatch(/^WIRE · \d+ a second\nGATEWAY to SERVER/);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await board(page)).wires.some((x) => x.key === gw.key)).toBe(false);
  expect((await board(page)).selectedWire).toBeNull();
  expect((await shell(page))?.paused).toBe(false);
});

/** Wait until the ghost is over `over` and its plate is drawn; returns that read. */
async function expectGhost(page: Page, over: string): Promise<BoardTestState> {
  await expect
    .poll(async () => {
      const b = await board(page);
      return b.ghost?.over === over && b.ghost.plateShown;
    })
    .toBe(true);
  return board(page);
}

test('C6 (board-8): the ghost and the what-if tick stay away while the sizing prompt is open, and come once it is SET', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Best play at speed 12 to the midnight forecast: the sizing prompt opens at 440 and stays until SET
  // or midnight at 510 (about 6 s at this speed).
  await liveOpen(page, { speed: 12 });
  await liveReach(page, 'c1');
  const deadline = Date.now() + 90_000;
  for (;;) {
    const h = await hudBits(page);
    if (h?.sizingPrompt.open) break;
    if (Date.now() > deadline) throw new Error('the sizing prompt never opened');
    await clickStoryOn(page);
    await page.waitForTimeout(40);
  }
  let b = await board(page);
  const card = b0(b, 'server');
  const empty = b.slots.filter((s) => s.id !== 'lb' && s.part === null);
  expect(empty.length).toBeGreaterThan(0);
  const pad = empty[empty.length - 1];
  await hold(page, card, pad);
  // One read of both sections, so the prompt and the board are seen on the same frame.
  const both = () =>
    page.evaluate(() => {
      const s = window.__neonTest!.state as unknown as { board: BoardTestState; hud: HudBits };
      return { board: s.board, prompt: s.hud.sizingPrompt.open };
    });
  let seen = await both();
  for (let i = 0; i < 100 && seen.board.dragOver?.over !== pad.id; i++) seen = await both();
  b = seen.board;
  expect(b.dragOver?.over).toBe(pad.id);
  expect(seen.prompt, 'the sizing prompt is still open').toBe(true);
  // An empty pad: legal, or short of credits by now (the ghost shows either way; only the drop differs).
  expect(['legal', 'poor']).toContain(b.dragOver!.state);
  expect(b.ghost, 'no ghost while the player sizes alone').toBeNull();
  expect(b.channel.whatIf).toBeNull();

  // SET the sizing (key 3 still reaches the deck with a card in hand): the ghost comes, wired
  // behind the crew's splitter, adding 60.
  await page.keyboard.press('3');
  await expect.poll(async () => (await hudBits(page))!.notes.sizing).not.toBeNull();
  b = await expectGhost(page, pad.id);
  expect(b.ghost).toMatchObject({ adds: 60, tick: 'ROOM +60' });
  expect(b.ghost!.plate).toMatch(/^\+60 room · boots 3 s · -80 cr$/);
  expect(b.ghost!.capacity).toBe(b.ghost!.wired + 60);
  expect(b.channel.whatIf).toBeCloseTo(b.ghost!.capacity / 400, 3);
  await page.screenshot({ path: 'test-results/screens/live-m3-board.png' });
  await page.mouse.move(card.x, card.y, { steps: 2 });
  await page.mouse.up();
});
