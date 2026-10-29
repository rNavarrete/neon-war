import mapViewSource from '../src/scenes/hud/MapView.ts?raw';
import { Bus } from '../src/game/bus';
import { type Frame, readFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import { CITY_GRID_KEY, MapView } from '../src/scenes/hud/MapView';
import {
  DOT_SPEED,
  FLOORS,
  LAUNDRY_FLOOR,
  MAP_WORDS,
  MAX_DOTS_PER_SECOND,
  type MapInput,
  REDRAW_LIGHTS,
  REDRAW_OUTLINES,
  STREET_IDS,
  WINDOWS_PER_FLOOR,
  districtDemand,
  fillStreetDots,
  mapDiff,
  mapDotsPerSecond,
  mapLayout,
  mapState,
  noStreetDots,
  pointAlong,
  poolRate,
  raidPulse,
  sparkleAlpha,
  streetSeconds,
  windowLook,
  windowRect,
} from '../src/scenes/hud/cityMap';
import { PacketPool, packetsPerSecond } from '../src/scenes/board/packets';
import { ZONES, inside } from '../src/scenes/live/layout';
import type { LiveHost } from '../src/scenes/live/view';
import { BROWNOUT } from '../src/sim/brownout';
import { blockDemand } from '../src/sim/failures';
import { LINES } from '../src/strings';
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

/** A map input at `now` with nothing going on. */
function input(now: number, over: Partial<MapInput> = {}): MapInput {
  return { now, errorShare: 0, laundryCut: null, rescued: false, surge: null, midnight: null, ...over };
}

describe('dot rates', () => {
  it('are clamp(reqps / 12, 0, 32)', () => {
    expect(mapDotsPerSecond(0)).toBe(0);
    expect(mapDotsPerSecond(-5)).toBe(0);
    expect(mapDotsPerSecond(Number.NaN)).toBe(0);
    expect(mapDotsPerSecond(90)).toBe(7.5);
    expect(mapDotsPerSecond(250)).toBeCloseTo(250 / 12);
    expect(mapDotsPerSecond(1000)).toBe(MAX_DOTS_PER_SECOND);
  });

  it('give 250 at least 1.6x the dots of 90', () => {
    expect(mapDotsPerSecond(250) / mapDotsPerSecond(90)).toBeGreaterThanOrEqual(1.6);
  });

  it('send the neighbours up the district road from the surge to the final surge only', () => {
    expect(districtDemand(C.c4 - 1, 250)).toBe(0);
    expect(districtDemand(C.c4, 250)).toBe(250 - BROWNOUT.demand.climb);
    expect(districtDemand(C.c5 + 10, BROWNOUT.demand.tail)).toBe(
      BROWNOUT.demand.tail - BROWNOUT.demand.climb,
    );
    expect(districtDemand(C.c6, 150)).toBe(0);
    const out = noStreetDots();
    fillStreetDots(out, 250, 90);
    expect(out).toEqual({ north: 3.75, west: 3.75, district: 0 });
    fillStreetDots(out, C.c4 + 1, 250);
    expect(out.district).toBeCloseTo(160 / 12);
    expect(out.north + out.west + out.district).toBeCloseTo(mapDotsPerSecond(250));
    // The same object comes back, refilled.
    expect(fillStreetDots(out, 0, 0)).toBe(out);
    expect(out).toEqual({ north: 0, west: 0, district: 0 });
  });

  it('come from the block before retries: the laundry cut thins them, retries never add any', () => {
    // A run in the surge, with and without retries piled on top: the street dots read blockDemand.
    const surge = blockDemand(C.c4 + 2, false, false);
    const cut = blockDemand(C.c4 + 2, false, true);
    expect(surge).toBe(250);
    expect(cut).toBe(210);
    const a = fillStreetDots(noStreetDots(), C.c4 + 2, surge);
    const b = fillStreetDots(noStreetDots(), C.c4 + 2, cut);
    expect(b.district).toBeLessThan(a.district);
    // The view feeds frame.blockDemand, never frame.demand (which carries the retries).
    expect(mapViewSource).toMatch(/fillStreetDots\(this\.streetDots, frame\.now, frame\.blockDemand\)/);
    expect(mapViewSource).not.toMatch(/frame\.demand\b/);
    expect(mapViewSource).not.toMatch(/frame\.retry\b/);
  });

  it('turn into pool rates that spawn exactly that many dots a second', () => {
    for (const dps of [0, 3.75, 7.5, 13.3]) expect(packetsPerSecond(poolRate(dps))).toBeCloseTo(dps);
  });
});

describe('mapState', () => {
  it('raids while the district surge is warned, and in [c4, c5) until the crew comes', () => {
    expect(mapState(input(C.c4 - 20)).raid).toBe(false);
    expect(mapState(input(C.c4 - 5, { surge: { surge: { startsAt: C.c4 } } })).raid).toBe(true);
    expect(mapState(input(C.c3 - 5, { surge: { surge: { startsAt: C.c3 } } })).raid).toBe(false);
    expect(mapState(input(C.c4 + 8)).raid).toBe(true);
    expect(mapState(input(C.c4 + 20, { rescued: true })).raid).toBe(false);
    expect(mapState(input(C.c5)).raid).toBe(false);
  });

  it('keeps the neighbours cut off from the surge to the final surge', () => {
    expect(mapState(input(C.c4 - 20)).neighboursCut).toBe(false);
    expect(mapState(input(C.c4 + 1)).neighboursCut).toBe(true);
    expect(mapState(input(C.c5 + 30, { rescued: true })).neighboursCut).toBe(true);
    expect(mapState(input(C.c6)).neighboursCut).toBe(false);
  });

  it('lights round(10 x (1 - error share)) floors, all of them at a held midnight, none at a dark one', () => {
    expect(mapState(input(100)).litFloors).toBe(FLOORS);
    expect(mapState(input(C.c4 + 5, { errorShare: 0.52 })).litFloors).toBe(5);
    expect(mapState(input(C.c4 + 5, { errorShare: 0.04 })).litFloors).toBe(10);
    expect(mapState(input(C.c4 + 5, { errorShare: 1 })).litFloors).toBe(0);
    const held = mapState(input(C.c7 + 1, { errorShare: 0.3, midnight: { held: true } }));
    expect(held).toMatchObject({ midnight: true, litFloors: FLOORS });
    expect(mapState(input(C.c7 + 1, { midnight: { held: false } })).litFloors).toBe(0);
    expect(mapState(input(C.c7 - 1)).midnight).toBe(false);
  });

  it('greys the laundry floor once cut', () => {
    const s = mapState(input(C.c4 + 3, { laundryCut: { at: C.c4 + 2 } }));
    expect(s.laundryDark).toBe(true);
    expect(windowLook(s, LAUNDRY_FLOOR)).toBe('grey');
    expect(windowLook(s, LAUNDRY_FLOOR + 1)).toBe('lit');
    expect(mapState(input(C.c4 + 3)).laundryDark).toBe(false);
  });

  it('follows a real run: raid in the surge, a dark laundry floor after the cut, fewer lit floors while dropping', () => {
    const r = new Run();
    // Nothing built yet: every call drops and the windows are dark.
    expect(mapState(readFrame(r))).toMatchObject({
      raid: false,
      laundryDark: false,
      litFloors: 0,
      midnight: false,
    });
    // Into the surge with every second call dropping.
    const f = { ...readFrame(r), now: C.c4 + 2, errorShare: 0.6 } as Frame;
    const s = mapState(f);
    expect(s.raid).toBe(true);
    expect(s.litFloors).toBe(4);
    const cut = mapState({ ...f, laundryCut: { at: C.c4 + 2 } });
    expect(cut.laundryDark).toBe(true);
  });
});

describe('mapDiff: what to redraw', () => {
  it('redraws both at first, then nothing while the state holds', () => {
    const s = mapState(input(100));
    expect(mapDiff(null, s)).toBe(REDRAW_LIGHTS | REDRAW_OUTLINES);
    expect(mapDiff(s, mapState(input(101)))).toBe(0);
  });

  it('redraws the lights on lit floors, the laundry floor or midnight, the outlines on the raid or the cut', () => {
    const s = mapState(input(C.c4 + 2));
    expect(mapDiff(s, mapState(input(C.c4 + 2, { errorShare: 0.5 })))).toBe(REDRAW_LIGHTS);
    expect(mapDiff(s, mapState(input(C.c4 + 2, { laundryCut: { at: C.c4 } })))).toBe(REDRAW_LIGHTS);
    // The crew arrives: the raid ends, the neighbours stay cut off.
    expect(mapDiff(s, mapState(input(C.c4 + 2, { rescued: true })))).toBe(REDRAW_OUTLINES);
    expect(mapDiff(mapState(input(C.c4 - 20)), s)).toBe(REDRAW_OUTLINES);
    expect(mapDiff(mapState(input(C.c7 - 1)), mapState(input(C.c7)))).toBe(REDRAW_LIGHTS);
  });
});

describe('looks', () => {
  it('pulse the raid at 1 Hz, steady with reduced flicker', () => {
    expect(raidPulse(0, false)).toBeCloseTo(1);
    expect(raidPulse(0.5, false)).toBeCloseTo(0.2);
    expect(raidPulse(1, false)).toBeCloseTo(1);
    expect(raidPulse(0.5, true)).toBe(1);
  });

  it('fire the sparkles once and fade them out', () => {
    expect(sparkleAlpha(-1)).toBe(0);
    expect(sparkleAlpha(0)).toBe(1);
    expect(sparkleAlpha(0.75)).toBeCloseTo(0.5);
    expect(sparkleAlpha(5)).toBe(0);
  });

  it('warm every window at midnight', () => {
    const s = mapState(input(C.c7 + 1, { laundryCut: { at: 302 }, midnight: { held: true } }));
    for (let floor = 1; floor <= FLOORS; floor++) expect(windowLook(s, floor)).toBe('warm');
  });

  it('print no debrief term', () => {
    const banned = [
      'headroom',
      'throughput',
      'balancer',
      'capacity',
      'n+1',
      'cascad',
      'retry storm',
      'shedding',
    ];
    const bold = (['C8.terms.sizing', 'C8.terms.scaling', 'C8.terms.failure'] as const).flatMap((id) =>
      [...LINES[id].text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1].toLowerCase()),
    );
    for (const w of Object.values(MAP_WORDS))
      for (const t of [...banned, ...bold.flatMap((b) => b.split(/,\s*/))])
        expect(w.toLowerCase().includes(t), `${w} / ${t}`).toBe(false);
  });
});

