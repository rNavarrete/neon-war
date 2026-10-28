import animSource from '../src/scenes/board/anim.ts?raw';
import boardSource from '../src/scenes/BoardScene.ts?raw';
import {
  ANIM_LOG,
  AnimBook,
  BOARD_ANIMS,
  BOARD_ANIM_KINDS,
  type BoardAnimKind,
  CABLE_DROP_PX,
  DEATH_FLASH_MS,
  EMBER_BURSTS,
  FIREWORK_BURSTS,
  FLOAT_MS,
  FLOAT_RISE_PX,
  PARTICLE_POOL,
  ParticlePool,
  animMs,
  animName,
  animPlays,
  bootFrame,
  burstsDue,
  cableFrame,
  cutFade,
  deathFrame,
  deathSmoke,
  drawOn,
  floatFrame,
  hazeFrame,
  heldPadGlow,
  kitFrame,
  lightsDown,
  pingFrame,
  pingPhase,
} from '../src/scenes/board/anim';
import { MOTION, NEUTRAL, sampleSpec, variantOf } from '../src/scenes/motion';

// board-9: the board's animations. Each listed event has an animation that finishes within its
// stated duration and leaves the sprite in its correct state; every one has a calm variant with no
// flashing; animations are looks only and never touch the sim.

/** The one-shot board-only timelines, as (t in s, calm) -> visible values, with their duration. */
const ONE_SHOTS: Record<string, { ms: number; at: (t: number, calm: boolean) => number[] }> = {
  boot: { ms: BOARD_ANIMS.boot.ms, at: (t, calm) => [bootFrame(t, calm).alpha] },
  overclock: { ms: BOARD_ANIMS.overclock.ms, at: (t) => [kitFrame(t).alpha] },
  wire: { ms: BOARD_ANIMS.wire.ms, at: (t) => [drawOn(t)] },
  cut: { ms: BOARD_ANIMS.cut.ms, at: (t) => [cutFade(t)] },
  float: { ms: BOARD_ANIMS.float.ms, at: (t) => [floatFrame(t).alpha] },
  cable: { ms: BOARD_ANIMS.cable.ms, at: (t, calm) => [cableFrame(t, calm).lower] },
  fireworks: { ms: BOARD_ANIMS.fireworks.ms, at: (t, calm) => [heldPadGlow(t, calm)] },
  lightsdown: { ms: BOARD_ANIMS.lightsdown.ms, at: (t) => [lightsDown(t)] },
  death: { ms: BOARD_ANIMS.death.ms, at: (t, calm) => [deathFrame(t, calm).flash] },
};

/**
 * The fastest a visible value changes direction, in Hz, sampled every ms over `ms` (a jump of more
 * than 0.2 inside one ms counts as a blink).
 */
function fastestHz(ms: number, at: (t: number) => number): number {
  const turns: number[] = [0];
  let prev = at(0);
  let dir = 0;
  let gap = Infinity;
  for (let i = 1; i <= ms; i++) {
    const v = at(i / 1000);
    const d = v - prev;
    if (Math.abs(d) > 0.2) gap = 1;
    if (Math.abs(d) > 1e-9) {
      const nd = Math.sign(d);
      if (dir !== 0 && nd !== dir) turns.push(i);
      dir = nd;
    }
    prev = v;
  }
  for (let i = 1; i < turns.length; i++) gap = Math.min(gap, turns[i] - turns[i - 1]);
  return gap === Infinity ? 0 : 1000 / (2 * gap);
}

