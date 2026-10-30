// Where the table's grid cells sit on screen: a grid drawn in code on the glass of the picked table
// (board/table-plate, Rolando's pick 30 Oct 2026: table B, the steeper top-down camera). Pure: no
// Phaser, so the geometry is unit-tested in node.
//
// The glass is painted in perspective: its far edge narrower than its near edge. The grid is the
// glass (layout.ts GLASS) inset a little, mapped from the unit square by a projective transform, so
// columns lean in toward the far edge and rows get shallower away from the viewer, the way the
// painting's own perspective does. A lattice node is where a column line crosses a row line; a cell
// is the quad between four nodes.

import { GRID, type Node, parseCell } from '../../sim/grid';
import { GLASS } from './glass';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** How far the grid sits in from the glass's painted edge, in game pixels. */
export const GRID_INSET = { side: 14, far: 10, near: 12 } as const;

/** The grid's outline: far-left, far-right, near-right, near-left (the glass, inset). */
export const GRID_QUAD: readonly [Pt, Pt, Pt, Pt] = (() => {
  const [tl, tr, br, bl] = GLASS;
  // Along each side, move in by `side` horizontally; the far and near edges down and up.
  return [
    { x: tl.x + GRID_INSET.side, y: tl.y + GRID_INSET.far },
    { x: tr.x - GRID_INSET.side, y: tr.y + GRID_INSET.far },
    { x: br.x - GRID_INSET.side, y: br.y - GRID_INSET.near },
    { x: bl.x + GRID_INSET.side, y: bl.y - GRID_INSET.near },
  ];
})();

type M3 = readonly [number, number, number, number, number, number, number, number, number];

/** The projective map from the unit square (u right, v toward the viewer) onto a quad (Heckbert). */
function squareToQuad(q: readonly [Pt, Pt, Pt, Pt]): M3 {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

/** The inverse of a 3x3 map (its adjugate: a projective map is defined up to scale). */
function inverse(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
}

const FORWARD = squareToQuad(GRID_QUAD);
const BACK = inverse(FORWARD);

/** The screen point of grid fraction (u, v): 0 to 1 across the columns and down the rows. */
export function gridPoint(u: number, v: number): Pt {
  const m = FORWARD;
  const w = m[6] * u + m[7] * v + m[8];
  return { x: (m[0] * u + m[1] * v + m[2]) / w, y: (m[3] * u + m[4] * v + m[5]) / w };
}

/** Where column line i crosses row line j, in game pixels. */
function cross(i: number, j: number): Pt {
  return gridPoint(i / GRID.cols, j / GRID.rows);
}

/** Every lattice node, row line by row line, made once. */
const NODES: readonly Pt[] = (() => {
  const out: Pt[] = [];
  for (let j = 0; j <= GRID.rows; j++) for (let i = 0; i <= GRID.cols; i++) out.push(cross(i, j));
  return out;
})();

/** The screen point of lattice node (i, j), clamped onto the grid. */
export function nodeAt(i: number, j: number): Pt {
  const ci = Math.max(0, Math.min(GRID.cols, i));
  const cj = Math.max(0, Math.min(GRID.rows, j));
  return NODES[cj * (GRID.cols + 1) + ci];
}

export function nodePoint(n: Node): Pt {
  return nodeAt(n.i, n.j);
}

/** A block of cells' outline on screen, as its four corners: far-left, far-right, near-right, near-left. */
export function blockQuad(col: number, row: number, w: number, h: number): [Pt, Pt, Pt, Pt] {
  return [nodeAt(col, row), nodeAt(col + w, row), nodeAt(col + w, row + h), nodeAt(col, row + h)];
}

/** A cell's outline on screen. */
export function cellQuad(id: string): [Pt, Pt, Pt, Pt] | null {
  const c = parseCell(id);
  return c ? blockQuad(c.col, c.row, 1, 1) : null;
}

/** The centre of a block of cells on screen (the mean of its corners). */
export function blockCentre(col: number, row: number, w: number, h: number): Pt {
  const q = blockQuad(col, row, w, h);
  return { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
}

/**
 * Where a screen point is on the grid, in fractional cells (u across the columns, v down the rows),
 * or null off the grid. Nothing allocates but the answer.
 */
export function gridAt(x: number, y: number): { u: number; v: number } | null {
  const m = BACK;
  const w = m[6] * x + m[7] * y + m[8];
  const u = (m[0] * x + m[1] * y + m[2]) / w;
  const v = (m[3] * x + m[4] * y + m[5]) / w;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  return { u: u * GRID.cols, v: v * GRID.rows };
}

/** The cell under a screen point, or null off the grid. */
export function cellAt(x: number, y: number): { col: number; row: number } | null {
  const g = gridAt(x, y);
  if (!g) return null;
  return { col: Math.min(GRID.cols - 1, Math.floor(g.u)), row: Math.min(GRID.rows - 1, Math.floor(g.v)) };
}

/**
 * The anchor of a w x h footprint centred under a screen point: the cell whose footprint has the
 * point nearest its middle, kept on the grid. Null off the grid.
 */
export function anchorAt(x: number, y: number, w: number, h: number): { col: number; row: number } | null {
  const g = gridAt(x, y);
  if (!g) return null;
  const col = Math.max(0, Math.min(GRID.cols - w, Math.round(g.u - w / 2)));
  const row = Math.max(0, Math.min(GRID.rows - h, Math.round(g.v - h / 2)));
  return { col, row };
}

/** A cell's drawn size near the middle of a row (game px): the far row's and the near row's, for the hook. */
export function cellSize(row: number): { w: number; h: number } {
  const mid = GRID.cols >> 1;
  const q = blockQuad(mid, row, 1, 1);
  return { w: (q[1].x - q[0].x + q[2].x - q[3].x) / 2, h: (q[3].y - q[0].y + q[2].y - q[1].y) / 2 };
}