describe('mapLayout', () => {
  const L = mapLayout(ZONES.map);

  it('keeps everything inside ZONES.map', () => {
    expect(L.plate).toEqual(ZONES.map);
    for (const r of [L.lux, ...L.neighbours, ...L.blocks])
      expect(inside(r, ZONES.map), JSON.stringify(r)).toBe(true);
    const pt = (p: { x: number; y: number }) => inside({ x: p.x, y: p.y, w: 0, h: 0 }, ZONES.map);
    for (const s of L.streets) for (const p of s.points) expect(pt(p)).toBe(true);
    for (const p of [L.title, L.luxLabel, L.cutOffLabel, ...L.sparkles]) expect(pt(p)).toBe(true);
    expect(L.neighbours).toHaveLength(4);
    expect(L.streets.map((s) => s.id)).toEqual(STREET_IDS);
  });

  it('puts a 12 x 10 window grid inside the block, the ground floor at the bottom', () => {
    const p = { x: 0, y: 0 };
    for (const floor of [1, FLOORS])
      for (const col of [0, WINDOWS_PER_FLOOR - 1]) {
        windowRect(L, col, floor, p);
        expect(inside({ x: p.x, y: p.y, w: L.windows.w, h: L.windows.h }, L.lux)).toBe(true);
      }
    const top = windowRect(L, 0, FLOORS, { x: 0, y: 0 }).y;
    const ground = windowRect(L, 0, 1, { x: 0, y: 0 }).y;
    expect(ground).toBeGreaterThan(top);
  });

  it('walks each street from its start to the block', () => {
    for (const s of L.streets) {
      const out = { x: 0, y: 0 };
      expect(pointAlong(s, 0, out)).toEqual(s.points[0]);
      pointAlong(s, 1, out);
      const last = s.points[s.points.length - 1];
      expect(out.x).toBeCloseTo(last.x);
      expect(out.y).toBeCloseTo(last.y);
      expect(streetSeconds(s)).toBeCloseTo(Math.max(0.5, s.length / DOT_SPEED));
    }
  });
});