describe('the board animation table', () => {
  it('lists every event the board animates, each with a stated duration and a calm variant', () => {
    expect([...BOARD_ANIM_KINDS].sort()).toEqual(
      [
        'boot',
        'cable',
        'cut',
        'death',
        'decommission',
        'dip',
        'fireworks',
        'flash',
        'float',
        'haze',
        'lightsdown',
        'overclock',
        'ping',
        'place',
        'sparks',
        'wire',
      ].sort(),
    );
    for (const k of BOARD_ANIM_KINDS) {
      const d = BOARD_ANIMS[k];
      expect(d.kind).toBe(k);
      expect(d.ms, k).toBeGreaterThan(0);
      expect(d.event.length, k).toBeGreaterThan(10);
      // Only the flash and the sparks have no calm variant: they are what calm leaves out.
      if (d.flashes) expect(d.calmMs, k).toBe(0);
      else expect(d.calmMs, k).toBeGreaterThan(0);
    }
  });

  it('takes the shared specs from motion.ts for the part sprite: place, death, dip, decommission, cable', () => {
    const shared: Partial<Record<BoardAnimKind, string>> = {
      place: 'placeDrop',
      death: 'dieCollapse',
      dip: 'dipBlackout',
      decommission: 'cardLift',
      cable: 'crewTint',
    };
    for (const [kind, name] of Object.entries(shared) as [BoardAnimKind, keyof typeof MOTION][]) {
      expect(BOARD_ANIMS[kind].motion).toBe(name);
      expect(BOARD_ANIMS[kind].ms).toBe(MOTION[name].durationMs);
      expect(BOARD_ANIMS[kind].calmMs).toBe(MOTION[name].calm.durationMs);
      expect(MOTION[name].scope).toBe('board');
    }
    // The cable is 1.2 s, inside the crew-build wait: no hold of its own.
    expect(BOARD_ANIMS.cable.ms).toBe(1200);
  });

  it('names an animation kind or kind:<id>, as the hook lists it', () => {
    expect(animName('death', 'server-2')).toBe('death:server-2');
    expect(animName('cut', 'gateway>server-1')).toBe('cut:gateway>server-1');
    expect(animName('cable', null)).toBe('cable');
    expect(animName('fireworks', 'x')).toBe('fireworks');
    expect(animName('flash', null)).toBe('flash');
    expect(animName('sparks', null)).toBe('sparks');
  });

  it('never plays the flash or the sparks under reduce flicker', () => {
    for (const k of BOARD_ANIM_KINDS) {
      expect(animPlays(k, false), k).toBe(true);
      expect(animPlays(k, true), k).toBe(!BOARD_ANIMS[k].flashes);
    }
    expect(animMs('flash', true)).toBe(0);
    expect(animMs('ping', false)).toBe(Infinity);
    expect(animMs('haze', true)).toBe(Infinity);
    expect(animMs('dip', true)).toBe(MOTION.dipBlackout.calm.durationMs);
  });
});

