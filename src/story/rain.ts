// Rain in Lux's room: it falls outside, so it only shows through the window glass. Two layers, the way
// rain-on-glass effects are usually built: fast streaks falling past the window, and a few slow drops
// trickling down the pane. Pure geometry, no Phaser; the scene owns the drops and draws them.

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The window glass in bg/bedroom-dark.webp as drawn to cover 1920x1080, in game pixels. */
export const ROOM_GLASS: Box = { x: 549, y: 166, w: 484, h: 432 };

/** A falling streak's slant and length: its tail is this far up and to the right of its head. */
export const STREAK = { dx: 6, dy: 28 } as const;

export interface Drop {
  x: number;
  y: number;
  /** Fall speed, px/s. */
  v: number;
}

/** A streak or trickle as drawn: head and tail, clipped to the glass. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** `n` drops spread over the glass, falling at `min` to `max` px/s. `rand` returns [0, 1). */
export function seedDrops(n: number, box: Box, min: number, max: number, rand: () => number): Drop[] {
  return Array.from({ length: n }, () => ({
    x: box.x + rand() * box.w,
    y: box.y + rand() * box.h,
    v: min + rand() * (max - min),
  }));
}

/**
 * Moves `d` down by its speed over `dt` seconds. Once its tail of length `len` is past the sill it
 * starts again just above the glass at a new x. Changes `d` in place: it runs per drop per frame.
 */
export function fall(d: Drop, dt: number, box: Box, len: number, rand: () => number): void {
  d.y += d.v * dt;
  if (d.y - len > box.y + box.h) {
    d.y = box.y - rand() * len;
    d.x = box.x + rand() * box.w;
  }
}

/**
 * The part of the line from (hx, hy) up to its tail (hx + dx, hy - dy) that lies on the glass, written
 * into `out`. Returns false when none of it does. Writes into `out` so nothing allocates per frame.
 */
export function clipToGlass(hx: number, hy: number, dx: number, dy: number, box: Box, out: Segment): boolean {
  const top = box.y;
  const bottom = box.y + box.h;
  // Parametrise along the line, t = 0 at the head and t = 1 at the tail, and keep the t range on the glass.
  let t0 = 0;
  let t1 = 1;
  if (hy > bottom) t0 = Math.max(t0, (hy - bottom) / dy);
  if (hy - dy < top) t1 = Math.min(t1, (hy - top) / dy);
  if (dx !== 0) {
    const ta = (box.x - hx) / dx;
    const tb = (box.x + box.w - hx) / dx;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  } else if (hx < box.x || hx > box.x + box.w) {
    return false;
  }
  if (t0 >= t1) return false;
  out.x1 = hx + dx * t0;
  out.y1 = hy - dy * t0;
  out.x2 = hx + dx * t1;
  out.y2 = hy - dy * t1;
  return true;
}
