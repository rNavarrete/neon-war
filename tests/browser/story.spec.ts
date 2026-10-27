import { type Page, expect, test } from '@playwright/test';
import type { TestState } from '../../src/testHook';

// The story layer: scene player, cold open, rescue, rewinds, debrief and Night Book. Until ENG-503
// wires the sim's triggers, tests play scenes through the test-only `window.__neonStory` handle.

type Story = NonNullable<TestState['story']>;

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
async function toBoard(page: Page, speed = 1): Promise<void> {
  await boot(page, `/?test&scene=board&speed=${speed}`);
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

test('the cold open plays about 15 s with no input, then hands over to the board', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?test&scene=story');
  await expect.poll(async () => (await story(page))?.scriptId, { timeout: 15_000 }).toBe('C0');
  const t0 = Date.now();

  await expect.poll(async () => (await story(page)).lineId, { timeout: 12_000 }).toBe('C0.lux.01');
  let s = await story(page);
  expect(s.backdrop).toBe('art/bg/bedroom-dark.webp');
  expect(s.nameplate).toBe('Lux');
  expect(s.portrait).toBe('portrait:lux/faces-room/grieving');
  expect(s.runHeld).toBe(true);

  await expect
    .poll(async () => (await story(page)).chat.length, { timeout: 6_000 })
    .toBeGreaterThanOrEqual(3);
  s = await story(page);
  expect(s.chat[0]).toBe("kenji: lux the net's doing the thing again");
  await page.screenshot({ path: 'test-results/screens/cold-open.png' });

  await expect.poll(async () => (await state(page)).scene, { timeout: 15_000 }).toBe('board');
  const seconds = (Date.now() - t0) / 1000;
  expect(seconds).toBeGreaterThan(13);
  expect(seconds).toBeLessThan(20);

  s = await story(page);
  expect(s.active).toBe(false);
  expect(s.finished).toEqual(['C0']);
  expect(s.chat).toHaveLength(4);
  expect(s.sfx).toEqual(expect.arrayContaining(['rain-loop', 'goggles-on']));
  expect(s.runNow).toBeGreaterThanOrEqual(15);
  // The board's HUD shows the job card when it arrives (HUD stream; absent until merged).
  const hud = (await state(page)) as { hud?: { jobCard: { open: boolean } } };
  if (hud.hud) expect(hud.hud.jobCard.open).toBe(true);
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

// TODO(ENG-503): "plays when the sim triggers it" — once the rescue trigger (trust under 30 or 45 s
// into the surge) and the load balancer unlock land, drive the surge under ?speed and assert the
// scene starts on its own and the balancer is unlocked when the board returns.
test.fixme('the sim triggers the rescue and the board returns with the load balancer unlocked', () => {});

const REWINDS = [
  { kind: 'replay', now: 200, target: 180, lines: ['C3.triage.rewind', 'C3.lux.rewind'], look: 'vhs' },
  { kind: 'rei-surge', now: 380, target: 300, lines: ['C5.rei.rewind'], look: 'crew' },
  { kind: 'rei-midnight', now: 500, target: 450, lines: ['C6.rei.fail'], look: 'crew' },
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
    estimate: 30,
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
    'C8.rei.sizing.good',
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
