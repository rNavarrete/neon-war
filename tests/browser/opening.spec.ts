import { type Page, expect, test } from '@playwright/test';

// The anime opening (src/scenes/opening.ts) plays only in attract mode: after the title sits idle
// (20 s; `?test&attract=N` shortens it), the title and its music fade to black and silence together, a
// beat of black, then the opening fades up over the canvas. Any key or click fades it back down and
// brings the title and its music back. Asserts on window.__neonTest.state, never on pixels.

type State = NonNullable<Window['__neonTest']>['state'];

const state = (page: Page): Promise<State> => page.evaluate(() => window.__neonTest!.state);

async function waitForScene(page: Page, scene: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => window.__neonTest?.state);
        return s && s.ready && s.shell ? s.scene : null;
      },
      { timeout: 15_000 },
    )
    .toBe(scene);
}

const opening = async (page: Page) => (await state(page)).opening!;

/** The video element is really playing: time moves on. */
async function videoAdvances(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0), { timeout: 10_000 })
    .toBeGreaterThan(0.5);
}

/**
 * Wait until the opening is over and the title music is back at its level (shell.titleMusicLevel, read in
 * the same frame), checked in the page on every frame. The short test idle starts the next fade 2 s after
 * the title is back, so a poll from outside can land after it has begun on a slow runner; this cannot.
 */
async function backOnTitle(page: Page, timeout: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.__neonTest!.state;
      return (
        s.opening!.playing === false &&
        s.scene === 'title' &&
        document.querySelector('video') === null &&
        Math.abs(s.shell!.titleMusicVolume - s.shell!.titleMusicLevel) < 5e-4
      );
    },
    undefined,
    { timeout, polling: 'raf' },
  );
}

test('idle fades the title and its music through black into the opening; a key fades back to the title', async ({
  page,
}) => {
  await page.goto('/?test&attract=2');
  await waitForScene(page, 'title');
  await expect.poll(async () => (await state(page)).shell!.titleMusicPlaying, { timeout: 10_000 }).toBe(true);
  // The title loop's own level, not a volume sampled now: on a slow runner the 2 s test idle can already
  // have begun the fade by this point (CI, 30 Oct 2026, read 0.86 and 0.63 of it).
  const full = (await state(page)).shell!.titleMusicLevel;
  expect(full).toBeGreaterThan(0);
  // (START's spot, read while the title lists its buttons: the paused title lists none.)
  const start = (await state(page)).shell!.buttons.start;

  // Going in: the title music fades with the picture (the gain falls through the middle, the volume follows).
  await expect.poll(async () => (await opening(page)).phase, { timeout: 10_000 }).toBe('entry');
  await expect.poll(async () => (await opening(page)).titleMusicGain, { timeout: 3_000 }).toBeLessThan(0.9);
  expect((await state(page)).shell!.titleMusicVolume).toBeLessThan(full);
  // Then black and silence, then the opening.
  await expect.poll(async () => (await opening(page)).phase, { timeout: 5_000 }).toBe('video');
  expect((await opening(page)).titleMusicGain).toBe(0);
  expect((await state(page)).shell!.titleMusicPlaying).toBe(false);
  expect((await opening(page)).reason).toBe('attract');
  await videoAdvances(page);
  expect(await page.evaluate(() => document.querySelector('video')!.muted)).toBe(false);
  await page.screenshot({ path: 'test-results/screens/opening.png' });

  // Coming out: the opening fades down, the title comes back, and its music fades back in to full.
  await page.keyboard.press('Space');
  await expect.poll(async () => (await opening(page)).phase).toBe('exit');
  await expect.poll(async () => (await state(page)).shell!.titleMusicPlaying, { timeout: 5_000 }).toBe(true);
  await backOnTitle(page, 5_000);

  // Idle again brings it back; a click skips it, and the release presses nothing on the menu under it.
  await expect.poll(async () => (await opening(page)).phase, { timeout: 10_000 }).toBe('video');
  await page.mouse.click(start.x, start.y);
  await expect.poll(async () => (await opening(page)).playing, { timeout: 5_000 }).toBe(false);
  await page.waitForTimeout(300);
  expect((await state(page)).scene).toBe('title');
});

test('an input during the fade in calls it off and brings the title music straight back', async ({
  page,
}) => {
  await page.goto('/?test&attract=2');
  await waitForScene(page, 'title');
  await expect.poll(async () => (await state(page)).shell!.titleMusicPlaying, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await opening(page)).titleMusicGain, { timeout: 10_000 }).toBeLessThan(0.8);
  await page.keyboard.press('Enter');
  await backOnTitle(page, 2_000);
});

test('input keeps the opening away: idle counts from the last input', async ({ page }) => {
  await page.goto('/?test&attract=2');
  await waitForScene(page, 'title');
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(200 + i * 40, 300);
    await page.waitForTimeout(700);
  }
  expect((await opening(page)).playing).toBe(false);
  await expect.poll(async () => (await opening(page)).playing, { timeout: 10_000 }).toBe(true);
});

test('with the music muted the opening plays muted', async ({ page }) => {
  await page.goto('/?test');
  await waitForScene(page, 'title');
  await page.keyboard.press('M');
  await expect.poll(async () => (await state(page)).title!.speaker.muted).toBe(true);
  // The mute is remembered, so the reload with a short idle keeps it.
  await page.goto('/?test&attract=2');
  await waitForScene(page, 'title');
  await expect.poll(async () => (await opening(page)).phase, { timeout: 10_000 }).toBe('video');
  expect(await page.evaluate(() => document.querySelector('video')!.muted)).toBe(true);
});
