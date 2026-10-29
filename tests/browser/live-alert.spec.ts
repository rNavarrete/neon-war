import { type Page, expect, test } from '@playwright/test';
import type { AlertHistoryEntry } from '../../src/scenes/hud/AlertView';
import { BROWNOUT } from '../../src/sim/brownout';
import { dismissJobCard, hud, openBoard, reach, shot, snap } from './live/reach';

// The gauges lane's alert band (gauges-3), asserted on window.__neonTest.state.hud.alert: one alert at
// a time, the number first in the headline, RAID only as the tag, and the district surge's number
// climbing with the retries.

const RAIDING = ['raid', 'refresh', 'flicker'];
const C = BROWNOUT.challenges;

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

  await test.step('M4 kit: the alert plate and its end cap, the map in the raid, the keycaps', async () => {
    const h = await hud(page);
    // The band is the picked alert plate, nine-sliced at k 0.5, with the hazard end cap: one baked
    // texture, nothing drawn above its file's size.
    const plate = h.alert!.panel!;
    expect(plate.texture).toBe('live-kit:alert');
    expect(plate.pieces).toEqual(['hud/live/alert-plate', 'hud/live/alert-endcap']);
    expect(plate.missing).toEqual([]);
    expect(plate.maxScale).toBeGreaterThan(0);
    expect(plate.maxScale).toBeLessThanOrEqual(1);
    expect(plate.rect).toEqual({ x: 460, y: 8, w: 1040, h: 84 });
    // The map is the painted city grid in its frame; CUT OFF sits on the red tag chip in the raid.
    const map = h.map!;
    expect(map.base).toBe('hud/city-grid');
    expect(map.neighboursCut).toBe(true);
    expect(map.chip).toBe(true);
    expect(map.panel!.pieces).toEqual([
      'hud/city-grid',
      'hud/live/panel-frame',
      'hud/live/label-tab',
      'hud/live/corner-marks',
    ]);
    expect(map.panel!.maxScale).toBeLessThanOrEqual(1);
    // Each deck key shows the picked keycap for its state.
    for (const k of ['one', 'two'] as const) {
      const key = h.deck!.keys[k];
      expect(key.cap, k).toMatch(/^hud\/live\/keycap-(idle|ready|pressed)$/);
      if (key.cap !== 'hud/live/keycap-pressed')
        expect(key.cap, k).toBe(key.lit ? 'hud/live/keycap-ready' : 'hud/live/keycap-idle');
    }
    await shot(page, 'm4-kit-raid');
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

// gauges-8: the deck's keys 1 REGROUP and 2 CUT 3F, pressed on the keyboard: the digits run the
// same handlers as the keys (hud.deck.presses records each press and whether it acted), and are
// ignored while the job card or the banner is open, while paused, or during a story scene.

type Press = { key: string; via: string; acted: boolean };

async function presses(page: Page): Promise<Press[]> {
  return (await hud(page)).deck?.presses ?? [];
}

/** Press a digit and wait until the deck has recorded it; returns the press. */
async function pressDigit(page: Page, digit: '1' | '2'): Promise<Press> {
  const before = (await hud(page)).deck?.pressed ?? 0;
  await page.keyboard.press(digit);
  await expect
    .poll(async () => (await hud(page)).deck?.pressed ?? 0, {
      timeout: 5_000,
      intervals: [10],
      message: `hud.deck.pressed never counted the ${digit} key`,
    })
    .toBeGreaterThan(before);
  const list = await presses(page);
  return list[list.length - 1];
}

test('deck keys: 1 and 2 on the keyboard act like the keys, and wait for the card, the banner, pause and scenes', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { errors } = await openBoard(page, { speed: 10, autopilot: true });

  await test.step('every key is interactive from the first frame; the keys wait while the job card is open', async () => {
    const h = await hud(page);
    expect(h.jobCard.open).toBe(true);
    expect(Object.keys(h.deck!.keys).sort()).toEqual(['one', 'two']);
    for (const k of ['one', 'two'] as const) expect(h.deck!.keys[k].interactive, k).toBe(true);
    // The keys sit where hud.regroup / hud.laundry say.
    expect(h.deck!.keys.one).toMatchObject({ x: h.regroup.button.x, y: h.regroup.button.y });
    expect(h.deck!.keys.two).toMatchObject({ x: h.laundry.button.x, y: h.laundry.button.y });
    const p = await pressDigit(page, '1');
    expect(p).toMatchObject({ key: 'one', via: 'key', acted: false });
  });

  await test.step('with the card away, 3 is no key: it records no press', async () => {
    await dismissJobCard(page);
    const before = (await hud(page)).deck!.pressed;
    await page.keyboard.press('3');
    await page.waitForTimeout(150);
    expect((await hud(page)).deck!.pressed).toBe(before);
  });

  await test.step('the Solace banner blocks every key', async () => {
    await expect
      .poll(async () => (await hud(page)).banner.open, { timeout: 60_000, intervals: [25] })
      .toBe(true);
    expect((await hud(page)).deck!.blocked).toBe(true);
    for (const d of ['1', '2'] as const) expect((await pressDigit(page, d)).acted, d).toBe(false);
  });

  await test.step('2 cuts the laundry floor in the district surge', async () => {
    await expect
      .poll(async () => (await hud(page)).laundry.available, {
        timeout: 120_000,
        intervals: [10],
        message: 'hud.laundry.available never became true',
      })
      .toBe(true);
    const p = await pressDigit(page, '2');
    expect(p).toMatchObject({ key: 'two', via: 'key', acted: true });
    await expect.poll(async () => (await hud(page)).laundry.cut, { timeout: 5_000 }).toBe(true);
    expect((await hud(page)).deck!.cut).toBe('done');
  });

  await test.step('a story scene holds the keys: 1 during the rescue does nothing', async () => {
    await expect
      .poll(async () => (await snap(page)).story?.scriptId ?? null, { timeout: 60_000, intervals: [25] })
      .toBe('C5');
    const before = (await hud(page)).deck!.pressed;
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    expect((await presses(page)).filter((p) => p.acted && p.key === 'one')).toHaveLength(0);
    expect((await hud(page)).deck!.pressed).toBe(before);
    await reach(page, 'rescue', { timeout: 60_000 });
    // Session 0 hands over no Regroup (BROWNOUT.regroup.inSession), so key 1 stays empty.
    expect((await hud(page)).deck?.regroup).toBe('hidden');
  });

  await test.step('after the scene, 1 does nothing: no Regroup in Session 0', async () => {
    const p = await pressDigit(page, '1');
    expect(p).toMatchObject({ key: 'one', via: 'key', acted: false });
    expect((await hud(page)).regroup.spent).toBe(false);
  });

  await test.step('paused at the midnight forecast, the keys wait', async () => {
    await expect
      .poll(async () => (await hud(page)).surge?.startsAt ?? null, { timeout: 60_000, intervals: [25] })
      .toBe(C.c6);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await hud(page)).paused, { timeout: 5_000 }).toBe(true);
    const before = (await hud(page)).deck!.pressed;
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.waitForTimeout(200);
    const h = await hud(page);
    const fresh = h.deck!.presses.slice(h.deck!.presses.length - (h.deck!.pressed - before));
    expect(fresh.filter((p) => p.acted)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await hud(page)).paused, { timeout: 5_000 }).toBe(false);
    await shot(page, 'live-m2-deck');
  });

  expect(errors).toEqual([]);
});