// ---- the view, against a stub scene ----

interface Made {
  kind: string;
  calls: number;
  depth: number;
  alpha: number;
  visible: boolean;
  destroyed: boolean;
  text: string;
}

function stubScene() {
  const made: Made[] = [];
  const object = (kind: string, text = ''): unknown => {
    const rec: Made = { kind, calls: 0, depth: 0, alpha: 1, visible: true, destroyed: false, text };
    made.push(rec);
    const o: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'setDepth') return (d: number) => ((rec.depth = d), o);
          if (prop === 'setAlpha') return (a: number) => ((rec.alpha = a), o);
          if (prop === 'setVisible') return (v: boolean) => ((rec.visible = v), o);
          if (prop === 'destroy') return () => ((rec.destroyed = true), undefined);
          if (prop === 'clear') return () => (rec.calls++, o);
          return () => o;
        },
      },
    );
    return o;
  };
  const loaded: string[] = [];
  const scene = {
    add: {
      graphics: () => object('Graphics'),
      image: () => object('Image'),
      text: (_x: number, _y: number, text: string) => object('Text', text),
    },
    textures: { exists: () => false },
    load: { image: (key: string) => loaded.push(key) },
  };
  return { scene, made, loaded };
}

const host = (bus: Bus): LiveHost => ({ scene: null as never, bus, rect: ZONES.map, flags: { lite: true } });

