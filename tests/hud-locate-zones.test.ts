import { Bus } from '../src/game/bus';
import { readFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import { AlertView } from '../src/scenes/hud/AlertView';
import { ChartView } from '../src/scenes/hud/ChartView';
import { DeckView } from '../src/scenes/hud/DeckView';
import { GaugeView } from '../src/scenes/hud/GaugeView';
import { TitleView } from '../src/scenes/hud/TitleView';
import { locateNames } from '../src/scenes/hud/comms';
import { KEY_NAMES } from '../src/scenes/hud/deck';
import { LEADER_FOR } from '../src/scenes/hud/lineMeta';
import { locate, registeredNames } from '../src/scenes/hud/locate';
import type { LiveView } from '../src/scenes/live/view';
import { ZONES, inside } from '../src/scenes/live/layout';
import { BROWNOUT } from '../src/sim/brownout';
import dialSource from '../src/scenes/hud/DialView.ts?raw';
import boardSource from '../src/scenes/BoardScene.ts?raw';

// Cross-lane swap 6: the views a leader line points at register where they are with locate.ts, so
// every zone and key subject in lineMeta's LEADER_FOR has someone answering for it.

/** Every source file's text, by path (the same scan as tests/live-docs.test.ts). */
const SOURCES = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every name some source registers with locate.ts (a key loop over KEY_NAMES counts as all three). */
function registeringNames(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, text] of Object.entries(SOURCES)) {
    for (const m of text.matchAll(/registerLocate\(\s*'([^']+)'/g)) out.set(m[1], path);
    if (/registerLocate\(\s*`key:\$\{name\}`/.test(text) && /for \(const name of KEY_NAMES\)/.test(text))
      for (const k of KEY_NAMES) out.set(`key:${k}`, path);
  }
  return out;
}

/** A scene stub whose every call returns another stub (enough for the views' create and update). */
function stubScene(): unknown {
  const chain = (extra: Record<string, unknown> = {}): unknown => {
    const target = Object.assign(() => o, extra);
    const o: unknown = new Proxy(target, {
      get(_t, prop) {
        if (prop in extra) return extra[prop as string];
        if (prop === 'then') return undefined;
        if (prop === Symbol.toPrimitive) return () => 0;
        return o;
      },
      apply: () => o,
    });
    return o;
  };
  const text = () => {
    let value = '';
    const t: Record<string, unknown> = {};
    t.setText = (s: string) => ((value = s), proxy);
    Object.defineProperty(t, 'text', { get: () => value });
    const proxy = chain(t);
    return proxy;
  };
  return chain({ add: chain({ text }), game: { loop: { time: 0 } } });
}

function build(view: LiveView, rect: (typeof ZONES)[keyof typeof ZONES]): void {
  view.create(stubScene() as never, { scene: null as never, bus: new Bus(), rect, flags: { lite: true } });
}

describe('every zone a leader line names has a registering view', () => {
  it('each zone or key subject in LEADER_FOR resolves to a name some source registers', () => {
    const names = registeringNames();
    const subjects = new Set(
      Object.values(LEADER_FOR).filter((s): s is NonNullable<typeof s> => !!s && !s.startsWith('part:')),
    );
    expect(subjects.size).toBeGreaterThan(4);
    for (const subject of subjects) {
      const by = locateNames(subject).filter((n) => names.has(n));
      expect(by.length, subject).toBeGreaterThan(0);
    }
  });

  it('the views register the names the leader lines use', () => {
    const names = registeringNames();
    const want: Record<string, string> = {
      gauge: 'GaugeView.ts',
      alert: 'AlertView.ts',
      scope: 'ChartView.ts',
      dial: 'DialView.ts',
      credits: 'TitleView.ts',
      'key:one': 'DeckView.ts',
      'key:two': 'DeckView.ts',
      'key:three': 'DeckView.ts',
      inventory: 'BoardScene.ts',
    };
    for (const [name, file] of Object.entries(want)) expect(names.get(name), name).toMatch(file);
  });
});

describe('the views register in create and unregister in shutdown', () => {
  it('gauge, scope, credits and the keys answer a game-px point inside their zone, then nothing', () => {
    const cases: [LiveView, keyof typeof ZONES, string[]][] = [
      [new GaugeView(), 'gauge', ['gauge']],
      [new ChartView(), 'scope', ['scope']],
      [new TitleView(), 'title', ['credits']],
      [new DeckView(), 'deck', ['key:one', 'key:two', 'key:three']],
    ];
    for (const [view, zone, names] of cases) {
      build(view, ZONES[zone]);
      for (const n of names) {
        const p = locate(n);
        expect(p, n).not.toBeNull();
        expect(inside({ x: p!.x, y: p!.y, w: 0, h: 0 }, ZONES[zone]), `${n} in ${zone}`).toBe(true);
        // One point made at create: no allocation per ask.
        expect(locate(n)).toBe(p);
      }
      view.shutdown();
      for (const n of names) {
        expect(locate(n), n).toBeNull();
        expect(registeredNames()).not.toContain(n);
      }
    }
  });

  it('the three keys sit left to right', () => {
    const deck = new DeckView();
    build(deck, ZONES.deck);
    const [a, b, c] = KEY_NAMES.map((k) => locate(`key:${k}`)!);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    deck.shutdown();
  });

  it('the alert answers only while an alert is up, under the plate', () => {
    const view = new AlertView();
    build(view, ZONES.alert);
    expect(registeredNames()).toContain('alert');
    expect(locate('alert')).toBeNull();
    const r = new Run();
    r.now = BROWNOUT.challenges.c4 - 12;
    view.update(readFrame(r), { now: 1, dt: 0.016 });
    expect(view.snapshot().visible).toBe(true);
    const p = locate('alert');
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(ZONES.alert.x + ZONES.alert.w / 2, 0);
    expect(p!.y).toBeGreaterThan(ZONES.alert.y);
    expect(p!.y).toBeLessThanOrEqual(ZONES.alert.y + ZONES.alert.h);
    view.shutdown();
    expect(registeredNames()).not.toContain('alert');
  });

  it('DialView registers the dial while its card shows, and unregisters on the scene shutdown', () => {
    expect(dialSource).toMatch(/registerLocate\('dial', \(\) => \(this\.root\.visible \? face0 : null\)\)/);
    expect(dialSource).toMatch(/scene\.events\.once\('shutdown', \(\) => \{[^}]*offLocate\(\);/);
  });

  it('BoardScene registers the inventory (and the channel mouth) and unregisters on shutdown', () => {
    expect(boardSource).toMatch(/registerLocate\('inventory', \(\) => cardAt\)/);
    expect(boardSource).toMatch(/registerLocate\('channel', \(\) => mouthAt\)/);
    expect(boardSource).toMatch(/SHUTDOWN, \(\) => \{\s*for \(const off of offLocate\) off\(\);/);
  });
});
