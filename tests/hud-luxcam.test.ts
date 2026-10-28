import luxCamViewSource from '../src/scenes/hud/LuxCamView.ts?raw';
import { Bus } from '../src/game/bus';
import { type Frame, readFrame } from '../src/game/frame';
import type { Occurrence } from '../src/game/occurrences';
import { allBoardFaces, portraitOfFile } from '../src/game/portraits';
import { Run } from '../src/game/run';
import { updateSettings } from '../src/game/settings';
import { CAM_WORDS, LuxCamView } from '../src/scenes/hud/LuxCamView';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';
import {
  CAM_ACTION_FOCUS,
  CAM_BACKDROP_KEY,
  CAM_FADE,
  CAM_LEAN_RELEASE,
  CAM_LENS,
  REC_PERIOD,
  type LuxCamTestState,
  camFileLanded,
  camLayout,
  camPortraits,
  camTextureOf,
  emptyCamView,
  emptyCrop,
  fadeAlpha,
  fillCamView,
  lensCrop,
  recOn,
} from '../src/scenes/hud/luxcam';
import { REGISTRY } from '../src/scenes/live/registry';
import { type Rect, ZONES, inside, pageRect } from '../src/scenes/live/layout';
import type { LiveHost } from '../src/scenes/live/view';
import { fileTexture } from '../src/scenes/plates';
import {
  CAM_ART,
  CAM_GOGGLES_AT,
  CAM_MOODS,
  type CamMood,
  type CamState,
  type CamView,
  NO_CAM_EXTRAS,
  camArtFile,
  camFacts,
  camStep,
  camViewOf,
  initialCam,
} from '../src/scenes/hud/luxcam';
import { HEADROOM_AMBER_FROM, HEADROOM_EXIT } from '../src/scenes/hud/thresholds';
import { BROWNOUT } from '../src/sim/brownout';

// luxcam-1: the cam's pure mood selector (src/scenes/hud/luxcam.ts).

interface Fs {
  existsSync(path: string): boolean;
}
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }
).process.getBuiltinModule('node:fs') as Fs;
const PUBLIC = new URL('../public/', import.meta.url).pathname;
const onDisk = (file: string): boolean => fs.existsSync(PUBLIC + file);

/** A quiet view: wired 100 req/s, demand 30 (load 0.3), nothing going on. */
const QUIET: CamView = {
  clock: 0,
  now: 100,
  paused: false,
  demand: 30,
  wiredCapacity: 100,
  errorShare: 0,
  surgeWarning: false,
  dipWarning: false,
  overheating: false,
  timeScale: 1,
  failure: false,
  rewinds: 0,
  rescued: false,
  midnightHeld: false,
  bannerBinned: false,
  dragging: false,
  luxSpeaking: false,
  actionAt: null,
  shockAt: null,
};

const DT = 0.016;

/** Settle a fresh cam on the quiet view for 10 s, ending at clock `at`. */
function settled(at = 10): CamState {
  let s = initialCam(at - 10);
  for (let c = at - 10; c <= at + 1e-9; c += 0.1) s = camStep(s, { ...QUIET, clock: c });
  return camStep(s, { ...QUIET, clock: at });
}

/** Step from `s` at 16 ms frames over [from, to], the view from `view(clock)`; records every mood. */
function run(
  s: CamState,
  from: number,
  to: number,
  view: (clock: number) => Partial<CamView>,
  seen?: CamMood[],
): CamState {
  const n = Math.round((to - from) / DT);
  for (let i = 1; i <= n; i++) {
    const clock = from + i * DT;
    s = camStep(s, { ...QUIET, ...view(clock), clock });
    seen?.push(s.mood);
  }
  // Land exactly on `to`.
  s = camStep(s, { ...QUIET, ...view(to), clock: to });
  seen?.push(s.mood);
  return s;
}

describe('camStep purity', () => {
  it('returns the identical state when nothing changes, and never mutates its inputs', () => {
    const s = settled();
    expect(s.mood).toBe('calm');
    const v = Object.freeze({ ...QUIET, clock: 11 });
    const frozen = Object.freeze({ ...s });
    expect(camStep(frozen, v)).toBe(frozen);
    for (let c = 11; c < 70; c += 0.5) {
      const next = camStep(s, { ...QUIET, clock: c });
      expect(next).toBe(s);
    }
    // A change gives a new object and leaves the old one as it was.
    const copy = JSON.stringify(s);
    const hot = Object.freeze({ ...QUIET, clock: 12, errorShare: 0.3 });
    const next = camStep(Object.freeze(s), hot);
    expect(next).not.toBe(s);
    expect(JSON.stringify(s)).toBe(copy);
    expect(hot.errorShare).toBe(0.3);
  });

  it('freezes while paused', () => {
    const s = settled();
    expect(camStep(s, { ...QUIET, clock: 30, paused: true, failure: true, errorShare: 1 })).toBe(s);
  });
});

describe('panic hysteresis', () => {
  it('never panics on a 0.49 / 0.51 square wave for 30 s', () => {
    const seen: CamMood[] = [];
    run(settled(), 10, 40, (c) => ({ errorShare: Math.round((c - 10) / DT) % 2 === 0 ? 0.49 : 0.51 }), seen);
    expect(seen).not.toContain('panicking');
    expect(seen).toContain('tense');
  });

  it('panics on 0.6 held 0.5 s and stays at least 2 s after errors drop to 0', () => {
    // errorShare 0.6 from the frame at 10.0.
    let s = camStep(settled(), { ...QUIET, clock: 10, errorShare: 0.6 });
    s = run(s, 10, 10.45, () => ({ errorShare: 0.6 }));
    expect(s.mood).not.toBe('panicking');
    s = run(s, 10.45, 10.5, () => ({ errorShare: 0.6 }));
    expect(s.mood).toBe('panicking');
    const seen: CamMood[] = [];
    s = run(s, 10.5, 12.45, () => ({ errorShare: 0 }), seen);
    expect(seen.every((m) => m === 'panicking')).toBe(true);
    s = run(s, 12.45, 12.5, () => ({ errorShare: 0 }));
    expect(s.mood).toBe('panicking');
    s = run(s, 12.5, 16, () => ({ errorShare: 0 }));
    expect(s.mood).not.toBe('panicking');
  });

  it('panics at once on a failure, and for 2 s after a died or dip shock', () => {
    const s = settled();
    expect(camStep(s, { ...QUIET, clock: 10.016, failure: true }).mood).toBe('panicking');
    const shocked = run(s, 10, 11.9, () => ({ shockAt: 10.016 }));
    expect(shocked.mood).toBe('panicking');
  });
});

