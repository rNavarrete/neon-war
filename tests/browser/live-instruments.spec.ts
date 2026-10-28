import { type Page, expect, test } from '@playwright/test';
import type { GaugeTestState } from '../../src/scenes/hud/GaugeView';
import type { HudTestState } from '../../src/scenes/hud/hook';
import { dismissJobCard, hud, openBoard, reach, setDial, shot } from './live/reach';

// The instrument panel in the left column (docs/LIVE.md): the COMING /s gauge in ZONES.gauge
// (gauges-5) and the scope in ZONES.scope (gauges-6), asserted on window.__neonTest.state.hud.

/** Words the player must not see before the debrief (docs/SCRIPT.md C8.terms, and the mockup's). */
const BANNED_ON_SCREEN = /head\s*room|throughput|est\.|capacity|requests per second/i;

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

test('the COMING /s gauge: NO ROOM YET before the first build, in crew words', async ({ page }) => {
  test.setTimeout(60_000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: false });
  await dismissJobCard(page);
  const h = await gaugeHud(page);
  expect(h.gauge.title).toBe('COMING /s');
  expect(h.gauge.max).toBe(400);
  expect(h.gauge.ticks).toEqual(['0', '100', '200', '300', '400']);
  expect(h.gauge.capacity).toBe(0);
  expect(h.gauge.strip).toBe('NO ROOM YET');
  expect(h.gauge.estimateMark).toBeNull();
  expect(h.gauge.tick).toBeNull();
  expectGaugeMatchesSim(h);
  expectCrewWords(h.gauge);
  expect(errors).toEqual([]);
});

test('the COMING /s gauge at speed 5: estimate tick after SET, needle on demand, OVER BY in the raid', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { errors } = await openBoard(page, { speed: 5, autopilot: true });
  await reach(page, 'c1');

  await test.step('C1: no tick until SET, then the tick is notes.estimate', async () => {
    let h = await gaugeHud(page);
    expect(h.dial.visible).toBe(true);
    expect(h.gauge.estimateMark).toBeNull();
    await setDial(page, 30);
    await expect.poll(async () => (await gaugeHud(page)).gauge.estimateMark, { timeout: 5_000 }).toBe(30);
    h = await gaugeHud(page);
    expect(h.notes.estimate).toBe(30);
    expect(h.gauge.tick).toBe(30);
    expect(h.gauge.sizingMark).toBeNull();
  });

  await test.step('a settled frame: the needle within 1 req/s of demand, the band on the wired room', async () => {
    await expect
      .poll(
        async () => {
          const h = await gaugeHud(page);
          return h.gauge.capacity > 0 && Math.abs(h.gauge.needle - h.gauge.demand) <= 1;
        },
        { timeout: 10_000, intervals: [50] },
      )
      .toBe(true);
    const h = await gaugeHud(page);
    expectGaugeMatchesSim(h);
    expect(h.gauge.sub).toBe(`room ${Math.round(h.gauge.capacity)}/s`);
    expect(h.gauge.strip).toBeNull();
    expectCrewWords(h.gauge);
  });

  await test.step('the district surge: OVER BY (demand - room), red wedge as calls drop', async () => {
    await reach(page, 'surge', { timeout: 110_000 });
    let read: Hud | null = null;
    await expect
      .poll(
        async () => {
          // Retries move demand between the gauge's frame and the read: keep a read where both agree.
          const h = await gaugeHud(page);
          const ok =
            h.gauge.strip !== null &&
            h.gauge.strip.startsWith('OVER BY') &&
            h.gauge.dropped > 0 &&
            Math.abs(h.gauge.demand - h.sim.demand) <= 1;
          if (ok) read = h;
          return ok;
        },
        { timeout: 10_000, intervals: [25] },
      )
      .toBe(true);
    const h = read as unknown as Hud;
    expectGaugeMatchesSim(h);
    expect(h.gauge.strip).toBe(`OVER BY ${Math.round(h.gauge.demand - h.gauge.capacity)}/s`);
    expect(h.gauge.demand).toBeGreaterThan(h.gauge.capacity);
    expect(h.gauge.estimateMark).toBe(30);
    expectCrewWords(h.gauge);
    await shot(page, 'live-m2-gauge');
  });
  expect(errors).toEqual([]);
});
