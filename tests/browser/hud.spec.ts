import { type Page, expect, test } from '@playwright/test';
import type { HudTestState } from '../../src/scenes/hud/hook';

// The board HUD, driven with the mouse at positions the test hook gives, asserting on
// window.__neonTest.state.hud. `speed` runs the sim faster (1 to 20) to reach later challenges.
// Headless Chromium can draw the board at under 10 fps, and Phaser caps each frame's step, so the
// sim may run well below `speed` times real time: waits are long on purpose.

type Hud = HudTestState;

async function hud(page: Page): Promise<Hud> {
  return page.evaluate(() => window.__neonTest!.state.hud as unknown as HudTestState);
}

/**
 * Open the board at `speed`. With `autopilot` the test-only scripted best play builds what GAME.md's
 * best-play path builds (src/game/autopilot.ts), so a test can reach the surge and midnight.
 */
async function openBoard(page: Page, speed = 1, autopilot = false): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`/?test&scene=board&speed=${speed}${autopilot ? '&autopilot' : ''}`);
  await expect
    .poll(() => page.evaluate(() => window.__neonTest?.state.hud?.ready ?? false), { timeout: 15_000 })
    .toBe(true);
  expect(errors).toEqual([]);
}

/** Click the job card away if it is open. */
async function dismissJobCard(page: Page): Promise<void> {
  const h = await hud(page);
  if (!h.jobCard.open) return;
  await page.mouse.click(h.jobCard.x, h.jobCard.y);
  await expect.poll(async () => (await hud(page)).jobCard.open).toBe(false);
}

/** Wait until the sim clock reaches `t` seconds. */
async function waitForNow(page: Page, t: number, timeout = 240_000): Promise<Hud> {
  await expect
    .poll(async () => (await hud(page)).now, { timeout, intervals: [50] })
    .toBeGreaterThanOrEqual(t);
  return hud(page);
}

/** Turn the dial to `value` with its plus and minus buttons, then press SET. */
async function setDial(page: Page, value: number): Promise<void> {
  let h = await hud(page);
  for (let guard = 0; h.dial.value !== value && guard < 200; guard++) {
    const p = h.dial.value < value ? h.dial.plus : h.dial.minus;
    await page.mouse.click(p.x, p.y);
    h = await hud(page);
  }
  expect(h.dial.value).toBe(value);
  await page.mouse.click(h.dial.set.x, h.dial.set.y);
}

type Story = {
  active: boolean;
  scriptId: string | null;
  click: { x: number; y: number } | null;
  skip: { visible: boolean; x: number; y: number };
};

/** Wait for a story scene over the board (the rescue), then click through it to the end. */
async function playThroughScene(page: Page, scriptId: string): Promise<void> {
  const story = () => page.evaluate(() => window.__neonTest!.state.story as unknown as Story);
  await expect
    .poll(async () => (await story()).scriptId, { timeout: 60_000, intervals: [50] })
    .toBe(scriptId);
  for (let guard = 0; guard < 200; guard++) {
    const s = await story();
    if (!s.active) return;
    const p = s.skip.visible ? s.skip : s.click;
    if (p) await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
  }
  throw new Error(`the ${scriptId} scene never ended`);
}

test('the session opens on the job card, and clicking it away starts C1', async ({ page }) => {
  test.setTimeout(60_000);
  await openBoard(page, 4);
  let h = await hud(page);
  expect(h.jobCard.open).toBe(true);
  expect(h.paused).toBe(true);
  expect(h.dial.visible).toBe(false);
  // The in-world clock opens at 23:51:30, eight and a half minutes before midnight.
  expect(h.clock).toBe('23:51:30');
  expect(h.countdown).toBe('8:30');
  await page.screenshot({ path: 'test-results/screens/hud-job-card.png' });

  await dismissJobCard(page);
  h = await hud(page);
  expect(h.paused).toBe(false);
  expect(h.now).toBeGreaterThanOrEqual(15);
  expect(h.dial.visible).toBe(true);
  expect(h.dial.mode).toBe('reqps');
  // TRIAGE guesses first, never pausing the board.
  await expect
    .poll(async () => (await hud(page)).bark.current, { timeout: 40_000, intervals: [50] })
    .toBe('C1.triage.02');
  h = await hud(page);
  expect(h.bark.text).toBe("480 a second! I'm great at math.");
  expect(h.paused).toBe(false);
});

