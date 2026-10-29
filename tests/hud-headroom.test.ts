import headroomViewSource from '../src/scenes/hud/HeadroomView.ts?raw';
import { bestPlay } from '../src/game/autopilot';
import { Bus } from '../src/game/bus';
import { readFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import { DeckView } from '../src/scenes/hud/DeckView';
import {
  RED_SOUND_GAP,
  emptyHeadroom,
  headroomColour,
  headroomLabel,
  headroomLayout,
  headroomPct,
  headroomState,
  litSegments,
  overBy,
  redSoundDue,
  stepHeadroom,
  wiredCapacityOf,
} from '../src/scenes/hud/headroom';
import { dismissJobCard, openJobCard } from '../src/scenes/hud/jobCard';
import {
  DEMAND_SCALE_MAX,
  HEADROOM_AMBER_FROM,
  HEADROOM_EXIT,
  HEADROOM_RED_OVER,
  HEADROOM_SEGMENTS,
} from '../src/scenes/hud/thresholds';
import { ZONES, inside } from '../src/scenes/live/layout';
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

const C = BROWNOUT.challenges;
const ONE_BOX = BROWNOUT.server.capacity;

describe('thresholds', () => {
  it('shares the numbers the gauge, the channel, the scope, the bar and the cam use', () => {
    expect(HEADROOM_AMBER_FROM).toBe(0.7);
    expect(HEADROOM_EXIT).toBe(0.6);
    expect(HEADROOM_RED_OVER).toBe(1.0);
    expect(DEMAND_SCALE_MAX).toBe(400);
    expect(HEADROOM_SEGMENTS).toBe(30);
  });
});

describe('room left', () => {
  it('is round((1 - demand / wiredCapacity) x 100), with nothing to say when nothing is wired', () => {
    expect(headroomPct(90, 120)).toBe(25);
    expect(headroomPct(30, 60)).toBe(50);
    expect(headroomPct(0, 60)).toBe(100);
    expect(headroomPct(250, 120)).toBe(-108);
    expect(headroomPct(30, 0)).toBeNull();
  });

  it('is green under 0.7 load, amber from 0.7 to 1.0, red over 1.0', () => {
    expect(headroomColour(0)).toBe('green');
    expect(headroomColour(0.69)).toBe('green');
    expect(headroomColour(0.7)).toBe('amber');
    expect(headroomColour(1.0)).toBe('amber');
    expect(headroomColour(1.01)).toBe('red');
    expect(headroomColour(Infinity)).toBe('red');
  });

  it('lights round(clamp(1 - demand / wired, 0, 1) x 30) segments, draining from the right as load grows', () => {
    expect(litSegments(0, 120)).toBe(30);
    expect(litSegments(90, 120)).toBe(Math.round(0.25 * 30));
    expect(litSegments(84, 120)).toBe(9); // 30% left: the marker
    expect(litSegments(120, 120)).toBe(0);
    expect(litSegments(250, 120)).toBe(0);
    expect(litSegments(30, 0)).toBe(0);
    let last = HEADROOM_SEGMENTS;
    for (let d = 0; d <= 130; d += 5) {
      const lit = litSegments(d, 120);
      expect(lit).toBeLessThanOrEqual(last);
      expect(lit).toBe(Math.round(Math.min(1, Math.max(0, 1 - d / 120)) * 30));
      last = lit;
    }
    expect(headroomLayout(ZONES.deck).marker).toBe(9);
  });

  it('is labelled HEADROOM, the real term, with the absolute numbers', () => {
    expect(headroomLabel(90, 120)).toBe('HEADROOM 25% · 90 of 120');
    expect(headroomLabel(250, 120)).toBe('HEADROOM · OVER +130 req/s');
    expect(headroomLabel(30, 0)).toBe('HEADROOM · NO SERVER');
    expect(overBy(120.2, 120)).toBe(1);
    expect(overBy(120, 120)).toBe(0);
    for (const [d, w] of [
      [90, 120],
      [250, 120],
      [30, 0],
      [0, 60],
    ]) {
      expect(headroomLabel(d, w)).toMatch(/^HEADROOM/);
    }
  });
});

describe('wired capacity', () => {
  it('ignores racked-but-unwired and offline servers', () => {
    const r = new Run();
    r.now = C.c1;
    for (const slot of SERVER_SLOTS.slice(0, 3)) expect(r.placeServer(slot).ok).toBe(true);
    const [a, b, c] = r.session.board.parts.filter((p) => p.kind === 'server').map((p) => p.id);
    // a: gateway -> a -> database. b: racked, with a way out but nothing feeding it. c: wired
    // through, but offline. (The wires are laid by hand: the rules let the gateway feed one box.)
    const board = {
      parts: r.session.board.parts,
      wires: [
        { from: 'gateway', to: a },
        { from: a, to: 'database' },
        { from: b, to: 'database' },
        { from: 'gateway', to: c },
        { from: c, to: 'database' },
      ],
    };
    expect(wiredCapacityOf(board, [])).toBe(2 * ONE_BOX);
    expect(wiredCapacityOf(board, [c])).toBe(ONE_BOX);
    expect(wiredCapacityOf(board, [a, c])).toBe(0);
    // Every live server counts towards capacity, wired or not; the bar measures only the wired ones.
    const st = headroomState(
      { demand: 30, capacity: 3 * ONE_BOX, wiredCapacity: wiredCapacityOf(board, [c]) },
      0,
    );
    expect(st.wiredCapacity).toBe(ONE_BOX);
    expect(st.capacity).toBe(3 * ONE_BOX);
    expect(st.pct).toBe(50);
    // On the run's own board: one box wired through and booted counts; the racked ones don't.
    expect(r.connect('gateway', a).ok).toBe(true);
    expect(r.connect(a, 'database').ok).toBe(true);
    r.now = C.c1 + BROWNOUT.server.bootSeconds + 1;
    const f = readFrame(r);
    expect(f.wiredCapacity).toBe(ONE_BOX);
    expect(wiredCapacityOf(r.session.board, f.offline)).toBe(ONE_BOX);
    expect(f.capacity).toBe(3 * ONE_BOX);
  });
});

describe('the red state', () => {
  it('records redSince on entering red, keeps it while red, clears it after, restarts on a rewind', () => {
    const st = emptyHeadroom();
    expect(stepHeadroom(st, { demand: 90, capacity: 120, wiredCapacity: 120 }, 100)).toBe(false);
    expect(st.state).toBe('amber');
    expect(st.redSince).toBeNull();
    expect(stepHeadroom(st, { demand: 250, capacity: 120, wiredCapacity: 120 }, 300.2)).toBe(true);
    expect(st).toMatchObject({ state: 'red', redSince: 300.2, lit: 0, pct: -108 });
    expect(stepHeadroom(st, { demand: 250, capacity: 120, wiredCapacity: 120 }, 305)).toBe(false);
    expect(st.redSince).toBe(300.2);
    // A rewind takes the clock back before it went red: it went red again, now.
    expect(stepHeadroom(st, { demand: 250, capacity: 120, wiredCapacity: 120 }, 290)).toBe(true);
    expect(st.redSince).toBe(290);
    expect(stepHeadroom(st, { demand: 60, capacity: 180, wiredCapacity: 180 }, 320)).toBe(false);
    expect(st).toMatchObject({ state: 'green', redSince: null });
  });

  it('plays the red sound at most once per 10 s of HUD time', () => {
    expect(RED_SOUND_GAP).toBe(10);
    expect(redSoundDue(5, null)).toBe(true);
    expect(redSoundDue(12, 5)).toBe(false);
    expect(redSoundDue(15, 5)).toBe(true);
    expect(redSoundDue(1, 5)).toBe(true); // a new run's clock
  });

  it('is red within one sim second of the district surge landing, at speed 5 with best play', () => {
    const r = new Run(5);
    r.autopilot = bestPlay;
    openJobCard(r);
    dismissJobCard(r);
    const st = emptyHeadroom();
    let firstRedAfterSurge: number | null = null;
    for (let i = 0; i < 20_000 && r.now < C.c4 + 1.5; i++) {
      r.tick(1 / 60);
      stepHeadroom(st, readFrame(r), r.now);
      if (r.now >= C.c4 && st.state === 'red' && firstRedAfterSurge === null) firstRedAfterSurge = r.now;
    }
    expect(r.now).toBeGreaterThanOrEqual(C.c4 + 1);
    expect(firstRedAfterSurge).not.toBeNull();
    expect(firstRedAfterSurge!).toBeLessThanOrEqual(C.c4 + 1);
    expect(st.redSince!).toBeLessThanOrEqual(C.c4 + 1);
  });
});

describe('the bar draws now only', () => {
  it('has no reference to the scope’s series or its past', () => {
    expect(headroomViewSource).not.toMatch(/\bring\b|chartRing|ChartRing|ChartView|history|series\[/i);
  });

  it('sits in the deck left of the keys', () => {
    const L = headroomLayout(ZONES.deck);
    expect(inside(L.plate, ZONES.deck)).toBe(true);
    expect(L.plate.x + L.plate.w).toBeLessThanOrEqual(1232); // the first key's left edge
    const s = L.segments;
    expect(s.x).toBe(612);
    expect(s.x + (s.count - 1) * s.pitch + s.w).toBeLessThanOrEqual(1225);
    expect(L.icon.x).toBeGreaterThanOrEqual(470);
  });
});

// ---- the deck view against a stub scene ----

function stubScene() {
  const fills: { x: number; color: number }[] = [];
  let color = 0;
  const texts: { text: string }[] = [];
  const chain = (extra: Record<string, unknown> = {}): unknown => {
    const o: unknown = new Proxy(extra, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        return () => o;
      },
    });
    return o;
  };
  const scene = {
    add: {
      graphics: () => {
        const g: Record<string, unknown> = {};
        g.fillStyle = (c: number) => ((color = c), proxy);
        g.fillRect = (x: number) => (fills.push({ x, color }), proxy);
        g.clear = () => ((fills.length = 0), proxy);
        const proxy = chain(g);
        return proxy;
      },
      text: () => {
        const rec = { text: '' };
        texts.push(rec);
        const t: Record<string, unknown> = {};
        t.setText = (s: string) => ((rec.text = s), proxy);
        Object.defineProperty(t, 'text', { get: () => rec.text });
        const proxy = chain(t);
        return proxy;
      },
    },
  };
  return { scene, fills, texts };
}

