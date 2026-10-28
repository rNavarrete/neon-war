// Round avatar geometry (art3d-4): which square of a source picture a round avatar shows, and the
// four corner shapes that cut a square bake down to a disc. Pure: no Phaser, so tests/avatar-crop.test.ts
// checks it in node. src/scenes/avatars.ts bakes with it once per key and size.

/** A point in texture pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the face sits in a source picture: the centre of the crop as a fraction of the picture's
 * width and height, and the crop's side as a fraction of the picture's shorter side.
 */
export interface FaceFocus {
  readonly cx: number;
  readonly cy: number;
  readonly frac: number;
}

/** The whole picture, centred: badges, the TRIAGE drone, the block's avatars, baked stand-ins. */
export const FULL: FaceFocus = { cx: 0.5, cy: 0.5, frac: 1 };

/** A crew bust (rei, mika, ozzie faces): head and collar, from the upper third. */
export const BUST: FaceFocus = { cx: 0.5, cy: 0.3, frac: 0.55 };

/** Lux's faces lean right of centre in their cuts. */
export const LUX_BUST: FaceFocus = { cx: 0.56, cy: 0.3, frac: 0.55 };

/**
 * The focus for a source file under public/ ('art/chars/rei/faces/smirk.webp'), or for a texture
 * with no file (a baked stand-in, null). Crew and Lux portraits are busts; everything else is shown
 * whole, so a picked round badge (chars/comms/*, hud/live/avatar-luxnet) fills its disc as cut.
 */
export function focusFor(file: string | null): FaceFocus {
  if (!file) return FULL;
  if (/^art\/chars\/lux\/(faces-board|faces-room)\//.test(file)) return LUX_BUST;
  if (/^art\/chars\/(rei|mika|ozzie)\/faces\//.test(file)) return BUST;
  return FULL;
}

/** The square of the source a round avatar shows, in source pixels, and the scale that fits it to `size`. */
export interface FaceCrop {
  readonly x: number;
  readonly y: number;
  readonly side: number;
  /** size / side: the stamp scale. */
  readonly scale: number;
}

/**
 * The square of a w x h picture to show in a `size` px avatar: `focus.frac` of the shorter side,
 * centred on the focus point and kept inside the picture. Whole pixels. Pure.
 */
export function faceCrop(w: number, h: number, size: number, focus: FaceFocus = FULL): FaceCrop {
  const short = Math.max(1, Math.min(w, h));
  const side = Math.max(1, Math.min(short, Math.round(short * focus.frac)));
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(max, v));
  const x = clamp(Math.round(focus.cx * w - side / 2), Math.max(0, Math.floor(w) - side));
  const y = clamp(Math.round(focus.cy * h - side / 2), Math.max(0, Math.floor(h) - side));
  return { x, y, side, scale: size / side };
}

/** Arc points per corner: enough that a 96 px disc reads round. */
export const CORNER_SEGMENTS = 12;

/**
 * The four shapes outside the disc inscribed in a size x size square, one per corner, each the
 * square's corner, pushed 1 px out so no sliver survives at the edge, and the quarter arc between
 * the two edge midpoints. Erased once from a bake, they leave the disc. New arrays each call. Pure.
 */
export function circleCorners(size: number, segments: number = CORNER_SEGMENTS): Point[][] {
  const r = size / 2;
  const out: Point[][] = [];
  // Corners in order: top-left, top-right, bottom-right, bottom-left, with the arc's start angle.
  const corners: readonly [number, number, number][] = [
    [-1, -1, Math.PI],
    [size + 1, -1, 1.5 * Math.PI],
    [size + 1, size + 1, 0],
    [-1, size + 1, 0.5 * Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    const poly: Point[] = [{ x: cx, y: cy }];
    for (let i = 0; i <= segments; i++) {
      const a = start + (i / segments) * (Math.PI / 2);
      poly.push({ x: r + r * Math.cos(a), y: r + r * Math.sin(a) });
    }
    // Close along the square's edges back to the pushed-out corner.
    const first = poly[1];
    const last = poly[poly.length - 1];
    poly.splice(1, 0, edgeOut(first, size));
    poly.push(edgeOut(last, size));
    out.push(poly);
  }
  return out;
}

/** An arc end on the square's edge, pushed 1 px outward so the corner shape overlaps the edge. */
function edgeOut(p: Point, size: number): Point {
  const near = (v: number, t: number): boolean => Math.abs(v - t) < 1e-6;
  if (near(p.x, 0)) return { x: -1, y: p.y };
  if (near(p.x, size)) return { x: size + 1, y: p.y };
  if (near(p.y, 0)) return { x: p.x, y: -1 };
  return { x: p.x, y: size + 1 };
}

/** The texture a round avatar is baked into: one per key and size. */
export function avatarTexture(key: string, size: number): string {
  return `avatar:${key}@${size}`;
}

/** Whether a point lies inside the disc of a size px avatar. Pure. */
export function insideDisc(p: Point, size: number): boolean {
  const r = size / 2;
  return (p.x - r) ** 2 + (p.y - r) ** 2 <= r * r;
}
