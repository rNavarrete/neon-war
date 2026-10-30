import { type Page, expect, test } from '@playwright/test';
import { BROWNOUT } from '../../src/sim/brownout';
import { SERVER_SLOTS } from '../../src/sim/tick';
import type { TestState } from '../../src/testHook';

// The story layer: scene player, cold open, rescue, rewinds, debrief and Night Book. Some tests open
// a scene directly through the test-only `window.__neonStory` handle; others let the sim trigger it,
// with `?test&autopilot` playing GAME.md's best-play build (src/game/autopilot.ts).

type Story = NonNullable<TestState['story']>;

const C = BROWNOUT.challenges;

const state = (page: Page) => page.evaluate(() => window.__neonTest!.state);
const story = async (page: Page): Promise<Story> => (await state(page)).story!;

/** Slow text so a test can click a line while it is still typing. */
async function slowText(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((s) => {
    window.localStorage.setItem('neon-war.settings', JSON.stringify({ textSpeed: 'slow', ...s }));
  }, extra);
}

async function boot(page: Page, url: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(url);
  await expect.poll(async () => (await state(page)).ready, { timeout: 15_000 }).toBe(true);
  expect(errors).toEqual([]);
}

/** Go to the board and click the HUD's job card away if it is up. */
async function toBoard(page: Page, speed = 1, extra = ''): Promise<void> {
  await boot(page, `/?test&scene=board&speed=${speed}${extra}`);
  const hud = (await state(page)) as { hud?: { jobCard: { open: boolean; x: number; y: number } } };
  if (hud.hud?.jobCard.open) await page.mouse.click(hud.hud.jobCard.x, hud.hud.jobCard.y);
}

/** Click the story's text box and wait until the scene has handled the click. */
async function clickStory(page: Page): Promise<Story> {
  const s = await story(page);
  await page.mouse.click(s.click!.x, s.click!.y);
  await expect.poll(async () => (await story(page)).clicks).toBeGreaterThan(s.clicks);
  return story(page);
}

/** Click on to the next line (finishing the typing one first if needed); returns the new state. */
async function nextLine(page: Page): Promise<Story> {
  const before = await story(page);
  const moved = (s: Story) =>
    s.lineId !== before.lineId || s.debrief?.step !== before.debrief?.step || !s.active;
  if (!moved(await clickStory(page))) await clickStory(page);
  await expect.poll(async () => moved(await story(page)), { timeout: 10_000 }).toBe(true);
  return story(page);
}

test('the cold open waits for a click on every line, then hands over to the board', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?test&scene=story');
  await expect.poll(async () => (await story(page))?.scriptId, { timeout: 15_000 }).toBe('C0');
  let s = await story(page);
  expect(s.lineId).toBe('C0.tv.01');
  expect(s.backdrop).toBe('art/bg/bedroom-dark.webp');
  expect(s.runHeld).toBe(true);
  expect(s.chat).toEqual([]);

  // Nothing moves on its own: five seconds later (the old timers had moved on by 4 s) it is still the
  // first line, no click has landed, and the run is held.
  await page.waitForTimeout(5000);
  s = await story(page);
  expect(s.lineId).toBe('C0.tv.01');
  expect(s.clicks).toBe(0);
  expect(s.active).toBe(true);
  expect(s.runHeld).toBe(true);

  s = await nextLine(page);
  expect(s.lineId).toBe('C0.tv.02');
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.grandma.01');
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.lux.01');
  expect(s.nameplate).toBe('Lux');
  expect(s.portrait).toBe('portrait:lux/vn/photo');
  expect(s.chat).toEqual([]);

  // The phone lights up with the block's four messages as TRIAGE wakes.
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.triage.01');
  expect(s.chat).toHaveLength(4);
  expect(s.chat[0]).toBe("kenji: lux the net's doing the thing again");
  await page.screenshot({ path: 'test-results/screens/cold-open.png' });

  s = await nextLine(page);
  expect(s.lineId).toBe('C0.lux.02');
  expect(s.sfx).toContain('goggles-on');
  expect((await state(page)).scene).toBe('story');

  // The last click brings the goggles down and hands over to the board at 23:54:40. Even a
  // double-click there leaves the job card up to be read.
  // Wait for the short line to finish typing on its own: a click to finish it can land just after
  // it finished and end the scene before the double-click.
  await expect.poll(async () => (await story(page)).typingDone).toBe(true);
  s = await story(page);
  expect(s.lineId).toBe('C0.lux.02');
  await page.mouse.dblclick(s.click!.x, s.click!.y);
  await expect.poll(async () => (await state(page)).scene, { timeout: 15_000 }).toBe('board');
  s = await story(page);
  expect(s.active).toBe(false);
  expect(s.finished).toEqual(['C0']);
  expect(s.chat).toHaveLength(4);
  expect(s.sfx).toEqual(expect.arrayContaining(['rain-loop', 'goggles-on']));
  expect(s.runNow).toBeGreaterThanOrEqual(15);
  // The board's HUD shows the job card when it arrives (HUD stream; absent until merged).
  type Card = { open: boolean; x: number; y: number };
  const card = async () => ((await state(page)) as { hud?: { jobCard: Card } }).hud?.jobCard;
  const hud = await card();
  if (hud) {
    expect(hud.open).toBe(true);
    // A moment later (the card ignores clicks for 400 ms after the cold open) a click on OK closes it.
    await page.waitForTimeout(500);
    expect((await card())?.open).toBe(true);
    await page.mouse.click(hud.x, hud.y);
    await expect.poll(async () => (await card())?.open).toBe(false);
  }
});