describe('tense on the bar’s thresholds', () => {
  it('uses thresholds.ts: amber from 0.7, exit under 0.6', () => {
    expect(HEADROOM_AMBER_FROM).toBe(0.7);
    expect(HEADROOM_EXIT).toBe(0.6);
  });

  it('enters tense at load 0.75 only after 0.5 s, stays at 0.65, and releases after 2 s at 0.55', () => {
    const seen: CamMood[] = [];
    // Load 0.75 from the frame at 10.0.
    let s = camStep(settled(), { ...QUIET, clock: 10, demand: 75 });
    s = run(s, 10, 10.48, () => ({ demand: 75 }), seen);
    expect(seen).not.toContain('tense');
    s = run(s, 10.48, 10.5, () => ({ demand: 75 }));
    expect(s.mood).toBe('tense');
    s = run(s, 10.5, 30, () => ({ demand: 65 }));
    expect(s.mood).toBe('tense');
    s = camStep(s, { ...QUIET, clock: 30, demand: 55 });
    s = run(s, 30, 31.95, () => ({ demand: 55 }));
    expect(s.mood).toBe('tense');
    s = run(s, 31.95, 32, () => ({ demand: 55 }));
    expect(s.mood).not.toBe('tense');
    // Twenty seconds of amber earn the relieved beat (3 s), then the bar's band says focused.
    expect(s.mood).toBe('relieved');
    s = run(s, 32, 35.1, () => ({ demand: 55 }));
    expect(s.mood).toBe('focused');
  });

  it('a surge warning, a dip warning or an overheating server held 0.5 s turns tense', () => {
    for (const fact of [{ surgeWarning: true }, { dipWarning: true }, { overheating: true }]) {
      const s = run(settled(), 10, 10.6, () => fact);
      expect(s.mood).toBe('tense');
    }
  });
});

describe('the beats', () => {
  it('a rewind gives exhausted for exactly 3.0 s, then calm; a surge warning does not cut it', () => {
    let s = settled();
    s = camStep(s, { ...QUIET, clock: 10.016, rewinds: 1 });
    expect(s.mood).toBe('exhausted');
    expect(s.since).toBe(10.016);
    const seen: CamMood[] = [];
    s = run(s, 10.016, 13.0, (c) => ({ rewinds: 1, surgeWarning: c > 11 && c < 12 }), seen);
    expect(seen.slice(0, -1).every((m) => m === 'exhausted')).toBe(true);
    s = camStep(s, { ...QUIET, clock: 13.015, rewinds: 1 });
    expect(s.mood).toBe('exhausted');
    s = camStep(s, { ...QUIET, clock: 13.016, rewinds: 1 });
    expect(s.mood).toBe('calm');
  });

  it('a failure cuts the exhausted beat', () => {
    let s = camStep(settled(), { ...QUIET, clock: 10.016, rewinds: 1 });
    s = camStep(s, { ...QUIET, clock: 11, rewinds: 1, failure: true });
    expect(s.mood).toBe('panicking');
  });

  it('a held midnight gives cheer for 6.0 s exactly once per run', () => {
    let s = camStep(settled(), { ...QUIET, clock: 10, midnightHeld: true });
    expect(s.mood).toBe('cheer');
    s = run(s, 10, 15.98, () => ({ midnightHeld: true }));
    expect(s.mood).toBe('cheer');
    s = run(s, 15.98, 16, () => ({ midnightHeld: true }));
    expect(s.mood).toBe('calm');
    // Held again (a later read) never cheers twice.
    s = run(s, 16, 18, () => ({ midnightHeld: false }));
    const seen: CamMood[] = [];
    run(s, 18, 30, () => ({ midnightHeld: true }), seen);
    expect(seen).not.toContain('cheer');
  });

  it('gogglesUp from now >= 537, and it sticks', () => {
    expect(CAM_GOGGLES_AT).toBe(BROWNOUT.challenges.c8 - 3);
    expect(CAM_GOGGLES_AT).toBe(537);
    let s = camStep(settled(), { ...QUIET, clock: 10, now: 536.9 });
    expect(s.mood).toBe('calm');
    s = camStep(s, { ...QUIET, clock: 10.1, now: 537 });
    expect(s.mood).toBe('gogglesUp');
    s = run(s, 10.1, 20, () => ({ now: 400, errorShare: 0.9, midnightHeld: true, rewinds: 1 }));
    expect(s.mood).toBe('gogglesUp');
  });

  it('the rescue and leaving long stress give relieved', () => {
    expect(camStep(settled(), { ...QUIET, clock: 10, rescued: true }).mood).toBe('relieved');
    let s = run(settled(), 10, 18, () => ({ errorShare: 0.3 }));
    expect(s.mood).toBe('tense');
    s = run(s, 18, 20.1, () => ({ errorShare: 0 }));
    expect(s.mood).toBe('relieved');
  });

  it('a drag or Regroup leans; an action or Lux speaking focuses', () => {
    expect(run(settled(), 10, 10.1, () => ({ dragging: true })).mood).toBe('leaning');
    expect(run(settled(), 10, 10.1, () => ({ timeScale: 0.25 })).mood).toBe('leaning');
    expect(run(settled(), 10, 10.1, () => ({ luxSpeaking: true })).mood).toBe('focused');
    const s = run(settled(), 10, 10.1, () => ({ actionAt: 10.016 }));
    expect(s.mood).toBe('focused');
    // A drop to calm waits for 2.5 s of the action plus 1.5 s.
    expect(run(s, 10.1, 13.9, () => ({ actionAt: 10.016 })).mood).toBe('focused');
    expect(run(s, 10.1, 14.1, () => ({ actionAt: 10.016 })).mood).toBe('calm');
  });
});

