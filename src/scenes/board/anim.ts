// The board's animations (board-9): which event plays what, for how long, and the board-only
// timelines that motion.ts (the shared kit: placeDrop, dieCollapse, dipBlackout, cardLift, crewTint)
// does not cover: the death flash and shake, the boot glow, the overclock kit's flight, the heat
// haze, a new wire drawing on, a cut trace fading, the refund float, the crew's cable, the
// health-check pings, the midnight fireworks and pad flash, and the lights going down.
//
// Every timeline has a calm variant that plays while settings().reduceFlicker is on: nothing in it
// flashes (no white flash, no sparks, no blink), and its visible values change direction at most
// once a second. Animations are looks only: nothing here reads or changes the sim. The cable plays
// inside the crew-build wait the sim already holds (no hold of its own).
//
// Also here: a fixed-size particle pool (smoke, sparks, fireworks, embers) that never grows, and
// AnimBook, which tracks the animations in flight by name for the test hook (board.anims) and logs
// when each started and finished on the animation clock.
//
// Pure: no Phaser, no DOM, no clock. Time comes in as a parameter, in seconds since the animation
// started (board time: real seconds times the Frame's timeScale, frozen while paused).

import { CARD_LIFT_MS, CREW_TINT_MS, MOTION, type MotionName, ease } from '../motion';

/** What can animate on the board; the hook names an animation `kind` or `kind:<id>`. */
export type BoardAnimKind =
  | 'place'
  | 'boot'
  | 'overclock'
  | 'death'
  | 'dip'
  | 'haze'
  | 'wire'
  | 'cut'
  | 'decommission'
  | 'float'
  | 'cable'
  | 'fireworks'
  | 'lightsdown'
  | 'ping'
  | 'flash'
  | 'sparks';

export interface BoardAnimDef {
  readonly kind: BoardAnimKind;
  /** What starts it. */
  readonly event: string;
  /** The shared motion.ts spec the part sprite plays, or null for a board-only timeline. */
  readonly motion: MotionName | null;
  /** Ms of one play (one cycle for a loop), full and calm. A calm of 0 means it never plays calm. */
  readonly ms: number;
  readonly calmMs: number;
  /** Plays for as long as its condition holds (one cycle is `ms`). */
  readonly loop: boolean;
  /** Its hook name carries the part id or wire key. */
  readonly keyed: boolean;
  /** Flashes or throws sparks: never under reduce flicker. */
  readonly flashes: boolean;
}

export const BOOT_MS = 500;
export const KIT_MS = 450;
export const HAZE_MS = 900;
export const DRAW_ON_MS = 250;
export const CUT_MS = 300;
export const FLOAT_MS = 1200;
export const FIREWORKS_MS = 2400;
export const LIGHTS_DOWN_MS = 1500;
export const PING_MS = 1000;
/** The death's white flash and the held pads' flash, ms (full variant only). */
export const DEATH_FLASH_MS = 150;
export const PAD_FLASH_MS = 800;
/** Sparks thrown at both ports of a cut wire live this long. */
export const CUT_SPARKS_MS = 350;
/** How far the death shakes, px, and for how long, s. */
export const SHAKE_PX = 4;
export const SHAKE_S = 0.4;
/** How far above its pad the crew's cable starts the balancer, px. */
export const CABLE_DROP_PX = 260;
/** How far a refund float rises, px. */
export const FLOAT_RISE_PX = 40;

const m = MOTION;
const def = (d: BoardAnimDef): BoardAnimDef => Object.freeze(d);