test('the rescue plays as a scene over the immersive backdrop and returns to the board', async ({ page }) => {
  test.setTimeout(60_000);
  await slowText(page);
  await toBoard(page, 4);
  await page.evaluate(() => window.__neonStory!.playRescue(true));
  await expect.poll(async () => (await story(page)).lineId).toBe('C5.triage.01');

  let s = await story(page);
  expect(s.active).toBe(true);
  expect(s.scriptId).toBe('C5');
  expect(s.backdrop).toBe('art/bg/immersive.webp');
  expect(s.nameplate).toBe('TRIAGE');
  expect(s.portrait).toBe('portrait:triage/panic');
  expect(s.skip.visible).toBe(false);
  expect(s.runHeld).toBe(true);

  // A click while typing finishes the line; the next click advances.
  expect(s.typingDone).toBe(false);
  s = await clickStory(page);
  expect(s.lineId).toBe('C5.triage.01');
  expect(s.typingDone).toBe(true);

  s = await nextLine(page);
  expect(s.lineId).toBe('C5.rei.01');
  expect(s.nameplate).toBe('Rei');
  expect(s.onStage).toEqual(['TRIAGE', 'Rei']);
  expect(s.dimmed).toEqual(['TRIAGE']);

  s = await nextLine(page);
  expect(s.lineId).toBe('C5.lux.01');
  expect(s.portrait).toBe('portrait:lux/faces-board/shocked');
  expect(s.dimmed).toEqual(['TRIAGE', 'Rei']);

  const seen: string[] = [];
  while (s.active && s.lineId !== 'C5.rei.cut') {
    s = await nextLine(page);
    seen.push(s.lineId!);
  }
  expect(seen).toContain('C5.rei.03');
  expect(s.sfx).toContain('rescue-cable');
  await page.screenshot({ path: 'test-results/screens/rescue.png' });
  s = await nextLine(page);
  expect(s.lineId).toBe('C5.lux.cut');

  while (s.active) s = await nextLine(page);
  expect(s.finished).toEqual(['C5']);
  await expect.poll(async () => (await state(page)).scene).toBe('board');
  expect((await story(page)).runHeld).toBe(false);

  // Seen once: the replay can be skipped.
  await page.evaluate(() => window.__neonStory!.playRescue(false));
  await expect.poll(async () => (await story(page)).skip.visible).toBe(true);
  s = await story(page);
  expect(s.seen).toContain('C5');
  await page.mouse.click(s.skip.x, s.skip.y);
  await expect.poll(async () => (await story(page)).finished).toEqual(['C5', 'C5']);
  expect((await story(page)).active).toBe(false);
});

/** Click through whatever story scene is up until it ends (Skip when it shows). */
async function playThrough(page: Page): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    const s = await story(page);
    if (!s.active) return;
    const p = s.skip.visible ? s.skip : s.click;
    if (p) await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
  }
  throw new Error('the scene never ended');
}

type Board = { tray: { id: string; locked: boolean }[]; parts: { id: string; kind: string }[] };
const board = async (page: Page) => (await state(page)).board as unknown as Board;