describe('each animation ends within its duration on the sprite state it belongs to', () => {
  it('the shared specs rest on the part state: placed upright and opaque, dead sunk and dim, dark unlit', () => {
    for (const reduce of [false, true]) {
      const place = sampleSpec(MOTION.placeDrop, variantOf(MOTION.placeDrop, reduce).durationMs, reduce);
      expect(place.y).toBeCloseTo(NEUTRAL.y, 6);
      expect(place.alpha).toBeCloseTo(1, 6);
      expect(place.scale).toBeCloseTo(1, 6);
      const die = sampleSpec(MOTION.dieCollapse, variantOf(MOTION.dieCollapse, reduce).durationMs, reduce);
      expect({ y: die.y, alpha: die.alpha, scale: die.scale }).toEqual(MOTION.dieCollapse.rest);
      const dip = sampleSpec(MOTION.dipBlackout, variantOf(MOTION.dipBlackout, reduce).durationMs, reduce);
      expect(dip.light).toBe(0);
      const lift = sampleSpec(MOTION.cardLift, variantOf(MOTION.cardLift, reduce).durationMs, reduce);
      expect(lift.alpha).toBe(0);
      const tint = sampleSpec(MOTION.crewTint, variantOf(MOTION.crewTint, reduce).durationMs, reduce);
      expect(tint.mix).toBe(0);
    }
  });

  it('the death: a white flash at 0, gone by 150 ms; the shake settles to 0 px; calm has neither', () => {
    expect(deathFrame(0, false).flash).toBe(1);
    expect(deathFrame(DEATH_FLASH_MS / 1000, false).flash).toBe(0);
    expect(deathFrame(0.5, false)).toEqual({ flash: 0, shakeX: 0 });
    expect(deathFrame(0.7, false)).toEqual({ flash: 0, shakeX: 0 });
    let moved = 0;
    for (let t = 0; t < 0.4; t += 0.01) moved = Math.max(moved, Math.abs(deathFrame(t, false).shakeX));
    expect(moved).toBeGreaterThan(1);
    for (let t = 0; t <= 0.7; t += 0.01) expect(deathFrame(t, true)).toEqual({ flash: 0, shakeX: 0 });
    expect(deathSmoke(false)).toBeGreaterThan(deathSmoke(true));
  });

  it('the cable lowers the balancer onto its pad: up at 0, landed with no offset or sway at 1.2 s', () => {
    expect(cableFrame(0, false)).toMatchObject({ lower: 0, dy: -CABLE_DROP_PX, landed: false });
    for (const calm of [false, true]) {
      const end = cableFrame(1.2, calm);
      expect(end.lower).toBe(1);
      expect(end.dy).toBeCloseTo(0, 9);
      expect(end.sway).toBe(0);
      expect(end.landed).toBe(true);
      expect(cableFrame(5, calm)).toEqual(end);
    }
    for (let t = 0; t <= 1.2; t += 0.05) expect(cableFrame(t, true).sway).toBe(0);
  });

  it('the health-check ping cycles once a second along the wire', () => {
    expect(pingPhase(0)).toBe(0);
    expect(pingPhase(0.25)).toBeCloseTo(0.25, 9);
    expect(pingPhase(1.25)).toBeCloseTo(0.25, 9);
    expect(pingPhase(3.5)).toBeCloseTo(0.5, 9);
    expect(pingPhase(-0.25)).toBeCloseTo(0.75, 9);
    expect(pingFrame(0.5, false).along).toBeCloseTo(0.5, 9);
    // Calm: the ring keeps one alpha and one size.
    for (let t = 0; t < 2; t += 0.05) expect(pingFrame(t, true)).toMatchObject({ alpha: 0.6, radius: 7 });
  });

  it('the boot glow, the kit, the draw-on, the cut fade, the float and the lights end where they rest', () => {
    for (const calm of [false, true]) expect(bootFrame(0.5, calm).alpha).toBe(0);
    expect(kitFrame(0)).toEqual({ along: 0, scale: 1, alpha: 1 });
    expect(kitFrame(0.45)).toMatchObject({ along: 1, alpha: 0 });
    expect(drawOn(0)).toBe(0);
    expect(drawOn(0.25)).toBe(1);
    expect(drawOn(1)).toBe(1);
    expect(cutFade(0)).toBe(1);
    expect(cutFade(0.3)).toBe(0);
    expect(floatFrame(0)).toEqual({ dy: -0, alpha: 1 });
    const end = floatFrame(FLOAT_MS / 1000);
    expect(end.dy).toBeCloseTo(-FLOAT_RISE_PX, 9);
    expect(end.alpha).toBe(0);
    expect(lightsDown(0)).toBe(0);
    expect(lightsDown(1.5)).toBeCloseTo(0.6, 9);
    expect(lightsDown(9)).toBeCloseTo(0.6, 9);
    for (const calm of [false, true]) {
      expect(heldPadGlow(2.4, calm)).toBe(0);
      expect(heldPadGlow(9, calm)).toBe(0);
    }
  });

  it('every one-shot timeline clamps outside its range', () => {
    for (const [name, s] of Object.entries(ONE_SHOTS)) {
      for (const calm of [false, true]) {
        const end = s.at(s.ms / 1000, calm);
        expect(s.at(s.ms / 1000 + 0.5, calm), `${name} after its end`).toEqual(end);
        expect(s.at(s.ms / 1000 + 10, calm), `${name} long after`).toEqual(end);
      }
    }
  });

  it('the haze loops while a part is hot and holds still when calm', () => {
    const a = hazeFrame(0.1, false);
    expect(hazeFrame(0.1 + 0.9, false).alpha).toBeCloseTo(a.alpha, 9);
    for (let t = 0; t < 2; t += 0.05) expect(hazeFrame(t, true)).toEqual({ alpha: 0.32, dy: 0, scaleY: 1 });
  });

  it('fireworks burst five times in full, three soft ember rises when calm, each counted once', () => {
    let full = 0;
    let calm = 0;
    let prev = -1;
    for (let t = 0; t <= 2.4; t += 1 / 60) {
      full += burstsDue(prev, t, false);
      calm += burstsDue(prev, t, true);
      prev = t;
    }
    expect(full).toBe(FIREWORK_BURSTS.length);
    expect(calm).toBe(EMBER_BURSTS.length);
    expect(burstsDue(2.4, 3, false)).toBe(0);
  });
});