export const BOARD_ANIMS: Readonly<Record<BoardAnimKind, BoardAnimDef>> = Object.freeze({
  place: def({
    kind: 'place',
    event: "a part placed (occurrence 'placed'), a dead box replaced",
    motion: 'placeDrop',
    ms: m.placeDrop.durationMs,
    calmMs: m.placeDrop.calm.durationMs,
    loop: false,
    keyed: true,
    flashes: false,
  }),
  boot: def({
    kind: 'boot',
    event: 'a boot or reboot completes (status booting/rebooting to online)',
    motion: null,
    ms: BOOT_MS,
    calmMs: BOOT_MS,
    loop: false,
    keyed: true,
    flashes: false,
  }),
  overclock: def({
    kind: 'overclock',
    event: "the kit fitted (bus action 'overclock'): it flies from the tray onto the box",
    motion: null,
    ms: KIT_MS,
    calmMs: KIT_MS,
    loop: false,
    keyed: true,
    flashes: false,
  }),
  death: def({
    kind: 'death',
    event: "a server dies (occurrence 'died'): collapse, smoke; flash and shake in full",
    motion: 'dieCollapse',
    ms: m.dieCollapse.durationMs,
    calmMs: m.dieCollapse.calm.durationMs,
    loop: false,
    keyed: true,
    flashes: false,
  }),
  dip: def({
    kind: 'dip',
    event: "a part goes dark in a power dip (occurrence 'dark' with an id)",
    motion: 'dipBlackout',
    ms: m.dipBlackout.durationMs,
    calmMs: m.dipBlackout.calm.durationMs,
    loop: false,
    keyed: true,
    flashes: false,
  }),
  haze: def({
    kind: 'haze',
    event: 'a part over 100% load: heat haze over it while it stays over',
    motion: null,
    ms: HAZE_MS,
    calmMs: HAZE_MS,
    loop: true,
    keyed: true,
    flashes: false,
  }),
  wire: def({
    kind: 'wire',
    event: "a wire connected (occurrence 'wired'): the trace draws on",
    motion: null,
    ms: DRAW_ON_MS,
    calmMs: DRAW_ON_MS,
    loop: false,
    keyed: true,
    flashes: false,
  }),
  cut: def({
    kind: 'cut',
    event: "a wire cut (occurrence 'cut'): the trace fades; sparks at both ports in full",
    motion: null,
    ms: CUT_MS,
    calmMs: CUT_MS,
    loop: false,
    keyed: true,
    flashes: false,
  }),
  decommission: def({
    kind: 'decommission',
    event: "a part decommissioned (bus action 'decommission'): it lifts and fades",
    motion: 'cardLift',
    ms: CARD_LIFT_MS,
    calmMs: m.cardLift.calm.durationMs,
    loop: false,
    keyed: true,
    flashes: false,
  }),
  float: def({
    kind: 'float',
    event: 'the refund of a decommission rises off the pad (+40)',
    motion: null,
    ms: FLOAT_MS,
    calmMs: FLOAT_MS,
    loop: false,
    keyed: true,
    flashes: false,
  }),
  cable: def({
    kind: 'cable',
    event: "the crew's balancer racked at the rescue: the cable lowers it onto its pad",
    motion: 'crewTint',
    ms: CREW_TINT_MS,
    calmMs: m.crewTint.calm.durationMs,
    loop: false,
    keyed: false,
    flashes: false,
  }),
  fireworks: def({
    kind: 'fireworks',
    event: "midnight held (occurrence 'held'): fireworks inside the feed, embers when calm",
    motion: null,
    ms: FIREWORKS_MS,
    calmMs: FIREWORKS_MS,
    loop: false,
    keyed: false,
    flashes: false,
  }),
  lightsdown: def({
    kind: 'lightsdown',
    event: "the block went dark at midnight (occurrence 'dark' without an id)",
    motion: null,
    ms: LIGHTS_DOWN_MS,
    calmMs: LIGHTS_DOWN_MS,
    loop: false,
    keyed: false,
    flashes: false,
  }),
  ping: def({
    kind: 'ping',
    event: 'a balancer feeds boxes: rings run down its wires once a second',
    motion: null,
    ms: PING_MS,
    calmMs: PING_MS,
    loop: true,
    keyed: false,
    flashes: false,
  }),
  flash: def({
    kind: 'flash',
    event: 'the white flash of a death, the held pads flashing (full variant only)',
    motion: null,
    ms: PAD_FLASH_MS,
    calmMs: 0,
    loop: false,
    keyed: false,
    flashes: true,
  }),
  sparks: def({
    kind: 'sparks',
    event: 'sparks off both ports of a cut wire (full variant only)',
    motion: null,
    ms: CUT_SPARKS_MS,
    calmMs: 0,
    loop: false,
    keyed: false,
    flashes: true,
  }),
});

