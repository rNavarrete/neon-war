import { expect, test } from '@playwright/test';

test('the game boots into the board scene and shows the art', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('requestfailed', (req) => errors.push(`failed to load ${req.url()}`));

  await page.goto('/?test&scene=board');
  await expect
    .poll(() => page.evaluate(() => window.__neonTest?.state.ready ?? false), { timeout: 15_000 })
    .toBe(true);

  const state = await page.evaluate(() => window.__neonTest!.state);
  expect(state.scene).toBe('board');
  expect(state.canvas?.width).toBeGreaterThan(0);
  expect(errors).toEqual([]);

  await page.screenshot({ path: 'test-results/screens/board.png' });
});

test('the test hook is absent without the test parameter', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
  expect(await page.evaluate(() => '__neonTest' in window)).toBe(false);
});