describe('the no-information rule', () => {
  /** A seeded walk over the facts, changing one now and then. */
  function walk(seed: number): CamView[] {
    let a = seed;
    const rnd = () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648;
    let v: CamView = { ...QUIET };
    const out: CamView[] = [];
    for (let i = 0; i < 4000; i++) {
      const clock = 10 + i * 0.05;
      if (rnd() < 0.02) {
        const k = Math.floor(rnd() * 9);
        if (k === 0) v = { ...v, demand: Math.floor(rnd() * 120) };
        if (k === 1) v = { ...v, errorShare: [0, 0.1, 0.3, 0.6][Math.floor(rnd() * 4)] };
        if (k === 2) v = { ...v, surgeWarning: !v.surgeWarning };
        if (k === 3) v = { ...v, dragging: !v.dragging };
        if (k === 4) v = { ...v, luxSpeaking: !v.luxSpeaking };
        if (k === 5) v = { ...v, actionAt: clock };
        if (k === 6) v = { ...v, shockAt: clock };
        if (k === 7) v = { ...v, rewinds: v.rewinds + 1 };
        if (k === 8) v = { ...v, overheating: !v.overheating };
      }
      out.push({ ...v, clock });
    }
    return out;
  }

  it('is a pure function of the facts: the same views give the same moods', () => {
    const views = walk(7);
    const moods = (vs: CamView[]) => {
      let s = initialCam(10);
      return vs.map((v) => (s = camStep(s, v)).mood);
    };
    expect(moods(views)).toEqual(moods(views));
  });

  it('never changes mood without a fact or an occurrence changing within the longest hold', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const views = walk(seed);
      let s = initialCam(10);
      let lastFactsAt = 10;
      let prevFacts = camFacts(views[0]);
      let changes = 0;
      for (const v of views) {
        const facts = camFacts(v);
        if (facts !== prevFacts) lastFactsAt = v.clock;
        prevFacts = facts;
        const next = camStep(s, v);
        if (next.mood !== s.mood) {
          changes++;
          // The longest a fact keeps working: the 6 s relief threshold plus its 3 s beat.
          expect(v.clock - lastFactsAt).toBeLessThanOrEqual(9 + 1e-6);
        }
        s = next;
      }
      expect(changes).toBeGreaterThan(5);
      // With the facts frozen the mood settles and stays: the identical state comes back.
      const last = views[views.length - 1];
      for (let c = last.clock; c < last.clock + 20; c += 0.05) s = camStep(s, { ...last, clock: c });
      expect(camStep(s, { ...last, clock: last.clock + 40 })).toBe(s);
    }
  });

  it('reads only the Frame, the died and dip occurrences and the bus facts', () => {
    const r = new Run();
    r.now = BROWNOUT.challenges.c1;
    const f = readFrame(r);
    const died: Occurrence = { kind: 'died', id: 'server-1', at: f.now };
    const v = camViewOf(f, [died], NO_CAM_EXTRAS, 42);
    expect(v.shockAt).toBe(42);
    expect(v.now).toBe(f.now);
    expect(v.demand).toBe(f.demand);
    expect(v.wiredCapacity).toBe(f.wiredCapacity);
    expect(v.errorShare).toBe(f.errorShare);
    expect(v.rewinds).toBe(0);
    expect(camViewOf(f, [{ kind: 'placed', id: 'x', at: f.now }], NO_CAM_EXTRAS, 42).shockAt).toBeNull();
    expect(camViewOf(f, [{ kind: 'dip', id: 'x', at: f.now }], NO_CAM_EXTRAS, 43).shockAt).toBe(43);
  });
});

describe('CAM_ART', () => {
  it('maps every mood to a file under public/art and a positive scale', () => {
    expect(Object.keys(CAM_ART).sort()).toEqual([...CAM_MOODS].sort());
    for (const mood of CAM_MOODS) {
      const a = CAM_ART[mood];
      expect(a.scale).toBeGreaterThan(0);
      expect(a.breath).toBeGreaterThan(0);
      expect(a.file.startsWith('art/')).toBe(true);
      const file = camArtFile(mood, onDisk);
      expect(onDisk(file), `${mood}: ${file}`).toBe(true);
      if (a.fallback !== null) expect(onDisk(a.fallback)).toBe(true);
    }
  });

  it('falls back to the board faces determined and smirk while the cam set is missing', () => {
    const noCam = (file: string) => !file.includes('/cam/') && onDisk(file);
    expect(camArtFile('leaning', noCam)).toBe('art/chars/lux/faces-board/determined.webp');
    expect(camArtFile('relieved', noCam)).toBe('art/chars/lux/faces-board/smirk.webp');
    expect(camArtFile('leaning', () => true)).toBe('art/chars/lux/cam/lean-in.webp');
    expect(camArtFile('relieved', () => true)).toBe('art/chars/lux/cam/relieved.webp');
    expect(camArtFile('calm', noCam)).toBe('art/chars/lux/faces-board/deadpan.webp');
    expect(camArtFile('exhausted', noCam)).toBe('art/chars/lux/faces-room/exhausted.webp');
    expect(camArtFile('gogglesUp', noCam)).toBe('art/chars/lux/poses/goggles-up.webp');
  });
});

// ---- luxcam-2: the cam's geometry, art loading and the view against a stub scene ----

