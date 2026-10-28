import { type ConsoleMessage, type Page, expect, test } from '@playwright/test';
import { ART_REQUESTS } from '../../src/game/artManifest';
import type { ArtTestState } from '../../src/scenes/plates';

// Art with stand-ins (art3d-2): the board boots with every texture it asks for, so no console error
// or warning mentions a missing texture or frame; and the `art` hook section reports the requested
// keys still drawing a stand-in (art.fallback) and the picked ones loaded (art.loaded).

/**
 * Console lines about art that failed to arrive: Phaser's 'Texture "k" has no frame "f"' and 'No
 * texture found matching key', its __MISSING stand-in, a file the loader could not process, and the
 * browser's 'Failed to load resource' for a missing file; plus any other line naming a missing or
 * unknown texture or frame.
 */
const MISSING_ART: readonly RegExp[] = [
  /has no frame/i,
  /no texture found/i,
  /__MISSING/,
  /failed to (load|process)/i,
  /(texture|frame)\b.*\b(missing|not found|unknown|invalid|undefined)/i,
  /\b(missing|unknown|invalid)\b.*\b(texture|frame)/i,
];
const aboutMissingArt = (line: string): boolean => MISSING_ART.some((re) => re.test(line));

async function bootBoard(page: Page, notes: string[]): Promise<void> {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') notes.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => notes.push(`pageerror: ${err.message}`));
  await page.goto('/?test&scene=board');
  await expect
    .poll(() => page.evaluate(() => window.__neonTest?.state.hud?.ready ?? false), { timeout: 15_000 })
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.__neonTest?.state.ready ?? false)).toBe(true);
}

test('the board boots without a console error or warning about a missing texture or frame', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const notes: string[] = [];
  await bootBoard(page, notes);
  // Give late loads and the first frames a moment to complain.
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/screens/art-board-boot.png' });
  expect(notes.filter(aboutMissingArt)).toEqual([]);
});

test('the art hook lists the stand-ins and the picked keys as arrays', async ({ page }) => {
  test.setTimeout(60_000);
  const notes: string[] = [];
  await bootBoard(page, notes);
  const art = await page.evaluate(
    () => (window.__neonTest!.state as unknown as { art?: ArtTestState }).art ?? null,
  );
  // The section is published by installArtHook(game) in src/main.ts, a tech-owned file; until that
  // line lands the section is absent and this test is reported as fixme, not passed.
  test.fixme(art === null, 'the art hook is not installed: src/main.ts needs installArtHook(game)');
  expect(Array.isArray(art!.fallback)).toBe(true);
  expect(Array.isArray(art!.loaded)).toBe(true);
  expect(Array.isArray(art!.baked)).toBe(true);
  // Nothing is picked yet, so every requested key stands in and none is loaded.
  expect(art!.fallback).toEqual(ART_REQUESTS.map((r) => r.key));
  expect(art!.loaded).toEqual([]);
  // Phaser swaps an unknown texture key for its __MISSING texture without a console line, so the
  // hook scans the running scenes for it.
  expect(art!.missing).toEqual([]);
});