describe('reduce flicker: every animation has a calm equivalent with no flashing', () => {
  it('no calm board-only timeline changes a visible value faster than 1 Hz or jumps', () => {
    for (const [name, s] of Object.entries(ONE_SHOTS)) {
      const ms = s.ms;
      const n = s.at(0, true).length;
      for (let i = 0; i < n; i++) {
        expect(
          fastestHz(ms, (t) => s.at(t, true)[i]),
          `${name} calm`,
        ).toBeLessThanOrEqual(1);
      }
    }
    for (const f of [
      (t: number) => pingFrame(t, true).alpha,
      (t: number) => hazeFrame(t, true).alpha,
      (t: number) => bootFrame(t, true).alpha,
    ]) {
      expect(fastestHz(3000, f)).toBeLessThanOrEqual(1);
    }
  });

  it('the full death and held pads do flash, so calm is a real change', () => {
    // The death goes white at once (from nothing to full in no time: a flash); calm never does.
    expect(deathFrame(0, false).flash).toBe(1);
    expect(deathFrame(0, true).flash).toBe(0);
    expect(fastestHz(2400, (t) => heldPadGlow(t, false))).toBeGreaterThan(1);
  });

  it('the shared specs the board plays have calm variants that do not blink', () => {
    for (const name of ['placeDrop', 'dieCollapse', 'dipBlackout', 'cardLift', 'crewTint'] as const) {
      const s = MOTION[name];
      const v = s.calm;
      for (const t of v.tracks) {
        if (!['alpha', 'light', 'glow', 'ring'].includes(t.prop)) continue;
        expect(
          fastestHz(v.durationMs, (sec) => sampleSpec(s, sec * 1000, true)[t.prop]),
          `${name}.${t.prop}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the particle pool', () => {
  it('is made once at its size and never grows, however much is thrown', () => {
    const pool = new ParticlePool();
    expect(pool.items).toHaveLength(PARTICLE_POOL);
    const items = pool.items;
    for (let i = 0; i < 20; i++) pool.emit('firework', 900, 300, 14);
    expect(pool.items).toBe(items);
    expect(pool.items).toHaveLength(PARTICLE_POOL);
    expect(pool.active).toBe(PARTICLE_POOL);
    expect(pool.peak).toBe(PARTICLE_POOL);
    expect(pool.dropped).toBe(20 * 14 - PARTICLE_POOL);
  });

  it('frees each particle after its life, fading without ever brightening', () => {
    const pool = new ParticlePool(8);
    pool.emit('smoke', 0, 0, 3);
    pool.emit('spark', 0, 0, 3);
    expect(pool.active).toBe(6);
    const p = pool.items.find((x) => x.active && x.kind === 'spark')!;
    let last = pool.alphaOf(p);
    for (let i = 0; i < 10 && p.active; i++) {
      pool.step(0.02);
      if (!p.active) break;
      const a = pool.alphaOf(p);
      expect(a).toBeLessThanOrEqual(last);
      last = a;
    }
    pool.step(2);
    expect(pool.active).toBe(0);
    expect(pool.items.every((x) => !x.active)).toBe(true);
    pool.step(0);
    pool.emit('ember', 1, 2, 2);
    pool.clear();
    expect(pool.active).toBe(0);
  });

  it('throws the same particles for the same emits (seeded, no Math.random)', () => {
    const a = new ParticlePool(16);
    const b = new ParticlePool(16);
    a.emit('firework', 10, 20, 5);
    b.emit('firework', 10, 20, 5);
    a.step(0.1);
    b.step(0.1);
    expect(a.items).toEqual(b.items);
  });
});

describe('the book of animations in flight', () => {
  it('lists what plays, ends each one-shot once its duration has passed, and logs start and end', () => {
    const book = new AnimBook();
    book.start('death', 'server-1', false, 10);
    book.start('flash', null, false, 10);
    book.start('place', 'server-2', false, 10.2);
    expect(book.names()).toEqual(['death:server-1', 'flash', 'place:server-2']);
    book.step(10.55);
    // The 320 ms drop has ended; the 700 ms death has not; the 800 ms flash has not.
    expect(book.names()).toEqual(['death:server-1', 'flash']);
    book.step(10.8);
    expect(book.names()).toEqual([]);
    const death = book.log.find((e) => e.name === 'death:server-1')!;
    expect(death.start).toBe(10);
    expect(death.end).toBe(10.8);
    expect(death.ms).toBe(700);
    expect(death.calm).toBe(false);
  });

  it('never starts the flash or sparks under reduce flicker', () => {
    const book = new AnimBook();
    expect(book.start('flash', null, true, 0)).toBeNull();
    expect(book.start('sparks', null, true, 0)).toBeNull();
    expect(book.start('death', 'a', true, 0)!.ms).toBe(MOTION.dieCollapse.calm.durationMs);
    expect(book.names()).toEqual(['death:a']);
  });

  it('holds a loop while its condition holds and restarts a one-shot of the same name', () => {
    const book = new AnimBook();
    book.keep('ping', null, true, false, 1);
    book.keep('ping', null, true, false, 2);
    book.step(100);
    expect(book.names()).toEqual(['ping']);
    expect(book.age('ping', null, 3)).toBe(2);
    book.keep('ping', null, false, false, 101);
    expect(book.names()).toEqual([]);
    expect(book.age('ping', null, 102)).toBe(-1);
    book.start('cut', 'a>b', false, 0);
    book.start('cut', 'a>b', false, 0.1);
    expect(book.names()).toEqual(['cut:a>b']);
    expect(book.log.filter((e) => e.name === 'cut:a>b').map((e) => e.end)).toEqual([0.1, null]);
  });

  it('clears everything on a rewind and keeps a bounded log', () => {
    const book = new AnimBook();
    for (let i = 0; i < ANIM_LOG + 10; i++) book.start('wire', `w${i}`, false, i * 0.01);
    expect(book.log).toHaveLength(ANIM_LOG);
    book.clear(5);
    expect(book.names()).toEqual([]);
    expect(book.log.every((e) => e.end !== null)).toBe(true);
  });
});

describe('animations never change sim state', () => {
  it('anim.ts imports only the motion kit: no run, no sim, no bus, no Phaser', () => {
    const src = animSource;
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['../motion']);
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|window\./);
  });

  it("BoardScene's animation code reads the run only through the Frame and never calls a run action", () => {
    const src = boardSource;
    const start = src.indexOf('// ---- board-9: animations');
    const end = src.indexOf('// ---- end board-9');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/run\(\)/);
    expect(block).not.toMatch(
      /\.(placeServer|replaceServer|connect|cut|decommission|overclock|hold|release|tick)\(/,
    );
  });
});
