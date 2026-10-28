import { type Page, expect, test } from '@playwright/test';
import type { PerfSection } from '../../src/scenes/live/hook';
import { ZONE_IDS } from '../../src/scenes/live/layout';
import { openBoard, reach, shot } from './live/reach';

// The perf hook (tech-7): perf.* is measured from walks of both scenes' display lists once a second.
// Every registered view stays inside its declared {objects, texts} budget, the totals stay inside the
// global budget (docs/LIVE.md "Perf budget"), and the board's packet pool stops growing in the surge.
// One page load, speed 20 with autopilot: the C4 surge, then midnight.

/** The registry's zones: every zone but the board's own two (feed, inventory). */
const REGISTERED = ZONE_IDS.filter((z) => z !== 'feed' && z !== 'inventory');
const OBJECTS_MAX = 750;
const TEXTS_MAX = 110;
/** The board's share of the 110 (docs/LIVE.md "Perf budget"). */
const BOARD_TEXTS_MAX = 28;
const PACKETS_MAX = 160;

async function perf(page: Page): Promise<PerfSection> {
  return page.evaluate(() => (window.__neonTest!.state as unknown as { perf: PerfSection }).perf);
}

/**
 * Wait for a sample taken at sim time `at` or later and after sample number `after` (samples come
 * once a real second while the HUD runs; a story scene holds them), and return it.
 */
async function sampleFrom(page: Page, at: number, after = -1): Promise<PerfSection> {
  let got: PerfSection | null = null;
  await expect
    .poll(
      async () => {
        const p = await perf(page);
        if (p.at >= at && p.samples > after) got = p;
        return got !== null;
      },
      { timeout: 5_000, intervals: [50], message: `a perf sample at now >= ${at} after sample ${after}` },
    )
    .toBe(true);
  return got as unknown as PerfSection;
}

/** Every registered view within its budget, and the totals within the global budget. */
function expectWithinBudgets(p: PerfSection, moment: string): void {
  expect(Object.keys(p.zones).sort(), `${moment}: perf.zones`).toEqual([...REGISTERED].sort());
  for (const zone of REGISTERED) {
    const z = p.zones[zone]!;
    expect(z.actual.objects, `${moment}: ${zone} objects`).toBeLessThanOrEqual(z.budget.objects);
    expect(z.actual.texts, `${moment}: ${zone} texts`).toBeLessThanOrEqual(z.budget.texts);
  }
  expect(p.objects.board + p.objects.hud, `${moment}: objects`).toBeLessThanOrEqual(OBJECTS_MAX);
  expect(p.drawn.objects, `${moment}: drawn objects`).toBeLessThanOrEqual(OBJECTS_MAX);
  expect(p.drawn.texts, `${moment}: drawn texts`).toBeLessThanOrEqual(TEXTS_MAX);
  // All texts, hidden ones included (the stronger check, now that the board keeps to its 28).
  expect(p.texts, `${moment}: all texts`).toBeLessThanOrEqual(TEXTS_MAX);
  expect(p.textsBy.board, `${moment}: board texts`).toBeLessThanOrEqual(BOARD_TEXTS_MAX);
  expect(p.textsBy.board + p.textsBy.hud).toBe(p.texts);
  expect(p.pools.packets, `${moment}: pools.packets`).toBeLessThanOrEqual(PACKETS_MAX);
  expect(p.fps.avg).toBeGreaterThan(0);
  expect(p.frameMs).toBeGreaterThan(0);
  // art3d-6 may add at most three Glows and one GradientMap; none have landed yet.
  expect(p.filters).toBeLessThanOrEqual(4);
  expect(p.lite).toBe(true);
}

function describe(p: PerfSection): string {
  return (
    `objects ${p.objects.board}+${p.objects.hud}, texts ${p.textsBy.board}+${p.textsBy.hud} ` +
    `(drawn ${p.drawn.objects} objects, ${p.drawn.texts} texts), host ${p.host.objects}/${p.host.texts}, ` +
    `packets ${p.pools.packets}, fps ${p.fps.avg}, frameMs ${p.frameMs}`
  );
}

test('perf: every view within its budget, the totals within 750 / 110 and the packet pool steady, at C4 and midnight', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });

  const first = await perf(page);
  expect(first.samples).toBeGreaterThan(0);

  await reach(page, 'surge');
  const surge = await sampleFrom(page, 300);
  expectWithinBudgets(surge, 'surge');
  testInfo.annotations.push({ type: 'surge', description: describe(surge) });

  // Back on the board after the crew's rescue, with the surge's tail and the final climb still on
  // the wires, the pool holds what the surge needed: two reads five seconds apart (about 100 sim
  // seconds at speed 20, the board running) are equal. The scene in between holds the HUD, so the
  // reads are taken after it.
  const back = await reach(page, 'rescue');
  const a = await sampleFrom(page, back.hud.now);
  await page.waitForTimeout(5_000);
  const b = await sampleFrom(page, a.at, a.samples);
  const nowA = a.at;
  const nowB = b.at;
  expect(nowB - nowA, 'the board ran between the two reads').toBeGreaterThan(20);
  expect(a.pools.packets).toBeGreaterThanOrEqual(surge.pools.packets);
  expect(b.pools.packets).toBe(a.pools.packets);
  expect(b.pools.packets).toBeLessThanOrEqual(PACKETS_MAX);
  testInfo.annotations.push({
    type: 'packets',
    description: `surge ${surge.pools.packets}, now ${nowA.toFixed(0)}: ${a.pools.packets}, now ${nowB.toFixed(0)}: ${b.pools.packets}`,
  });

  const twelve = await reach(page, 'midnight', { timeout: 60_000 });
  const midnight = await sampleFrom(page, twelve.hud.now);
  expectWithinBudgets(midnight, 'midnight');
  testInfo.annotations.push({ type: 'midnight', description: describe(midnight) });
  await shot(page, 'tech-perf-midnight');
  expect(errors).toEqual([]);
});
