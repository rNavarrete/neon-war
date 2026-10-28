import { readFrame } from '../src/game/frame';
import type { Occurrence } from '../src/game/occurrences';
import { Run } from '../src/game/run';
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
