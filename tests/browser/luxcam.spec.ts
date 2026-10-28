import { type Page, expect, test } from '@playwright/test';
import type { LuxCamTestState } from '../../src/scenes/hud/luxcam';
import type { Rect } from '../../src/scenes/live/layout';
import { LINES, type LineId } from '../../src/strings';
import { dismissJobCard, openBoard, reach, setDial, shot, snap } from './live/reach';

// Lux's cam (luxcam-2, luxcam-3), asserted on window.__neonTest.state.hud.luxCam: it draws inside
// ZONES.cam with the face and the backdrop only inside the 388x230 lens, its art is the texture on
// the front face, REC blinks on the HUD clock (steady with reduce flicker) and the talk bars follow
// Lux's lines. Short on purpose: speed 20 with the autopilot for the first two, and a third page at
// speed 4 without it, where touching the dial makes Lux answer (C1.lux.01) on the band.

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

/** Whether a bark id is one of Lux's lines (its speaker in docs/SCRIPT.md). */
const isLux = (id: LineId | null): boolean => id !== null && LINES[id].speaker === 'Lux';

test('the talk bars: speaking is true exactly while Lux’s line is on the band', async ({ page }) => {
  test.setTimeout(60_000);
  const { errors } = await openBoard(page, { speed: 4, autopilot: false });
  await dismissJobCard(page);
  // Touching the dial makes Lux answer (C1.lux.01) once the band is free.
  await setDial(page, 30);
  const seen = { lux: 0, other: 0, quiet: 0 };
  const deadline = Date.now() + 40_000;
  let luxDone = false;
  while (!luxDone && Date.now() < deadline) {
    const { bark, luxCam } = await page.evaluate(() => {
      const h = window.__neonTest!.state.hud!;
      return { bark: h.bark.current, luxCam: h.luxCam! };
    });
    // One hook read: the band and the cam agree on every sample.
    expect(luxCam.speaking, `bark.current=${bark}`).toBe(isLux(bark));
    if (isLux(bark)) seen.lux++;
    else if (bark) seen.other++;
    else seen.quiet++;
    // Done once Lux has spoken and her line has left the band.
    if (seen.lux > 0 && !isLux(bark)) luxDone = true;
    await page.waitForTimeout(25);
  }
  expect(seen.lux, 'C1.lux.01 was seen on the band').toBeGreaterThan(0);
  expect(luxDone, 'Lux’s line left the band').toBe(true);
  expect((await cam(page)).speaking).toBe(false);
  expect(errors).toEqual([]);
});

// ---- luxcam-4: the autopilot night, read as history, with three screenshots ----
//
// Two more page loads: the autopilot night to midnight and the goggles (about 49 s, the midnight
// floor), and a C3 failure staged as story.spec does, with the clock jumped to 170 (about 12 s).
// exhausted only follows a rewind, and C7 and C8 never fail (src/sim/play.ts), so it cannot sit
// between cheer and gogglesUp on one night: the night run checks calm or focused, panicking,
// relieved, cheer and gogglesUp in that order, and the C3 run checks exhausted after its rewind.

type Mood = LuxCamTestState['mood'];

/**
 * Every mood change the cam reported while the night ran, in the order it happened: a sampler that
 * merges hud.luxCam.history (the last 12 changes) read after read, so nothing is lost at speed 20.
 */
class CamLog {
  readonly moods: Mood[] = [];
  private readonly keys = new Set<string>();

  add(c: LuxCamTestState): void {
    for (const h of c.history) {
      const key = `${h.mood}@${h.at}`;
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      this.moods.push(h.mood);
    }
  }

  async read(page: Page): Promise<LuxCamTestState> {
    const c = await cam(page);
    this.add(c);
    return c;
  }

  /** Read the cam every 25 ms until `done` holds for a read, or fail naming `what`. */
  async until(
    page: Page,
    what: string,
    done: (c: LuxCamTestState) => boolean,
    timeout = 20_000,
  ): Promise<LuxCamTestState> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const c = await this.read(page);
      if (done(c)) return c;
      if (Date.now() > deadline)
        throw new Error(
          `waited ${timeout / 1000} s for hud.luxCam ${what}; moods seen: ${this.moods.join(' > ')}`,
        );
      await page.waitForTimeout(25);
    }
  }

  /** Sample in the background (every 150 ms) while `work` runs, so reach() loses no mood change. */
  async during<T>(page: Page, work: Promise<T>): Promise<T> {
    let running = true;
    const sampler = (async () => {
      while (running) {
        try {
          await this.read(page);
        } catch {
          // A read between scenes can miss the HUD; the next one catches up through history.
        }
        await page.waitForTimeout(150);
      }
    })();
    try {
      return await work;
    } finally {
      running = false;
      await sampler;
    }
  }
}

/** The index of the first `want` mood at or after `from` in `moods`, or -1. */
const nextOf = (moods: readonly Mood[], want: readonly Mood[], from: number): number => {
  for (let i = from; i < moods.length; i++) if (want.includes(moods[i])) return i;
  return -1;
};

