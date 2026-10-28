import { type Page, expect } from '@playwright/test';
import type { HudTestState } from '../../../src/scenes/hud/hook';
import type { StoryTestState } from '../../../src/story/state';

// Shared helpers for the Live screen's browser specs (tech-6). Every lane's spec opens the board,
// clicks the job card away, turns the dial, reaches a moment of the night and saves a screenshot
// through these instead of copying the boilerplate from hud.spec.ts and story.spec.ts.
//
// They only read window.__neonTest.state (the hook is a test mirror) and drive the mouse at the
// positions it reports. Every wait has an explicit timeout and fails with a message naming the
// hook field it waited on. docs/LIVE.md ("Browser test budget") lists what each moment costs.

/** What the hook reports that these helpers read: the HUD and story sections and the scene. */
export interface Snap {
  scene: string | null;
  hud: HudTestState | null;
  story: StoryTestState | null;
}

/** One read of the hook (one structuredClone in the page). */
export async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const s = window.__neonTest?.state;
    return { scene: s?.scene ?? null, hud: s?.hud ?? null, story: s?.story ?? null };
  });
}

/** The HUD section; fails if the HUD has not published it yet. */
export async function hud(page: Page): Promise<HudTestState> {
  const s = await snap(page);
  if (!s.hud) throw new Error('window.__neonTest.state.hud is missing: is the board open with ?test?');
  return s.hud;
}

export interface OpenOptions {
  /** Sim speed, 1 to 20 (src/testHook.ts caps it). Default 20. */
  speed?: number;
  /** Scripted best play (src/game/autopilot.ts). Default true. */
  autopilot?: boolean;
  /** Extra query text appended as is, for example '&foo=1'. */
  params?: string;
  /** How long to wait for hud.ready. Default 15 s. */
  timeout?: number;
}

/**
 * Open the board with `?test&scene=board` at `speed` (default 20 with autopilot, the reach path)
 * and wait for hud.ready. Returns the page errors seen so far; the array keeps filling for the
 * rest of the page's life, so a spec can assert it is still empty at the end.
 */
export async function openBoard(page: Page, opts: OpenOptions = {}): Promise<{ errors: string[] }> {
  const speed = opts.speed ?? 20;
  const autopilot = opts.autopilot ?? true;
  const timeout = opts.timeout ?? 15_000;
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`/?test&scene=board&speed=${speed}${autopilot ? '&autopilot' : ''}${opts.params ?? ''}`);
  await expect
    .poll(async () => (await snap(page)).hud?.ready ?? false, {
      timeout,
      message: `openBoard: hud.ready never became true within ${timeout / 1000} s`,
    })
    .toBe(true);
  expect(errors, 'openBoard: page errors while booting').toEqual([]);
  return { errors };
}

/** Click the job card away if it is open, and wait until hud.jobCard.open is false. */
export async function dismissJobCard(page: Page, timeout = 5_000): Promise<void> {
  const h = await hud(page);
  if (!h.jobCard.open) return;
  await page.mouse.click(h.jobCard.x, h.jobCard.y);
  await expect
    .poll(async () => (await hud(page)).jobCard.open, {
      timeout,
      message: `dismissJobCard: hud.jobCard.open was still true ${timeout / 1000} s after the click`,
    })
    .toBe(false);
}

/** Turn the dial to `value` with its plus and minus buttons, then press SET. */
export async function setDial(page: Page, value: number): Promise<void> {
  let h = await hud(page);
  expect(h.dial.visible, 'setDial: hud.dial.visible').toBe(true);
  for (let guard = 0; h.dial.value !== value && guard < 200; guard++) {
    const p = h.dial.value < value ? h.dial.plus : h.dial.minus;
    await page.mouse.click(p.x, p.y);
    h = await hud(page);
  }
  expect(h.dial.value, `setDial: hud.dial.value never reached ${value}`).toBe(value);
  await page.mouse.click(h.dial.set.x, h.dial.set.y);
}

