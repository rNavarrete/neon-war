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
