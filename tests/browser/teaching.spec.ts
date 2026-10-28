import { type Page, expect, test } from '@playwright/test';
import { CARDS, ZONES, overlaps } from '../../src/scenes/live/layout';
import { LINES } from '../../src/strings';
import { type Snap, dismissJobCard, hud, openBoard, shot, snap } from './live/reach';

// The learning lane's teaching criteria in the browser (learning-5, docs/LIVE.md: 150 s). Every
// assertion reads window.__neonTest.state; the mouse is the only input. Where a moment is a time
// rather than an event, the spec runs on until the hook's clock has passed it and then reads the
// hook, instead of waiting for an exact window (Rolando: tests honest, never blocking on timing).

/** The learning lane's line in docs/LIVE.md ("Browser test budget"). */
const LANE_SECONDS = 150;

/** Where the four reads sit: the gauge (COMING against ROOM), the scope and the deck's ROOM LEFT bar. */
const READOUT = [ZONES.gauge, ZONES.scope, ZONES.deck] as const;

/**
 * Run the night on until `done` holds, clicking the job card away and every story scene on (Skip
 * when shown), as tests/browser/live/reach.ts does for its moments. Returns the snapshot that met it.
 */
async function until(
  page: Page,
  what: string,
  done: (s: Snap) => boolean,
  timeout: number,
  saw: (s: Snap) => void = () => {},
): Promise<Snap> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const s = await snap(page);
    saw(s);
    if (done(s)) return s;
    if (Date.now() > deadline) {
      throw new Error(
        `until: waited ${timeout / 1000} s for ${what}; last read hud.now=${s.hud?.now ?? 'none'}, ` +
          `story.active=${s.story?.active ?? 'none'}, story.scriptId=${s.story?.scriptId ?? 'none'}, scene=${s.scene}`,
      );
    }
    if (s.story?.active) {
      const p = s.story.skip.visible ? s.story.skip : s.story.click;
      if (p) await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(80);
    } else if (s.hud?.jobCard.open) {
      await page.mouse.click(s.hud.jobCard.x, s.hud.jobCard.y);
      await page.waitForTimeout(50);
    } else {
      await page.waitForTimeout(25);
    }
  }
}

/** The four reads agree with the sim on this one snapshot (the hook reads them on the same frame). */
function readable(s: Snap): boolean {
  const h = s.hud;
  if (!h || !h.gauge || !h.headroom || s.story?.active) return false;
  return (
    h.gauge.visible &&
    Math.abs(h.gauge.demand - h.sim.demand) <= 1 &&
    h.gauge.capacity === h.headroom.wiredCapacity &&
    Math.abs(h.chart.capacity - h.sim.capacity) <= 1
  );
}

/** The modal cards open on this snapshot, as their CARDS rects. */
function openModals(s: Snap) {
  const h = s.hud!;
  const out: { id: string; rect: (typeof CARDS)[keyof typeof CARDS] }[] = [];
  if (h.jobCard.open) out.push({ id: 'jobCard', rect: CARDS.jobCard });
  if (h.banner.open) out.push({ id: 'banner', rect: CARDS.banner });
  return out;
}

test('1. demand against room is readable at 60, 200, 300, 455 and 515, nothing over the readout', async ({
  page,
}) => {
  test.setTimeout(LANE_SECONDS * 1000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });
  const moments: [number, string][] = [
    [60, 'teaching-c1'],
    [200, 'teaching-c3'],
    [300, 'teaching-c4'],
    [455, 'teaching-c6'],
    [515, 'teaching-c7'],
  ];
  // The C6 forecast is up from 440 until the surge starts at 450: note every read of it on the way.
  const forecasts: { now: number; title: string | null; line: string | null; sub: string }[] = [];
  const saw = (s: Snap): void => {
    const a = s.hud?.alert;
    if (a && a.kind === 'forecast' && s.hud!.now >= 430 && s.hud!.now < 455) {
      forecasts.push({ now: s.hud!.now, title: a.title, line: a.line, sub: a.sub });
    }
  };
  for (const [at, name] of moments) {
    await test.step(`now >= ${at}`, async () => {
      await until(page, `hud.now >= ${at}`, (s) => (s.hud?.now ?? 0) >= at && !s.story?.active, 40_000, saw);
      // The board runs on at speed 20: read the first frame on which the four reads agree.
      const s = await until(page, `the readout agreeing with hud.sim after now ${at}`, readable, 20_000);
      const h = s.hud!;
      expect(h.gauge!.readout.length, 'the gauge prints its number').toBeGreaterThan(0);
      expect(h.headroom!.label.length, 'the ROOM LEFT bar prints its words').toBeGreaterThan(0);
      // No modal card open on this frame sits over the gauge, the scope or the deck.
      for (const m of openModals(s)) {
        for (const z of READOUT)
          expect(overlaps(m.rect, z), `${m.id} over the readout at ${h.now}`).toBe(false);
      }
      if (at === 455) {
        // The C6 forecast led with MIDNIGHT and named the outage under it. It
        // comes down when the surge starts at 450, so it is read on the way rather than at 455.
        expect(forecasts.length, 'hud.alert read as the C6 forecast between 430 and 455').toBeGreaterThan(0);
        for (const f of forecasts) {
          expect(f.title).toBe('C6.alert.title');
          expect(f.line).toBe('C6.alert.dip');
          expect(f.sub).toBe(LINES['C6.alert.dip'].text);
        }
      }
      await shot(page, name);
    });
  }
  expect(errors).toEqual([]);
});

