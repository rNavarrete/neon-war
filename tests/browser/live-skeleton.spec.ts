import { type Page, expect, test } from '@playwright/test';
import type { LiveTestState, PerfTestState } from '../../src/scenes/live/hook';
import { LAYOUT_VERSION, ZONES, ZONE_IDS, pageRect } from '../../src/scenes/live/layout';
import { openBoard, reach, shot } from './live/reach';

// The Live screen's skeleton (tech-3): the twelve zones reported on the page, the placeholders the
// registry still draws, and the perf section, asserted on window.__neonTest.state.live and .perf.

type Sections = { live: LiveTestState; perf: PerfTestState };

async function sections(page: Page): Promise<Sections> {
  return page.evaluate(() => {
    const s = window.__neonTest!.state as unknown as Partial<Sections>;
    return { live: s.live!, perf: s.perf! };
  });
}

test('the Live skeleton: zones on the page, ten placeholders, perf numbers and lite under ?test', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/?test&scene=board');
  await expect
    .poll(() => page.evaluate(() => window.__neonTest?.state.hud?.ready ?? false), { timeout: 15_000 })
    .toBe(true);
  expect(errors).toEqual([]);

  // The canvas as the page lays it out: at 1280x720 the 16:9 game fills the viewport.
  const canvas = await page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  expect(canvas.width).toBeGreaterThan(0);
  expect(canvas.height).toBeGreaterThan(0);

  const { live, perf } = await sections(page);
  expect(live.layoutVersion).toBe(LAYOUT_VERSION);
  expect(live.layoutVersion).toBe(1);
  expect(Object.keys(live.zones)).toEqual(ZONE_IDS);
  for (const zone of ZONE_IDS) expect(live.zones[zone], zone).toEqual(pageRect(ZONES[zone], canvas));
  // Every zone lands inside the canvas.
  for (const zone of ZONE_IDS) {
    const z = live.zones[zone];
    expect(z.x, zone).toBeGreaterThanOrEqual(canvas.left);
    expect(z.y, zone).toBeGreaterThanOrEqual(canvas.top);
    expect(z.x + z.w, zone).toBeLessThanOrEqual(canvas.left + canvas.width + 0.1);
    expect(z.y + z.h, zone).toBeLessThanOrEqual(canvas.top + canvas.height + 0.1);
  }
  expect(live.placeholders).toEqual([
    'title',
    'alert',
    'clock',
    'map',
    'cam',
    'gauge',
    'scope',
    'comms',
    'deck',
    'chat',
  ]);

  for (const n of [perf.objects.board, perf.objects.hud, perf.texts, perf.graphics, perf.fps.avg]) {
    expect(typeof n).toBe('number');
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  }
  // Ten placeholders: a Graphics and a Text each, on the HUD's list, under the HUD's own objects.
  expect(perf.objects.hud).toBeGreaterThanOrEqual(20);
  expect(perf.texts).toBeGreaterThanOrEqual(10);
  expect(perf.graphics).toBeGreaterThanOrEqual(10);
  expect(perf.objects.board).toBeGreaterThan(0);
  expect(perf.lite).toBe(true);

  await page.screenshot({ path: 'test-results/screens/live-skeleton.png' });
  expect(errors).toEqual([]);
});

// tech-6: the reach helpers (tests/browser/live/reach.ts) get to the surge and to midnight at speed 20
// with autopilot inside their budgets. Each test records its wall-clock seconds as annotations
// ('boot' and 'reach'); docs/LIVE.md ("Browser test budget") lists the measured floors.

test('reach surge at speed 20 with autopilot: surge.startsAt 300 seen and now >= 300 within 25 s', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const t0 = Date.now();
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });
  const boot = (Date.now() - t0) / 1000;
  const r = await reach(page, 'surge', { timeout: 25_000 });
  testInfo.annotations.push(
    { type: 'boot', description: `${boot.toFixed(1)} s` },
    {
      type: 'reach',
      description: `reach('surge') ${r.seconds.toFixed(1)} s (hud.now ${r.hud.now.toFixed(1)})`,
    },
  );
  expect(r.seen.surgeAt300).toBe(true);
  expect(r.seen.surgeStartsAt).toContain(300);
  expect(r.hud.now).toBeGreaterThanOrEqual(300);
  expect(r.seconds).toBeLessThan(25);
  await shot(page, 'live-reach-surge');
  expect(errors).toEqual([]);
});

test('reach midnight at speed 20 with autopilot: clock 00:00 within 50 s, the rescue clicked through', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const t0 = Date.now();
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });
  const boot = (Date.now() - t0) / 1000;
  const r = await reach(page, 'midnight', { timeout: 50_000 });
  testInfo.annotations.push(
    { type: 'boot', description: `${boot.toFixed(1)} s` },
    {
      type: 'reach',
      description: `reach('midnight') ${r.seconds.toFixed(1)} s (hud.now ${r.hud.now.toFixed(1)}, scenes ${r.scenes.join(',')})`,
    },
  );
  expect(r.hud.clock).toMatch(/^00:00/);
  expect(r.seconds).toBeLessThan(50);
  // The crew's rescue holds the run on the way; the helper clicked it through itself.
  expect(r.scenes).toContain('C5');
  expect(r.snap.story?.finished).toContain('C5');
  expect(r.snap.story?.active).toBe(false);
  await shot(page, 'live-reach-midnight');
  expect(errors).toEqual([]);
});
