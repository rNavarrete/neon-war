import { BROWNOUT } from '../src/sim/brownout';
import { NEEDLE_EASE_SECONDS, easeNeedle } from '../src/scenes/hud/gauge';
import { travelSeconds } from '../src/scenes/board/packets';
import {
  type EasedReadout,
  type MotionProp,
  type MotionSpec,
  type MotionVariant,
  MOTION,
  MOTION_NAMES,
  MOTION_PROPS,
  MotionPlayer,
  NEEDLE_TAU_SECONDS,
  NEUTRAL,
  SPEAK_RING_HZ,
  ease,
  followReadout,
  readoutHook,
  sampleSpec,
  sampleTrack,
  scaledDurationMs,
  specDone,
  specTimeScale,
  variantOf,
} from '../src/scenes/motion';
import * as glowKit from '../src/scenes/motion';

// The motion kit (art3d-3): eight named specs as data, each with a calm variant; sampleSpec and the
// MotionPlayer adapter; board specs slowed by Regroup with the packets; hooks report plotted values.

const EIGHT = [
  'placeDrop',
  'dieCollapse',
  'dipBlackout',
  'speakRing',
  'needleEase',
  'cardLift',
  'heldFlare',
  'crewTint',
] as const;

/** Props that make something appear or vanish: the ones a blink is made of. */
const VISIBILITY: readonly MotionProp[] = ['alpha', 'light', 'ring', 'glow'];

function variants(s: MotionSpec): [string, MotionVariant][] {
  return [
    ['full', s],
    ['calm', s.calm],
  ];
}

/**
 * The fastest a variant's `prop` changes direction, in Hz: half the inverse of the shortest gap
 * between turning points (the start counts as one), sampled every ms over two plays.
 */
function fastestHz(s: MotionSpec, prop: MotionProp, reduce: boolean): number {
  const v = variantOf(s, reduce);
  const span = v.durationMs * (v.repeat === -1 ? 2 : 1);
  const turns: number[] = [0];
  let prev = sampleSpec(s, 0, reduce)[prop];
  let dir = 0;
  for (let t = 1; t <= span; t++) {
    const val = sampleSpec(s, t, reduce)[prop];
    const d = val - prev;
    if (Math.abs(d) > 1e-9) {
      const nd = Math.sign(d);
      if (dir !== 0 && nd !== dir) turns.push(t);
      dir = nd;
    }
    prev = val;
  }
  let gap = Infinity;
  for (let i = 1; i < turns.length; i++) gap = Math.min(gap, turns[i] - turns[i - 1]);
  // A step change (a 'hold' key) counts as a blink: a jump inside one ms.
  for (let t = 1; t <= span; t++) {
    const jump = Math.abs(sampleSpec(s, t, reduce)[prop] - sampleSpec(s, t - 1, reduce)[prop]);
    if (jump > 0.2) gap = Math.min(gap, 1);
  }
  return gap === Infinity ? 0 : 1000 / (2 * gap);
}

