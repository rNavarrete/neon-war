import script from '../docs/SCRIPT.md?raw';
import strings from '../src/strings.ts?raw';
import { PLAY_FLAGS, flagsFrom } from '../src/scenes/live/flags';
import { countDisplayList, liveTestState, perfTestState } from '../src/scenes/live/hook';
import { LAYOUT_VERSION, ZONES, ZONE_IDS, type ZoneId, pageRect } from '../src/scenes/live/layout';
import {
  BOARD_ZONES,
  REGISTRY,
  REGISTRY_ZONES,
  createViews,
  placeholderZones,
} from '../src/scenes/live/registry';
import {
  type LiveHost,
  PLACEHOLDER_DASH,
  PLACEHOLDER_DEPTH,
  PlaceholderView,
  dashedOutline,
  withinBudget,
} from '../src/scenes/live/view';
import { bus } from '../src/game/bus';

// The Live screen's skeleton (tech-3): the flags, the registry's shape, the placeholder's budget and
// the hook sections, all without Phaser (the placeholder gets a stub scene).

/** The registry zones no lane has drawn yet, in registry order (each lane takes its zones out). */
const STILL_PLACEHOLDERS: ZoneId[] = ['alert', 'map', 'cam', 'gauge', 'scope', 'chat'];

describe('live flags', () => {
  it('turns lite on under ?test and off in play', () => {
    expect(flagsFrom('?test')).toEqual({ lite: true });
    expect(flagsFrom('?test&scene=board&speed=4')).toEqual({ lite: true });
    expect(flagsFrom('')).toEqual({ lite: false });
    expect(flagsFrom('?scene=board')).toEqual({ lite: false });
    expect(flagsFrom('?testing')).toEqual({ lite: false });
    expect(flagsFrom('')).toBe(PLAY_FLAGS);
    expect(Object.isFrozen(flagsFrom('?test'))).toBe(true);
  });
});

describe('live registry', () => {
  it('has one line per zone the HUD draws, and none for the board’s two', () => {
    expect(REGISTRY_ZONES).toEqual([
      'title',
      'alert',
      'clock',
      'map',
      'cam',
      'gauge',
      'scope',
      'comms',
      'deck',
      'chat',
    ]);
    expect(BOARD_ZONES).toEqual(['feed', 'inventory']);
    expect([...REGISTRY_ZONES, ...BOARD_ZONES].sort()).toEqual([...ZONE_IDS].sort());
    expect(new Set(REGISTRY_ZONES).size).toBe(REGISTRY.length);
    for (const e of REGISTRY)
      expect(['board', 'gauges', 'comms', 'chat', 'luxcam', 'learning']).toContain(e.lane);
    expect(REGISTRY.find((e) => e.zone === 'cam')?.lane).toBe('luxcam');
    expect(REGISTRY.find((e) => e.zone === 'comms')?.lane).toBe('comms');
    expect(REGISTRY.find((e) => e.zone === 'chat')?.lane).toBe('chat');
  });

  it('makes a fresh placeholder for every line, each in its own zone', () => {
    const views = createViews();
    expect(views.map((v) => v.zone)).toEqual(REGISTRY_ZONES);
    expect(views.filter((v) => v instanceof PlaceholderView).map((v) => v.zone)).toEqual(STILL_PLACEHOLDERS);
    expect(placeholderZones(views)).toEqual(STILL_PLACEHOLDERS);
    const again = createViews();
    for (let i = 0; i < views.length; i++) expect(again[i]).not.toBe(views[i]);
    // A lane's view in place of a placeholder drops out of the placeholder list.
    const at = views.findIndex((v) => v.zone === STILL_PLACEHOLDERS[0]);
    const custom = { ...views[at], zone: STILL_PLACEHOLDERS[0] };
    expect(placeholderZones([...views.slice(0, at), custom, ...views.slice(at + 1)])).toEqual(
      STILL_PLACEHOLDERS.slice(1),
    );
  });
});

/** A stand-in for the scene's factory that records what a view made and how it was set up. */
function stubScene() {
  const made: {
    kind: string;
    depth: number | null;
    interactive: boolean;
    destroyed: boolean;
    text?: string;
  }[] = [];
  const paths: { x: number; y: number }[][] = [];
  const object = (kind: string, text?: string) => {
    const rec = { kind, depth: null as number | null, interactive: false, destroyed: false, text };
    made.push(rec);
    let path: { x: number; y: number }[] = [];
    const o = {
      setDepth: (d: number) => ((rec.depth = d), o),
      setAlpha: () => o,
      setInteractive: () => ((rec.interactive = true), o),
      destroy: () => {
        rec.destroyed = true;
      },
      lineStyle: () => o,
      beginPath: () => ((path = []), paths.push(path), o),
      moveTo: (x: number, y: number) => (path.push({ x, y }), o),
      lineTo: (x: number, y: number) => (path.push({ x, y }), o),
      strokePath: () => o,
    };
    return o;
  };
  const scene = {
    add: {
      graphics: () => object('Graphics'),
      text: (_x: number, _y: number, text: string) => object('Text', text),
    },
  };
  return { scene, made, paths };
}