describe('the cam’s geometry', () => {
  it('puts a 388x230 lens and every piece inside ZONES.cam (x 16-424, y 430-700)', () => {
    expect(ZONES.cam).toEqual({ x: 16, y: 430, w: 408, h: 270 });
    const L = camLayout(ZONES.cam);
    expect(L.plate).toEqual(ZONES.cam);
    expect(L.lens.w).toBe(CAM_LENS.w);
    expect(L.lens.h).toBe(CAM_LENS.h);
    expect(L.lens).toEqual({ x: 26, y: 460, w: 388, h: 230 });
    expect(inside(L.lens, ZONES.cam)).toBe(true);
    for (const p of [L.label, L.recDot, L.recText, ...L.bars]) {
      expect(p.x).toBeGreaterThan(ZONES.cam.x);
      expect(p.x).toBeLessThan(ZONES.cam.x + ZONES.cam.w);
      expect(p.y).toBeGreaterThanOrEqual(ZONES.cam.y);
      expect(p.y).toBeLessThan(L.lens.y);
    }
    for (const b of L.bars) expect(b.y - L.barHeight).toBeGreaterThanOrEqual(ZONES.cam.y);
  });

  it('crops any image to the lens: what shows is always inside it', () => {
    const lens = camLayout(ZONES.cam).lens;
    const out = emptyCrop();
    // A 1000x1000 texture at 0.5 over the whole lens: the crop is the lens, in texture pixels.
    lensCrop(lens, 0, 400, 1000, 1000, 0.5, out);
    expect(out.visible).toEqual(lens);
    expect(out.x).toBeCloseTo((26 - 0) / 0.5);
    expect(out.y).toBeCloseTo((460 - 400) / 0.5);
    expect(out.w).toBeCloseTo(388 / 0.5);
    expect(out.h).toBeCloseTo(230 / 0.5);
    // Fully inside: no crop beyond the texture.
    lensCrop(lens, 100, 500, 100, 100, 1, out);
    expect(out).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
    // Off the lens: nothing shows.
    lensCrop(lens, 500, 500, 100, 100, 1, out);
    expect(out.visible.w * out.visible.h).toBe(0);
    // A sweep of placements and scales never shows anything outside the lens.
    for (let x = -300; x <= 500; x += 37)
      for (let y = 200; y <= 800; y += 41)
        for (const s of [0.2, 0.42, 1]) {
          lensCrop(lens, x, y, 430, 460, s, out);
          if (out.visible.w > 0) expect(inside(out.visible, lens)).toBe(true);
          expect(out.x).toBeGreaterThanOrEqual(0);
          expect(out.y).toBeGreaterThanOrEqual(0);
          expect(out.x + out.w).toBeLessThanOrEqual(430 + 1e-9);
          expect(out.y + out.h).toBeLessThanOrEqual(460 + 1e-9);
        }
  });
});

describe('the cam’s art', () => {
  it('loads all nine moods through the portrait keys, the picked cam set for leaning and relieved', () => {
    // luxcam-5: the cam set (D7) is picked, so the manifest says it landed and the cam draws it.
    expect(camFileLanded('art/chars/lux/cam/lean-in.webp')).toBe(true);
    expect(camFileLanded('art/chars/lux/cam/relieved.webp')).toBe(true);
    expect(camFileLanded('art/chars/lux/faces-board/deadpan.webp')).toBe(true);
    expect(camTextureOf('leaning')).toBe('portrait:lux/cam/lean-in');
    expect(camTextureOf('relieved')).toBe('portrait:lux/cam/relieved');
    expect(camTextureOf('calm')).toBe('portrait:lux/faces-board/deadpan');
    expect(camTextureOf('gogglesUp')).toBe('portrait:lux/poses/goggles-up');
    const files = camPortraits();
    for (const mood of CAM_MOODS) expect(files.map((p) => p.key)).toContain(camTextureOf(mood));
    for (const p of files) expect(onDisk(p.file), p.file).toBe(true);
    expect(files.filter((p) => p.file.includes('/cam/')).map((p) => p.key)).toEqual([
      'portrait:lux/cam/lean-in',
      'portrait:lux/cam/relieved',
    ]);
    expect(new Set(files.map((p) => p.key)).size).toBe(files.length);
  });

  it('portraits.ts: portraitOfFile keys a file as the speaker portraits do; allBoardFaces lists Lux’s six', () => {
    expect(portraitOfFile('art/chars/lux/faces-board/determined.webp')).toEqual({
      key: 'portrait:lux/faces-board/determined',
      file: 'art/chars/lux/faces-board/determined.webp',
    });
    const faces = allBoardFaces();
    expect(faces).toHaveLength(6);
    for (const p of faces) {
      expect(p.key.startsWith('portrait:lux/faces-board/')).toBe(true);
      expect(onDisk(p.file), p.file).toBe(true);
    }
  });
});

// The stub: every object records what a test needs (texture swaps, crops, alpha, visibility).

interface StubObject {
  kind: string;
  texture: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  visible: boolean;
  depth: number;
  text: string;
  destroyed: boolean;
  swaps: number;
  crop: { x: number; y: number; w: number; h: number } | null;
  [method: string]: unknown;
}

/** Sizes the stub gives each texture: the picked cut sizes for the faces, the bedroom for the backdrop. */
const SIZES: Record<string, { w: number; h: number }> = {
  'portrait:lux/faces-board/deadpan': { w: 410, h: 449 },
  'portrait:lux/faces-board/determined': { w: 436, h: 429 },
  'portrait:lux/faces-board/tense': { w: 425, h: 457 },
  'portrait:lux/faces-board/shocked': { w: 417, h: 456 },
  'portrait:lux/faces-board/smirk': { w: 427, h: 455 },
  'portrait:lux/faces-board/triumphant': { w: 506, h: 453 },
  'portrait:lux/faces-room/exhausted': { w: 460, h: 431 },
  'portrait:lux/poses/goggles-up': { w: 382, h: 953 },
  'art:bg/bedroom-dark': { w: 1536, h: 1024 },
  // luxcam-5: the picked cam set, backdrop and REC badge, at their real file sizes.
  'portrait:lux/cam/lean-in': { w: 924, h: 548 },
  'portrait:lux/cam/relieved': { w: 924, h: 548 },
  'art:hud/cam-backdrop': { w: 824, h: 504 },
  'art:hud/live/rec-badge': { w: 121, h: 48 },
};