describe('motion specs as data', () => {
  it('names exactly the eight specs, each with a calm variant', () => {
    expect([...MOTION_NAMES].sort()).toEqual([...EIGHT].sort());
    for (const n of EIGHT) {
      const s = MOTION[n];
      expect(s.name).toBe(n);
      expect(s.calm).toBeDefined();
      expect(s.calm.tracks.length).toBeGreaterThan(0);
      expect(s.what.length).toBeGreaterThan(0);
    }
  });

  it('every variant is finite, its keys sorted from 0 to 1, and only moves known props', () => {
    for (const n of EIGHT) {
      for (const [label, v] of variants(MOTION[n])) {
        expect(Number.isFinite(v.durationMs), `${n} ${label}`).toBe(true);
        expect(v.durationMs).toBeGreaterThan(0);
        const seen = new Set<MotionProp>();
        for (const t of v.tracks) {
          expect(MOTION_PROPS).toContain(t.prop);
          expect(seen.has(t.prop), `${n} ${label} repeats ${t.prop}`).toBe(false);
          seen.add(t.prop);
          expect(t.keys[0].at).toBe(0);
          expect(t.keys[t.keys.length - 1].at).toBe(1);
          for (let i = 1; i < t.keys.length; i++)
            expect(t.keys[i].at).toBeGreaterThanOrEqual(t.keys[i - 1].at);
          for (const key of t.keys) expect(Number.isFinite(key.value)).toBe(true);
        }
        for (let ms = 0; ms <= v.durationMs * 2; ms += 7) {
          const smp = sampleSpec(MOTION[n], ms, label === 'calm');
          for (const p of MOTION_PROPS)
            expect(Number.isFinite(smp[p]), `${n} ${label} ${p} at ${ms}`).toBe(true);
        }
      }
    }
  });

  it('a one-shot ends at its rest values; a loop ends where it starts', () => {
    for (const n of EIGHT) {
      const s = MOTION[n];
      for (const [label, v] of variants(s)) {
        const reduce = label === 'calm';
        if (v.repeat === 0) {
          const end = sampleSpec(s, v.durationMs, reduce);
          for (const p of MOTION_PROPS) {
            const want = s.rest[p] ?? NEUTRAL[p];
            expect(end[p], `${n} ${label} ${p}`).toBeCloseTo(want, 6);
          }
          // Past the end it holds there.
          expect(sampleSpec(s, v.durationMs * 3, reduce)).toEqual(end);
        } else {
          for (const t of v.tracks) expect(t.keys[t.keys.length - 1].value).toBe(t.keys[0].value);
        }
      }
    }
  });

  it('sampleSpec matches every keyframe at its time', () => {
    for (const n of EIGHT) {
      const s = MOTION[n];
      for (const [label, v] of variants(s)) {
        for (const t of v.tracks) {
          for (const key of t.keys) {
            // A loop wraps at 1, so its last key is read as the first; they are equal.
            const ms = key.at * v.durationMs;
            expect(
              sampleSpec(s, ms, label === 'calm')[t.prop],
              `${n} ${label} ${t.prop}@${key.at}`,
            ).toBeCloseTo(key.value, 6);
          }
        }
      }
    }
  });

  it('props no track moves stay neutral, and sampleSpec fills the given sample without allocating', () => {
    const out = { ...NEUTRAL, glow: 9 };
    const r = sampleSpec(MOTION.dipBlackout, 100, false, out);
    expect(r).toBe(out);
    expect(r.glow).toBe(0);
    expect(r.alpha).toBe(1);
  });

  it('eases map 0 to 0 and 1 to 1', () => {
    for (const e of [
      'linear',
      'quadIn',
      'quadOut',
      'cubicOut',
      'sineInOut',
      'backOut',
      'hold',
      'exp5',
    ] as const) {
      expect(ease(e, 0)).toBeCloseTo(0, 9);
      expect(ease(e, 1)).toBeCloseTo(1, 9);
    }
    expect(ease('hold', 0.99)).toBe(0);
    expect(
      sampleTrack(
        {
          prop: 'alpha',
          keys: [
            { at: 0, value: 0 },
            { at: 1, value: 1 },
          ],
        },
        0.5,
      ),
    ).toBe(0.5);
  });
});

