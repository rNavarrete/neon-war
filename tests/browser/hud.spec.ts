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

type Story = {
  active: boolean;
  scriptId: string | null;
  click: { x: number; y: number } | null;
  skip: { visible: boolean; x: number; y: number };
};

/** The story section of the hook. */
async function storyOf(page: Page): Promise<Story> {
  return page.evaluate(() => window.__neonTest!.state.story as unknown as Story);
}

/** Wait for a story scene over the board (the rescue), then click through it to the end. */
async function playThroughScene(page: Page, scriptId: string): Promise<void> {
  const story = () => storyOf(page);
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
  // Under the job card the band asks nothing yet.
  expect(h.alert?.hint ?? null).toBeNull();
  // The in-world clock opens at 23:51:30, eight and a half minutes before midnight.
  expect(h.clock).toBe('23:51:30');
  expect(h.countdown).toBe('8:30');
  await page.screenshot({ path: 'test-results/screens/hud-job-card.png' });

  await dismissJobCard(page);
  h = await hud(page);
  expect(h.paused).toBe(false);
  expect(h.now).toBeGreaterThanOrEqual(15);
  // No estimate step: the band says what to do first, straight to the build.
  expect(h.alert?.hint).toBe('C1.alert.place');
  expect(h.alert?.hintText).toBe('drag a SERVER card onto a glowing pad');
  // TRIAGE guesses first, never pausing the board.
  await expect
    .poll(async () => (await hud(page)).bark.current, { timeout: 40_000, intervals: [50] })
    .toBe('C1.triage.02');
  h = await hud(page);
  expect(h.bark.text).toBe("480 a second! I'm great at math.");
  expect(h.paused).toBe(false);
});

test('C1: Lux and TRIAGE do the sum once a box is live, and the chart, trust and credits match the sim', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openBoard(page, 20, true);
  await dismissJobCard(page);
  await expect
    .poll(async () => (await hud(page)).bark.history, { timeout: 60_000 })
    .toEqual(expect.arrayContaining(['C1.lux.01', 'C1.triage.03']));

  // Let the real line draw in for a while.
  await waitForNow(page, 60);
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
  // Trust and credits on screen match the sim. At speed 20 trust can move between a draw and a
  // read, so wait for a frame where both are read together, as for the chart.
  await expect
    .poll(
      async () => {
        const n = await hud(page);
        return Math.max(Math.abs(n.shown.trust - n.sim.trust), Math.abs(n.shown.credits - n.sim.credits));
      },
      { timeout: 20_000, intervals: [25] },
    )
    .toBeLessThanOrEqual(1);
  const h = await hud(page);
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

test('the surge, the laundry cut, the dip flicker, Regroup, the midnight forecast and midnight', async ({
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
    expect(before.sim.block).toBe(250);
    await page.mouse.click(before.laundry.button.x, before.laundry.button.y);
    await expect.poll(async () => (await hud(page)).laundry.cut).toBe(true);
    // The block sheds the laundry floor: 250 becomes 210 before retries (which keep climbing).
    const after = await hud(page);
    expect(after.sim.block).toBe(210);
    // Taken as the surge lands, so the warning (it lingers a few seconds) and the cut both show.
    await page.screenshot({ path: 'test-results/screens/hud-c4.png' });
    // Lux's line about the cut waits in the comms band's queue behind TRIAGE's surge lines. Taken a
    // few sim seconds late (305 or after), it is still queued when the crew break in at about 310,
    // and the rescue scene pauses the HUD with it there, so it cannot show until the scene is
    // clicked through (tech follow-up 5). Wait for whichever comes first; the line itself is
    // asserted in bark.history below, after the scene if it came first.
    await expect
      .poll(
        async () =>
          (await hud(page)).bark.history.includes('C4.lux.cut') || (await storyOf(page)).scriptId === 'C5',
        { timeout: 60_000, intervals: [50] },
      )
      .toBe(true);
  });

  await test.step('a flicker warning shows on the overclocked server 2 s before its power dip', async () => {
    const h = await dipSeen;
    expect(h).not.toBeNull();
    expect(h!.dip!.partId).toMatch(/^server-/);
    expect(h!.now).toBeLessThan(305);
  });

  await test.step('the crew arrive, and Regroup runs quarter speed for 10 s once, then greys out', async () => {
    // Tech follow-up 4: while the rescue scene is up the HUD is paused, and the title's dot says HELD.
    await expect
      .poll(async () => (await storyOf(page)).scriptId, { timeout: 60_000, intervals: [50] })
      .toBe('C5');
    expect((await hud(page)).title?.live).toBe('held');
    await playThroughScene(page, 'C5');
    await expect.poll(async () => (await hud(page)).title?.live, { timeout: 10_000 }).not.toBe('held');
    // Lux answered the laundry cut, before the scene or right after it (see the laundry step).
    await expect
      .poll(async () => (await hud(page)).bark.history, { timeout: 60_000 })
      .toContain('C4.lux.cut');
    await expect.poll(async () => (await hud(page)).regroup.visible, { timeout: 30_000 }).toBe(true);
    const h = await hud(page);
    expect(h.timeScale).toBe(1);
    await page.mouse.click(h.regroup.button.x, h.regroup.button.y);
    await expect.poll(async () => (await hud(page)).timeScale, { intervals: [25] }).toBe(0.25);
    await expect.poll(async () => (await hud(page)).regroup.spent, { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await hud(page)).timeScale).toBe(1);
  });

  await waitForNow(page, 430);

  await test.step('C6: the midnight surge is warned, with no sizing question', async () => {
    await expect
      .poll(async () => (await hud(page)).surge?.startsAt ?? null, { timeout: 60_000, intervals: [25] })
      .toBe(450);
    let h = await hud(page);
    expect(450 - h.surge!.shownAt!).toBeGreaterThanOrEqual(10);
    expect(h.surge?.demand).toBe(150);
    h = await hud(page);
    expect(h.now).toBeLessThan(510);
    await page.screenshot({ path: 'test-results/screens/hud-c6.png' });
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

// Tech follow-up 4: the title's round avatar, and the LIVE dot reads HELD while the pause menu is up
// (it pauses the HUD scene, so no update runs; the title hears the scene's pause and resume).
test('the title shows the round avatar and reads HELD under the pause menu, LIVE after resume', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await openBoard(page, 20, true);
  await dismissJobCard(page);
  await expect.poll(async () => (await hud(page)).title?.live, { timeout: 10_000 }).toBe('live');
  const h = await hud(page);
  expect(h.title!.avatar).toBe('avatar:hud/live/avatar-luxnet@72');
  const baked = await page.evaluate(
    () => (window.__neonTest!.state as unknown as { avatars: { baked: string[] } }).avatars.baked,
  );
  expect(baked).toContain(h.title!.avatar);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await hud(page)).title?.live, { timeout: 5_000 }).toBe('held');
  expect((await hud(page)).title!.scenePaused).toBe(true);
  await page.screenshot({ path: 'test-results/screens/hud-title-held.png' });
  const resume = await page.evaluate(
    () =>
      (
        window.__neonTest!.state as unknown as {
          shell: { buttons: Record<string, { x: number; y: number }> };
        }
      ).shell.buttons.resume,
  );
  await page.mouse.click(resume.x, resume.y);
  await expect.poll(async () => (await hud(page)).title?.live, { timeout: 5_000 }).toBe('live');
  expect((await hud(page)).title!.scenePaused).toBe(false);
});
