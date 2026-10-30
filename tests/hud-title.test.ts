import { twelveHour } from '../src/scenes/hud/format';
import { Bus } from '../src/game/bus';
import { readFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import { ClockView, TitleView } from '../src/scenes/hud/TitleView';
import {
  CLOCK_RIGHT_LIMIT,
  COUNTDOWN_RED_FROM,
  LIVE_WORDS,
  clockLayout,
  countdownRed,
  creditsRed,
  liveDotAlpha,
  liveState,
  shownCredits,
  shownTrust,
  titleLayout,
  titleState,
  trustRed,
  watchingFrom,
  watchingText,
  CREDIT_POP_MIN,
  TIP_ALERT,
  creditPop,
  tipAlertAt,
  tipAlertOf,
} from '../src/scenes/hud/title';
import { VIEWER_HANDLES } from '../src/scenes/hud/chat';
import { line } from '../src/strings';
import { dismissJobCard, openJobCard } from '../src/scenes/hud/jobCard';
import { type Rect, ZONES, inside } from '../src/scenes/live/layout';
import type { LiveHost } from '../src/scenes/live/view';
import { BROWNOUT } from '../src/sim/brownout';
import { SERVER_SLOTS } from '../src/sim/tick';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';

// The hook's sections as the views provide them, read back here without a window.
const sections = vi.hoisted(() => new Map<string, () => unknown>());
vi.mock('../src/testHook', async (actual) => ({
  ...(await actual<typeof import('../src/testHook')>()),
  provideTestState: (key: string, read: () => unknown) => {
    sections.set(key, read);
  },
}));
const getTestState = (): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, read] of sections) out[k] = read();
  // The views provide hud.* through provideHudSection (no HudScene here): the section over an empty base.
  out.hud = hudSection({} as HudTestState);
  return out;
};

// gauges-1: the title cluster's rules (titleState: the LIVE dot and WATCHING), the chips and the
// clock, and where the pieces sit. The zones' no-overlap proof is tests/live-layout.test.ts's.

const C = BROWNOUT.challenges;

/** Build a server wired gateway -> server -> database (the C1 first build). */
function firstBuild(r: Run): void {
  const ok = r.placeServer(SERVER_SLOTS[0]);
  if (!ok.ok) throw new Error('placeServer failed');
  const parts = r.session.board.parts;
  const id = parts[parts.length - 1].id;
  expect(r.connect('gateway', id).ok).toBe(true);
  expect(r.connect(id, 'database').ok).toBe(true);
}

describe('the LIVE dot (titleState.live)', () => {
  const base = { paused: false, waitingForFirstBuild: false, waitingForCrewBuild: false };

  it('waits while the clock waits for a build, holds while held, otherwise is live', () => {
    expect(liveState(base)).toBe('live');
    expect(liveState({ ...base, waitingForFirstBuild: true })).toBe('waiting');
    expect(liveState({ ...base, waitingForCrewBuild: true })).toBe('waiting');
    expect(liveState({ ...base, paused: true })).toBe('held');
    expect(liveState({ ...base, paused: true, waitingForFirstBuild: true })).toBe('waiting');
  });

  it("is 'waiting' while run().waitingForFirstBuild and 'live' after the first build", () => {
    const r = new Run();
    openJobCard(r);
    dismissJobCard(r);
    expect(r.waitingForFirstBuild).toBe(true);
    expect(titleState(readFrame(r), null).live).toBe('waiting');
    firstBuild(r);
    expect(r.waitingForFirstBuild).toBe(false);
    expect(titleState(readFrame(r), null).live).toBe('live');
    r.hold('pause');
    expect(titleState(readFrame(r), null).live).toBe('held');
  });

  it('says it in the crew’s words and pulses only while live, steady under reduce flicker', () => {
    expect(LIVE_WORDS).toEqual({ live: 'LIVE', waiting: 'waiting for your build', held: 'HELD' });
    const samples = [0, 0.3, 0.6, 0.9, 1.2].map((t) => liveDotAlpha('live', t, false));
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.3);
    for (const t of [0, 0.4, 0.8]) {
      expect(liveDotAlpha('live', t, true)).toBe(1);
      expect(liveDotAlpha('waiting', t, false)).toBe(1);
      expect(liveDotAlpha('held', t, false)).toBe(0.4);
    }
  });
});