describe('DeckView', () => {
  it('draws 30 segments only when they change and mirrors hud.headroom', () => {
    const { scene, fills, texts } = stubScene();
    const view = new DeckView();
    const bus = new Bus();
    view.create(scene as never, { scene: null as never, bus, rect: ZONES.deck, flags: { lite: true } });
    const r = new Run();
    r.now = C.c1;
    expect(r.placeServer(SERVER_SLOTS[0]).ok).toBe(true);
    const id = r.session.board.parts.find((p) => p.kind === 'server')!.id;
    r.connect('gateway', id);
    r.connect(id, 'database');
    r.now = C.c1 + BROWNOUT.server.bootSeconds + 1;
    const f = readFrame(r);
    view.update(f, { now: 1, dt: 0.016 });
    expect(view.headroom.draws).toBe(1);
    // The plate's own fill is cleared by the first segment draw's clear in this stub; count segments.
    expect(fills.filter((x) => x.x >= 612).length).toBe(HEADROOM_SEGMENTS);
    view.update(f, { now: 1.02, dt: 0.016 });
    view.update(f, { now: 1.04, dt: 0.016 });
    expect(view.headroom.draws).toBe(1);

    const hud = hudSection({} as HudTestState) as unknown as { headroom: Record<string, unknown> };
    expect(hud.headroom).toMatchObject({
      wiredCapacity: f.wiredCapacity,
      capacity: f.capacity,
      pct: headroomPct(f.demand, f.wiredCapacity),
      state: headroomColour(f.demand / f.wiredCapacity),
      lit: litSegments(f.demand, f.wiredCapacity),
    });
    expect(texts[0].text).toBe(headroomLabel(f.demand, f.wiredCapacity));
    expect(hud.headroom.label).toBe(texts[0].text);
    expect(texts[0].text.startsWith('HEADROOM')).toBe(true);
    view.shutdown();
  });
});