/** A frame of a fresh run at `now`, with fields overridden. */
function frameAt(now: number, over: Partial<Frame> = {}): Frame {
  return { ...readFrame(new Run()), now, ...over };
}

describe('MapView', () => {
  it('draws inside its budget, mirrors hud.map and loads no missing art', () => {
    const { scene, made, loaded } = stubScene();
    const v = new MapView();
    v.preload(scene as never);
    // hud/city-grid and the frame kit are picked (M4): their files are queued from public/art. The
    // stub scene loads nothing, so the vector base draws here.
    expect(loaded).toEqual([
      'art:hud/city-grid',
      'art:hud/live/panel-frame',
      'art:hud/live/corner-marks',
      'art:hud/live/label-tab',
      'art:hud/live/tag-chip',
      'art:hud/city-grid-lit',
    ]);
    expect(CITY_GRID_KEY).toBe('hud/city-grid');
    v.create(scene as never, host(new Bus()));
    expect(made.length).toBeLessThanOrEqual(v.budget.objects);
    expect(made.filter((m) => m.kind === 'Text').length).toBeLessThanOrEqual(v.budget.texts);
    expect(made.map((m) => m.text).filter(Boolean)).toEqual(['CITY GRID', 'LUX', 'CUT OFF']);
    expect(made.every((m) => m.depth > 0)).toBe(true);

    v.update(frameAt(C.c4 + 2, { blockDemand: 250, errorShare: 0.5 }), { now: 1, dt: 0.5 });
    const hud = hudSection({} as HudTestState) as unknown as { map: unknown };
    expect(hud.map).toMatchObject({
      raid: true,
      neighboursCut: true,
      litFloors: 5,
      laundryDark: false,
      midnight: false,
    });
    expect((hud.map as { dots: { active: number } }).dots.active).toBeGreaterThan(0);

    v.shutdown();
    expect(made.every((m) => m.destroyed)).toBe(true);
  });

  it('redraws no window light or outline on frames where mapState did not change', () => {
    const { scene } = stubScene();
    const v = new MapView();
    v.create(scene as never, host(new Bus()));
    let t = 0;
    const step = (f: Frame) => v.update(f, { now: (t += 0.016), dt: 0.016 });

    step(frameAt(250, { blockDemand: 90 }));
    expect(v.draws).toEqual({ lights: 1, outlines: 1 });
    // 100 frames of steady demand at the climb: dots move, nothing else is redrawn.
    for (let i = 0; i < 100; i++) step(frameAt(250 + i * 0.016, { blockDemand: 90 }));
    expect(v.draws).toEqual({ lights: 1, outlines: 1 });
    // The raid: outlines only.
    step(frameAt(C.c4 + 1, { blockDemand: 250 }));
    expect(v.draws).toEqual({ lights: 1, outlines: 2 });
    for (let i = 0; i < 30; i++) step(frameAt(C.c4 + 1 + i * 0.016, { blockDemand: 250 }));
    expect(v.draws).toEqual({ lights: 1, outlines: 2 });
    // Dropping: lights only, once per change of lit floors.
    step(frameAt(C.c4 + 2, { blockDemand: 250, errorShare: 0.3 }));
    step(frameAt(C.c4 + 2.1, { blockDemand: 250, errorShare: 0.31 }));
    expect(v.draws).toEqual({ lights: 2, outlines: 2 });
    // The cut: lights only.
    step(frameAt(C.c4 + 3, { blockDemand: 210, errorShare: 0.3, laundryCut: { at: C.c4 + 3 } }));
    expect(v.draws).toEqual({ lights: 3, outlines: 2 });
    expect(v.state.laundryDark).toBe(true);
    v.shutdown();
  });

  it('pools the dots: the pool stops growing at steady demand, holds more at 250 than at 90, slows with Regroup', () => {
    const { scene } = stubScene();
    const v = new MapView();
    v.create(scene as never, host(new Bus()));
    let t = 0;
    const run = (seconds: number, at: (i: number) => Frame, dt = 1 / 60) => {
      let sum = 0;
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) {
        v.update(at(i * dt), { now: (t += dt), dt });
        sum += v.pool.active;
      }
      return sum / n;
    };
    run(5, (s) => frameAt(250 + s, { blockDemand: 90 }));
    const pool = v.pool.size;
    const at90 = run(3, (s) => frameAt(255 + s, { blockDemand: 90 }));
    expect(v.pool.size).toBe(pool);
    run(5, (s) => frameAt(C.c4 + s, { blockDemand: 250 }));
    const pool250 = v.pool.size;
    const at250 = run(3, (s) => frameAt(C.c4 + 5 + s, { blockDemand: 250 }));
    expect(v.pool.size).toBe(pool250);
    expect(at250 / at90).toBeGreaterThanOrEqual(1.6);
    // Regroup: a quarter of the speed, so a dot spends four times as long on its street.
    const before = v.pool.items.filter((p) => p.active).map((p) => p.age);
    v.update(frameAt(C.c4 + 9, { blockDemand: 250, timeScale: 0.25 }), { now: (t += 0.1), dt: 0.1 });
    const after = v.pool.items.filter((p) => p.active).map((p) => p.age);
    expect(Math.max(...after) - Math.max(...before)).toBeLessThanOrEqual(0.025 + 1e-9);
    // Held: nothing moves.
    const held = v.pool.items.map((p) => p.age);
    v.update(frameAt(C.c4 + 9, { blockDemand: 250 }), { now: t, dt: 0 });
    expect(v.pool.items.map((p) => p.age)).toEqual(held);
    // A rewind: the pool clears.
    v.update(frameAt(C.c4 - 10, { blockDemand: 90 }), { now: (t += 0.016), dt: 0 });
    expect(v.pool.active).toBe(0);
    v.shutdown();
  });

  it('keeps the dots off the retries: a frame with retries piled on draws as many as one without', () => {
    const a = new MapView();
    const b = new MapView();
    a.create(stubScene().scene as never, host(new Bus()));
    b.create(stubScene().scene as never, host(new Bus()));
    for (let i = 0; i < 300; i++) {
      const now = C.c4 + 1 + i / 60;
      a.update(frameAt(now, { blockDemand: 250, demand: 250, retry: 0 }), { now: i / 60, dt: 1 / 60 });
      b.update(frameAt(now, { blockDemand: 250, demand: 375, retry: 0.5 }), { now: i / 60, dt: 1 / 60 });
    }
    expect(b.pool.active).toBe(a.pool.active);
    expect(b.pool.size).toBe(a.pool.size);
    a.shutdown();
    b.shutdown();
  });

  it('allocates nothing in update: no array helpers, closures or template strings there', () => {
    const body = mapViewSource
      .slice(mapViewSource.indexOf('  update(frame'), mapViewSource.indexOf('  private steady'))
      .replace(/\/\/.*$/gm, '');
    expect(body.length).toBeGreaterThan(100);
    for (const bad of ['.filter(', '.map(', '.find(', '=>', '`', 'new ', '[]', '{ '])
      expect(body.includes(bad), bad).toBe(false);
  });

  it('a second PacketPool fills to the same size whatever the frame times', () => {
    const p = new PacketPool();
    const rates = { north: poolRate(3.75), west: poolRate(3.75), district: 0 };
    const travel = () => 2;
    for (let i = 0; i < 600; i++) p.step(i % 3 === 0 ? 0.05 : 0.01, rates, travel);
    const size = p.size;
    for (let i = 0; i < 600; i++) p.step(0.016, rates, travel);
    expect(p.size).toBe(size);
  });
});
