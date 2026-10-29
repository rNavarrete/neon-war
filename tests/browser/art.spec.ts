import { type ConsoleMessage, type Page, expect, test } from '@playwright/test';
import { ART_REQUESTS, isPicked } from '../../src/game/artManifest';
import type { ArtTestState } from '../../src/scenes/plates';
import { reach, shot } from './live/reach';

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
  // Batches 1 to 5 are all picked (28 Oct 2026, round 2): nothing stands in, and every loaded key is
  // a picked one whose file the views asked for.
  const unpicked = ART_REQUESTS.filter((r) => !isPicked(r)).map((r) => r.key);
  const picked = ART_REQUESTS.filter(isPicked).map((r) => r.key);
  expect(unpicked).toEqual([]);
  expect(art!.fallback).toEqual(unpicked);
  for (const k of picked) expect(art!.fallback, k).not.toContain(k);
  for (const k of art!.loaded) expect(picked, k).toContain(k);
  expect(art!.loaded.length).toBeGreaterThan(0);
  // Phaser swaps an unknown texture key for its __MISSING texture without a console line, so the
  // hook scans the running scenes for it.
  expect(art!.missing).toEqual([]);
});

test('the Live screen runs with the picked pieces in and nothing drawing a missing texture', async ({
  page,
}) => {
  // art3d-5: the look of batches 1 to 4 can't be judged by an assertion, so the running Live screen
  // (job card away, the night under way) is saved for Rolando to judge.
  test.setTimeout(90_000);
  await reach(page, 'c1');
  const art = await page.evaluate(
    () => (window.__neonTest!.state as unknown as { art?: ArtTestState }).art ?? null,
  );
  test.fixme(art === null, 'the art hook is not installed: src/main.ts needs installArtHook(game)');
  expect(art!.missing).toEqual([]);
  expect(art!.fallback).toEqual(ART_REQUESTS.filter((r) => !isPicked(r)).map((r) => r.key));
  await shot(page, 'm4-art3d-live');
});

/** One read of the probe and the parts it could glow on, from the same hook snapshot. */
interface GlowRead {
  now: number;
  paused: boolean;
  glows: number;
  gradientMaps: number;
  parts: string[];
  over: string[];
  shares: Record<string, number | null>;
  filters: number;
}

async function glowRead(page: Page): Promise<GlowRead> {
  return page.evaluate(() => {
    const s = window.__neonTest!.state as unknown as {
      board: {
        now: number;
        paused: boolean;
        glow: { glows: number; gradientMaps: number; parts: string[] };
        parts: { id: string; share: number | null; dark: boolean }[];
      };
      perf?: { filters: number };
    };
    const b = s.board;
    const shares: Record<string, number | null> = {};
    for (const p of b.parts) shares[p.id] = p.share;
    return {
      now: b.now,
      paused: b.paused,
      glows: b.glow.glows,
      gradientMaps: b.glow.gradientMaps,
      parts: [...b.glow.parts],
      over: b.parts.filter((p) => !p.dark && p.share !== null && p.share > 1).map((p) => p.id),
      shares,
      filters: s.perf?.filters ?? 0,
    };
  });
}

test('the surge: at most three red glows, only on parts over capacity, and at most one GradientMap', async ({
  page,
}, testInfo) => {
  // art3d-6: the Glow probe, read from the board hook (board.glow) through the surge at speed 20.
  test.setTimeout(90_000);
  await reach(page, 'surge');
  let most: GlowRead | null = null;
  let reads = 0;
  const maps: number[] = [];
  const filters: number[] = [];
  // Sample the probe for a few real seconds (about a minute of game time at speed 20), checking every
  // read; keep the read with the most glows for the screenshot.
  const until = Date.now() + 4_000;
  while (Date.now() < until) {
    const r = await glowRead(page);
    reads++;
    maps.push(r.gradientMaps);
    filters.push(r.filters);
    expect(r.glows, `glows at now ${r.now}`).toBeLessThanOrEqual(3);
    expect(r.gradientMaps, `gradientMaps at now ${r.now}`).toBeLessThanOrEqual(1);
    // The rescue's recolour never sits on a held board (a story scene over it).
    if (r.paused) expect(r.gradientMaps, `gradientMaps on a held board at now ${r.now}`).toBe(0);
    expect(r.parts.length).toBe(r.glows);
    expect(new Set(r.parts).size).toBe(r.parts.length);
    // Every glowing part is over capacity (the hook rounds shares to 3 decimals, so a part just over
    // 100% can read 1.000: at least 1 is what the rounding allows).
    for (const id of r.parts) {
      const share = r.shares[id];
      expect(share, `${id} glows (now ${r.now})`).not.toBeNull();
      expect(share as number, `${id} glows at share ${share} (now ${r.now})`).toBeGreaterThanOrEqual(1);
    }
    // The hottest over-capacity parts are the ones that glow: none hotter than a glowing one is left
    // out, and a board with a part over capacity has a glow.
    if (r.parts.length > 0) {
      const coolest = Math.min(...r.parts.map((id) => r.shares[id] as number));
      const hotterLeftOut = r.over.filter(
        (id) => !r.parts.includes(id) && (r.shares[id] as number) > coolest + 0.001,
      );
      expect(hotterLeftOut, `now ${r.now}`).toEqual([]);
    } else {
      expect(r.over, `over capacity but no glow (now ${r.now})`).toEqual([]);
    }
    expect(r.filters).toBeLessThanOrEqual(4);
    if (most === null || r.glows > most.glows) {
      most = r;
      if (r.glows > 0) await shot(page, 'perf-surge');
    }
    await page.waitForTimeout(100);
  }
  if (most === null || most.glows === 0) await shot(page, 'perf-surge');
  testInfo.annotations.push({
    type: 'glow',
    description: most
      ? `${reads} reads (gradientMaps ${maps.join(',')}, perf.filters ${filters.join(',')}); ` +
        `most glows ${most.glows} at now ${most.now} on ${most.parts.join(', ') || 'none'} ` +
        `(shares ${most.parts.map((id) => most!.shares[id]).join(', ')}); over capacity then: ${most.over.join(', ') || 'none'}`
      : 'no read',
  });
});