export const BOARD_ANIM_KINDS: readonly BoardAnimKind[] = Object.freeze(
  Object.keys(BOARD_ANIMS) as BoardAnimKind[],
);

/** Ms one play of `kind` lasts in the variant that plays (Infinity for a loop; 0 if it never plays). */
export function animMs(kind: BoardAnimKind, calm: boolean): number {
  const d = BOARD_ANIMS[kind];
  if (calm && d.calmMs === 0) return 0;
  if (d.loop) return Infinity;
  return calm ? d.calmMs : d.ms;
}

/** Whether `kind` plays at all under the setting (flashes and sparks never play calm). */
export function animPlays(kind: BoardAnimKind, calm: boolean): boolean {
  return !(calm && BOARD_ANIMS[kind].flashes);
}

/** The hook name of an animation: `kind`, or `kind:<id>` for one keyed to a part or a wire. */
export function animName(kind: BoardAnimKind, id: string | null): string {
  return BOARD_ANIMS[kind].keyed && id !== null ? `${kind}:${id}` : kind;
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

// ---- board-only timelines ---------------------------------------------------------------------

/** The death's extras over dieCollapse: the white flash overlay's alpha and the sideways shake, px. */
export interface DeathFrame {
  flash: number;
  shakeX: number;
}

/** The death `t` s in: a white flash fading over 150 ms and a shake dying out over 0.4 s; neither when calm. */
export function deathFrame(t: number, calm: boolean, out: DeathFrame = { flash: 0, shakeX: 0 }): DeathFrame {
  const flashS = DEATH_FLASH_MS / 1000;
  if (calm || t < 0) {
    out.flash = 0;
    out.shakeX = 0;
    return out;
  }
  out.flash = t < flashS ? 1 - t / flashS : 0;
  out.shakeX = t < SHAKE_S ? Math.sin(t * Math.PI * 2 * 18) * SHAKE_PX * (1 - t / SHAKE_S) : 0;
  return out;
}

/** Smoke puffs a death sends up: more in full, fewer and slower when calm. */
export function deathSmoke(calm: boolean): number {
  return calm ? 3 : 6;
}

/** The boot glow: a ring on the box that comes up and fades (full), or only fades (calm); `scale` grows. */
export interface RingFrame {
  alpha: number;
  scale: number;
}

export function bootFrame(t: number, calm: boolean, out: RingFrame = { alpha: 0, scale: 1 }): RingFrame {
  const p = clamp01(t / (BOOT_MS / 1000));
  out.scale = 1 + 0.3 * ease('cubicOut', p);
  if (calm) out.alpha = 0.6 * (1 - p);
  else out.alpha = p < 0.3 ? ease('quadOut', p / 0.3) : 1 - ease('quadIn', (p - 0.3) / 0.7);
  if (p >= 1) out.alpha = 0;
  return out;
}

/** The overclock kit's flight from the tray card to the box: progress 0..1 along the way, its scale and alpha. */
export interface FlyFrame {
  along: number;
  scale: number;
  alpha: number;
}

export function kitFrame(t: number, out: FlyFrame = { along: 0, scale: 1, alpha: 1 }): FlyFrame {
  const p = clamp01(t / (KIT_MS / 1000));
  out.along = ease('quadOut', p);
  out.scale = 1 - 0.55 * p;
  out.alpha = p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
  if (p >= 1) out.alpha = 0;
  return out;
}

/** The heat haze over a hot part, `t` s into the loop: alpha and a vertical shimmer, px; steady when calm. */
export interface HazeFrame {
  alpha: number;
  dy: number;
  scaleY: number;
}

export function hazeFrame(
  t: number,
  calm: boolean,
  out: HazeFrame = { alpha: 0, dy: 0, scaleY: 1 },
): HazeFrame {
  if (calm) {
    out.alpha = 0.32;
    out.dy = 0;
    out.scaleY = 1;
    return out;
  }
  const w = Math.sin((t / (HAZE_MS / 1000)) * Math.PI * 2);
  out.alpha = 0.3 + 0.1 * w;
  out.dy = -3 * w;
  out.scaleY = 1 + 0.04 * w;
  return out;
}

/** How much of a new trace has drawn on, 0..1 (the same calm: a sweep, not a flash). */
export function drawOn(t: number): number {
  return ease('cubicOut', clamp01(t / (DRAW_ON_MS / 1000)));
}

/** A cut trace's alpha as it fades, 1..0. */
export function cutFade(t: number): number {
  return 1 - clamp01(t / (CUT_MS / 1000));
}

/** The refund float: its rise (negative y, px) and alpha. */
export interface FloatFrame {
  dy: number;
  alpha: number;
}

export function floatFrame(t: number, out: FloatFrame = { dy: 0, alpha: 1 }): FloatFrame {
  const s = FLOAT_MS / 1000;
  const p = clamp01(t / s);
  out.dy = -FLOAT_RISE_PX * ease('cubicOut', p);
  out.alpha = t < s / 2 ? 1 : Math.max(0, 1 - (t - s / 2) / (s / 2));
  return out;
}

/**
 * The crew's cable `t` s in: how far it has lowered (0 up, 1 landed at 1.2 s), the balancer's offset
 * above its pad (px, 0 once landed), a small sway in full (none when calm) and crewTint's mix.
 */
export interface CableFrame {
  lower: number;
  dy: number;
  sway: number;
  landed: boolean;
}

export function cableFrame(
  t: number,
  calm: boolean,
  out: CableFrame = { lower: 0, dy: -CABLE_DROP_PX, sway: 0, landed: false },
): CableFrame {
  const s = CREW_TINT_MS / 1000;
  const p = clamp01(t / s);
  out.lower = ease('cubicOut', p);
  out.dy = -CABLE_DROP_PX * (1 - out.lower);
  out.sway = calm || p >= 1 ? 0 : Math.sin(t * Math.PI * 2 * 1.5) * 6 * (1 - p);
  out.landed = p >= 1;
  return out;
}

/** The health-check ping's phase on a wire, 0..1, cycling once a second. */
export function pingPhase(t: number): number {
  const s = PING_MS / 1000;
  const x = (t % s) / s;
  return x < 0 ? x + 1 : x;
}

/** A ping ring: where it is along the wire (0..1), its alpha and radius, px. Steady alpha when calm. */
export interface PingFrame {
  along: number;
  alpha: number;
  radius: number;
}

export function pingFrame(
  t: number,
  calm: boolean,
  out: PingFrame = { along: 0, alpha: 0, radius: 0 },
): PingFrame {
  const p = pingPhase(t);
  out.along = p;
  out.radius = calm ? 7 : 5 + 5 * p;
  // Full: fades in over the first fifth and out over the last, so the wrap is not a jump.
  out.alpha = calm ? 0.6 : 0.9 * Math.min(1, p / 0.2, (1 - p) / 0.2);
  return out;
}

/** The held pads: a fast flash for 0.8 s then a fade (full), or one slow rise and fall of glow (calm). */
export function heldPadGlow(t: number, calm: boolean): number {
  const s = FIREWORKS_MS / 1000;
  if (t >= s || t < 0) return 0;
  if (calm) {
    const half = s / 2;
    return t < half ? 0.5 * ease('sineInOut', t / half) : 0.5 * (1 - ease('sineInOut', (t - half) / half));
  }
  const flash = PAD_FLASH_MS / 1000;
  if (t < flash) return Math.floor(t * 8) % 2 === 0 ? 1 : 0.25;
  return 0.5 * (1 - (t - flash) / (s - flash));
}

/** Burst times, s from the stroke of twelve: fireworks in full, a few soft ember rises when calm. */
export const FIREWORK_BURSTS: readonly number[] = Object.freeze([0, 0.45, 0.9, 1.4, 1.9]);
export const EMBER_BURSTS: readonly number[] = Object.freeze([0, 0.8, 1.6]);
export const FIREWORK_SIZE = 14;
export const EMBER_SIZE = 6;

/**
 * How many bursts fall in (from, to] s: the scene emits that many this frame. The first frame
 * passes a negative `from` so the burst at 0 counts.
 */
export function burstsDue(from: number, to: number, calm: boolean): number {
  const list = calm ? EMBER_BURSTS : FIREWORK_BURSTS;
  let n = 0;
  for (let i = 0; i < list.length; i++) if (list[i] > from && list[i] <= to) n++;
  return n;
}

/** The lights going down over the feed when the block goes dark: the shade's alpha, 0..0.6. */
export function lightsDown(t: number): number {
  return 0.6 * ease('sineInOut', clamp01(t / (LIGHTS_DOWN_MS / 1000)));
}

// ---- the particle pool ------------------------------------------------------------------------

export type ParticleKind = 'smoke' | 'spark' | 'firework' | 'ember';

export interface Particle {
  active: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** The pool's fixed size: it never grows, and an emit past it is dropped. */
export const PARTICLE_POOL = 96;

const PARTICLE: Readonly<
  Record<ParticleKind, { life: number; speed: [number, number]; gravity: number; up: boolean }>
> = {
  smoke: { life: 1, speed: [25, 45], gravity: -10, up: true },
  spark: { life: 0.35, speed: [120, 220], gravity: 400, up: false },
  firework: { life: 1.1, speed: [140, 240], gravity: 120, up: false },
  ember: { life: 1.6, speed: [30, 60], gravity: 0, up: true },
};

/** Particles that live a while and then are free again: made once, stepped in place. */
export class ParticlePool {
  readonly items: Particle[] = [];
  /** Live particles now, the most ever live at once, and emits dropped because the pool was full. */
  active = 0;
  peak = 0;
  dropped = 0;
  private seed = 0x2545f491;

  constructor(readonly size = PARTICLE_POOL) {
    for (let i = 0; i < size; i++) {
      this.items.push({ active: false, kind: 'smoke', x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1 });
    }
  }

  /** A deterministic 0..1 (an LCG), so the same emits always throw the same particles. */
  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Throw up to `n` particles of `kind` from (x, y); returns how many found a free slot. */
  emit(kind: ParticleKind, x: number, y: number, n: number): number {
    const k = PARTICLE[kind];
    let made = 0;
    for (let i = 0; i < this.items.length && made < n; i++) {
      const p = this.items[i];
      if (p.active) continue;
      const speed = k.speed[0] + (k.speed[1] - k.speed[0]) * this.rand();
      const angle = k.up ? -Math.PI / 2 + (this.rand() - 0.5) * 0.9 : this.rand() * Math.PI * 2;
      p.active = true;
      p.kind = kind;
      p.x = x + (this.rand() - 0.5) * 10;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.age = 0;
      p.life = k.life * (0.8 + 0.4 * this.rand());
      made++;
    }
    this.dropped += n - made;
    this.active += made;
    if (this.active > this.peak) this.peak = this.active;
    return made;
  }

  /** Move every live particle on by `dt` s; one past its life is free again. */
  step(dt: number): void {
    if (dt <= 0) return;
    let live = 0;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      p.vy += PARTICLE[p.kind].gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      live++;
    }
    this.active = live;
  }

  /** A particle's alpha: fading over its life (smoke softer), never coming back up. */
  alphaOf(p: Particle): number {
    const left = 1 - p.age / p.life;
    return p.kind === 'smoke' ? 0.55 * left : left;
  }

  /** Every particle free (a rewind, a new run). */
  clear(): void {
    for (let i = 0; i < this.items.length; i++) this.items[i].active = false;
    this.active = 0;
  }
}

// ---- the book of animations in flight ---------------------------------------------------------

/** One animation: its hook name, kind, the animation clock it started and ended on, and whether it played calm. */
export interface AnimEntry {
  name: string;
  kind: BoardAnimKind;
  id: string | null;
  start: number;
  end: number | null;
  ms: number;
  calm: boolean;
}

/** How many finished or running animations the log keeps (oldest dropped first). */
export const ANIM_LOG = 128;

/**
 * The animations in flight, by name, on the animation clock (seconds). A one-shot ends once its
 * duration has passed; a loop runs until `keep` turns it off. Entries are made when an animation
 * starts (an event), never on a steady frame.
 */
export class AnimBook {
  readonly live: AnimEntry[] = [];
  readonly log: AnimEntry[] = [];

  /**
   * Start `kind` (restarting one of the same name), unless it never plays under this setting. `ms`
   * shortens a one-shot below its table duration (the death's 150 ms flash).
   */
  start(kind: BoardAnimKind, id: string | null, calm: boolean, now: number, ms?: number): AnimEntry | null {
    if (!animPlays(kind, calm)) return null;
    const name = animName(kind, id);
    this.end(name, now);
    const full = animMs(kind, calm);
    const e: AnimEntry = {
      name,
      kind,
      id,
      start: now,
      end: null,
      ms: ms !== undefined ? Math.min(ms, full) : full,
      calm,
    };
    this.live.push(e);
    this.log.push(e);
    if (this.log.length > ANIM_LOG) this.log.shift();
    return e;
  }

  /** A loop: on while `on`, ended once it is not. */
  keep(kind: BoardAnimKind, id: string | null, on: boolean, calm: boolean, now: number): void {
    const e = this.playing(kind, id);
    if (on && !e) this.start(kind, id, calm, now);
    else if (!on && e) this.endEntry(e, now);
  }

  /** The live entry of `kind` (and `id`), or undefined; a plain loop, no name built. */
  playing(kind: BoardAnimKind, id: string | null): AnimEntry | undefined {
    for (let i = 0; i < this.live.length; i++) {
      const e = this.live[i];
      if (e.kind === kind && e.id === id) return e;
    }
    return undefined;
  }

  /** Seconds since the live `kind` (and `id`) started, or -1 when it is not playing. */
  age(kind: BoardAnimKind, id: string | null, now: number): number {
    const e = this.playing(kind, id);
    return e ? now - e.start : -1;
  }

  /** End every one-shot whose time is up. */
  step(now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      if (now - e.start >= e.ms / 1000) {
        e.end = now;
        this.live.splice(i, 1);
      }
    }
  }

  /** The names in flight now (the hook). */
  names(): string[] {
    return this.live.map((e) => e.name);
  }

  /** End everything now (a rewind clears the board's animations with the views). */
  clear(now: number): void {
    for (const e of this.live) e.end = now;
    this.live.length = 0;
  }

  private end(name: string, now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (this.live[i].name === name) {
        this.live[i].end = now;
        this.live.splice(i, 1);
      }
    }
  }

  private endEntry(e: AnimEntry, now: number): void {
    const i = this.live.indexOf(e);
    if (i < 0) return;
    e.end = now;
    this.live.splice(i, 1);
  }
}