test('the sim triggers the rescue and the board returns with the load balancer unlocked', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await toBoard(page, 20, '&autopilot');
  expect((await board(page)).tray.find((t) => t.id === 'balancer')?.locked).toBe(true);
  // Nothing opens the scene but the sim: the surge drains trust under 30 and the crew break in.
  await expect
    .poll(async () => (await story(page)).scriptId, { timeout: 90_000, intervals: [50] })
    .toBe('C5');
  const now = (await state(page)).hud as unknown as { now: number };
  expect(now.now).toBeGreaterThan(C.c4);
  expect(now.now).toBeLessThan(C.c4 + BROWNOUT.rescue.surgeSeconds + 0.1);
  expect((await story(page)).backdrop).toMatch(/immersive/);
  await page.screenshot({ path: 'test-results/screens/rescue-live.png' });
  await playThrough(page);
  await expect.poll(async () => (await state(page)).scene).toBe('board');
  const b = await board(page);
  expect(b.tray.find((t) => t.id === 'balancer')?.locked).toBe(false);
  expect(b.parts.some((p) => p.kind === 'balancer')).toBe(true);
});

test("a real overheat in C3 plays TRIAGE's replay and rewinds credits, parts and trust to 23:55:55", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await toBoard(page, 20);
  // One stock server and no kit: the evening climb to 90 cooks it.
  const id = await page.evaluate((cell) => window.__neonShell!.place(cell), SERVER_SLOTS[0]);
  expect(id).not.toBeNull();
  await page.evaluate((s) => window.__neonShell!.connect('gateway', s!), id);
  await page.evaluate((s) => window.__neonShell!.connect(s!, 'database'), id);
  await expect
    .poll(async () => (await story(page)).scriptId, { timeout: 90_000, intervals: [50] })
    .toBe('rewind-replay');
  const s = await story(page);
  expect(s.look).toBe('vhs');
  expect(s.lineId).toBe('C3.triage.rewind');
  await playThrough(page);
  await expect.poll(async () => (await state(page)).scene).toBe('board');
  // Speed 20 runs on as soon as the board is back, so the rewind target comes from the sim's record.
  const b = (await state(page)).board as unknown as Board & { rewinds: { at: number; to: number }[] };
  expect(b.rewinds).toHaveLength(1);
  expect(b.rewinds[0].to).toBe(C.c3);
  expect(b.rewinds[0].at).toBeGreaterThan(C.c3);
  // Back as it was at the start of C3: the one server and full trust.
  const h = (await state(page)).hud as unknown as { now: number; sim: { trust: number } };
  expect(h.now).toBeGreaterThanOrEqual(C.c3);
  expect(h.sim.trust).toBe(100);
  expect(b.parts.filter((p) => p.kind === 'server')).toHaveLength(1);
});

test('one test plays the whole session from the title to Night Book page 1 with best play', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await boot(page, '/?test&speed=20&autopilot');
  const shell = () =>
    page.evaluate(
      () =>
        (
          window.__neonTest!.state as unknown as {
            shell: { buttons: Record<string, { x: number; y: number }> };
          }
        ).shell,
    );
  await expect.poll(async () => (await shell()).buttons.start ?? null, { timeout: 15_000 }).not.toBeNull();
  const start = (await shell()).buttons.start;
  await page.mouse.click(start.x, start.y);

  // C0: the cold open is clicked through and hands over to the board's job card.
  await expect.poll(async () => (await story(page)).scriptId, { timeout: 15_000 }).toBe('C0');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/screens/session-cold-open.png' });
  await playThrough(page);
  type Hud = { now: number; jobCard: { open: boolean; x: number; y: number } };
  const hud = async () => (await state(page)).hud as unknown as Hud;
  await expect.poll(async () => (await hud())?.jobCard?.open ?? false, { timeout: 40_000 }).toBe(true);
  // The card ignores clicks for 400 ms after the cold open ends (the tail of a double-click).
  await page.waitForTimeout(500);
  const card = (await hud()).jobCard;
  await page.mouse.click(card.x, card.y);

  // C1 to C4 on best play, then the crew break in.
  await expect
    .poll(async () => (await story(page)).scriptId, { timeout: 120_000, intervals: [50] })
    .toBe('C5');
  await page.screenshot({ path: 'test-results/screens/session-rescue.png' });
  await playThrough(page);

  // Midnight holds, then the debrief at 00:01:00.
  await expect
    .poll(async () => (await story(page)).debrief?.step ?? null, { timeout: 120_000 })
    .toBe('grades');
  const s = await story(page);
  expect(s.debrief?.results.midnightHeld).toBe(true);
  expect(s.debrief?.results.serversAtMidnight).toBe(4);
  expect(s.debrief?.results.droppedRequests).toBeGreaterThan(0);
  expect(s.debrief?.results.ozzieTab).toBe(100);
  expect(s.debrief?.results.scaledDown).toBe(true);
  await page.screenshot({ path: 'test-results/screens/session-debrief.png' });

  let line = s;
  for (let guard = 0; line.debrief?.step !== 'book' && guard < 40; guard++) line = await nextLine(page);
  expect(line.debrief?.step).toBe('book');
  line = await nextLine(page);
  expect(line.debrief?.page).toMatch(/^Demand decides the design\./);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/screens/session-night-book.png' });
});