function camStub(pointer = { x: 960, y: 540 }) {
  const made: StubObject[] = [];
  const object = (kind: string, texture = '', text = ''): StubObject => {
    const size = SIZES[texture] ?? { w: 0, h: 0 };
    const o = {
      kind,
      texture,
      width: size.w,
      height: size.h,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      visible: true,
      depth: 0,
      text,
      destroyed: false,
      swaps: 0,
      crop: null,
    } as StubObject;
    const self = new Proxy(o, {
      get(t, prop: string) {
        if (prop in t) return t[prop];
        switch (prop) {
          case 'setTexture':
            return (key: string) => {
              t.texture = key;
              t.swaps++;
              const s = SIZES[key] ?? { w: 0, h: 0 };
              t.width = s.w;
              t.height = s.h;
              return self;
            };
          case 'setCrop':
            return (x: number, y: number, w: number, h: number) => ((t.crop = { x, y, w, h }), self);
          case 'setPosition':
            return (x: number, y: number) => ((t.x = x), (t.y = y), self);
          case 'setScale':
            return (x: number, y = x) => ((t.scaleX = x), (t.scaleY = y), self);
          case 'setAlpha':
            return (a: number) => ((t.alpha = a), self);
          case 'setVisible':
            return (v: boolean) => ((t.visible = v), self);
          case 'setDepth':
            return (d: number) => ((t.depth = d), self);
          case 'destroy':
            return () => {
              t.destroyed = true;
            };
          default:
            return () => self;
        }
      },
      set(t, prop: string, v) {
        t[prop] = v;
        return true;
      },
    });
    made.push(o);
    return self;
  };
  const loaded: string[] = [];
  const scene = {
    add: {
      graphics: () => object('Graphics'),
      image: (_x: number, _y: number, key: string) => object('Image', key),
      text: (_x: number, _y: number, text: string) => object('Text', '', text),
      rectangle: () => object('Rectangle'),
      circle: () => object('Arc'),
    },
    textures: { exists: (key: string) => key in SIZES },
    load: { image: (key: string, file: string) => loaded.push(`${key} ${file}`) },
    input: { activePointer: pointer },
    game: { canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 960, height: 540 }) } },
  };
  return { scene, made, loaded, pointer };
}

const camHost = (scene: unknown, bus = new Bus(), lite = false): LiveHost => ({
  scene: scene as never,
  bus,
  rect: ZONES.cam,
  flags: { lite },
});

/** A frame of a fresh run at `now`, with fields overridden. */
function frameAt(now: number, over: Partial<Frame> = {}): Frame {
  return { ...readFrame(new Run()), now, ...over };
}

/** hud.luxCam as the hook publishes it. */
function camHook(): LuxCamTestState {
  const h = hudSection({} as HudTestState);
  if (!h.luxCam) throw new Error('hud.luxCam missing');
  return h.luxCam;
}

/** A frame script: quiet, then load at 0.75 (tense), then errors (panic), then quiet, with a rewind. */
function scripted(t: number): Partial<Frame> {
  if (t < 3) return { demand: 30, wiredCapacity: 100, errorShare: 0 };
  if (t < 7) return { demand: 75, wiredCapacity: 100, errorShare: 0 };
  if (t < 11) return { demand: 150, wiredCapacity: 100, errorShare: 0.6 };
  return { demand: 20, wiredCapacity: 100, errorShare: 0 };
}

