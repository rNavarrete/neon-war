import { type Page, expect, test } from '@playwright/test';
import type { LuxCamTestState } from '../../src/scenes/hud/luxcam';
import type { Rect } from '../../src/scenes/live/layout';
import { openBoard, reach, shot, snap } from './live/reach';

// Lux's cam (luxcam-2, luxcam-3), asserted on window.__neonTest.state.hud.luxCam: it draws inside
// ZONES.cam with the face and the backdrop only inside the 388x230 lens, its art is the texture on
// the front face, REC blinks on the HUD clock (steady with reduce flicker) and the talk bars follow
// Lux's lines. Short on purpose: speed 20 with the autopilot, two page loads.

async function cam(page: Page): Promise<LuxCamTestState> {
  const c = await page.evaluate(() => window.__neonTest?.state?.hud?.luxCam ?? null);
  if (!c) throw new Error('hud.luxCam is missing: is LuxCamView in the registry?');
  return c;
}

async function camZone(page: Page): Promise<Rect> {
  return page.evaluate(() => window.__neonTest!.state.live!.zones.cam);
}

const within = (r: Rect, outer: Rect, slack = 0.2): boolean =>
  r.x >= outer.x - slack &&
  r.y >= outer.y - slack &&
  r.x + r.w <= outer.x + outer.w + slack &&
  r.y + r.h <= outer.y + outer.h + slack;

test('the cam: inside its zone, the face and backdrop cropped to the lens, art on the front face, REC blinking', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { errors } = await openBoard(page);
  await reach(page, 'c1');

  const zone = await camZone(page);
  let c = await cam(page);
  // The hook's zone is ZONES.cam (x 16-424, y 430-700) in page px, the same rect live.zones reports.
  expect(c.zone).toEqual(zone);
  const canvas = await page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const k = canvas.width / 1920;
  expect(zone.x).toBeCloseTo(canvas.left + 16 * k, 0);
  expect(zone.y).toBeCloseTo(canvas.top + 430 * (canvas.height / 1080), 0);
  expect(c.lens.w).toBeCloseTo(388 * k, 0);
  expect(c.lens.h).toBeCloseTo(230 * (canvas.height / 1080), 0);
  expect(within(c.lens, zone)).toBe(true);

  // Sample the cam for a while: the face and backdrop never leave the lens, art is the front face's
  // texture (a portrait key), and REC blinks (1.2 s on the HUD clock is 60 ms of real time at speed 20).
  const recs = new Set<boolean>();
  for (let i = 0; i < 60; i++) {
    c = await cam(page);
    expect(within(c.face, c.lens), `face ${JSON.stringify(c.face)}`).toBe(true);
    expect(within(c.backdrop, c.lens), `backdrop ${JSON.stringify(c.backdrop)}`).toBe(true);
    expect(c.face.w * c.face.h).toBeGreaterThan(0);
    expect(c.art).toMatch(/^portrait:lux\//);
    expect(c.motion).toBe('full');
    expect(['amber', 'red']).toContain(c.frame);
    expect(c.frame === 'red').toBe(c.mood === 'panicking');
    recs.add(c.rec);
    await page.waitForTimeout(15);
  }
  expect([...recs].sort()).toEqual([false, true]);
  expect(c.history.length).toBeGreaterThanOrEqual(1);
  expect(c.history.length).toBeLessThanOrEqual(12);

  // No missing texture anywhere, and no page error.
  const missing = await page.evaluate(() => window.__neonTest?.state?.art?.missing ?? []);
  expect(missing).toEqual([]);
  await shot(page, 'live-m3-cam');
  expect(errors).toEqual([]);
});

test('the cam with reduce flicker: REC never goes off and motion is reduced', async ({ page }) => {
  test.setTimeout(45_000);
  await page.addInitScript(() => {
    window.localStorage.setItem('neon-war.settings', JSON.stringify({ reduceFlicker: true }));
  });
  const { errors } = await openBoard(page);
  await reach(page, 'c1');
  for (let i = 0; i < 60; i++) {
    const c = await cam(page);
    expect(c.rec).toBe(true);
    expect(c.motion).toBe('reduced');
    await page.waitForTimeout(15);
  }
  expect((await snap(page)).hud?.ready).toBe(true);
  expect(errors).toEqual([]);
});