const REWINDS = [
  { kind: 'replay', now: C.c3 + 20, target: C.c3, lines: ['C3.triage.rewind', 'C3.lux.rewind'], look: 'vhs' },
  { kind: 'rei-surge', now: C.c5 + 20, target: C.c4, lines: ['C5.rei.rewind'], look: 'crew' },
  { kind: 'rei-midnight', now: C.c7 - 10, target: C.c6, lines: ['C6.rei.fail'], look: 'crew' },
] as const;

for (const r of REWINDS) {
  test(`a failure shows the ${r.kind} rewind and goes back to ${r.target}`, async ({ page }) => {
    await toBoard(page);
    await page.evaluate(
      ([now, kind]) => {
        window.__neonStory!.setNow(now);
        window.__neonStory!.playRewind(kind);
      },
      [r.now, r.kind] as const,
    );
    await expect.poll(async () => (await story(page)).lineId).toBe(r.lines[0]);
    let s = await story(page);
    expect(s.look).toBe(r.look);
    expect(s.nameplate).toBe(r.kind === 'replay' ? 'TRIAGE' : 'Rei');
    expect(s.runHeld).toBe(true);
    if (r.kind === 'replay') await page.screenshot({ path: 'test-results/screens/rewind-replay.png' });

    const lines: string[] = [s.lineId!];
    for (let i = 1; i < r.lines.length; i++) lines.push((await nextLine(page)).lineId!);
    expect(lines).toEqual(r.lines);
    await nextLine(page); // the rewind plays, then the board returns
    await expect.poll(async () => (await story(page)).active, { timeout: 10_000 }).toBe(false);
    s = await story(page);
    expect(s.sfx).toContain('rewind');
    expect(s.rewind).toEqual({ kind: r.kind, target: r.target });
    expect(s.runNow).toBeGreaterThanOrEqual(r.target);
    expect(s.runNow).toBeLessThan(r.target + 10);
    expect((await state(page)).scene).toBe('board');
  });
}

test('the debrief grades the night, names the terms, ends with the interview card, then Night Book page 1 and the title card', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await toBoard(page);
  const results = {
    droppedRequests: 12,
    wastedCredits: 80,
    trustLeft: 64,
    banner: 'pay',
    ozzieTab: 230,
    scaledDown: true,
    midnightHeld: true,
    serversAtMidnight: 5,
  } as const;
  await page.evaluate((r) => window.__neonStory!.playDebrief(r), results);
  await expect.poll(async () => (await story(page)).lineId).toBe('C8.rei.open');

  let s = await story(page);
  expect(s.debrief?.step).toBe('grades');
  expect(s.debrief?.results).toEqual(results);
  expect(s.portrait).toBe('portrait:rei/faces/grading');
  await page.screenshot({ path: 'test-results/screens/debrief.png' });

  const grades = [s.lineId];
  while (s.lineId !== 'C8.rei.close') {
    s = await nextLine(page);
    grades.push(s.lineId);
  }
  expect(grades).toEqual([
    'C8.rei.open',
    // Graded on the boxes built: midnight held, but on 5 (one only cost).
    'C8.rei.sizing.bad',
    'C8.rei.banner.pay',
    'C8.rei.debt',
    'C8.ozzie.debt',
    'C8.rei.waste',
    'C8.rei.down',
    'C8.rei.close',
  ]);

  s = await nextLine(page);
  expect(s.debrief?.step).toBe('terms');
  expect(s.debrief?.terms.map((t) => t.group)).toEqual(['Sizing', 'Scaling', 'Failure']);
  expect(s.debrief?.terms[1].bold).toContain('Load balancer');
  expect(s.debrief?.terms[2].bold).toContain('Redundancy, N+1');
  await page.screenshot({ path: 'test-results/screens/debrief-terms.png' });

  s = await nextLine(page);
  expect(s.debrief?.step).toBe('interview');
  expect(s.lineId).toBe('C8.rei.interview');
  expect(s.debrief?.card[0]).toBe('How would you scale a web app from a single server?');
  expect(s.debrief?.card).toHaveLength(8);
  await page.screenshot({ path: 'test-results/screens/interview-card.png' });

  s = await nextLine(page);
  expect(s.debrief?.step).toBe('book');
  expect(s.lineId).toBe('C8.book.open');
  expect(s.nameplate).toBeNull();
  s = await nextLine(page);
  expect(s.lineId).toBe('C8.triage.end');
  expect(s.debrief?.page).toMatch(/^Demand decides the design\./);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/screens/night-book.png' });
  s = await nextLine(page);
  expect(s.lineId).toBe('C8.rei.end');

  s = await nextLine(page);
  expect(s.debrief?.step).toBe('title');
  expect(s.debrief?.title).toBe('Session 0: Brownout');
  expect(s.fireworks.bursts).toBeGreaterThan(0);
  expect(s.fireworks.flashes).toBeGreaterThan(0);
  expect(s.sfx).toContain('fireworks');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/screens/title-card.png' });

  await clickStory(page);
  await expect.poll(async () => (await state(page)).scene).toBe('title');
});

