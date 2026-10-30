import gaugeSource from '../src/scenes/hud/gauge.ts?raw';
import gaugeViewSource from '../src/scenes/hud/GaugeView.ts?raw';
import { bestPlay } from '../src/game/autopilot';
import { Bus } from '../src/game/bus';
import { type Frame, readFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import { DeckView } from '../src/scenes/hud/DeckView';
import { GaugeView } from '../src/scenes/hud/GaugeView';
import {
  GAUGE_MAX,
  GAUGE_TICKS,
  GAUGE_TICK_STEP,
  NEEDLE_EASE_SECONDS,
  arcPoint,
  bootingCapacity,
  easeNeedle,
  emptyGauge,
  emptyGaugeMemo,
  gaugeAngle,
  gaugeLayout,
  gaugeState,
  gaugeStrip,
  stepGauge,
} from '../src/scenes/hud/gauge';
import { dismissJobCard, openJobCard } from '../src/scenes/hud/jobCard';
import { LABELS } from '../src/scenes/hud/labels';
import { DEMAND_SCALE_MAX } from '../src/scenes/hud/thresholds';
import { ZONES } from '../src/scenes/live/layout';
import { createViews } from '../src/scenes/live/registry';
import { withinBudget } from '../src/scenes/live/view';
import { BROWNOUT } from '../src/sim/brownout';
import { SERVER_SLOTS } from '../src/sim/tick';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';

// gauges-5: the COMING /s gauge in ZONES.gauge. The pure rules (gauge.ts) against hand-made and
// real frames, and GaugeView against a stub scene, read back through the hook without a window.

const sections = vi.hoisted(() => new Map<string, () => unknown>());
vi.mock('../src/testHook', async (actual) => ({
  ...(await actual<typeof import('../src/testHook')>()),
  provideTestState: (key: string, read: () => unknown) => {
    sections.set(key, read);
  },
}));

const C = BROWNOUT.challenges;
const ONE_BOX = BROWNOUT.server.capacity;

/** A frame with only what the gauge reads, the rest from a fresh run. */
function frameWith(over: Partial<Frame>): Frame {
  const base = readFrame(new Run());
  return { ...base, ...over };
}

/** A run with one server wired gateway -> server -> database at C1, booted. */
function wiredRun(): { r: Run; id: string } {
  const r = new Run();
  r.now = C.c1;
  expect(r.placeServer(SERVER_SLOTS[0]).ok).toBe(true);
  const id = r.session.board.parts.find((p) => p.kind === 'server')!.id;
  expect(r.connect('gateway', id).ok).toBe(true);
  expect(r.connect(id, 'database').ok).toBe(true);
  return { r, id };
}

describe('the scale', () => {
  it('runs a fixed 0..400 with ticks every 100', () => {
    expect(GAUGE_MAX).toBe(400);
    expect(GAUGE_MAX).toBe(DEMAND_SCALE_MAX);
    expect(GAUGE_TICK_STEP).toBe(100);
    expect(GAUGE_TICKS).toEqual([0, 100, 200, 300, 400]);
    expect(emptyGauge().max).toBe(400);
  });

  it('puts the needle at an angle linear in demand, clamped to the arc', () => {
    expect(gaugeAngle(0)).toBeCloseTo(Math.PI, 10);
    expect(gaugeAngle(200)).toBeCloseTo(1.5 * Math.PI, 10);
    expect(gaugeAngle(400)).toBeCloseTo(2 * Math.PI, 10);
    const per = (gaugeAngle(400) - gaugeAngle(0)) / 400;
    for (const v of [0, 1, 30, 60, 90, 120, 150, 250, 375, 399.5, 400]) {
      expect(gaugeAngle(v)).toBeCloseTo(Math.PI + per * v, 10);
    }
    // Equal steps in demand are equal steps in angle.
    expect(gaugeAngle(130) - gaugeAngle(30)).toBeCloseTo(gaugeAngle(350) - gaugeAngle(250), 10);
    expect(gaugeAngle(-20)).toBe(gaugeAngle(0));
    expect(gaugeAngle(900)).toBe(gaugeAngle(400));
  });

  it('eases the needle with a 0.18 s time constant and settles exactly on demand', () => {
    expect(NEEDLE_EASE_SECONDS).toBe(0.18);
    expect(easeNeedle(0, 100, 0.18)).toBeCloseTo(100 * (1 - Math.exp(-1)), 6);
    expect(easeNeedle(50, 100, 0)).toBe(50);
    expect(easeNeedle(Number.NaN, 30, 0.016)).toBe(30);
    let n = 0;
    for (let i = 0; i < 60; i++) n = easeNeedle(n, 250, 5 / 60);
    expect(n).toBe(250);
  });
});

describe('dropping', () => {
  it('shows gauge.dropped > 0 exactly when flow.dropped > 0.5', () => {
    for (const flowDropped of [0, 0.2, 0.5, 0.500001, 0.51, 1, 30, 190]) {
      const st = gaugeState(
        frameWith({ demand: 250, served: 250 - flowDropped, dropped: flowDropped, wiredCapacity: 60 }),
      );
      expect(st.dropped > 0, `flow.dropped ${flowDropped}`).toBe(flowDropped > 0.5);
      if (flowDropped > 0.5) expect(st.dropped).toBe(flowDropped);
      else expect(st.dropped).toBe(0);
    }
  });

  it('says dropping on the sub-line while calls drop, capacity otherwise', () => {
    expect(gaugeState(frameWith({ demand: 30, served: 30, dropped: 0, wiredCapacity: 60 })).sub).toBe(
      'capacity 60 req/s',
    );
    expect(gaugeState(frameWith({ demand: 250, served: 60, dropped: 190, wiredCapacity: 60 })).sub).toBe(
      'dropping 190 req/s',
    );
    expect(gaugeState(frameWith({ demand: 30, served: 0, dropped: 30, wiredCapacity: 0 })).sub).toBe(
      'no server yet',
    );
  });
});

describe('the strip', () => {
  it('reads NO CAPACITY YET before the first build and OVER BY (demand - capacity) when over', () => {
    const r = new Run();
    r.now = C.c1;
    const f = readFrame(r);
    expect(f.waitingForFirstBuild).toBe(true);
    expect(f.wiredCapacity).toBe(0);
    expect(gaugeState(f).strip).toBe('NO CAPACITY YET');
    expect(gaugeState(f).strip).toBe(LABELS.gauge.noRoom);

    expect(gaugeStrip(250, 120)).toBe('OVER BY 130/s');
    expect(gaugeStrip(250, 120)).toBe(`${LABELS.gauge.overBy} ${250 - 120}/s`);
    expect(gaugeStrip(90, 120)).toBeNull();
    expect(gaugeStrip(120, 120)).toBeNull();
    const over = gaugeState(frameWith({ demand: 250, served: 120, dropped: 130, wiredCapacity: 120 }));
    expect(over.strip).toBe('OVER BY 130/s');
    const under = gaugeState(frameWith({ demand: 90, served: 90, dropped: 0, wiredCapacity: 120 }));
    expect(under.strip).toBeNull();
  });

  it('rebuilds the words only when their rounded numbers change', () => {
    const st = emptyGauge();
    const memo = emptyGaugeMemo();
    stepGauge(st, memo, frameWith({ demand: 250, served: 120, dropped: 130, wiredCapacity: 120 }), 0.016);
    const strip = st.strip;
    const sub = st.sub;
    stepGauge(st, memo, frameWith({ demand: 250.2, served: 120, dropped: 130.2, wiredCapacity: 120 }), 0.016);
    expect(st.strip).toBe(strip);
    expect(st.sub).toBe(sub);
    stepGauge(st, memo, frameWith({ demand: 260, served: 120, dropped: 140, wiredCapacity: 120 }), 0.016);
    expect(st.strip).toBe('OVER BY 140/s');
  });
});

describe('the ROOM band', () => {
  it('runs to the wired capacity, never to the racked capacity', () => {
    const { r } = wiredRun();
    expect(r.placeServer(SERVER_SLOTS[1]).ok).toBe(true);
    r.now = C.c1 + BROWNOUT.server.bootSeconds + 1;
    const f = readFrame(r);
    expect(f.capacity).toBe(2 * ONE_BOX);
    expect(f.wiredCapacity).toBe(ONE_BOX);
    const st = gaugeState(f);
    expect(st.capacity).toBe(f.wiredCapacity);
    expect(st.capacity).toBe(60);
    expect(st.booting).toBe(0);
    expect(st.sub).toBe('capacity 60 req/s');
  });

  it('extends dashed by the wired boxes still booting, and not by unwired ones', () => {
    const { r, id } = wiredRun();
    expect(r.placeServer(SERVER_SLOTS[1]).ok).toBe(true);
    // Both boxes boot for 3 s; only the wired one will add room.
    const f = readFrame(r);
    expect(f.offline).toContain(id);
    expect(f.wiredCapacity).toBe(0);
    expect(bootingCapacity(f.parts, f.wires, f.offline, f.offlineUntil, f.now)).toBe(ONE_BOX);
    expect(gaugeState(f).booting).toBe(ONE_BOX);
    // Once booted the extension becomes the band.
    r.now = C.c1 + BROWNOUT.server.bootSeconds + 1;
    const g = gaugeState(readFrame(r));
    expect(g.booting).toBe(0);
    expect(g.capacity).toBe(ONE_BOX);
  });
});

describe('the needle at speed 5 with best play', () => {
  it('sits within 1 req/s of demand on every settled frame', () => {
    const r = new Run(5);
    r.autopilot = bestPlay;
    openJobCard(r);
    dismissJobCard(r);
    const st = emptyGauge();
    const memo = emptyGaugeMemo();
    const dt = 5 / 60;
    let lastDemand = Number.NaN;
    let steady = 0;
    let checked = 0;
    for (let i = 0; i < 30_000 && r.now < C.c4 + 30; i++) {
      r.tick(1 / 60);
      const f = readFrame(r);
      stepGauge(st, memo, f, r.paused ? 0 : dt);
      steady = Math.abs(f.demand - lastDemand) < 0.01 ? steady + 1 : 0;
      lastDemand = f.demand;
      // Settled: demand has held for a quarter of a sim second.
      if (steady >= 3) {
        expect(Math.abs(st.needle - f.demand), `now ${r.now}`).toBeLessThanOrEqual(1);
        checked++;
      }
    }
    expect(r.now).toBeGreaterThanOrEqual(C.c4 + 1);
    expect(checked).toBeGreaterThan(100);
  });
});

describe('the layout', () => {
  it('keeps the arc, its numbers and the readout inside ZONES.gauge', () => {
    const z = ZONES.gauge;
    const L = gaugeLayout(z);
    // The dial fills the column's width since the chart went (30 Oct 2026), the readout under it.
    // Layout A2's smaller gauge (Rolando, 30 Oct 2026, 344x260) draws it at GAUGE_COMPACT (0.72).
    // Option 2 (Rolando, 30 Oct 2026: "too much wasted space"): the gauge moved down to y 645, same size.
    // Rolando, 30 Oct 2026 ("expand the city grid to match the size of the demand widget"): the gauge
    // moved up to y 545 to make room for the bigger map.
    expect(L.centre).toEqual({ x: 1738, y: 686 });
    expect(L.outer).toBe(111);
    expect(L.needle).toBe(89);
    expect(gaugeLayout({ x: 16, y: 710, w: 408, h: 360 })).toMatchObject({
      centre: { x: 220, y: 908 },
      outer: 154,
      needle: 123,
    });
    expect(L.centre.x - L.outer - 8).toBeGreaterThanOrEqual(z.x);
    expect(L.centre.x + L.outer + 8).toBeLessThanOrEqual(z.x + z.w);
    expect(L.readout.y).toBeGreaterThan(L.centre.y);
    expect(L.centre.y - L.outer - 8).toBeGreaterThanOrEqual(L.title.y + 16);
    expect(L.centre.y).toBeLessThanOrEqual(z.y + z.h);
    for (const v of GAUGE_TICKS) {
      const p = arcPoint(L, v, L.numbers);
      expect(p.x).toBeGreaterThan(z.x);
      expect(p.x).toBeLessThan(z.x + z.w);
      expect(p.y).toBeGreaterThan(z.y);
      expect(p.y).toBeLessThan(z.y + z.h);
    }
    for (const p of [L.readout, L.room, L.sub, L.strip]) {
      expect(p.x).toBeGreaterThanOrEqual(z.x);
      expect(p.y).toBeGreaterThanOrEqual(z.y);
      expect(p.y + 20).toBeLessThanOrEqual(z.y + z.h);
    }
  });
});

// ---- the view against a stub scene ----

function stubScene() {
  const texts: { text: string; visible: boolean }[] = [];
  const chain = (extra: Record<string, unknown> = {}): unknown => {
    const o: unknown = new Proxy(extra, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        return () => o;
      },
    });
    return o;
  };
  let graphics = 0;
  const scene = {
    add: {
      graphics: () => {
        graphics++;
        return chain({});
      },
      text: (_x: number, _y: number, s: string) => {
        const rec = { text: s, visible: true };
        texts.push(rec);
        const t: Record<string, unknown> = {};
        t.setText = (v: string) => ((rec.text = v), proxy);
        t.setVisible = (v: boolean) => ((rec.visible = v), proxy);
        Object.defineProperty(t, 'text', { get: () => rec.text });
        const proxy = chain(t);
        return proxy;
      },
    },
  };
  return { scene, texts, graphics: () => graphics };
}

