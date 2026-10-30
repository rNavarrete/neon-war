import { type Page, expect, test } from '@playwright/test';
import type { GaugeTestState } from '../../src/scenes/hud/GaugeView';
import type { HudTestState } from '../../src/scenes/hud/hook';
import { dismissJobCard, hud, openBoard, reach, shot } from './live/reach';

// The instrument panel in the left column (docs/LIVE.md): the COMING /s gauge in ZONES.gauge
// (gauges-5) and the scope in ZONES.scope (gauges-6), asserted on window.__neonTest.state.hud.

/** Words the player must not see before the debrief (docs/SCRIPT.md C8.terms, and the mockup's). */
// Real terms on screen (Rolando, 29 Oct 2026): the old crew words must not come back.
const BANNED_ON_SCREEN = /\bcoming\b|\broom\b|no box|\bsplitter\b|est\./i;

type Hud = HudTestState & { gauge: GaugeTestState };

async function gaugeHud(page: Page): Promise<Hud> {
  const h = await hud(page);
  expect(h.gauge, 'hud.gauge is missing').toBeTruthy();
  return h as Hud;
}

/** The gauge's words on screen are the crew's. */
function expectCrewWords(g: GaugeTestState): void {
  for (const w of [g.title, g.readout, g.sub, g.strip ?? '', ...g.ticks])
    expect(w, w).not.toMatch(BANNED_ON_SCREEN);
}

/** hud.gauge agrees with the sim and the room-left bar on this read. */
function expectGaugeMatchesSim(h: Hud): void {
  expect(h.gauge.visible).toBe(true);
  expect(Math.abs(h.gauge.demand - h.sim.demand), 'gauge.demand vs sim.demand').toBeLessThanOrEqual(1);
  expect(h.headroom, 'hud.headroom').toBeTruthy();
  expect(
    Math.abs(h.gauge.capacity - h.headroom!.wiredCapacity),
    'gauge.capacity vs wiredCapacity',
  ).toBeLessThanOrEqual(1);
  // The wired room never exceeds what every live box could serve.
  expect(h.headroom!.wiredCapacity).toBeLessThanOrEqual(h.sim.capacity + 1);
}

test('the DEMAND gauge: NO CAPACITY YET before the first build, in the real terms', async ({ page }) => {
  test.setTimeout(60_000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: false });
  await dismissJobCard(page);
  const h = await gaugeHud(page);
  expect(h.gauge.title).toBe('DEMAND req/s');
  expect(h.gauge.max).toBe(400);
  expect(h.gauge.ticks).toEqual(['0', '100', '200', '300', '400']);
  expect(h.gauge.capacity).toBe(0);
  expect(h.gauge.strip).toBe('NO CAPACITY YET');
  // Batch 5: the painted face is baked into the plate and the painted needle turns, both at half.
  expect(h.gauge.face).toBe('hud/gauge-face');
  expect(h.gauge.needleArt).toEqual({ key: 'hud/gauge-needle', scale: 0.5 });
  expect(h.gauge.panel!.maxScale).toBeLessThanOrEqual(1);
  expectGaugeMatchesSim(h);
  expectCrewWords(h.gauge);
  expect(errors).toEqual([]);
});

test('the DEMAND gauge at speed 5: needle on demand, OVER BY in the raid', async ({ page }) => {
  test.setTimeout(150_000);
  const { errors } = await openBoard(page, { speed: 5, autopilot: true });
  await reach(page, 'c1');

  await test.step('a settled frame: the needle within 1 req/s of demand, the band on the wired room', async () => {
    let settled: Hud | null = null;
    await expect
      .poll(
        async () => {
          const h = await gaugeHud(page);
          // Read on a frame where the gauge and hud.sim agree too: early in C1 the retries still move
          // demand between the gauge's frame and the read (the dial step used to give it time).
          const ok =
            h.gauge.capacity > 0 &&
            Math.abs(h.gauge.needle - h.gauge.demand) <= 1 &&
            Math.abs(h.gauge.demand - h.sim.demand) <= 1;
          if (ok) settled = h;
          return ok;
        },
        { timeout: 10_000, intervals: [50] },
      )
      .toBe(true);
    const h = settled as unknown as Hud;
    expectGaugeMatchesSim(h);
    expect(h.gauge.sub).toBe(`capacity ${Math.round(h.gauge.capacity)} req/s`);
    expect(h.gauge.strip).toBeNull();
    expectCrewWords(h.gauge);
  });

  await test.step('the district surge: OVER BY (demand - room), red wedge as calls drop', async () => {
    await reach(page, 'surge', { timeout: 110_000 });
    let read: Hud | null = null;
    let last = '';
    await expect
      .poll(
        async () => {
          const h = await gaugeHud(page);
          const g = h.gauge;
          last = JSON.stringify({ now: h.now, paused: h.paused, sim: h.sim.demand, ...g, ticks: undefined });
          // While the raid runs (not held for a scene): the strip, the wedge and the band agree on one frame.
          const ok =
            !h.paused &&
            g.strip !== null &&
            g.strip.startsWith('OVER BY') &&
            g.dropped > 0 &&
            Math.abs(g.capacity - h.headroom!.wiredCapacity) <= 1 &&
            // With the HUD clock at true game time a headless frame at speed 5 can be most of a game
            // second, so read on a frame where the gauge and hud.sim are within one small rise.
            Math.abs(g.demand - h.sim.demand) <= 10;
          if (ok) read = h;
          return ok ? 'ok' : last;
        },
        {
          timeout: 20_000,
          intervals: [25],
        },
      )
      .toBe('ok');
    const h = read as unknown as Hud;
    // In the raid retries move demand every frame, so the gauge (drawn from this frame) and hud.sim
    // (read later) can differ by one frame's rise; the same-read check is made on a settled frame above.
    expect(Math.abs(h.gauge.demand - h.sim.demand)).toBeLessThanOrEqual(10);
    expect(h.gauge.capacity).toBe(h.headroom!.wiredCapacity);
    expect(h.gauge.strip).toBe(`OVER BY ${Math.round(h.gauge.demand - h.gauge.capacity)}/s`);
    expect(h.gauge.demand).toBeGreaterThan(h.gauge.capacity);
    expectCrewWords(h.gauge);
    await shot(page, 'live-m2-gauge');
  });
  expect(errors).toEqual([]);
});

// The LAST 60 s chart is gone (Rolando, 30 Oct 2026: three widgets measured the same thing; the
// gauge stays). hud.chart keeps the demand and capacity it mirrored, now straight from the sim.
test('no scope: the gauge is the one demand widget, and hud.chart reads the sim', async ({ page }) => {
  test.setTimeout(90_000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });
  await reach(page, 'c1');
  const h = await hud(page);
  const c = h.chart as { demand: number; capacity: number; ceiling: number; plot?: unknown };
  expect(c.plot).toBeUndefined();
  expect(c.ceiling).toBe(400);
  expect(Math.abs(c.capacity - h.sim.capacity)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