/** Save a screenshot to test-results/screens/<name>.png, where CI uploads it for review. */
export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test-results/screens/${name}.png` });
}

export type Moment = 'c1' | 'c3' | 'surge' | 'rescue' | 'midnight';

/** What the helper has seen on the way, for moments that are an event rather than a time. */
export interface Seen {
  /** Every distinct hud.surge.startsAt seen, in order (the C3 climb warns for 180, C4 for 300). */
  surgeStartsAt: number[];
  /** The surge warning with startsAt 300 was seen on some read. */
  surgeAt300: boolean;
  /** The C5 rescue scene (story.scriptId 'C5') was seen. */
  rescue: boolean;
}

interface MomentSpec {
  /** Default timeout in ms, counted from the reach call (the board already open). */
  timeout: number;
  /** The hook fields waited on, for the failure message. */
  waitsOn: string;
  done(s: Snap, seen: Seen): boolean;
}

// Timeouts: the measured floor at speed 20 with autopilot (docs/LIVE.md) plus a margin. surge and
// midnight are the tech-6 acceptance bounds (25 s and 50 s).
const MOMENTS: Record<Moment, MomentSpec> = {
  c1: {
    timeout: 10_000,
    waitsOn: 'hud.jobCard.open === false, hud.paused === false and hud.now >= 15',
    done: (s) => !!s.hud && !s.hud.jobCard.open && !s.hud.paused && s.hud.now >= 15,
  },
  c3: {
    timeout: 20_000,
    waitsOn: 'hud.now >= 180',
    done: (s) => !!s.hud && s.hud.now >= 180,
  },
  surge: {
    timeout: 25_000,
    waitsOn: 'hud.surge.startsAt === 300 (observed) and hud.now >= 300',
    done: (s, seen) => seen.surgeAt300 && !!s.hud && s.hud.now >= 300,
  },
  rescue: {
    timeout: 40_000,
    waitsOn: "story.scriptId === 'C5' (observed), then story.finished containing 'C5' and scene 'board'",
    done: (s, seen) =>
      seen.rescue && !!s.story && !s.story.active && s.story.finished.includes('C5') && s.scene === 'board',
  },
  midnight: {
    timeout: 50_000,
    waitsOn: 'hud.clock matching /^00:00/',
    done: (s) => !!s.hud && /^00:00/.test(s.hud.clock),
  },
};

export interface Reached {
  moment: Moment;
  /** The hook as read on the frame the moment was reached. */
  snap: Snap;
  hud: HudTestState;
  /** Wall-clock seconds the reach call took (not counting a board it had to open). */
  seconds: number;
  /** Story scenes the helper clicked through on the way, in order (for example ['C5']). */
  scenes: string[];
  /** Events seen on the way. */
  seen: Seen;
}

export interface ReachOptions {
  /** Override the moment's default timeout (ms). */
  timeout?: number;
}

/**
 * Run the night on to `moment` and return the hook as it was there.
 *
 * - If the page has not been opened yet, opens the board at speed 20 with autopilot first.
 * - Clicks the job card away, and clicks through every story scene that comes up on the way (the
 *   C5 rescue, a rewind), using Skip when it shows, since a scene holds the run.
 * - 'c1' the board is running at 15 s or later; 'c3' the clock is at 180 s or later; 'surge' the
 *   district surge warning was seen with startsAt 300 and the clock is at 300 or later; 'rescue'
 *   the C5 scene came up and has been clicked through, back on the board; 'midnight' the in-world
 *   clock reads 00:00.
 *
 * Throws, naming the hook fields it waited on and the last values read, if the moment is not
 * reached within the timeout.
 */
export async function reach(page: Page, moment: Moment, opts: ReachOptions = {}): Promise<Reached> {
  const spec = MOMENTS[moment];
  const timeout = opts.timeout ?? spec.timeout;
  if (page.url() === 'about:blank') await openBoard(page);
  const started = Date.now();
  const deadline = started + timeout;
  const seen: Seen = { surgeStartsAt: [], surgeAt300: false, rescue: false };
  const scenes: string[] = [];
  let lastClickAt = 0;
  for (;;) {
    const s = await snap(page);
    const surge = s.hud?.surge;
    if (surge && !seen.surgeStartsAt.includes(surge.startsAt)) seen.surgeStartsAt.push(surge.startsAt);
    if (surge?.startsAt === 300) seen.surgeAt300 = true;
    if (s.story?.scriptId === 'C5') seen.rescue = true;
    if (spec.done(s, seen)) {
      return { moment, snap: s, hud: s.hud!, seconds: (Date.now() - started) / 1000, scenes, seen };
    }
    if (Date.now() > deadline) {
      const h = s.hud;
      throw new Error(
        `reach('${moment}'): waited ${timeout / 1000} s for ${spec.waitsOn}; last read: ` +
          `hud.now=${h?.now ?? 'none'}, hud.clock=${h?.clock ?? 'none'}, ` +
          `hud.surge.startsAt=${h?.surge?.startsAt ?? 'none'}, hud.jobCard.open=${h?.jobCard.open ?? 'none'}, ` +
          `story.scriptId=${s.story?.scriptId ?? 'none'}, story.active=${s.story?.active ?? 'none'}, ` +
          `scene=${s.scene}, scenes clicked through=[${scenes.join(', ')}]`,
      );
    }
    const story = s.story;
    if (story?.active) {
      // A scene holds the run: click it on (Skip when shown), at most one click per 80 ms.
      if (story.scriptId && scenes[scenes.length - 1] !== story.scriptId) scenes.push(story.scriptId);
      const p = story.skip.visible ? story.skip : story.click;
      if (p && Date.now() - lastClickAt >= 80) {
        await page.mouse.click(p.x, p.y);
        lastClickAt = Date.now();
      } else {
        await page.waitForTimeout(20);
      }
    } else if (s.hud?.jobCard.open) {
      await page.mouse.click(s.hud.jobCard.x, s.hud.jobCard.y);
      await page.waitForTimeout(50);
    } else {
      await page.waitForTimeout(25);
    }
  }
}