// Real terms on screen (Rolando, 29 Oct 2026): the old crew words must not come back.
const BANNED_ON_SCREEN = /\bcoming\b|\broom\b|no box|\bsplitter\b|est\./i;

describe('GaugeView', () => {
  it('is the registry’s gauge line', () => {
    const v = createViews().find((x) => x.zone === 'gauge');
    expect(v).toBeInstanceOf(GaugeView);
  });

  it('mirrors hud.gauge: demand from the sim, capacity equal to hud.headroom.wiredCapacity', () => {
    const { scene, texts } = stubScene();
    const bus = new Bus();
    const gauge = new GaugeView();
    const deck = new DeckView();
    gauge.create(scene as never, { scene: null as never, bus, rect: ZONES.gauge, flags: { lite: true } });
    deck.create(scene as never, { scene: null as never, bus, rect: ZONES.deck, flags: { lite: true } });
    expect(withinBudget(gauge)).toBe(true);
    // One more of each since the headroom line moved in (30 Oct 2026).
    expect(gauge.made).toEqual({ objects: 13, texts: 11 });

    const { r } = wiredRun();
    expect(r.placeServer(SERVER_SLOTS[1]).ok).toBe(true);
    r.now = C.c1 + BROWNOUT.server.bootSeconds + 1;
    const f = readFrame(r);
    gauge.update(f, { now: 1, dt: 0.016 });
    deck.update(f, { now: 1, dt: 0.016 });
    const hud = hudSection({} as HudTestState) as unknown as {
      gauge: Record<string, unknown> & { demand: number; capacity: number };
      headroom: { wiredCapacity: number };
    };
    expect(hud.gauge.visible).toBe(true);
    expect(Math.abs(hud.gauge.demand - f.demand)).toBeLessThanOrEqual(1);
    expect(hud.gauge.capacity).toBe(hud.headroom.wiredCapacity);
    expect(hud.headroom.wiredCapacity).toBe(f.wiredCapacity);
    expect(hud.gauge).toMatchObject({
      max: 400,
      capacity: 60,
      title: 'DEMAND req/s',
      readout: `${Math.round(f.demand)}/s`,
      sub: 'capacity 60 req/s',
      strip: null,
      ticks: ['0', '100', '200', '300', '400'],
    });
    // The ROOM tag rides the band.
    expect(texts.some((t) => t.text === LABELS.gauge.room && t.visible)).toBe(true);

    // Redrawn only on a change: once the needle has settled, a quiet frame draws nothing.
    gauge.update(f, { now: 1.01, dt: 5 });
    expect(gauge.snapshot().needle).toBe(f.demand);
    const draws = gauge.draws;
    gauge.update(f, { now: 1.02, dt: 0.016 });
    gauge.update(f, { now: 1.04, dt: 0.016 });
    expect(gauge.draws).toBe(draws);

    // No real system-design term on screen.
    for (const t of texts) expect(t.text, t.text).not.toMatch(BANNED_ON_SCREEN);
    gauge.shutdown();
    deck.shutdown();
    expect(gauge.made).toEqual({ objects: 0, texts: 0 });
  });

  it('reads NO CAPACITY YET before the first build, in amber words, and never a crew word', () => {
    const { scene, texts } = stubScene();
    const gauge = new GaugeView();
    gauge.create(scene as never, {
      scene: null as never,
      bus: new Bus(),
      rect: ZONES.gauge,
      flags: { lite: true },
    });
    const r = new Run();
    r.now = C.c1;
    gauge.update(readFrame(r), { now: 0, dt: 0.016 });
    const snap = gauge.snapshot();
    expect(snap.strip).toBe('NO CAPACITY YET');
    expect(snap.sub).toBe('no server yet');
    expect(snap.capacity).toBe(0);
    expect(texts.some((t) => t.text === LABELS.gauge.room && t.visible)).toBe(false);
    for (const t of texts) expect(t.text).not.toMatch(BANNED_ON_SCREEN);
    gauge.shutdown();
  });

  it('prints no copy of its own: every word comes from labels.ts', () => {
    for (const src of [gaugeSource, gaugeViewSource]) {
      expect(src).not.toMatch(/EST\.\s*THROUGHPUT|'HEADROOM|HEADROOM'/);
      // String literals that would reach the screen: none spell a word outside labels.ts.
      // (Import paths and the Frame field names a Pick lists are code, not copy.)
      const literals = [...src.matchAll(/'([^'\n]*)'/g)]
        .map((m) => m[1])
        .filter((l) => !l.startsWith('.') && !/^[a-z]+[A-Z][A-Za-z]*$/.test(l));
      for (const l of literals) expect(l, l).not.toMatch(BANNED_ON_SCREEN);
    }
  });
});