describe('WATCHING (titleState.watching)', () => {
  it('has no number before the first audience event, then the value it carried', () => {
    const f = { paused: false, waitingForFirstBuild: false, waitingForCrewBuild: false };
    expect(titleState(f, null)).toEqual({ live: 'live', watching: null });
    expect(watchingText(null)).toBe('WATCHING');
    for (const n of [0, 1, 2, 3, 4]) {
      expect(watchingFrom({ watching: n })).toBe(n);
      expect(watchingText(n)).toBe(`WATCHING ${n}`);
      expect(titleState(f, n).watching).toBe(n);
    }
    expect(watchingFrom({ watching: -1 })).toBe(0);
    expect(watchingFrom({ watching: 2.6 })).toBe(3);
  });
});

describe('the chips and the clock', () => {
  it('turns trust red under 30 and credits red below zero, on whole units', () => {
    expect(shownTrust(29.6)).toBe(30);
    expect(trustRed(shownTrust(29.6))).toBe(false);
    expect(trustRed(shownTrust(29.4))).toBe(true);
    expect(shownCredits(-0.5)).toBe(-1);
    expect(creditsRed(shownCredits(-0.5))).toBe(true);
    expect(creditsRed(shownCredits(0.9))).toBe(false);
  });

  it('turns the countdown red from 23:59:30', () => {
    const r = new Run();
    expect(r.clock(COUNTDOWN_RED_FROM)).toBe('23:59:30');
    expect(countdownRed(COUNTDOWN_RED_FROM - 0.1)).toBe(false);
    expect(countdownRed(COUNTDOWN_RED_FROM)).toBe(true);
    expect(countdownRed(C.c7)).toBe(true);
  });
});

/** Every rect and point the layouts return, as rects. */
function rectsOf(layout: object): Rect[] {
  const out: Rect[] = [];
  for (const v of Object.values(layout) as Record<string, number>[]) {
    if ('w' in v) out.push(v as unknown as Rect);
    else if ('r' in v) out.push({ x: v.x - v.r, y: v.y - v.r, w: 2 * v.r, h: 2 * v.r });
    else if ('size' in v) out.push({ x: v.x - v.size / 2, y: v.y - v.size / 2, w: v.size, h: v.size });
    else out.push({ x: v.x, y: v.y, w: 0, h: 0 });
  }
  return out;
}

describe('where the title and the clock sit', () => {
  it('keeps every title piece inside ZONES.title', () => {
    for (const r of rectsOf(titleLayout(ZONES.title))) expect(inside(r, ZONES.title)).toBe(true);
  });

  it('keeps every clock piece inside ZONES.clock and left of x 1800 (the pause button is the overlay’s)', () => {
    expect(CLOCK_RIGHT_LIMIT).toBe(1800);
    for (const r of rectsOf(clockLayout(ZONES.clock))) {
      expect(inside(r, ZONES.clock)).toBe(true);
      expect(r.x + r.w).toBeLessThanOrEqual(1800);
    }
    // The clock's 40 px text (8 characters) ends before the icon; the countdown runs under it.
    const L = clockLayout(ZONES.clock);
    expect(L.clock.x + 8 * 25).toBeLessThan(L.icon.x - L.icon.size / 2);
    expect(L.countdown.y).toBeGreaterThanOrEqual(L.icon.y + L.icon.size / 2);
    expect(L.countdown.x + 16 * 12.5).toBeLessThan(1800);
  });
});

// ---- the views, against a stub scene ----

interface Made {
  kind: string;
  x: number;
  y: number;
  text: string;
  depth: number;
  alpha: number;
  color: string | null;
  destroyed: boolean;
}