test('the estimate dial records 30 and leaves a dashed guess line on the chart', async ({ page }) => {
  test.setTimeout(180_000);
  await openBoard(page, 20, true);
  await dismissJobCard(page);
  await setDial(page, 30);
  await expect.poll(async () => (await hud(page)).notes.estimate).toBe(30);
  let h = await hud(page);
  expect(h.dial.locked).toBe(true);
  expect(h.chart.estimateLine).toBe(30);
  await expect
    .poll(async () => (await hud(page)).bark.history, { timeout: 60_000 })
    .toEqual(expect.arrayContaining(['C1.lux.01', 'C1.triage.03']));

  // Let the real line draw in for a while; the guess stays.
  await waitForNow(page, 60);
  h = await hud(page);
  expect(h.notes.estimate).toBe(30);
  // The guess itself costs nothing (also unit-tested in tests/hud-format.test.ts).
  // The chart's last plotted values match the sim within 1 req/s. At speed 20 retries move demand
  // between a plot and a read, so wait for a frame where both are read together.
  await expect
    .poll(
      async () => {
        const n = await hud(page);
        return Math.max(Math.abs(n.chart.demand - n.sim.demand), Math.abs(n.chart.capacity - n.sim.capacity));
      },
      { timeout: 20_000, intervals: [25] },
    )
    .toBeLessThanOrEqual(1);
  h = await hud(page);
  // Trust and credits on screen match the sim.
  expect(Math.abs(h.shown.trust - h.sim.trust)).toBeLessThanOrEqual(1);
  expect(Math.abs(h.shown.credits - h.sim.credits)).toBeLessThanOrEqual(1);
  expect(h.chat.block.length + h.chat.stream.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/screens/hud-c1.png' });
});

for (const choice of ['pay', 'ignore', 'bin'] as const) {
  test(`the Solace banner records ${choice}`, async ({ page }) => {
    test.setTimeout(180_000);
    await openBoard(page, 20, true);
    await dismissJobCard(page);
    await expect.poll(async () => (await hud(page)).banner.open, { timeout: 60_000 }).toBe(true);
    // Let the slide-in finish so the buttons are where the hook says.
    await page.waitForTimeout(600);
    const before = await hud(page);
    expect(before.now).toBeGreaterThanOrEqual(90);
    const p = before.banner[choice];
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await hud(page)).banner.choice).toBe(choice);
    const after = await hud(page);
    expect(after.banner.open).toBe(false);
    // Pay spends 200; the server's upkeep (5 credits a minute) moves credits by a little either way.
    const spent = before.sim.credits - after.sim.credits;
    const expected = choice === 'pay' ? 200 : 0;
    expect(spent).toBeGreaterThanOrEqual(expected);
    expect(spent).toBeLessThan(expected + 3);
    await expect
      .poll(async () => (await hud(page)).bark.history, { timeout: 60_000 })
      .toContain(`C2.lux.${choice}`);
  });
}

