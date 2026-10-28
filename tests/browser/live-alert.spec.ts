import { expect, test } from '@playwright/test';
import type { AlertHistoryEntry } from '../../src/scenes/hud/AlertView';
import { hud, openBoard, reach, shot } from './live/reach';

// The gauges lane's alert band (gauges-3), asserted on window.__neonTest.state.hud.alert: one alert at
// a time, the number first in the headline, RAID only as the tag, and the district surge's number
// climbing with the retries.

const RAIDING = ['raid', 'refresh', 'flicker'];

test('the alert band: number first, RAID only as a tag, and the raid number climbs past 250 with retries (speed 5)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { errors } = await openBoard(page, { speed: 5, autopilot: true });
  await reach(page, 'c1');

  await test.step('the C3 climb is forecast with its number first', async () => {
    await expect
      .poll(async () => (await hud(page)).alert?.title ?? null, {
        timeout: 120_000,
        intervals: [50],
        message: 'hud.alert.title never read C3.alert.title',
      })
      .toBe('C3.alert.title');
    const a = (await hud(page)).alert!;
    expect(a.kind).toBe('forecast');
    expect(a.number).toBe(90);
    expect(a.headline).toBe('90/s · EVERYONE FILMING');
    expect(a.line).toBe('C3.warn.01');
    expect(a.tag).toBeNull();
    expect(a.visible).toBe(true);
  });

  await reach(page, 'surge', { timeout: 200_000 });

  await test.step('the district surge: the number leads, RAID sits in the tag well', async () => {
    await expect
      .poll(async () => RAIDING.includes((await hud(page)).alert?.kind ?? 'none'), {
        timeout: 30_000,
        intervals: [25],
        message: 'hud.alert.kind never became raid, refresh or flicker',
      })
      .toBe(true);
    await shot(page, 'live-m2-alert');
    const h = await hud(page);
    const a = h.alert!;
    expect(a.title).toBe('C4.alert.title');
    expect(a.headline).toMatch(/^\d+\/s · NEIGHBOURS REROUTED HERE$/);
    expect(a.headline).not.toContain('RAID');
    expect(a.tag).toBe('RAID');
    expect(a.stripes).toBe(true);
    // hud.surge keeps reporting the legacy warning, unchanged.
    expect(h.surge?.line ?? 'C4.warn.01').toBe('C4.warn.01');
  });

  await test.step('the raid number climbs above 250 once retries are rising', async () => {
    const climbed = (list: AlertHistoryEntry[]): AlertHistoryEntry | undefined =>
      list.find((e) => RAIDING.includes(e.kind) && e.retry > 0 && e.number > 250);
    await expect
      .poll(async () => climbed((await hud(page)).alert?.history ?? []) !== undefined, {
        timeout: 60_000,
        intervals: [25],
        message: 'hud.alert.history never held a raid number above 250 with play.retry > 0',
      })
      .toBe(true);
    const history = (await hud(page)).alert!.history;
    const up = climbed(history)!;
    expect(up.number).toBeGreaterThan(250);
    expect(up.retry).toBeGreaterThan(0);
    // Earlier in the night the C4 forecast read 250 ahead of the surge.
    expect(history.some((e) => e.kind === 'forecast' && e.number === 250)).toBe(true);
  });

  expect(errors).toEqual([]);
});