/** A scene whose factories record what was made; every other method chains. */
function stubScene() {
  const made: Made[] = [];
  const object = (kind: string, x = 0, y = 0, text = ''): unknown => {
    const rec: Made = { kind, x, y, text, depth: 0, alpha: 1, color: null, destroyed: false };
    made.push(rec);
    const o: unknown = new Proxy(
      { width: 100, height: 100 },
      {
        get(target, prop) {
          if (prop in target) return (target as Record<string, unknown>)[prop as string];
          if (prop === 'setText') return (t: string) => ((rec.text = t), o);
          if (prop === 'setDepth') return (d: number) => ((rec.depth = d), o);
          if (prop === 'setAlpha') return (a: number) => ((rec.alpha = a), o);
          if (prop === 'setColor') return (c: string) => ((rec.color = c), o);
          if (prop === 'destroy') return () => ((rec.destroyed = true), undefined);
          if (prop === 'getBounds') return () => ({ right: rec.x + 10 });
          if (prop === 'text') return rec.text;
          return () => o;
        },
      },
    );
    return o;
  };
  const scene = {
    add: {
      graphics: () => object('Graphics'),
      image: (x: number, y: number) => object('Image', x, y),
      circle: (x: number, y: number) => object('Arc', x, y),
      text: (x: number, y: number, text: string) => object('Text', x, y, text),
    },
    textures: { exists: () => true },
    load: { image: () => undefined },
  };
  return { scene, made };
}

describe('TitleView and ClockView', () => {
  const host = (bus: Bus, rect: Rect): LiveHost => ({
    scene: null as never,
    bus,
    rect,
    flags: { lite: true },
  });

  it('draw over the zone, show WATCHING with no number until the bus says, and mirror hud.title', () => {
    const { scene, made } = stubScene();
    const bus = new Bus();
    const title = new TitleView();
    const clock = new ClockView();
    title.create(scene as never, host(bus, ZONES.title));
    clock.create(scene as never, host(bus, ZONES.clock));
    const texts = made.filter((m) => m.kind === 'Text');
    expect(texts.length).toBe(title.budget.texts + clock.budget.texts);
    expect(made.length).toBe(title.budget.objects + clock.budget.objects);
    expect(made.every((m) => m.depth > 0)).toBe(true);

    const r = new Run();
    openJobCard(r);
    dismissJobCard(r);
    const clk = { now: 1, dt: 0.016 };
    title.update(readFrame(r), clk);
    clock.update(readFrame(r));
    expect(texts.some((t) => t.text === 'WATCHING')).toBe(true);
    expect(texts.some((t) => t.text === 'waiting for your build')).toBe(true);
    // The title shows the run's clock in 12-hour time (11:54:40 PM).
    expect(texts.some((t) => t.text === twelveHour(r.clock()))).toBe(true);
    expect(texts.some((t) => t.text === 'midnight in 5:20')).toBe(true);

    const hud = getTestState().hud as unknown as { title: { live: string; watching: number | null } };
    expect(hud.title.live).toBe('waiting');
    expect(hud.title.watching).toBeNull();

    bus.emit('audience', { watching: 3 });
    firstBuild(r);
    title.update(readFrame(r), clk);
    expect(texts.some((t) => t.text === 'WATCHING 3')).toBe(true);
    expect(texts.some((t) => t.text === 'LIVE')).toBe(true);
    const after = getTestState().hud as unknown as {
      title: { live: string; watching: number | null; clockRight: number | null };
    };
    expect(after.title).toMatchObject({ live: 'live', watching: 3 });
    expect(after.title.clockRight).toBeLessThanOrEqual(1800);

    title.shutdown();
    clock.shutdown();
    expect(made.every((m) => m.destroyed)).toBe(true);
    // Unsubscribed: a late audience event changes nothing.
    bus.emit('audience', { watching: 1 });
    expect(title.watching).toBe(3);
  });
});

