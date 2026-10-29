import { expect, test } from '@playwright/test';
import type { HudTestState } from '../../src/scenes/hud/hook';
import { BROWNOUT } from '../../src/sim/brownout';
import { hud, openBoard, reach, shot } from './live/reach';

const C = BROWNOUT.challenges;

// The CITY GRID map (gauges-7), asserted on window.__neonTest.state.hud.map: pooled dots that stop
// growing at steady demand, more of them in the district surge than at the evening climb, the raid
// outlines at the surge, the laundry floor dark after the cut and fewer lit floors while dropping.
//
// Speed 5 with autopilot: the laundry cut is offered only for the few seconds between the surge and
// the crew, as in hud.spec.ts.

type MapState = NonNullable<HudTestState['map']>;

async function map(page: Parameters<typeof hud>[0]): Promise<MapState> {
  const m = (await hud(page)).map;
  if (!m) throw new Error('hud.map is missing: is MapView in the registry?');
  return m;
}

test('the city map: pooled dots, more in the surge, the raid, the laundry cut and dark floors while dropping', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { errors } = await openBoard(page, { speed: 5, autopilot: true });
  await reach(page, 'c1');
  let m = await map(page);
  expect(m.raid).toBe(false);
  expect(m.midnight).toBe(false);
  // Batch 5: the lit city painting is baked and waits, hidden, for a held midnight.
  expect(m.lit).toEqual({ key: 'hud/city-grid-lit', alpha: 0 });

  let at90 = 0;
  await test.step('steady at the climb (90/s): the pool does not grow over 3 s', async () => {
    await expect
      .poll(async () => (await hud(page)).now, { timeout: 70_000, intervals: [100] })
      .toBeGreaterThanOrEqual(C.c3 + BROWNOUT.demand.climbRampSeconds + 5);
    let h = await hud(page);
    expect(h.sim.block).toBe(90);
    const pool = h.map!.dots.pool;
    expect(pool).toBeGreaterThan(0);
    const samples: number[] = [];
    const end = Date.now() + 3_000;
    while (Date.now() < end) {
      h = await hud(page);
      samples.push(h.map!.dots.active);
      expect(h.map!.dots.pool).toBe(pool);
      await page.waitForTimeout(50);
    }
    h = await hud(page);
    // Still the same steady demand three seconds on, and the same pool.
    expect(h.sim.block).toBe(90);
    expect(h.map!.dots.pool).toBe(pool);
    at90 = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(at90).toBeGreaterThan(0);
  });

  await test.step('the district surge: raid outlines, then 1.6x the dots at 250', async () => {
    await expect
      .poll(async () => (await hud(page)).surge?.startsAt ?? null, { timeout: 60_000, intervals: [25] })
      .toBe(C.c4);
    await expect.poll(async () => (await map(page)).raid, { timeout: 5_000, intervals: [25] }).toBe(true);
    m = await map(page);
    expect(m.neighboursCut).toBe(true);
    await expect
      .poll(
        async () => {
          const h = await hud(page);
          return h.laundry.available && h.sim.block >= 250;
        },
        { timeout: 20_000, intervals: [25] },
      )
      .toBe(true);
    // The district road fills within a couple of sim seconds (under half a real second here).
    let best = 0;
    await expect
      .poll(
        async () => {
          const h = await hud(page);
          if (h.sim.block === 250) best = Math.max(best, h.map!.dots.active);
          return best;
        },
        { timeout: 2_000, intervals: [25] },
      )
      .toBeGreaterThanOrEqual(1.6 * at90);
    expect((await map(page)).raid).toBe(true);
  });

  await test.step('the laundry cut greys its floor; while dropping fewer floors are lit', async () => {
    const before = await hud(page);
    expect(before.laundry.available).toBe(true);
    await page.mouse.click(before.laundry.button.x, before.laundry.button.y);
    await expect.poll(async () => (await hud(page)).laundry.cut, { timeout: 5_000 }).toBe(true);
    await expect
      .poll(async () => (await map(page)).laundryDark, { timeout: 5_000, intervals: [25] })
      .toBe(true);
    // The surge is more than the wired boxes take: calls drop and the top floors go dark.
    await expect
      .poll(
        async () => {
          const h = await hud(page);
          return h.headroom?.state === 'red' && h.map!.litFloors < 10;
        },
        { timeout: 10_000, intervals: [25] },
      )
      .toBe(true);
    m = await map(page);
    expect(m.litFloors).toBeGreaterThanOrEqual(0);
    expect(m.laundryDark).toBe(true);
    expect(m.dots.active).toBeGreaterThan(0);
    await shot(page, 'live-m2-map');
  });

  expect(errors).toEqual([]);
});