describe('calm variants', () => {
  it('under reduce flicker no spec changes alpha, light, ring or glow faster than 1 Hz', () => {
    for (const n of EIGHT) {
      for (const p of VISIBILITY) {
        expect(fastestHz(MOTION[n], p, true), `${n} ${p}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the full variants that blink do so faster than 1 Hz, so calm is a real change', () => {
    expect(fastestHz(MOTION.dieCollapse, 'alpha', false)).toBeGreaterThan(1);
    expect(fastestHz(MOTION.dipBlackout, 'light', false)).toBeGreaterThan(1);
    expect(fastestHz(MOTION.speakRing, 'ring', false)).toBeGreaterThan(1);
    expect(fastestHz(MOTION.heldFlare, 'glow', false)).toBeGreaterThan(1);
  });

  it('calm dipBlackout has no re-light frames: the light only ever falls', () => {
    const v = MOTION.dipBlackout.calm;
    let prev = sampleSpec(MOTION.dipBlackout, 0, true).light;
    expect(prev).toBe(1);
    for (let ms = 1; ms <= v.durationMs + 50; ms++) {
      const l = sampleSpec(MOTION.dipBlackout, ms, true).light;
      expect(l, `re-lit at ${ms} ms`).toBeLessThanOrEqual(prev);
      prev = l;
    }
    expect(prev).toBe(0);
    // The full dip does re-light (the stutter), which is what calm removes.
    let relit = false;
    prev = 1;
    for (let ms = 1; ms <= MOTION.dipBlackout.durationMs; ms++) {
      const l = sampleSpec(MOTION.dipBlackout, ms, false).light;
      if (l > prev) relit = true;
      prev = l;
    }
    expect(relit).toBe(true);
  });

  it('the speaker ring pulses at 1.2 Hz and is steady under reduce flicker', () => {
    expect(MOTION.speakRing.durationMs).toBe(Math.round(1000 / SPEAK_RING_HZ));
    expect(MOTION.speakRing.repeat).toBe(-1);
    const calm = new Set<number>();
    for (let ms = 0; ms < 3000; ms += 13) calm.add(sampleSpec(MOTION.speakRing, ms, true).ring);
    expect([...calm]).toEqual([1]);
  });
});

describe('needleEase and eased readouts', () => {
  it("shares the gauge needle's 0.18 s time constant and follows the same curve", () => {
    expect(NEEDLE_TAU_SECONDS).toBe(NEEDLE_EASE_SECONDS);
    for (const t of [0.05, 0.18, 0.36, 0.6]) {
      const exact = 1 - Math.exp(-t / NEEDLE_TAU_SECONDS);
      expect(sampleSpec(MOTION.needleEase, t * 1000, false).value).toBeCloseTo(exact, 1);
    }
    const r: EasedReadout = { plotted: 0, shown: 100 };
    let needle = 100;
    for (let i = 0; i < 30; i++) {
      followReadout(r, 300, 1 / 60);
      needle = easeNeedle(needle, 300, 1 / 60);
      expect(r.shown).toBeCloseTo(needle, 9);
    }
  });

  it('the hook reports the plotted value for an eased readout, never the eased value', () => {
    const r: EasedReadout = { plotted: 0, shown: 0 };
    followReadout(r, 240, 1 / 60);
    expect(r.shown).toBeGreaterThan(0);
    expect(r.shown).toBeLessThan(240);
    expect(readoutHook(r)).toBe(240);
    // Held still (dt 0) it does not move, and the hook still says what was plotted.
    followReadout(r, 260, 0);
    expect(r.shown).toBeLessThan(240);
    expect(readoutHook(r)).toBe(260);
    // A fresh readout (NaN shown) jumps.
    const fresh: EasedReadout = { plotted: 0, shown: NaN };
    expect(followReadout(fresh, 50, 1 / 60).shown).toBe(50);
  });

  it("a player's hook value is the spec's rest, not the frame's sample, while it plays", () => {
    const m = new MotionPlayer();
    expect(m.motion).toBe('idle');
    m.play(MOTION.dieCollapse);
    m.step(0.2, 1, false);
    expect(m.motion).toBe('dieCollapse');
    expect(m.sample.scale).not.toBe(MOTION.dieCollapse.rest.scale);
    expect(m.hookValue('scale')).toBe(0.9);
    expect(m.hookValue('alpha')).toBe(0.6);
    expect(m.hookValue('glow')).toBe(NEUTRAL.glow);
    m.step(1, 1, false);
    expect(m.motion).toBe('idle');
    expect(m.sample.scale).toBe(0.9);
    expect(m.hookValue('scale')).toBe(0.9);
  });
});

describe('MotionPlayer and Regroup', () => {
  it('one-shots finish on their rest values; loops run until stopped and then hold rest', () => {
    const m = new MotionPlayer();
    m.play(MOTION.placeDrop);
    const sample = m.step(0.1, 1, false);
    expect(sample).toBe(m.sample);
    expect(sample.y).toBeLessThan(0);
    m.step(0.3, 1, false);
    expect(m.motion).toBe('idle');
    expect(m.sample).toMatchObject({ y: 0, alpha: 1, scale: 1 });

    m.play(MOTION.speakRing);
    for (let i = 0; i < 300; i++) m.step(1 / 60, 1, false);
    expect(m.motion).toBe('speakRing');
    m.stop();
    expect(m.motion).toBe('idle');
    expect(m.sample.ring).toBe(0);
    expect(specDone(MOTION.speakRing, 1e9, false)).toBe(false);
  });

  it('Regroup slows board specs to a quarter with the packets; hud specs keep the HUD clock', () => {
    const q = BROWNOUT.regroup.speed;
    expect(q).toBe(0.25);
    for (const n of EIGHT) {
      const s = MOTION[n];
      const want = s.scope === 'board' ? q : 1;
      expect(specTimeScale(s, q), n).toBe(want);
      for (const reduce of [false, true]) {
        expect(scaledDurationMs(s, reduce, q)).toBeCloseTo(variantOf(s, reduce).durationMs / want, 6);
      }
    }
    // The board specs are the board's: placing, dying, dips, lifts and the crew.
    expect(EIGHT.filter((n) => MOTION[n].scope === 'board').sort()).toEqual(
      ['cardLift', 'crewTint', 'dieCollapse', 'dipBlackout', 'placeDrop'].sort(),
    );

    // A packet crossing a 320 px wire and a placeDrop, both stepped with the same frames at Regroup
    // speed, are each a quarter as far along as at full speed (BoardScene: dt * f.timeScale).
    const travel = travelSeconds(320);
    const slow = new MotionPlayer();
    const fast = new MotionPlayer();
    slow.play(MOTION.placeDrop);
    fast.play(MOTION.placeDrop);
    let packetSlow = 0;
    let packetFast = 0;
    for (let i = 0; i < 6; i++) {
      slow.step(1 / 60, q, false);
      fast.step(1 / 60, 1, false);
      packetSlow += ((1 / 60) * q) / travel;
      packetFast += 1 / 60 / travel;
    }
    expect(slow.elapsedMs / fast.elapsedMs).toBeCloseTo(q, 9);
    expect(packetSlow / packetFast).toBeCloseTo(q, 9);
    // The slowed drop lasts four times as long in wall time.
    const wall = new MotionPlayer();
    wall.play(MOTION.placeDrop);
    let frames = 0;
    while (wall.motion !== 'idle' && frames < 1000) {
      wall.step(1 / 60, q, false);
      frames++;
    }
    expect(frames / 60).toBeGreaterThanOrEqual((MOTION.placeDrop.durationMs * 4) / 1000 - 1 / 60);

    const ring = new MotionPlayer();
    ring.play(MOTION.speakRing);
    ring.step(0.5, q, false);
    expect(ring.elapsedMs).toBeCloseTo(500, 9);
  });

  it('a paused board (timeScale 0) freezes board specs', () => {
    const m = new MotionPlayer();
    m.play(MOTION.dieCollapse);
    m.step(0.1, 1, false);
    const at = m.elapsedMs;
    m.step(0.5, 0, false);
    expect(m.elapsedMs).toBe(at);
    expect(scaledDurationMs(MOTION.dieCollapse, false, 0)).toBe(Infinity);
  });

  it('stepping allocates no new sample', () => {
    const m = new MotionPlayer();
    const s = m.sample;
    m.play(MOTION.crewTint);
    for (let i = 0; i < 100; i++) expect(m.step(1 / 60, 1, true)).toBe(s);
  });
});

// ---- art3d-6: the glow probe ----

describe('art3d-6 glow probe: which parts glow', () => {
  const { pickGlows, pickGlowsInto, GLOW_MAX } = glowKit;

  it('picks only parts over capacity, hottest first, at most three', () => {
    const parts = [
      { id: 'a', share: 0.9 },
      { id: 'b', share: 1.4 },
      { id: 'c', share: 2.2 },
      { id: 'd', share: 1.01 },
      { id: 'e', share: 1.8 },
      { id: 'gw', share: null },
      { id: 'f', share: 1 },
    ];
    expect(GLOW_MAX).toBe(3);
    expect(pickGlows(parts)).toEqual(['c', 'e', 'b']);
    expect(pickGlows(parts, 5)).toEqual(['c', 'e', 'b', 'd']);
  });

  it('never picks a part at or under capacity, unlimited, dark or with a non-finite share', () => {
    expect(
      pickGlows([
        { id: 'a', share: 1 },
        { id: 'b', share: 0.5 },
        { id: 'c', share: null },
        { id: 'd', share: 3, dark: true },
        { id: 'e', share: Number.NaN },
        { id: 'f', share: Number.POSITIVE_INFINITY },
      ]),
    ).toEqual([]);
  });

  it('breaks ties by id and does not mutate its inputs', () => {
    const parts = Object.freeze([
      Object.freeze({ id: 'z', share: 1.5 }),
      Object.freeze({ id: 'm', share: 1.5 }),
      Object.freeze({ id: 'a', share: 1.5 }),
      Object.freeze({ id: 'q', share: 1.5 }),
    ]);
    expect(pickGlows(parts)).toEqual(['a', 'm', 'q']);
  });

  it('pickGlowsInto reuses its output arrays', () => {
    const out: string[] = [];
    const shares: number[] = [];
    const r = pickGlowsInto(out, shares, ['a', 'b'], [1.2, 1.6], [false, false], 2);
    expect(r).toBe(out);
    expect(out).toEqual(['b', 'a']);
    expect(shares).toEqual([1.6, 1.2]);
    pickGlowsInto(out, shares, ['a', 'b'], [0.2, 0.6], [false, false], 2);
    expect(out).toEqual([]);
  });

  it('is steady under reduce flicker and breathes only when not calm', () => {
    const { glowStrength } = glowKit;
    const calm = [0, 0.1, 0.33, 0.5, 1.7].map((t) => glowStrength(1.5, t, true));
    expect(new Set(calm).size).toBe(1);
    expect(glowStrength(3, 0, true)).toBe(5);
    expect(glowStrength(1.0001, 0, true)).toBeCloseTo(2, 3);
    const lively = [0, 0.1, 0.2, 0.3].map((t) => glowStrength(1.5, t, false));
    expect(new Set(lively).size).toBeGreaterThan(1);
    for (const v of lively) {
      expect(v).toBeGreaterThanOrEqual(0.7 * 3.5 - 1e-9);
      expect(v).toBeLessThanOrEqual(3.5 + 1e-9);
    }
  });

  it('shows the rescue GradientMap for 1.5 s after the rescue, never when calm', () => {
    const { rescueMapOn, RESCUE_MAP_SECONDS } = glowKit;
    expect(RESCUE_MAP_SECONDS).toBe(1.5);
    expect(rescueMapOn(10, null, false)).toBe(false);
    expect(rescueMapOn(10, 10, false)).toBe(true);
    expect(rescueMapOn(11.4, 10, false)).toBe(true);
    expect(rescueMapOn(11.5, 10, false)).toBe(false);
    expect(rescueMapOn(9, 10, false)).toBe(false);
    expect(rescueMapOn(10.5, 10, true)).toBe(false);
  });
});

describe('art3d-6 glow probe: the adapter', () => {
  const { GlowProbe } = glowKit;

  interface FakeCtl {
    kind: 'glow' | 'map';
    active: boolean;
    outerStrength: number;
  }
  /** A fake FilterList that keeps its controllers like Phaser's, and counts adds. */
  class FakeList {
    readonly list: FakeCtl[] = [];
    adds = 0;
    addGlow(_c?: number, outer = 4): FakeCtl {
      this.adds++;
      const g: FakeCtl = { kind: 'glow', active: true, outerStrength: outer };
      this.list.push(g);
      return g;
    }
    addGradientMap(): FakeCtl {
      this.adds++;
      const m: FakeCtl = { kind: 'map', active: true, outerStrength: 0 };
      this.list.push(m);
      return m;
    }
    remove(f: unknown): void {
      const i = this.list.indexOf(f as FakeCtl);
      if (i >= 0) this.list.splice(i, 1);
    }
  }
  class FakeHost {
    filters: { internal: FakeList } | null = null;
    enableFilters(): this {
      this.filters = { internal: new FakeList() };
      return this;
    }
  }
  type Views = Map<string, { img: FakeHost; look: { share: number | null; dark: boolean } }>;
  function boardOf(shares: Record<string, number | null>): Views {
    const views: Views = new Map();
    for (const [id, share] of Object.entries(shares))
      views.set(id, { img: new FakeHost(), look: { share, dark: false } });
    return views;
  }
  const camera = () => ({ filters: { internal: new FakeList() } });
  function glowsOn(views: Views): number {
    let n = 0;
    views.forEach((v) => (n += v.img.filters?.internal.list.filter((c) => c.kind === 'glow').length ?? 0));
    return n;
  }
  function addsOn(views: Views): number {
    let n = 0;
    views.forEach((v) => (n += v.img.filters?.internal.adds ?? 0));
    return n;
  }

  it('glows the three hottest over-capacity parts, and only those', () => {
    const views = boardOf({ a: 1.3, b: 2.0, c: 0.8, d: 1.6, e: 1.1, gw: null });
    const probe = new GlowProbe(true);
    const st = probe.step(views, 0, false, camera(), false);
    expect(st.parts).toEqual(['b', 'd', 'a']);
    expect(st.glows).toBe(3);
    expect(st.gradientMaps).toBe(0);
    expect(glowsOn(views)).toBe(3);
    for (const id of st.parts) expect(views.get(id)!.look.share!).toBeGreaterThan(1);
    expect(views.get('c')!.img.filters).toBeNull();
  });

  it('keeps its filters on a steady board and drops one only when the hot set changes', () => {
    const views = boardOf({ a: 1.3, b: 2.0, d: 1.6 });
    const cam = camera();
    const probe = new GlowProbe(true);
    probe.step(views, 0, false, cam, false);
    expect(addsOn(views)).toBe(3);
    for (let i = 1; i < 100; i++) probe.step(views, i / 60, false, cam, false);
    expect(addsOn(views)).toBe(3);
    views.get('a')!.look.share = 0.9;
    const st = probe.step(views, 2, false, cam, false);
    expect(st.parts).toEqual(['b', 'd']);
    expect(st.glows).toBe(2);
    expect(glowsOn(views)).toBe(2);
    expect(addsOn(views)).toBe(3);
  });

  it('forgets a glow whose part left the board and never holds more than three', () => {
    const views = boardOf({ a: 1.3, b: 2.0, d: 1.6, e: 1.5 });
    const cam = camera();
    const probe = new GlowProbe(true);
    expect(probe.step(views, 0, false, cam, false).parts).toEqual(['b', 'd', 'e']);
    views.delete('b');
    const st = probe.step(views, 1, false, cam, false);
    expect(st.parts).toEqual(['d', 'e', 'a']);
    expect(st.glows).toBe(3);
    expect(glowsOn(views)).toBe(3);
  });

  it('holds a steady strength under reduce flicker', () => {
    const views = boardOf({ a: 1.5 });
    const cam = camera();
    const probe = new GlowProbe(true);
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      probe.step(views, i / 10, true, cam, false);
      seen.add(views.get('a')!.img.filters!.internal.list[0]!.outerStrength);
    }
    expect(seen.size).toBe(1);
  });

  it('puts one GradientMap on the camera for 1.5 s of running board after the rescue, none when calm', () => {
    const views = boardOf({});
    const cam = camera();
    const probe = new GlowProbe(true);
    const at60 = (from: number, frames: number, rescued: boolean, held: boolean, calm = false) => {
      const seen: number[] = [];
      for (let i = 0; i < frames; i++)
        seen.push(probe.step(views, from + i / 60, calm, cam, rescued, held).gradientMaps);
      return seen;
    };
    expect(at60(0, 60, false, false)).toEqual(Array(60).fill(0));
    // The rescue's edge holds the run for the crew's scene: no map on the held (frozen) board.
    expect(at60(1, 120, true, true)).toEqual(Array(120).fill(0));
    expect(cam.filters.internal.adds).toBe(0);
    // Back on the running board: on for 1.5 s (90 frames at 60 fps), then off, made once.
    const back = at60(3, 120, true, false);
    expect(back.slice(0, 89).every((n) => n === 1)).toBe(true);
    expect(back.slice(91).every((n) => n === 0)).toBe(true);
    expect(cam.filters.internal.list.length).toBe(0);
    expect(cam.filters.internal.adds).toBe(1);

    // Held mid-window: off while held, and the window resumes after.
    const p2 = new GlowProbe(true);
    const cam2 = camera();
    p2.step(views, 0, false, cam2, true, false);
    expect(p2.step(views, 0.5, false, cam2, true, false).gradientMaps).toBe(1);
    expect(p2.step(views, 0.6, false, cam2, true, true).gradientMaps).toBe(0);
    expect(p2.step(views, 20, false, cam2, true, true).gradientMaps).toBe(0);
    expect(p2.step(views, 20.1, false, cam2, true, false).gradientMaps).toBe(1);

    const calm = new GlowProbe(true);
    const cam3 = camera();
    calm.step(views, 5, true, cam3, false);
    for (let i = 0; i < 60; i++) expect(calm.step(views, 6 + i / 60, true, cam3, true).gradientMaps).toBe(0);
    expect(cam3.filters.internal.adds).toBe(0);
  });

  it('makes no filter at all when off, and clear() removes what it made', () => {
    const views = boardOf({ a: 1.5, b: 1.9 });
    const cam = camera();
    const off = new GlowProbe(false);
    expect(off.step(views, 0, false, cam, true)).toEqual({ glows: 0, gradientMaps: 0, parts: [] });
    expect(glowsOn(views)).toBe(0);
    const on = new GlowProbe(true);
    on.step(views, 0, false, cam, true);
    expect(glowsOn(views)).toBe(2);
    on.clear();
    expect(glowsOn(views)).toBe(0);
    expect(cam.filters.internal.list.length).toBe(0);
    expect(on.state).toEqual({ glows: 0, gradientMaps: 0, parts: [] });
  });
});
