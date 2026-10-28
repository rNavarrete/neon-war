import { artRequest, isPicked } from '../src/game/artManifest';
import { Bus } from '../src/game/bus';
import { readFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import { AlertView } from '../src/scenes/hud/AlertView';
import { ChartView } from '../src/scenes/hud/ChartView';
import { DeckView } from '../src/scenes/hud/DeckView';
import { GaugeView } from '../src/scenes/hud/GaugeView';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';
import {
  ALERT_ENDS,
  CORNER_SIZE,
  FRAME_EDGE,
  KIT,
  KIT_FILE,
  KIT_K,
  KIT_KEYS,
  PRESSED_SECONDS,
  type Stamp,
  alertEndcap,
  alertPlateStamps,
  cornerStamps,
  dividerStamp,
  edgeRun,
  frameStamps,
  keyCap,
  livePill,
  maxScale,
  panelStamps,
  stampKeys,
} from '../src/scenes/hud/kit';
import { MapView } from '../src/scenes/hud/MapView';
import { bakePanel, panelTexture, releasePanel } from '../src/scenes/hud/panel';
import { TitleView } from '../src/scenes/hud/TitleView';
import { CARDS, type Rect, ZONES } from '../src/scenes/live/layout';
import type { LiveHost, LiveView } from '../src/scenes/live/view';
import { artTexture } from '../src/scenes/plates';

vi.mock('../src/testHook', async (actual) => ({
  ...(await actual<typeof import('../src/testHook')>()),
  provideTestState: () => undefined,
}));

// M4 panel kit: the picked frame language (docs/ART-REQUESTS.md batch 4) on the gauges lane's Live
// panels. kit.ts is the pure geometry; panel.ts bakes it, one texture per panel.

const inBox = (s: Stamp, w: number, h: number): boolean =>
  s.x >= 0 && s.y >= 0 && s.x + s.w <= w && s.y + s.h <= h;

describe('the kit files', () => {
  it('are picked, and kit.ts knows each file at the size the manifest gives its cut', () => {
    for (const key of KIT_KEYS) {
      const r = artRequest(key);
      expect(r, key).toBeDefined();
      expect(isPicked(r!), key).toBe(true);
      expect(r!.cut, key).toEqual(KIT_FILE[key]);
    }
  });
});

describe('frameStamps: the panel frame nine-sliced at k 0.5', () => {
  for (const [w, h] of [
    [408, 170],
    [408, 310],
    [440, 100],
    [771, 105],
    [340, 250],
  ] as const)
    it(`covers a ${w} x ${h} panel's edge once, corners and lamps at k, only rails stretched`, () => {
      const st = frameStamps(w, h);
      for (const s of st) expect(inBox(s, w, h), JSON.stringify(s)).toBe(true);
      // Corners: the file's 48 px corners at 24 px.
      const corners = st.filter((s) => s.src.w === 48 && s.src.h === 48);
      expect(corners).toHaveLength(4);
      for (const c of corners) expect([c.w, c.h]).toEqual([FRAME_EDGE, FRAME_EDGE]);
      // Every piece that is not a rail is drawn at exactly k: nothing past its file's size.
      for (const s of st.filter((x) => !x.stretch)) {
        expect(s.w / s.src.w).toBeCloseTo(KIT_K, 1);
        expect(s.h / s.src.h).toBeCloseTo(KIT_K, 1);
      }
      // Rails stretch only along their edge: across it they are at k too.
      for (const s of st.filter((x) => x.stretch)) {
        const across = s.y === 0 || s.y === h - FRAME_EDGE ? s.h / s.src.h : s.w / s.src.w;
        expect(across).toBeCloseTo(KIT_K, 5);
      }
      // The top edge runs from corner to corner with no gap or overlap.
      const top = st.filter((s) => s.y === 0).sort((a, b) => a.x - b.x);
      let at = 0;
      for (const s of top) {
        expect(s.x).toBe(at);
        at += s.w;
      }
      expect(at).toBe(w);
      expect(maxScale(st)).toBeCloseTo(KIT_K, 1);
    });

  it('splits an edge into rail, lamp at k, rail, in proportion to the rails in the file', () => {
    expect(edgeRun(360, 72, 122, 48, 144, 0.5)).toEqual([175, 25, 160]);
    // Too short for the lamp: one stretched rail.
    expect(edgeRun(10, 72, 122, 48, 144, 0.5)).toEqual([10, 0, 0]);
  });
});

describe('cornerStamps: one bracket, turned for each corner', () => {
  it('puts the 59 px bracket at each corner, turned a quarter more each time, never above its size', () => {
    const st = cornerStamps(408, 170);
    expect(st.map((s) => s.rotation)).toEqual([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]);
    expect(st.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [408 - CORNER_SIZE, 0],
      [408 - CORNER_SIZE, 170 - CORNER_SIZE],
      [0, 170 - CORNER_SIZE],
    ]);
    for (const s of st) expect(s.src).toEqual({ x: 0, y: 0, w: 59, h: 59 });
    expect(maxScale(cornerStamps(100, 100, 200))).toBe(1);
  });
});