test('the autopilot night on the cam: calm, panicking at the dip, relieved after the rescue, cheer at a held midnight, goggles up', async ({
  page,
}) => {
  test.setTimeout(75_000);
  const { errors } = await openBoard(page);
  const log = new CamLog();

  // C1: the first box serves and the cam is quiet (calm or focused, amber frame).
  await log.during(page, reach(page, 'c1'));
  let c = await log.until(page, 'mood calm or focused', (x) => x.mood === 'calm' || x.mood === 'focused');
  expect(c.frame).toBe('amber');
  await shot(page, 'luxcam-calm');

  // C4: the district surge and the power dip at 305 send her into a panic, with the red frame.
  await log.during(page, reach(page, 'surge'));
  c = await log.until(page, 'mood panicking', (x) => x.mood === 'panicking');
  expect(c.frame).toBe('red');
  await shot(page, 'luxcam-surge');

  // The rescue (clicked through by reach) brings relief; a held midnight brings the cheer.
  await log.during(page, reach(page, 'midnight'));
  c = await log.until(page, 'mood cheer', (x) => x.mood === 'cheer');
  expect(c.frame).toBe('amber');
  await shot(page, 'luxcam-held');

  // 3 s before the debrief (sim 537) the goggles go up and stay up.
  await log.until(page, 'mood gogglesUp', (x) => x.mood === 'gogglesUp');

  // In order: calm or focused, then panicking, then relieved, then cheer, then gogglesUp.
  const m = log.moods;
  const quiet = nextOf(m, ['calm', 'focused'], 0);
  const panic = nextOf(m, ['panicking'], quiet + 1);
  const relieved = nextOf(m, ['relieved'], panic + 1);
  const cheer = nextOf(m, ['cheer'], relieved + 1);
  const goggles = nextOf(m, ['gogglesUp'], cheer + 1);
  const order = `moods seen: ${m.join(' > ')}`;
  test.info().annotations.push({ type: 'moods', description: m.join(' > ') });
  expect(quiet, order).toBeGreaterThanOrEqual(0);
  expect(panic, order).toBeGreaterThan(quiet);
  expect(relieved, order).toBeGreaterThan(panic);
  expect(cheer, order).toBeGreaterThan(relieved);
  expect(goggles, order).toBeGreaterThan(cheer);
  // Cheer comes once, at the held midnight; nothing follows the goggles.
  expect(m.filter((x) => x === 'cheer')).toHaveLength(1);
  expect(m.slice(goggles + 1), order).toEqual([]);
  expect(errors).toEqual([]);
});

test('a failure in C3 rewinds the night and the cam shows her exhausted, then lets go', async ({ page }) => {
  test.setTimeout(30_000);
  const { errors } = await openBoard(page, { autopilot: false });
  await dismissJobCard(page);
  // One stock server and no kit, the way story.spec stages it: the evening climb cooks it in C3.
  const id = await page.evaluate(() => window.__neonShell!.place('s1'));
  expect(id).not.toBeNull();
  await page.evaluate((s) => window.__neonShell!.connect('gateway', s!), id);
  await page.evaluate((s) => window.__neonShell!.connect(s!, 'database'), id);
  // Skip the quiet C1 and C2 stretch (seconds of wall clock even at speed 20): the run jumps to 23:54:20,
  // ten seconds before C3, and its checkpoint at 180 is still taken on the way.
  await page.evaluate(() => window.__neonStory!.setNow(170));

  // TRIAGE's replay comes up; click it through (Skip when shown) until the cam has been exhausted.
  const log = new CamLog();
  const deadline = Date.now() + 20_000;
  let replay = false;
  let lastClick = 0;
  while (!log.moods.includes('exhausted')) {
    if (Date.now() > deadline)
      throw new Error(
        `no exhausted face after the C3 rewind (replay seen: ${replay}); moods: ${log.moods.join(' > ')}`,
      );
    const s = await snap(page);
    if (s.hud?.luxCam) log.add(s.hud.luxCam);
    const story = s.story;
    if (story?.active) {
      if (story.scriptId === 'rewind-replay') replay = true;
      const p = story.skip.visible ? story.skip : story.click;
      if (p && Date.now() - lastClick >= 80) {
        await page.mouse.click(p.x, p.y);
        lastClick = Date.now();
        continue;
      }
    }
    await page.waitForTimeout(25);
  }
  expect(replay, 'the rewind-replay scene came up').toBe(true);
  // The beat is 3 s on the HUD clock, then the ladder takes over again.
  const c = await log.until(page, 'a mood after exhausted', (x) => x.mood !== 'exhausted');
  const i = c.history.findIndex((h) => h.mood === 'exhausted');
  if (i >= 0 && i + 1 < c.history.length) {
    expect(c.history[i + 1].at - c.history[i].at).toBeGreaterThanOrEqual(3 - 0.05);
  }
  test.info().annotations.push({ type: 'moods', description: log.moods.join(' > ') });
  expect(errors).toEqual([]);
});
