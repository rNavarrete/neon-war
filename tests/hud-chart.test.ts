import chartViewSource from '../src/scenes/hud/ChartView.ts?raw';
import { Bus } from '../src/game/bus';
import { type Frame, readFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import { ChartView, scopeViewOf } from '../src/scenes/hud/ChartView';
import {
  ChartRing,
  SCOPE_AHEAD_SECONDS,
  SCOPE_PAST_SECONDS,
  scopeCeiling,
  scopeForecast,
  scopeLayout,
  scopeX,
  scopeY,
} from '../src/scenes/hud/chartRing';
import { LEFT } from '../src/scenes/hud/layout';
import { DEMAND_SCALE_MAX } from '../src/scenes/hud/thresholds';
import { ZONES, inside } from '../src/scenes/live/layout';
import { createViews } from '../src/scenes/live/registry';
import { withinBudget } from '../src/scenes/live/view';
import { BROWNOUT } from '../src/sim/brownout';
import { forecastAt } from '../src/sim/demand';
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

describe('chart ring buffer', () => {
  it('holds one window of buckets and drops the oldest', () => {
    const ring = new ChartRing(60, 0.25);
    expect(ring.size).toBe(241);
    for (let t = 0; t <= 100; t += 0.25) ring.push(t, t, 2 * t);
    expect(ring.count).toBe(ring.size);
    expect(ring.timeAt(ring.count - 1)).toBe(100);
    expect(ring.timeAt(0)).toBe(40);
    expect(ring.lastDemand).toBe(100);
    expect(ring.lastCapacity).toBe(200);
    expect(ring.max()).toBe(200);
  });

  it('overwrites the newest bucket within one interval, so the tip moves every frame', () => {
    const ring = new ChartRing(60, 0.25);
    ring.push(10, 30, 60);
    ring.push(10.1, 31, 60);
    ring.push(10.2, 32, 0);
    expect(ring.count).toBe(1);
    expect(ring.lastDemand).toBe(32);
    expect(ring.lastCapacity).toBe(0);
  });

  it('fills skipped buckets after a long frame, at most one window', () => {
    const ring = new ChartRing(10, 1);
    ring.push(0, 1, 1);
    ring.push(3, 5, 5);
    expect(ring.count).toBe(4);
    expect([0, 1, 2, 3].map((i) => ring.timeAt(i))).toEqual([0, 1, 2, 3]);
    ring.push(1000, 9, 9);
    expect(ring.count).toBe(ring.size);
    expect(ring.timeAt(ring.count - 1)).toBe(1000);
    expect(ring.timeAt(0)).toBe(1000 - ring.size + 1);
  });

  it('clears when the clock goes backwards (a rewind)', () => {
    const ring = new ChartRing(60, 0.25);
    ring.push(100, 250, 120);
    ring.push(101, 250, 120);
    ring.push(50, 30, 60);
    expect(ring.count).toBe(1);
    expect(ring.lastDemand).toBe(30);
  });

  it('allocates nothing after construction: the same typed arrays are reused', () => {
    const ring = new ChartRing(60, 0.25);
    const arrays = Object.values(ring).filter((v) => ArrayBuffer.isView(v));
    for (let t = 0; t < 500; t += 0.016) ring.push(t, 1, 1);
    expect(Object.values(ring).filter((v) => ArrayBuffer.isView(v))).toEqual(arrays);
    expect(arrays.length).toBe(3);
  });
});

// ---- gauges-6: the scope in ZONES.scope ----

const C = BROWNOUT.challenges;
const ONE_BOX = BROWNOUT.server.capacity;

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
  const scene = {
    add: {
      graphics: () => chain({}),
      nineslice: () => chain({}),
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
  return { scene, texts };
}

function scopeView(): { view: ChartView; texts: { text: string; visible: boolean }[] } {
  const { scene, texts } = stubScene();
  const view = new ChartView();
  view.create(scene as never, {
    scene: null as never,
    bus: new Bus(),
    rect: ZONES.scope,
    flags: { lite: true },
  });
  return { view, texts };
}

type Chart = {
  demand: number;
  capacity: number;
  wiredCapacity: number;
  ceiling: number;
  racked: boolean;
  forecast: { startsAt: number; demand: number; peak: number } | null;
  now: number;
  plot: { w: number; h: number };
  title: string;
  legend: string;
};
const chart = (): Chart => (hudSection({} as HudTestState) as unknown as { chart: Chart }).chart;

describe('the scope', () => {
  it('is the registry’s scope line, and the HUD finds it there', () => {
    const views = createViews();
    const v = views.find((x) => x.zone === 'scope');
    expect(v).toBeInstanceOf(ChartView);
    expect(scopeViewOf(views)).toBe(v);
    expect(() => scopeViewOf([])).toThrow();
  });

  it('plots on 354 x 145 inside ZONES.scope, at least 140 px tall, the same plot as LEFT.plot', () => {
    const L = scopeLayout(ZONES.scope);
    expect(L.plot).toEqual(LEFT.plot);
    expect(L.plot.right - L.plot.left).toBe(354);
    expect(L.plot.bottom - L.plot.top).toBe(145);
    expect(L.plot.bottom - L.plot.top).toBeGreaterThanOrEqual(140);
    const plot = { x: L.plot.left, y: L.plot.top, w: 354, h: 145 };
    expect(inside(plot, ZONES.scope)).toBe(true);
    expect(L.legend.y + 16).toBeLessThanOrEqual(ZONES.scope.y + ZONES.scope.h);
    // The past fills the plot up to the playhead; the forecast region is the last 10 s.
    expect(SCOPE_PAST_SECONDS).toBe(60);
    expect(SCOPE_AHEAD_SECONDS).toBe(10);
    expect(scopeX(L, 100, 100)).toBe(L.playhead);
    expect(scopeX(L, 40, 100)).toBeCloseTo(L.plot.left, 6);
    expect(scopeX(L, 110, 100)).toBeCloseTo(L.plot.right, 6);
    expect(scopeY(L, 0, 120)).toBe(L.plot.bottom);
    expect(scopeY(L, 120, 120)).toBe(L.plot.top);
    expect(scopeY(L, 500, 120)).toBe(L.plot.top);
  });

  it('tops out at the shared 400 scale', () => {
    expect(scopeCeiling(30)).toBe(60);
    expect(scopeCeiling(250)).toBe(300);
    expect(scopeCeiling(375)).toBe(DEMAND_SCALE_MAX);
    expect(scopeCeiling(5000)).toBe(400);
  });

  it('draws two absolute lines, never a difference series', () => {
    // Demand and the wired room are each drawn as their own line from their own ring.
    expect(chartViewSource.match(/this\.drawLine\(/g)).toHaveLength(2);
    expect(chartViewSource).toMatch(/this\.drawLine\(g, this\.ring, COLORS\.amber/);
    expect(chartViewSource).toMatch(/this\.drawLine\(g, this\.wired, COLORS\.cyan/);
    // No series of demand less capacity (or the other way round), and no "diff" anything, in the
    // code (the comments may say what the scope is not).
    const code = chartViewSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/demand\w*\s*-\s*[\w.]*capacity|capacity\w*\s*-\s*[\w.]*demand\b|\bdiff/i);
  });
});

describe('the scope’s hook', () => {
  it('reports wiredCapacity 60 and capacity 120 with one wired and one unwired server', () => {
    const { view, texts } = scopeView();
    expect(withinBudget(view)).toBe(true);
    const r = new Run();
    r.now = C.c1;
    expect(r.placeServer(SERVER_SLOTS[0]).ok).toBe(true);
    const id = r.session.board.parts.find((p) => p.kind === 'server')!.id;
    expect(r.connect('gateway', id).ok).toBe(true);
    expect(r.connect(id, 'database').ok).toBe(true);
    expect(r.placeServer(SERVER_SLOTS[1]).ok).toBe(true);
    r.now = C.c1 + BROWNOUT.server.bootSeconds + 1;
    const f = readFrame(r);
    view.update(f);
    const c = chart();
    expect(c.wiredCapacity).toBe(60);
    expect(c.capacity).toBe(120);
    expect(c.wiredCapacity).toBe(ONE_BOX);
    expect(c.demand).toBe(f.demand);
    expect(c.racked).toBe(true);
    expect(c.plot).toEqual({ w: 354, h: 145 });
    expect(c.ceiling).toBeLessThanOrEqual(400);
    expect(c.title).toBe('LAST 60 s');
    expect(c.legend).toBe(`coming ${Math.round(f.demand)}/s   room 60/s`);
    expect(texts.some((t) => t.text === 'racked, not fed' && t.visible)).toBe(true);
    for (const t of texts) expect(t.text).not.toMatch(/head\s*room|throughput|capacity|requests per second/i);
    view.shutdown();
    expect(view.made).toEqual({ objects: 0, texts: 0 });
  });

  it('shows a forecast region exactly while forecastAt(now) is non-null, and never otherwise', () => {
    let shown = 0;
    for (let t = 0; t <= C.c8 + 30; t += 0.25) {
      expect(scopeForecast(t) !== null, `t ${t}`).toBe(forecastAt(t) !== null);
      if (forecastAt(t)) {
        shown++;
        expect(scopeForecast(t)!.startsAt).toBe(forecastAt(t)!.startsAt);
      }
    }
    expect(shown).toBeGreaterThan(0);

    const { view, texts } = scopeView();
    const base = readFrame(new Run());
    const ahead = () => texts.find((x) => x.text === 'ahead')!;
    for (let t = C.c3 - 15; t <= C.c3 + 2; t += 0.25) {
      view.update({ ...base, now: t } as Frame);
      const c = chart();
      expect(c.now).toBe(t);
      expect(c.forecast !== null, `t ${t}`).toBe(forecastAt(t) !== null);
      expect(ahead().visible).toBe(forecastAt(t) !== null);
      if (c.forecast) {
        expect(c.forecast.startsAt).toBe(C.c3);
        expect(c.forecast.peak).toBeGreaterThanOrEqual(base.demand);
      }
    }
    view.shutdown();
  });
});