describe('panelStamps', () => {
  it('draws the base first, then dividers, frame, tab and corners, all inside the rect and at or under 1:1', () => {
    const r: Rect = ZONES.map;
    const st = panelStamps(r, {
      base: KIT.cityGrid,
      frame: true,
      corners: 30,
      tab: { x: r.x + 4, y: r.y + 4, h: 26 },
      dividers: [{ x: r.x + 200, y: r.y + 20, h: 200 }],
    });
    expect(stampKeys(st)).toEqual([KIT.cityGrid, KIT.divider, KIT.frame, KIT.tab, KIT.corner]);
    for (const s of st) expect(inBox(s, r.w, r.h), s.key).toBe(true);
    expect(maxScale(st)).toBeLessThanOrEqual(1);
    // The city grid fills the map at half its 816 x 620 file.
    expect(st[0]).toMatchObject({ x: 0, y: 0, w: 408, h: 310 });
    // A divider is never drawn longer than its 160 px file.
    expect(dividerStamp(0, 0, 400).h).toBe(160);
    expect(dividerStamp(0, 0, 100)).toMatchObject({ w: 4, h: 100 });
  });

  it('nine-slices the alert plate at k 0.5: both painted ends whole, the plain middle stretched', () => {
    const st = alertPlateStamps(1040, 84);
    expect(st).toHaveLength(3);
    expect(st.reduce((n, s) => n + s.w, 0)).toBe(1040);
    expect(st[0]).toMatchObject({ x: 0, w: ALERT_ENDS.left / 2, h: 84, stretch: false });
    expect(st[2]).toMatchObject({ w: (1040 - ALERT_ENDS.right) / 2, stretch: false });
    expect(st[1].stretch).toBe(true);
    expect(maxScale(st)).toBe(0.5);
    const cap = alertEndcap(ZONES.alert);
    expect(cap).toEqual({ x: 1500 - 68, y: 8, w: 68, h: 84 });
    const panel = panelStamps(ZONES.alert, { alert: { endcap: true } });
    expect(stampKeys(panel)).toEqual([KIT.alertPlate, KIT.alertEndcap]);
    expect(maxScale(panel)).toBeLessThanOrEqual(1);
  });
});

describe('keyCap and the pill', () => {
  it('shows pressed for a moment after a press that acted, else ready when lit, else idle', () => {
    expect(keyCap(false, 5, null)).toBe(KIT.keyIdle);
    expect(keyCap(true, 5, null)).toBe(KIT.keyReady);
    expect(keyCap(true, 5, 5)).toBe(KIT.keyPressed);
    expect(keyCap(false, 5 + PRESSED_SECONDS / 2, 5)).toBe(KIT.keyPressed);
    expect(keyCap(true, 5 + PRESSED_SECONDS, 5)).toBe(KIT.keyReady);
  });

  it('draws the LIVE pill at k: 95 x 28 from the 189 x 56 file', () => {
    expect(livePill(10, 20)).toEqual({ x: 10, y: 20, w: 95, h: 28 });
  });
});

// ---- the bake, against a stub scene that can bake ----

interface Baking {
  stamps: { texture: string; frame: string; x: number; y: number; scaleX: number; scaleY: number }[];
  textures: string[];
  graphics: number;
  images: { x: number; y: number; key: string; kind: string }[];
}

