// The title screen's motion over Rolando's picked rooftop art (30 Oct 2026, title A): rain falling in
// front of Lux, two searchlights sweeping over the towers, and New Year's fireworks bursting above
// them. Memorable title screens are alive enough to idle on (Zelda's waterfall, Hollow Knight's
// rain), so the picture moves but the menu stays still. Pure: the scene owns the objects and draws
// from these numbers; time and randomness come in as parameters.

/** A rectangle in game pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The 1536x1024 art drawn to cover 1920x1080: scale 1.25, 100 px cut off the top and bottom. */
export const ART = { w: 1536, h: 1024, scale: 1.25, dy: -100 } as const;

/** A point in the art's own pixels, in game pixels. Pure. */
export function fromArt(ax: number, ay: number): { x: number; y: number } {
  return { x: ax * ART.scale, y: ay * ART.scale + ART.dy };
}

/** Where Lux and TRIAGE stand in the art, in game pixels: the logo, menu and fireworks keep clear. */
export const HERO: Box = { x: 1320, y: 270, w: 500, h: 760 };
/** The sky over the towers where fireworks burst: right of the logo, above Lux's head. */
export const FIREWORK_SKY: Box = { x: 980, y: 110, w: 820, h: 250 };

/** Rain: streak count, slant and length, fall speed range (px/s). */
export const RAIN = { count: 150, dx: -7, dy: 34, vMin: 900, vMax: 1400 } as const;

export interface Streak {
  x: number;
  y: number;
  v: number;
}

/** `n` streaks spread over the frame. `rand` returns [0, 1). Pure. */
export function seedRain(n: number, w: number, h: number, rand: () => number): Streak[] {
  return Array.from({ length: n }, () => ({
    x: rand() * (w + 60),
    y: rand() * h,
    v: RAIN.vMin + rand() * (RAIN.vMax - RAIN.vMin),
  }));
}

/**
 * Moves a streak down over `dt` seconds along the slant; past the bottom it starts again above the
 * top at a new x. Changes `s` in place: it runs per streak per frame.
 */
export function fallStreak(s: Streak, dt: number, w: number, h: number, rand: () => number): void {
  const step = s.v * dt;
  s.y += step;
  s.x += (step * RAIN.dx) / RAIN.dy;
  if (s.y - RAIN.dy > h || s.x < -RAIN.dy) {
    s.y = -rand() * 80;
    s.x = rand() * (w + 60);
  }
}

/** The two searchlights: where each beam starts (game px), its length, half-width at the far end, period (s). */
export const BEAMS = [
  { x: 1125, y: 712, len: 760, spread: 34, base: -100, swing: 14, period: 9 },
  { x: 1745, y: 650, len: 720, spread: 30, base: -78, swing: 12, period: 11 },
] as const;

/** A beam's angle in degrees at `t` seconds (0 is pointing right, -90 straight up). Pure. */
export function beamAngle(beam: (typeof BEAMS)[number], t: number): number {
  return beam.base + Math.sin((t / beam.period) * Math.PI * 2) * beam.swing;
}

/** Fireworks: sparks per burst, a burst's life (s), gap between bursts (s), spark speed (px/s), gravity. */
export const FIREWORK = {
  sparks: 28,
  life: 1.6,
  gapMin: 0.9,
  gapSpread: 1.6,
  speed: 150,
  gravity: 70,
} as const;
/** Burst colours: magenta, cyan, gold, the game's neon. */
export const FIREWORK_COLORS = [0xff3fa4, 0x2de2e6, 0xffc857, 0xff6ad5] as const;

export interface Burst {
  x: number;
  y: number;
  /** Seconds since it burst; past FIREWORK.life it is spent and can be reused. */
  age: number;
  color: number;
  live: boolean;
}

/** A new burst somewhere in the firework sky. `rand` returns [0, 1). Writes into `b`. */
export function igniteBurst(b: Burst, rand: () => number): void {
  b.x = FIREWORK_SKY.x + rand() * FIREWORK_SKY.w;
  b.y = FIREWORK_SKY.y + rand() * FIREWORK_SKY.h;
  b.age = 0;
  b.color = FIREWORK_COLORS[Math.floor(rand() * FIREWORK_COLORS.length)]!;
  b.live = true;
}

/**
 * Spark `i` of a burst `age` seconds old, offset from the burst's centre: sparks fly out evenly in a
 * ring, slow down and fall. Writes into `out` so nothing allocates per frame. Pure apart from `out`.
 */
export function sparkAt(i: number, age: number, out: { dx: number; dy: number }): void {
  const a = (i / FIREWORK.sparks) * Math.PI * 2;
  // Drag: the ring opens fast and settles, r = speed * (1 - e^-2t) / 2.
  const r = (FIREWORK.speed * (1 - Math.exp(-2 * age))) / 2;
  out.dx = Math.cos(a) * r;
  out.dy = Math.sin(a) * r + 0.5 * FIREWORK.gravity * age * age;
}

/** A burst's brightness at `age`: a flash, then a fade to nothing at the end of its life. Pure. */
export function burstAlpha(age: number): number {
  if (age <= 0 || age >= FIREWORK.life) return 0;
  return Math.min(1, age / 0.08) * (1 - age / FIREWORK.life);
}

/**
 * The logo's neon buzz: true while the sign's light dips. A short stutter every 6 s or so, never with
 * reduce flicker on. Pure.
 */
export function logoDips(t: number, reduceFlicker: boolean): boolean {
  if (reduceFlicker) return false;
  const p = t % 6.3;
  return (p > 4.0 && p < 4.07) || (p > 4.16 && p < 4.21);
}

/** True when two boxes overlap. Pure. */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