test('2. hints fire on sim triggers: 8 s with the job card open says nothing, then C1.triage.02 runs on', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: false });
  const start = await hud(page);
  expect(start.jobCard.open).toBe(true);
  // 8 s of wall time with the card up: no cue fires, the band stays empty.
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const h = await hud(page);
    expect(h.jobCard.open).toBe(true);
    expect(h.comms?.line ?? null, 'hud.comms.line with the job card open').toBeNull();
    expect(h.cues.fired, 'hud.cues.fired with the job card open').toEqual([]);
    await page.waitForTimeout(250);
  }
  // The card going away is the trigger: C1.triage.01, then C1.triage.02 chained 2 s after it.
  await dismissJobCard(page);
  await expect
    .poll(async () => (await hud(page)).comms?.history ?? [], { timeout: 15_000 })
    .toContain('C1.triage.02');
  const h = await hud(page);
  expect(h.cues.fired.slice(0, 2)).toEqual(['C1.triage.01', 'C1.triage.02']);
  // A hint never holds the board or opens a scene.
  const s = await snap(page);
  expect(h.paused).toBe(false);
  expect(s.story?.active ?? false).toBe(false);
  expect(errors).toEqual([]);
});

test('3. a missed line can be reread from the band log, and the log stays open across a new line', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: false });
  await dismissJobCard(page);
  await expect
    .poll(async () => (await hud(page)).comms?.history ?? [], { timeout: 15_000 })
    .toContain('C1.triage.02');
  // Wait until C1.triage.01 has left the band: it is the missed line.
  await expect
    .poll(async () => (await hud(page)).comms?.line?.id ?? null, { timeout: 15_000 })
    .not.toBe('C1.triage.01');
  let c = (await hud(page)).comms!;
  // Hover the band for 400 ms: the log opens with the last three shown lines, newest last.
  await page.mouse.move(c.log.band.x, c.log.band.y);
  await expect.poll(async () => (await hud(page)).comms?.log.open, { timeout: 5_000 }).toBe(true);
  c = (await hud(page)).comms!;
  const ids = c.log.lines.map((l) => l.id);
  expect(ids).toContain('C1.triage.01');
  for (const l of c.log.lines) expect(l.text).toBe(LINES[l.id].text);
  // A new line (Lux's answer to the 480) arrives under the hover: the log stays open and takes it in.
  await page.mouse.move(c.log.outside.x, c.log.outside.y);
  await page.mouse.move(c.log.band.x, c.log.band.y);
  await expect
    .poll(async () => (await hud(page)).comms?.history.length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(2);
  await expect.poll(async () => (await hud(page)).comms?.log.open, { timeout: 5_000 }).toBe(true);
  c = (await hud(page)).comms!;
  const shown = [...c.history];
  if (c.line && shown[shown.length - 1] !== c.line.id) shown.push(c.line.id);
  expect(c.log.lines.map((l) => l.id)).toEqual(shown.slice(-3));
  await shot(page, 'teaching-reread');
  expect(errors).toEqual([]);
});

/**
 * Leave the board alone for 10 s of wall time from sim time `from` (best play until then, `?idle`
 * after): the sim clock runs on, the scene, the pause state and the story never change.
 */
async function idleWindow(page: Page, from: number, speed: number): Promise<void> {
  const { errors } = await openBoard(page, { speed, autopilot: true, params: `&idle=${from}` });
  const a = await until(
    page,
    `hud.now >= ${from}`,
    (s) => (s.hud?.now ?? 0) >= from && !s.story?.active,
    40_000,
  );
  const wires = a.hud!.measure?.wires ?? null;
  const t0 = Date.now();
  // No input from here: only reads.
  while (Date.now() - t0 < 10_000) {
    const s = await snap(page);
    expect(s.scene, `scene during the idle window from ${from}`).toBe(a.scene);
    expect(s.hud!.paused, `hud.paused at now ${s.hud!.now}`).toBe(false);
    expect(s.story?.active ?? false, `story.active at now ${s.hud!.now}`).toBe(false);
    expect(s.hud!.jobCard.open).toBe(false);
    // The autopilot keeps its hands off: the board's wires stay as they were.
    expect(s.hud!.measure?.wires ?? null).toBe(wires);
    await page.waitForTimeout(500);
  }
  const b = await snap(page);
  const moved = b.hud!.now - a.hud!.now;
  expect(moved, `hud.now moved ${moved} s in 10 s at speed ${speed}`).toBeGreaterThanOrEqual(9 * speed);
  expect(b.scene).toBe(a.scene);
  expect(b.hud!.paused).toBe(false);
  expect(b.story?.active ?? false).toBe(false);
  expect(errors).toEqual([]);
}

test('7. nothing advances on a timer: 10 s without input moves the clock, never the scene or the pause', async ({
  page,
}) => {
  test.setTimeout(LANE_SECONDS * 1000);
  // Speed 10, so the windows (60..160, 200..300) end before the surge the rescue scene answers.
  await test.step('from now 60, the first box wired and no card open', () => idleWindow(page, 60, 10));
  await test.step('from now 200', () => idleWindow(page, 200, 10));
});