/** A scene whose texture manager has every picked file loaded and can bake DynamicTextures. */
function bakingScene(loaded = true) {
  const rec: Baking = { stamps: [], textures: [], graphics: 0, images: [] };
  const made: { kind: string; destroyed: boolean }[] = [];
  const object = (kind: string): unknown => {
    const m = { kind, destroyed: false };
    made.push(m);
    const o: unknown = new Proxy(
      { width: 100, height: 100, visible: true, input: { enabled: true } },
      {
        get(target, prop) {
          if (prop in target) return (target as Record<string, unknown>)[prop as string];
          if (prop === 'destroy') return () => ((m.destroyed = true), undefined);
          if (prop === 'text') return '';
          return () => o;
        },
      },
    );
    return o;
  };
  const exists = new Set<string>();
  const scene = {
    add: {
      graphics: () => object('Graphics'),
      image: (x: number, y: number, key: string) => {
        rec.images.push({ x, y, key, kind: 'Image' });
        return object('Image');
      },
      text: () => object('Text'),
      circle: () => object('Arc'),
      container: () => object('Container'),
      tileSprite: () => object('TileSprite'),
      zone: () => object('Zone'),
    },
    make: {
      graphics: () => {
        rec.graphics++;
        return object('MadeGraphics');
      },
    },
    textures: {
      exists: (key: string) => exists.has(key) || (loaded && key.startsWith('art:')),
      getFrame: () => ({ width: 256, height: 256 }),
      get: () => ({ has: () => false, add: () => undefined }),
      addDynamicTexture: (key: string) => {
        exists.add(key);
        rec.textures.push(key);
        return {
          draw: () => undefined,
          erase: () => undefined,
          render: () => undefined,
          stamp: (
            texture: string,
            frame: string,
            x: number,
            y: number,
            c: { scaleX: number; scaleY: number },
          ) => rec.stamps.push({ texture, frame, x, y, scaleX: c?.scaleX ?? 1, scaleY: c?.scaleY ?? 1 }),
        };
      },
    },
    load: { image: () => undefined },
    events: { on: () => undefined, off: () => undefined, once: () => undefined },
    input: null,
    game: { loop: { time: 0 }, canvas: null },
  };
  return { scene, rec, made };
}

describe('bakePanel', () => {
  it('bakes one texture per panel from the picked files, reuses it, and shows it as one image', () => {
    const { scene, rec } = bakingScene();
    const r = CARDS.dialCard;
    const p = bakePanel(
      scene as never,
      'kit-test',
      r,
      { frame: true, corners: 30 },
      { fill: { color: 0, alpha: 1 } },
    );
    expect(rec.textures).toEqual([panelTexture('kit-test')]);
    expect(rec.images).toEqual([{ x: r.x, y: r.y, key: 'live-kit:kit-test', kind: 'Image' }]);
    expect(p.state).toMatchObject({
      texture: 'live-kit:kit-test',
      pieces: [KIT.frame, KIT.corner],
      missing: [],
    });
    expect(p.state.maxScale).toBeLessThanOrEqual(1);
    // Every stamp is one of the two picked files, never above 1:1 except the frame's rails.
    const textures = new Set(rec.stamps.map((s) => s.texture));
    expect([...textures]).toEqual([artTexture(KIT.frame), artTexture(KIT.corner)]);
    for (const s of rec.stamps.filter((x) => x.texture === artTexture(KIT.corner))) {
      expect(s.scaleX).toBeLessThanOrEqual(1);
      expect(s.scaleY).toBeLessThanOrEqual(1);
    }
    // A second HUD start finds the texture and draws nothing again.
    const before = rec.stamps.length;
    bakePanel(scene as never, 'kit-test', r, { frame: true, corners: 30 });
    expect(rec.stamps.length).toBe(before);
    expect(rec.textures).toHaveLength(1);
    releasePanel(p);
  });

  it('falls back to one code plate with a rim when the scene cannot bake, and names what is missing', () => {
    const scene = { add: { graphics: () => new Proxy({}, { get: () => () => undefined }) } };
    const p = bakePanel(scene as never, 'kit-stub', ZONES.gauge, { frame: true, corners: 30 });
    expect(p.state.texture).toBeNull();
    expect(p.state.pieces).toEqual([]);
    expect(p.state.missing).toEqual([KIT.frame, KIT.corner]);
  });

  it('skips a piece whose file is not loaded, and draws the frame as a code rim instead', () => {
    const { scene, rec } = bakingScene(false);
    const p = bakePanel(scene as never, 'kit-unloaded', ZONES.scope, { frame: true, corners: 30 });
    expect(p.state.texture).toBe('live-kit:kit-unloaded');
    expect(p.state.pieces).toEqual([]);
    expect(p.state.missing).toEqual([KIT.frame, KIT.corner]);
    expect(rec.stamps).toEqual([]);
  });
});

