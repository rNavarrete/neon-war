import { type Page, expect, test } from '@playwright/test';

// The anime opening (src/scenes/opening.ts) plays only in attract mode: after the title sits idle
// (20 s; `?test&attract=N` shortens it), the title music fades and the opening plays over the canvas.
// Any key or click stops it and returns to the menu. Asserts on window.__neonTest.state, never on pixels.

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

const playing = async (page: Page): Promise<boolean> => (await state(page)).opening!.playing;

/** The video element is really playing: time moves on. */
async function videoAdvances(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0), { timeout: 10_000 })
    .toBeGreaterThan(0.5);
}

test('idle on the title plays the opening over it, the music fading; a key returns to the menu', async ({
  page,
}) => {
  await page.goto('/?test&attract=2');
  await waitForScene(page, 'title');
  await expect.poll(async () => (await state(page)).shell!.titleMusicPlaying, { timeout: 10_000 }).toBe(true);
  // (START's spot, read while the title lists its buttons: the paused title lists none.)
  const start = (await state(page)).shell!.buttons.start;

  await expect.poll(() => playing(page), { timeout: 10_000 }).toBe(true);
  expect((await state(page)).opening!.reason).toBe('attract');
  await videoAdvances(page);
  expect(await page.evaluate(() => document.querySelector('video')!.muted)).toBe(false);
  await expect.poll(async () => (await state(page)).shell!.titleMusicPlaying).toBe(false);
  await page.screenshot({ path: 'test-results/screens/opening.png' });

  await page.keyboard.press('Space');
  await expect.poll(() => playing(page)).toBe(false);
  expect(await page.locator('video').count()).toBe(0);
  expect((await state(page)).scene).toBe('title');
  await expect.poll(async () => (await state(page)).shell!.titleMusicPlaying, { timeout: 10_000 }).toBe(true);

  // Idle again brings it back; a click stops it, and the release presses nothing on the menu under it.
  await expect.poll(() => playing(page), { timeout: 10_000 }).toBe(true);
  await page.mouse.click(start.x, start.y);
  await expect.poll(() => playing(page)).toBe(false);
  await page.waitForTimeout(300);
  expect((await state(page)).scene).toBe('title');
});

test('input keeps the opening away: idle counts from the last input', async ({ page }) => {
  await page.goto('/?test&attract=2');
  await waitForScene(page, 'title');
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(200 + i * 40, 300);
    await page.waitForTimeout(700);
  }
  expect(await playing(page)).toBe(false);
  await expect.poll(() => playing(page), { timeout: 10_000 }).toBe(true);
});

test('with the music muted the opening plays muted', async ({ page }) => {
  await page.goto('/?test');
  await waitForScene(page, 'title');
  await page.keyboard.press('M');
  await expect.poll(async () => (await state(page)).title!.speaker.muted).toBe(true);
  // The mute is remembered, so the reload with a short idle keeps it.
  await page.goto('/?test&attract=2');
  await waitForScene(page, 'title');
  await expect.poll(() => playing(page), { timeout: 10_000 }).toBe(true);
  expect(await page.evaluate(() => document.querySelector('video')!.muted)).toBe(true);
});