// Tech follow-up 4: the title's face is the round avatar, and the dot reads held while a story scene
// or the pause menu pauses the HUD scene (no update runs then, so the view hears the scene's events).
describe('TitleView: round avatar and held under a paused HUD', () => {
  const host = (bus: Bus): LiveHost => ({
    scene: null as never,
    bus,
    rect: ZONES.title,
    flags: { lite: true },
  });

  /** The stub scene with a scene event emitter, as Phaser's scene.events. */
  function pausable() {
    const { scene, made } = stubScene();
    const handlers = new Map<string, Set<() => void>>();
    const events = {
      on(e: string, fn: () => void) {
        if (!handlers.has(e)) handlers.set(e, new Set());
        handlers.get(e)!.add(fn);
      },
      off(e: string, fn: () => void) {
        handlers.get(e)?.delete(fn);
      },
      emit(e: string) {
        for (const fn of handlers.get(e) ?? []) fn();
      },
      count: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
    };
    return { scene: { ...scene, events }, made, events };
  }

  const title = (): { live: string; avatar?: string | null; scenePaused?: boolean } =>
    (
      getTestState().hud as unknown as {
        title: { live: string; avatar?: string | null; scenePaused?: boolean };
      }
    ).title;

  it('draws the round avatar baked at the ring’s diameter, inside the same budget', () => {
    const { scene, made } = pausable();
    const view = new TitleView();
    view.create(scene as never, host(new Bus()));
    const r = titleLayout(ZONES.title).avatar.r;
    expect(title().avatar).toBe(`avatar:hud/live/avatar-luxnet@${2 * r}`);
    expect(made.length).toBe(view.budget.objects);
    // The face, the two chip icons, and the tip alert's coin (Rolando, 30 Oct 2026: viewer tips).
    expect(made.filter((m) => m.kind === 'Image').length).toBe(4);
    view.shutdown();
  });

  it('reads held at once when the HUD scene pauses, and live again after the resume', () => {
    const { scene, made, events } = pausable();
    const view = new TitleView();
    view.create(scene as never, host(new Bus()));
    const words = made.filter((m) => m.kind === 'Text');
    const r = new Run();
    openJobCard(r);
    dismissJobCard(r);
    firstBuild(r);
    const clk = { now: 1, dt: 0.016 };
    view.update(readFrame(r), clk);
    expect(title().live).toBe('live');
    expect(words.some((t) => t.text === 'LIVE')).toBe(true);

    // A story scene or the pause menu: the run is held and the HUD scene paused, with no update.
    events.emit('pause');
    expect(title()).toMatchObject({ live: 'held', scenePaused: true });
    expect(words.some((t) => t.text === 'HELD')).toBe(true);
    expect(words.some((t) => t.text === 'LIVE')).toBe(false);

    // An update that slips in while paused still says held.
    view.update(readFrame(r), clk);
    expect(title().live).toBe('held');

    events.emit('resume');
    view.update(readFrame(r), clk);
    expect(title()).toMatchObject({ live: 'live', scenePaused: false });
    expect(words.some((t) => t.text === 'LIVE')).toBe(true);

    view.shutdown();
    expect(events.count()).toBe(0);
  });
});

describe('viewer tips on the title (Rolando, 30 Oct 2026: donations like on Twitch)', () => {
  it('a tip alert names a regular, the amount and a message; a bail-out says you got this', () => {
    const a = tipAlertOf({ n: 0, amount: 25, kind: 'trickle' });
    expect(VIEWER_HANDLES).toContain(a.who);
    expect(a.line).toBe(`${a.who} tipped 💰 25!`);
    expect(a.message.length).toBeGreaterThan(0);
    expect(tipAlertOf({ n: 3, amount: 90, kind: 'help' }).message).toBe(line('C1.tip.07'));
    // Different tips, different regulars.
    const who = new Set([0, 1, 2, 3, 4, 5].map((n) => tipAlertOf({ n, amount: 5, kind: 'trickle' }).who));
    expect(who.size).toBeGreaterThan(3);
  });

  it('the credits pop shows tips, buys and refunds, never the drip of upkeep', () => {
    expect(creditPop(25)).toBe('+25');
    expect(creditPop(-80)).toBe('-80');
    expect(creditPop(-0.4)).toBeNull();
    expect(creditPop(CREDIT_POP_MIN - 1)).toBeNull();
  });

  it('the alert slides in, holds 3 s and fades out', () => {
    expect(tipAlertAt(0)).toEqual({ alpha: 0, dy: -24 });
    expect(tipAlertAt(1)).toEqual({ alpha: 1, dy: 0 });
    expect(tipAlertAt(TIP_ALERT.inSeconds + TIP_ALERT.holdSeconds + TIP_ALERT.outSeconds)).toBeNull();
    expect(tipAlertAt(-1)).toBeNull();
  });
});