describe('LuxCamView', () => {
  it('is the cam’s registry line, draws inside its budget at depth > 0, and loads its art in preload', () => {
    expect(REGISTRY.find((e) => e.zone === 'cam')?.make()).toBeInstanceOf(LuxCamView);
    const { scene, made, loaded } = camStub();
    const v = new LuxCamView();
    v.preload(scene as never);
    // The bedroom stands in for hud/cam-backdrop; every mood's portrait (with fallbacks) is queued.
    expect(loaded).toEqual([]); // the stub already has every texture, so nothing is queued twice
    const empty = camStub();
    empty.scene.textures.exists = () => false;
    v.preload(empty.scene as never);
    // luxcam-5: the picked backdrop, REC badge and cam set load, not the bedroom stand-in.
    expect(empty.loaded).toContain(`${fileTexture('art/hud/cam-backdrop.webp')} art/hud/cam-backdrop.webp`);
    expect(empty.loaded).toContain(
      `${fileTexture('art/hud/live/rec-badge.webp')} art/hud/live/rec-badge.webp`,
    );
    expect(empty.loaded.some((l) => l.includes('bedroom-dark'))).toBe(false);
    for (const p of camPortraits()) expect(empty.loaded).toContain(`${p.key} ${p.file}`);
    expect(empty.loaded.some((l) => l.includes('/cam/'))).toBe(true);
    expect(CAM_BACKDROP_KEY).toBe('hud/cam-backdrop');

    v.create(scene as never, camHost(scene));
    expect(made.length).toBeLessThanOrEqual(v.budget.objects);
    expect(made.filter((m) => m.kind === 'Text').length).toBeLessThanOrEqual(v.budget.texts);
    expect(made.filter((m) => m.kind === 'Text').map((m) => m.text)).toEqual([
      CAM_WORDS.title,
      CAM_WORDS.rec,
    ]);
    expect(made.every((m) => m.depth > 0)).toBe(true);
    v.shutdown();
    expect(made.every((m) => m.destroyed)).toBe(true);
  });

  it('prints no number and no mood word', () => {
    for (const w of Object.values(CAM_WORDS)) {
      expect(w).not.toMatch(/\d/);
      for (const mood of CAM_MOODS) expect(w.toLowerCase()).not.toContain(mood.toLowerCase());
    }
  });

  it('shows the face and the backdrop only inside the lens; hook zone is ZONES.cam in page px', () => {
    const { scene, made, pointer } = camStub({ x: 0, y: 0 });
    const v = new LuxCamView();
    v.create(scene as never, camHost(scene));
    const lens = camLayout(ZONES.cam).lens;
    const canvas = { left: 10, top: 20, width: 960, height: 540 };
    // The backdrop, two faces and (luxcam-5) the REC badge; only the first three are lens images.
    const images = made.filter((m) => m.kind === 'Image' && m.texture !== 'art:hud/live/rec-badge');
    expect(images).toHaveLength(3);
    expect(made.filter((m) => m.kind === 'Image')).toHaveLength(4);
    let clock = 0;
    for (let i = 0; i < 1200; i++) {
      clock += 0.016;
      // Sweep the pointer over the screen for the parallax.
      pointer.x = (i * 37) % 1920;
      pointer.y = (i * 23) % 1080;
      const now = 100 + clock;
      v.update(frameAt(now, scripted(clock)), { now: clock, dt: 0.016 }, []);
      for (const img of images) {
        if (!img.visible || !img.crop) continue;
        const shown: Rect = {
          x: img.x + img.crop.x * img.scaleX,
          y: img.y + img.crop.y * img.scaleY,
          w: img.crop.w * img.scaleX,
          h: img.crop.h * img.scaleY,
        };
        // A millionth of a pixel of float slack: the crop is computed in texture pixels.
        const slack = { x: lens.x - 1e-6, y: lens.y - 1e-6, w: lens.w + 2e-6, h: lens.h + 2e-6 };
        if (shown.w > 0 && shown.h > 0) expect(inside(shown, slack), JSON.stringify(shown)).toBe(true);
      }
    }
    const h = camHook();
    expect(h.zone).toEqual(pageRect(ZONES.cam, canvas));
    expect(h.lens).toEqual(pageRect(lens, canvas));
    expect(inside(h.face, h.lens)).toBe(true);
    expect(inside(h.backdrop, h.lens)).toBe(true);
    expect(h.backdrop).toEqual(h.lens);
    v.shutdown();
  });

  it('follows camStep every frame; art is the texture key on the front image', () => {
    const { scene, made } = camStub();
    const v = new LuxCamView();
    v.create(scene as never, camHost(scene));
    // Made in order: the backdrop, the front face, the back face.
    const front = made.filter((m) => m.kind === 'Image')[1];
    let s = initialCam(0);
    const cv = emptyCamView();
    const extras = { ...NO_CAM_EXTRAS };
    const seen = new Set<string>();
    let clock = 0;
    for (let i = 0; i < 900; i++) {
      clock += 0.016;
      const f = frameAt(100 + clock, scripted(clock));
      v.update(f, { now: clock, dt: 0.016 }, []);
      s = camStep(s, fillCamView(cv, f, [], extras, clock));
      const h = camHook();
      expect(h.mood).toBe(s.mood);
      expect(h.art).toBe(camTextureOf(s.mood));
      expect(front.texture).toBe(h.art);
      seen.add(h.mood);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['calm', 'tense', 'panicking']));
    expect(camHook().history.map((e) => e.mood)).toEqual(
      expect.arrayContaining(['calm', 'tense', 'panicking']),
    );
    v.shutdown();
  });

  it('swaps no texture and starts no fade on frames where the mood does not change', () => {
    const { scene, made } = camStub();
    const v = new LuxCamView();
    v.create(scene as never, camHost(scene));
    const images = made.filter((m) => m.kind === 'Image');
    const swaps = () => images.reduce((n, m) => n + m.swaps, 0);
    let clock = 0;
    const quiet = frameAt(100, { demand: 30, wiredCapacity: 100, errorShare: 0 });
    for (let i = 0; i < 60; i++) v.update(quiet, { now: (clock += 0.016), dt: 0.016 }, []);
    const state = v.camState;
    const before = swaps();
    const fades = v.counts.fades;
    for (let i = 0; i < 2000; i++) v.update(quiet, { now: (clock += 0.016), dt: 0.016 }, []);
    expect(v.camState).toBe(state);
    expect(swaps()).toBe(before);
    expect(v.counts.fades).toBe(fades);
    expect(camHook().fading).toBe(false);
    // A change of mood: one swap on each face image (the old face to the back), one fade.
    const hot = frameAt(100, { demand: 30, wiredCapacity: 100, errorShare: 0.8 });
    let changedAt = -1;
    for (let i = 0; i < 60 && changedAt < 0; i++) {
      v.update(hot, { now: (clock += 0.016), dt: 0.016 }, []);
      if (v.mood !== 'calm') changedAt = clock;
    }
    expect(v.mood).toBe('panicking');
    expect(swaps()).toBe(before + 2);
    expect(v.counts.fades).toBe(fades + 1);
    expect(camHook().fading).toBe(true);
    expect(camHook().frame).toBe('red');
    // The crossfade is done after CAM_FADE on the HUD clock, with no further swap.
    for (let i = 0; i < 20; i++) v.update(hot, { now: (clock += 0.016), dt: 0.016 }, []);
    expect(clock - changedAt).toBeGreaterThan(CAM_FADE);
    expect(camHook().fading).toBe(false);
    expect(swaps()).toBe(before + 2);
    v.shutdown();
  });

  it('starts no tween and keeps its per-frame path free of allocation (read from the code)', () => {
    expect(luxCamViewSource).not.toMatch(/\.tweens\b/);
    expect(luxCamViewSource).not.toMatch(/\.time\.(addEvent|delayedCall)/);
    // The body of update() only calls helpers that write into kept objects (onMood, the one place
    // that allocates, runs only on a mood change).
    const signature = luxCamViewSource.indexOf('  update(frame');
    expect(signature).toBeGreaterThan(0);
    const update = luxCamViewSource.slice(
      luxCamViewSource.indexOf('): void {', signature),
      luxCamViewSource.indexOf('  /** The mood changed'),
    );
    expect(update).toContain('fillCamView(this.view');
    expect(update).toMatch(/if \(next\.mood !== was\) this\.onMood/);
    expect(update).not.toMatch(/camViewOf|new [A-Z]|\[\]|\{ *[a-z]+:/);
    // Placing, cropping, the roll band and the talk bars write into kept objects too.
    const per = luxCamViewSource.slice(luxCamViewSource.indexOf('  private layoutAll'));
    const perFrame = per.slice(0, per.indexOf('  /** The current mood'));
    expect(perFrame).not.toMatch(/new [A-Z]|\[\]|\{ *[a-z]+: /);
  });

  it('REC: steady with reduce flicker (motion reduced), else a 1.2 s blink on the HUD clock', () => {
    expect(REC_PERIOD).toBe(1.2);
    expect(recOn(0.1, false)).toBe(true);
    expect(recOn(0.7, false)).toBe(false);
    expect(recOn(1.3, false)).toBe(true);
    expect(recOn(0.7, true)).toBe(true);
    expect(fadeAlpha(0)).toBe(0);
    expect(fadeAlpha(CAM_FADE / 2)).toBeCloseTo(0.5);
    expect(fadeAlpha(1)).toBe(1);

    const { scene } = camStub();
    const quiet = frameAt(100, { demand: 30, wiredCapacity: 100 });
    try {
      updateSettings({ reduceFlicker: true });
      const v = new LuxCamView();
      v.create(scene as never, camHost(scene));
      for (let c = 0.01; c < 6; c += 0.016) {
        v.update(quiet, { now: c, dt: 0.016 }, []);
        const h = camHook();
        expect(h.rec).toBe(true);
        expect(h.motion).toBe('reduced');
      }
      v.shutdown();

      updateSettings({ reduceFlicker: false });
      const w = new LuxCamView();
      w.create(scene as never, camHost(scene));
      const flips: number[] = [];
      let last = true;
      for (let i = 1; i <= 400; i++) {
        const c = i * 0.01;
        w.update(quiet, { now: c, dt: 0.01 }, []);
        const h = camHook();
        expect(h.motion).toBe('full');
        if (h.rec !== last) flips.push(c);
        last = h.rec;
      }
      // Off at 0.6, on at 1.2, off at 1.8 ...: a 1.2 s period.
      expect(flips.length).toBeGreaterThanOrEqual(5);
      for (let i = 2; i < flips.length; i++) expect(flips[i] - flips[i - 2]).toBeCloseTo(REC_PERIOD, 1);
      w.shutdown();
    } finally {
      updateSettings({ reduceFlicker: false });
    }
  });
});

// ---- luxcam-3: the talk bars, the drag, the action, the shock and the goggles ----

describe('camStep: drag, action and talk (luxcam-3)', () => {
  it('a card drag leans within 0.1 s and lets go 0.5 s after the drag ends', () => {
    expect(CAM_LEAN_RELEASE).toBe(0.5);
    for (const held of [0.2, 0.6, 2]) {
      const seen: CamMood[] = [];
      let s = run(settled(), 10, 10.1, () => ({ dragging: true }), seen);
      expect(seen[0], `drag ${held} s: the first frame`).toBe('leaning');
      s = run(s, 10.1, 10 + held, () => ({ dragging: true }));
      expect(s.mood).toBe('leaning');
      const end = 10 + held;
      s = run(s, end, end + CAM_LEAN_RELEASE - 0.02, () => ({}));
      expect(s.mood, `drag ${held} s: still leaning just before the release`).toBe('leaning');
      s = run(s, end + CAM_LEAN_RELEASE - 0.02, end + CAM_LEAN_RELEASE + 0.02, () => ({}));
      expect(s.mood, `drag ${held} s: let go 0.5 s after the end`).not.toBe('leaning');
      expect(s.since).toBeGreaterThanOrEqual(end + CAM_LEAN_RELEASE - 1e-9);
      // The first frame without the drag is one frame after `end`; she lets go 0.5 s after it.
      expect(s.since).toBeLessThanOrEqual(end + CAM_LEAN_RELEASE + 2 * DT);
    }
  });

  it('within 2.5 s of an action she is focused, unless a danger state applies', () => {
    expect(CAM_ACTION_FOCUS).toBe(2.5);
    // From calm: focused on the next frame and through the whole 2.5 s.
    const seen: CamMood[] = [];
    run(settled(), 10, 12.49, () => ({ actionAt: 10 }), seen);
    expect(new Set(seen)).toEqual(new Set(['focused']));
    // The drop that ends a drag: focused at once, no lean release.
    let s = run(settled(), 10, 11, () => ({ dragging: true }));
    expect(s.mood).toBe('leaning');
    const after: CamMood[] = [];
    run(s, 11, 13.49, () => ({ actionAt: 11 }), after);
    expect(after[0]).toBe('focused');
    expect(new Set(after)).toEqual(new Set(['focused']));
    // Right after another change (CAM_MIN_GAP: a 50 ms drag ending in a drop) she still turns
    // focused well inside the 2.5 s, and stays focused to its end.
    s = run(settled(), 10, 10.05, () => ({ dragging: true }));
    expect(s.mood).toBe('leaning');
    const late: CamMood[] = [];
    run(s, 10.05, 12.5, () => ({ actionAt: 10.05 }), late);
    expect(late.indexOf('focused')).toBeGreaterThanOrEqual(0);
    expect(late.indexOf('focused') * DT).toBeLessThanOrEqual(0.5);
    expect(late.slice(late.indexOf('focused')).every((m) => m === 'focused')).toBe(true);
    // Danger wins: errors held into panic, load over the amber line into tense.
    const panic = run(settled(), 10, 12, () => ({ actionAt: 10.5, errorShare: 0.8 }));
    expect(panic.mood).toBe('panicking');
    const tense = run(settled(), 10, 12, () => ({ actionAt: 10.5, demand: 90 }));
    expect(tense.mood).toBe('tense');
  });

  it('a died or dip occurrence shocks her into panic for 2 s; the goggles go up at 537 and stay', () => {
    const r = new Run();
    r.now = BROWNOUT.challenges.c1;
    const f = readFrame(r);
    const out = emptyCamView();
    fillCamView(out, f, [{ kind: 'died', id: 'server-1', at: f.now }], NO_CAM_EXTRAS, 20);
    expect(out.shockAt).toBe(20);
    fillCamView(out, f, [{ kind: 'dip', id: 'server-1', at: f.now }], NO_CAM_EXTRAS, 21);
    expect(out.shockAt).toBe(21);
    fillCamView(out, f, [{ kind: 'wired', id: 'a>b', at: f.now }], { ...NO_CAM_EXTRAS, shockAt: 21 }, 22);
    expect(out.shockAt).toBe(21);
    const s = run(settled(), 10, 10.05, () => ({ shockAt: 10.02 }));
    expect(s.mood).toBe('panicking');
    const g = run(settled(), 10, 10.1, () => ({ now: CAM_GOGGLES_AT, errorShare: 1, rewinds: 1 }));
    expect(g.mood).toBe('gogglesUp');
    expect(run(g, 10.1, 15, () => ({ now: CAM_GOGGLES_AT + 5, failure: true })).mood).toBe('gogglesUp');
  });
});

describe('LuxCamView: the bus facts (luxcam-3)', () => {
  /** A view on a stub, with its own bus, stepped on a quiet frame. */
  function bused() {
    const { scene, made } = camStub();
    const bus = new Bus();
    const v = new LuxCamView();
    v.create(scene as never, camHost(scene, bus));
    let clock = 0;
    const quiet = frameAt(100, { demand: 30, wiredCapacity: 100, errorShare: 0 });
    const step = (seconds: number, f: Frame = quiet): void => {
      const end = clock + seconds;
      while (clock < end - 1e-9) {
        clock += 0.016;
        v.update(f, { now: clock, dt: 0.016 }, []);
      }
    };
    const bars = made.filter((m) => m.kind === 'Rectangle').slice(1);
    return { v, bus, step, bars, now: () => clock };
  }

  it('speaking is true while Lux’s line is on the band and false otherwise; the bars bounce', () => {
    const { v, bus, step, bars } = bused();
    expect(bars).toHaveLength(3);
    step(1);
    expect(camHook().speaking).toBe(false);
    bus.emit('line', { id: 'C1.lux.01', speaker: 'Lux', tag: 'LUX', lesson: false, since: 1 });
    expect(camHook().speaking).toBe(true);
    step(0.5);
    expect(camHook().speaking).toBe(true);
    expect(v.mood).toBe('focused');
    expect(bars.some((b) => b.scaleY > 0.3)).toBe(true);
    expect(bars.every((b) => b.alpha === 1)).toBe(true);
    // Another line's end leaves her talking; hers ends it.
    bus.emit('lineEnd', { id: 'C1.triage.02' });
    expect(camHook().speaking).toBe(true);
    bus.emit('lineEnd', { id: 'C1.lux.01' });
    expect(camHook().speaking).toBe(false);
    step(0.1);
    expect(bars.every((b) => b.scaleY === 0.25 && b.alpha < 1)).toBe(true);
    // A crew line is not hers; a new line pre-empting hers ends her talking too.
    bus.emit('line', { id: 'C1.triage.02', speaker: 'TRIAGE (eager)', tag: 'CREW', lesson: false, since: 2 });
    expect(camHook().speaking).toBe(false);
    bus.emit('line', { id: 'C2.lux.ignore', speaker: 'Lux', tag: 'LUX', lesson: false, since: 3 });
    expect(camHook().speaking).toBe(true);
    bus.emit('line', { id: 'C1.triage.02', speaker: 'TRIAGE (eager)', tag: 'CREW', lesson: false, since: 4 });
    expect(camHook().speaking).toBe(false);
    v.shutdown();
    // Unsubscribed on shutdown.
    bus.emit('line', { id: 'C1.lux.01', speaker: 'Lux', tag: 'LUX', lesson: false, since: 5 });
  });

  it('drag {kind: card} leans within 0.1 s; drag {kind: null} lets go 0.5 s later', () => {
    const { v, bus, step, now } = bused();
    step(3);
    expect(v.mood).toBe('calm');
    bus.emit('drag', { kind: 'card', card: 'server', over: null });
    expect(camHook().dragging).toBe(true);
    step(0.1);
    expect(v.mood).toBe('leaning');
    step(1);
    bus.emit('drag', { kind: 'card', card: 'server', over: 'pad' });
    step(0.5);
    expect(v.mood).toBe('leaning');
    bus.emit('drag', { kind: null, card: null, over: null });
    const ended = now();
    expect(camHook().dragging).toBe(false);
    step(0.45);
    expect(v.mood).toBe('leaning');
    step(0.1);
    expect(v.mood).not.toBe('leaning');
    expect(camHook().since - ended).toBeGreaterThanOrEqual(0.5 - 0.016);
    expect(camHook().since - ended).toBeLessThanOrEqual(0.5 + 0.032);
    v.shutdown();
  });

  it('an action focuses her for 2.5 s on the HUD clock; a died occurrence shocks her', () => {
    const { v, bus, step } = bused();
    step(3);
    expect(v.mood).toBe('calm');
    bus.emit('action', { type: 'place', id: 'server-1' });
    const moods = new Set<CamMood>();
    for (let i = 0; i < 150; i++) {
      step(0.016);
      moods.add(v.mood);
    }
    expect(moods).toEqual(new Set(['focused']));
    v.shutdown();

    const b = bused();
    b.step(3);
    const f = frameAt(100, { demand: 30, wiredCapacity: 100 });
    b.v.update(f, { now: 3.1, dt: 0.016 }, [{ kind: 'died', id: 'server-1', at: 100 }]);
    expect(b.v.mood).toBe('panicking');
    expect(camHook().frame).toBe('red');
    b.v.shutdown();
  });

  it('shows the goggles-up pose from 537 s, cropped to its top', () => {
    const { v, step } = bused();
    step(1);
    step(0.5, frameAt(CAM_GOGGLES_AT, { demand: 30, wiredCapacity: 100 }));
    const h = camHook();
    expect(h.mood).toBe('gogglesUp');
    expect(h.art).toBe('portrait:lux/poses/goggles-up');
    const lens = camLayout(ZONES.cam).lens;
    const page = pageRect(lens, { left: 10, top: 20, width: 960, height: 540 });
    // The pose's head sits near the lens's top edge (8 px down, breathing 2 px), cropped below.
    expect(h.face.y).toBeGreaterThanOrEqual(page.y);
    expect(h.face.y).toBeLessThanOrEqual(page.y + 6);
    expect(h.face.y + h.face.h).toBeCloseTo(page.y + page.h, 0);
    expect(inside(h.face, h.lens)).toBe(true);
    v.shutdown();
  });
});