describe('placeholder view', () => {
  const rect = ZONES.cam;

  it('draws a dashed outline and the zone name under the HUD, never interactive, within its budget', () => {
    const { scene, made, paths } = stubScene();
    const view = new PlaceholderView('cam');
    let lite = true;
    const host: LiveHost = {
      scene: scene as unknown as LiveHost['scene'],
      bus,
      rect,
      get flags() {
        return { lite };
      },
    };
    expect(view.budget).toEqual({ objects: 2, texts: 1 });
    expect(view.made).toEqual({ objects: 0, texts: 0 });
    view.create(host.scene, host);
    expect(view.made).toEqual({ objects: 2, texts: 1 });
    expect(withinBudget(view)).toBe(true);
    expect(made.map((m) => m.kind)).toEqual(['Graphics', 'Text']);
    expect(made.every((m) => m.depth === PLACEHOLDER_DEPTH)).toBe(true);
    expect(PLACEHOLDER_DEPTH).toBeLessThan(0);
    expect(made.every((m) => !m.interactive)).toBe(true);
    expect(made[1].text).toBe('CAM');
    // The outline stays inside the zone's rect.
    expect(paths).toHaveLength(1);
    for (const p of paths[0]) {
      expect(p.x).toBeGreaterThanOrEqual(rect.x);
      expect(p.x).toBeLessThanOrEqual(rect.x + rect.w);
      expect(p.y).toBeGreaterThanOrEqual(rect.y);
      expect(p.y).toBeLessThanOrEqual(rect.y + rect.h);
    }
    // Lite changes nothing it draws: there is no effect to drop.
    lite = false;
    view.update();
    expect(made).toHaveLength(2);
    view.shutdown();
    expect(made.every((m) => m.destroyed)).toBe(true);
    expect(view.made).toEqual({ objects: 0, texts: 0 });
  });

  it('cuts the outline into dashes that end on each corner', () => {
    const segs = dashedOutline({ x: 10, y: 20, w: 30, h: 14 }, 8, 6);
    // Top edge: 30 long at a 14 pitch: 0-8, 14-22, 28-30.
    expect(segs.slice(0, 3)).toEqual([
      { x1: 10, y1: 20, x2: 18, y2: 20 },
      { x1: 24, y1: 20, x2: 32, y2: 20 },
      { x1: 38, y1: 20, x2: 40, y2: 20 },
    ]);
    // Right edge: 14 long: 0-8 then 14-14 is past the end, so one dash.
    expect(segs[3]).toEqual({ x1: 40, y1: 20, x2: 40, y2: 28 });
    expect(segs[4]).toEqual({ x1: 40, y1: 34, x2: 32, y2: 34 });
    expect(segs).toHaveLength(3 + 1 + 3 + 1);
    expect(PLACEHOLDER_DASH).toEqual({ dash: 8, gap: 6 });
    const budget = { budget: { objects: 2, texts: 1 }, made: { objects: 3, texts: 1 } };
    expect(withinBudget(budget)).toBe(false);
  });
});

describe('live hook sections', () => {
  const canvas = { left: 0, top: 0, width: 1280, height: 720 };

  it('reports every zone on the page, the placeholders left and the layout version', () => {
    const views = createViews();
    const live = liveTestState(canvas, views);
    expect(live.layoutVersion).toBe(LAYOUT_VERSION);
    expect(Object.keys(live.zones)).toEqual(ZONE_IDS);
    for (const id of ZONE_IDS) expect(live.zones[id]).toEqual(pageRect(ZONES[id], canvas));
    expect(live.zones.feed).toEqual({ x: 303.3, y: 73.3, w: 970, h: 353.3 });
    expect(live.placeholders).toEqual(STILL_PLACEHOLDERS);
  });

  it('counts the display lists by kind and rounds the frame rate', () => {
    const board = [{ type: 'Image' }, { type: 'Graphics' }, { type: 'Text' }, { type: 'Container' }];
    const hud = [{ type: 'Text' }, { type: 'Text' }, { type: 'Graphics' }, { type: 'NineSlice' }];
    expect(countDisplayList(board)).toEqual({ objects: 4, texts: 1, graphics: 1 });
    expect(perfTestState(board, hud, 59.94, true)).toEqual({
      objects: { board: 4, hud: 4 },
      texts: 3,
      graphics: 2,
      fps: { avg: 59.9 },
      lite: true,
    });
    expect(perfTestState([], [], NaN, false)).toEqual({
      objects: { board: 0, hud: 0 },
      texts: 0,
      graphics: 0,
      fps: { avg: 0 },
      lite: false,
    });
  });
});

describe('lane anchors in the script and the strings file', () => {
  const lanes = ['board', 'gauges', 'comms', 'chat', 'luxcam', 'learning'];

  it('has one section per lane in docs/SCRIPT.md, each with the line table header', () => {
    const lines = script.split('\n');
    for (const lane of lanes) {
      const at = lines.findIndex((l) => l.includes(`<!-- anchor: ${lane} -->`));
      expect(at, lane).toBeGreaterThan(0);
      expect(lines[at].startsWith('### '), lane).toBe(true);
      expect(lines[at + 2], lane).toBe('| ID | Kind | Speaker | When | Line |');
      expect(lines[at + 3], lane).toBe('| --- | --- | --- | --- | --- |');
      // Lanes fill their own section: every row under the header is a five-column line row.
      for (let i = at + 4; i < lines.length && lines[i].startsWith('|'); i++) {
        expect(lines[i], lane).toMatch(/^\| (C\d|fill)\.[^|]+(\|[^|]*){4}\|$/);
      }
    }
  });

  it('has the matching anchor comment inside LINES in src/strings.ts', () => {
    const open = strings.indexOf('export const LINES = {');
    const close = strings.indexOf('} as const satisfies Record<string, Line>;');
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
    const body = strings.slice(open, close);
    for (const lane of lanes) expect(body, lane).toContain(`// anchor: ${lane}\n`);
  });
});