test('reduce flicker keeps the debrief fireworks without flashes', async ({ page }) => {
  await slowText(page, { reduceFlicker: true });
  await toBoard(page);
  await page.evaluate(() => window.__neonStory!.playDebrief());
  await expect.poll(async () => (await story(page)).fireworks.bursts, { timeout: 10_000 }).toBeGreaterThan(1);
  const s = await story(page);
  expect(s.fireworks.flashes).toBe(0);
  // Built from the run: no banner answer yet, a fresh run's trust.
  expect(s.debrief?.results.banner).toBeNull();
  expect(s.debrief?.results.trustLeft).toBe(100);
});

test("the rain in Lux's room falls only on the window glass, never over the room", async ({ page }) => {
  await boot(page, '/?test&scene=story');
  await expect.poll(async () => (await story(page))?.scriptId, { timeout: 15_000 }).toBe('C0');
  const boxes: { glass: { x: number; y: number; w: number; h: number }; drawn: unknown }[] = [];
  for (let i = 0; i < 10; i++) {
    const s = await story(page);
    expect(s.rain).not.toBeNull();
    boxes.push(s.rain!);
    await page.waitForTimeout(150);
  }
  for (const { glass, drawn } of boxes) {
    expect(drawn).not.toBeNull();
    const d = drawn as { x: number; y: number; w: number; h: number };
    expect(d.x).toBeGreaterThanOrEqual(glass.x - 0.5);
    expect(d.y).toBeGreaterThanOrEqual(glass.y - 0.5);
    expect(d.x + d.w).toBeLessThanOrEqual(glass.x + glass.w + 0.5);
    expect(d.y + d.h).toBeLessThanOrEqual(glass.y + glass.h + 0.5);
  }
  await page.screenshot({ path: 'test-results/screens/story-room-rain.png' });
});

test('the cold open shows the photo as an insert, then Lux holding it on the left third, sunk behind the text box', async ({
  page,
}) => {
  await boot(page, '/?test&scene=story');
  await expect.poll(async () => (await story(page))?.scriptId, { timeout: 15_000 }).toBe('C0');
  let s = await story(page);
  expect(s.lineId).toBe('C0.tv.01');
  expect(s.photo).toBe(true);
  await page.screenshot({ path: 'test-results/screens/story-photo-insert.png' });
  while (s.lineId !== 'C0.lux.01') {
    if (!s.typingDone) await clickStory(page);
    s = await clickStory(page);
  }
  expect(s.photo).toBe(false);
  expect(s.onStage).toEqual(['Lux']);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/screens/story-lux-staged.png' });
  // The phone lights up: four rows in the stream chat, and TRIAGE hovers beside Lux.
  while (s.lineId !== 'C0.triage.01') {
    if (!s.typingDone) await clickStory(page);
    s = await clickStory(page);
  }
  expect(s.chat).toHaveLength(4);
  expect(s.onStage).toEqual(['Lux', 'TRIAGE']);
  // The four messages roll in one at a time rather than all at once...
  expect(s.chatShown.length).toBeLessThan(4);
  await expect
    .poll(async () => (await story(page)).chatShown.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);
  expect((await story(page)).chatShown.slice(0, 4)).toEqual(s.chat);
  await page.screenshot({ path: 'test-results/screens/story-triage-chat.png' });
  // ...and the chat keeps talking while the player reads.
  await expect.poll(async () => (await story(page)).chatShown.length, { timeout: 10_000 }).toBeGreaterThan(4);
});