// ---- the views with their art loaded: one baked plate each, inside the same budgets ----

describe('the gauges lane views with the kit loaded', () => {
  const host = (rect: Rect): LiveHost => ({
    scene: null as never,
    bus: new Bus(),
    rect,
    flags: { lite: true },
  });
  const cases: [string, () => LiveView, Rect][] = [
    ['title', () => new TitleView(), ZONES.title],
    ['gauge', () => new GaugeView(), ZONES.gauge],
    ['scope', () => new ChartView(), ZONES.scope],
    ['map', () => new MapView(), ZONES.map],
    ['deck', () => new DeckView(), ZONES.deck],
    ['alert', () => new AlertView(), ZONES.alert],
  ];
  for (const [name, make, rect] of cases)
    it(`${name}: draws its baked plate inside its budget`, () => {
      const { scene, rec, made } = bakingScene();
      const v = make();
      v.create(scene as never, host(rect));
      const madeHere = made.filter((m) => m.kind !== 'MadeGraphics');
      expect(madeHere.length, name).toBeLessThanOrEqual(v.budget.objects);
      expect(madeHere.filter((m) => m.kind === 'Text').length).toBeLessThanOrEqual(v.budget.texts);
      const plateName = name === 'deck' ? 'headroom' : name;
      expect(
        rec.images.some((i) => i.key === `live-kit:${plateName}`),
        name,
      ).toBe(true);
      v.update(readFrame(new Run()), { now: 1, dt: 0.016 }, []);
      v.shutdown();
      // The alert band destroys its container with its children (Phaser's destroy(true)).
      const owned = made.filter((m) => m.kind !== 'MadeGraphics');
      if (name === 'alert') expect(owned.find((m) => m.kind === 'Container')?.destroyed).toBe(true);
      else expect(owned.every((m) => m.destroyed)).toBe(true);
    });

  it('deck: the keys wear the picked keycaps and SET carries the play glyph', () => {
    const { scene, rec } = bakingScene();
    const v = new DeckView();
    v.create(scene as never, host(ZONES.deck));
    expect(rec.images.filter((i) => i.key === artTexture(KIT.keyIdle))).toHaveLength(3);
    expect(rec.images.filter((i) => i.key === artTexture(KIT.play))).toHaveLength(1);
    v.update(readFrame(new Run()), { now: 1, dt: 0.016 });
    const h = hudSection({} as HudTestState);
    for (const k of ['one', 'two', 'three'] as const) expect(h.deck!.keys[k].cap).toBe(KIT.keyIdle);
    expect(h.deck!.play).toEqual({ drawn: true, lit: false });
    expect(h.headroom!.panel!.pieces).toEqual([KIT.divider, KIT.frame, KIT.corner]);
    v.shutdown();
  });

  it('map: the painted city grid is the base, and CUT OFF has its red chip', () => {
    const { scene, rec } = bakingScene();
    const v = new MapView();
    v.create(scene as never, host(ZONES.map));
    expect(rec.stamps.some((s) => s.texture === artTexture(KIT.cityGrid) && s.scaleX === 0.5)).toBe(true);
    expect(rec.images.some((i) => i.key === artTexture(KIT.chip))).toBe(true);
    const h = hudSection({} as HudTestState);
    expect(h.map!.base).toBe('hud/city-grid');
    v.shutdown();
  });
});