test('the surge, the laundry cut, the dip flicker, Regroup, the sizing prompt and midnight', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // Speed 5: the laundry cut is only offered for the few seconds between the surge and the crew.
  await openBoard(page, 5, true);
  await dismissJobCard(page);
  await waitForNow(page, 280);

  await test.step('C4: the district surge is warned with its number at least 10 s ahead', async () => {
    await expect
      .poll(async () => (await hud(page)).surge?.startsAt ?? null, { timeout: 60_000, intervals: [25] })
      .toBe(300);
    const h = await hud(page);
    expect(h.surge?.demand).toBe(250);
    expect(300 - h.surge!.shownAt!).toBeGreaterThanOrEqual(10);
    expect(h.surge?.line).toBe('C4.warn.01');
  });

  // The dip's 2 s warning lands while the laundry cut is being taken: watch for it from here on.
  const dipSeen = (async () => {
    for (const end = Date.now() + 90_000; Date.now() < end;) {
      const n = await hud(page);
      if (n.dip) return n;
      await page.waitForTimeout(25);
    }
    return null;
  })();

  await test.step('the laundry cut takes about 40 req/s off demand', async () => {
    // The cut is offered from the warning on; take it once the surge has landed.
    await expect
      .poll(
        async () => {
          const n = await hud(page);
          return n.laundry.available && n.sim.demand >= 250;
        },
        { timeout: 60_000, intervals: [25] },
      )
      .toBe(true);
    // The surge window is a couple of real seconds at speed 5: click before anything slow.
    const before = await hud(page);
    expect(before.sim.demand).toBeGreaterThanOrEqual(250);
    await page.mouse.click(before.laundry.button.x, before.laundry.button.y);
    await expect.poll(async () => (await hud(page)).laundry.cut).toBe(true);
    // Taken as the surge lands, so the warning (it lingers a few seconds) and the cut both show.
    await page.screenshot({ path: 'test-results/screens/hud-c4.png' });
    const after = await hud(page);
    // 250 becomes 210 before retries; with the retry pile on top the drop is 40 or more.
    expect(before.sim.demand - after.sim.demand).toBeGreaterThanOrEqual(35);
    await expect
      .poll(async () => (await hud(page)).bark.history, { timeout: 60_000 })
      .toContain('C4.lux.cut');
  });

  await test.step('a flicker warning shows on the overclocked server 2 s before its power dip', async () => {
    const h = await dipSeen;
    expect(h).not.toBeNull();
    expect(h!.dip!.partId).toMatch(/^server-/);
    expect(h!.now).toBeLessThan(305);
  });

  await test.step('the crew arrive, and Regroup runs quarter speed for 10 s once, then greys out', async () => {
    await playThroughScene(page, 'C5');
    await expect.poll(async () => (await hud(page)).regroup.visible, { timeout: 30_000 }).toBe(true);
    const h = await hud(page);
    expect(h.timeScale).toBe(1);
    await page.mouse.click(h.regroup.button.x, h.regroup.button.y);
    await expect.poll(async () => (await hud(page)).timeScale, { intervals: [25] }).toBe(0.25);
    await expect.poll(async () => (await hud(page)).regroup.spent, { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await hud(page)).timeScale).toBe(1);
  });

  await waitForNow(page, 430);

  await test.step('C6: the midnight surge is warned and the sizing prompt asks for servers', async () => {
    await expect
      .poll(async () => (await hud(page)).surge?.startsAt ?? null, { timeout: 60_000, intervals: [25] })
      .toBe(450);
    let h = await hud(page);
    expect(450 - h.surge!.shownAt!).toBeGreaterThanOrEqual(10);
    expect(h.surge?.demand).toBe(150);
    await expect.poll(async () => (await hud(page)).sizingPrompt.open).toBe(true);
    h = await hud(page);
    expect(h.dial.mode).toBe('servers');
    expect(h.now).toBeLessThan(510);
    await page.screenshot({ path: 'test-results/screens/hud-c6.png' });
    await setDial(page, 4);
    await expect.poll(async () => (await hud(page)).notes.sizing).toBe(4);
    h = await hud(page);
    expect(h.sizingPrompt.open).toBe(false);
  });

  await test.step('the countdown reaches 0:00 at midnight, not before', async () => {
    await waitForNow(page, 500);
    let h = await hud(page);
    if (h.now < 509) expect(h.countdown).not.toBe('0:00');
    await expect
      .poll(async () => (await hud(page)).countdown, { timeout: 60_000, intervals: [25] })
      .toBe('0:00');
    h = await hud(page);
    expect(h.now).toBeGreaterThanOrEqual(509);
    await waitForNow(page, 510);
    h = await hud(page);
    expect(h.clock.startsWith('00:00')).toBe(true);
    expect(h.countdown).toBe('0:00');
  });
});

test('Regroup stays hidden until the crew hands it over', async ({ page }) => {
  await openBoard(page);
  await dismissJobCard(page);
  const h = await hud(page);
  expect(h.regroup.visible).toBe(false);
  expect(h.timeScale).toBe(1);
});
