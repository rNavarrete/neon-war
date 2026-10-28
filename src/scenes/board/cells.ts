// Where the table's grid cells sit on screen: the painted silkscreen of board/table-plate (1228 x
// 416, drawn at its own size by art.ts tablePlatePlace) measured line by line, so a cell's outline
// lies on the painted grid lines. Pure: no Phaser, so the geometry is unit-tested in node.
//
// The plate is painted in perspective: its column lines lean in toward the far edge and its rows
// get shallower away from the viewer. Each painted line is kept as measured (in plate pixels): a
// column line as its x on the grid's far and near borders, a row line as its y at two points across
// the plate. A lattice node is where a column line crosses a row line; a cell is the quad between
// four nodes. One column (between lines 21 and 22) is painted wider than the rest, and so is its cell.

import { GRID, type Node, parseCell } from '../../sim/grid';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** The plate's top-left in game pixels: tablePlatePlace for the 1228 x 416 cut, at scale 1. */
export const PLATE_AT: Pt = { x: 568.5, y: 224 };
/** The plate pixel rows the column lines are measured on: the grid's far and near borders. */
const FAR_Y = 20;
const NEAR_Y = 326;
/** The plate pixel columns the row lines are measured on. */
const ROW_XL = 300;
const ROW_XR = 900;

/** The 29 column lines, left to right: x at the grid's far border and at its near border (plate px). */
export const COLUMN_LINES: readonly { readonly far: number; readonly near: number }[] = [
  [196.0, 75.3],
  [225.0, 112.3],
  [254.0, 150.1],
  [283.0, 187.7],
  [312.0, 225.3],
  [341.1, 262.9],
  [370.4, 300.5],
  [399.4, 337.2],
  [428.4, 374.6],
  [457.2, 411.9],
  [486.1, 449.3],
  [515.1, 486.8],
  [544.5, 524.5],
  [573.7, 561.9],
  [602.7, 599.5],
  [631.8, 637.1],
  [661.2, 674.8],
  [690.4, 712.7],
  [719.6, 750.7],
  [748.5, 788.7],
  [777.7, 826.4],
  [806.3, 864.2],
  [846.2, 917.6],
  [874.9, 955.7],
  [903.6, 993.6],
  [932.3, 1031.3],
  [960.9, 1069.1],
  [989.2, 1107.1],
  [1017.6, 1145.0],
].map(([far, near]) => ({ far, near }));

/** The 20 row lines, far to near: y at plate x 300 and at plate x 900 (the outer two are the grid's border). */
export const ROW_LINES: readonly { readonly l: number; readonly r: number }[] = [
  [20.1, 20.1],
  [30.0, 29.9],
  [42.8, 42.3],
  [56.0, 55.7],
  [69.5, 69.0],
  [83.3, 83.0],
  [97.8, 97.0],
  [112.2, 111.7],
  [126.8, 125.9],
  [141.1, 140.1],
  [156.5, 155.2],
  [174.5, 173.0],
  [191.8, 190.1],
  [209.0, 207.2],
  [227.1, 225.2],
  [245.8, 243.9],
  [264.6, 263.0],
  [284.1, 282.2],
  [304.0, 302.4],
  [326.7, 325.9],
].map(([l, r]) => ({ l, r }));

/** Where column line i crosses row line j, in game pixels. */
function cross(i: number, j: number): Pt {
  const c = COLUMN_LINES[i];
  const r = ROW_LINES[j];
  // Column: x = a + b * y; row: y = p + q * x (plate px). Solve the pair.
  const b = (c.near - c.far) / (NEAR_Y - FAR_Y);
  const a = c.far - b * FAR_Y;
  const q = (r.r - r.l) / (ROW_XR - ROW_XL);
  const p = r.l - q * ROW_XL;
  const x = (a + b * p) / (1 - b * q);
  const y = p + q * x;
  return { x: PLATE_AT.x + x, y: PLATE_AT.y + y };
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

/** The x of column line i at screen height y. */
function columnX(i: number, y: number): number {
  const c = COLUMN_LINES[i];
  const py = y - PLATE_AT.y;
  return PLATE_AT.x + c.far + ((c.near - c.far) * (py - FAR_Y)) / (NEAR_Y - FAR_Y);
}

/** The y of row line j at screen x. */
function rowY(j: number, x: number): number {
  const r = ROW_LINES[j];
  const px = x - PLATE_AT.x;
  return PLATE_AT.y + r.l + ((r.r - r.l) * (px - ROW_XL)) / (ROW_XR - ROW_XL);
}

/**
 * Where a screen point is on the grid, in fractional cells (u across the columns, v down the rows),
 * or null off the grid. Plain loops over the lines; nothing allocates but the answer.
 */
export function gridAt(x: number, y: number): { u: number; v: number } | null {
  if (y < rowY(0, x) || y > rowY(GRID.rows, x)) return null;
  let v = -1;
  for (let j = 0; j < GRID.rows; j++) {
    const y0 = rowY(j, x);
    const y1 = rowY(j + 1, x);
    if (y >= y0 && y <= y1) {
      v = j + (y - y0) / (y1 - y0);
      break;
    }
  }
  if (v < 0) return null;
  if (x < columnX(0, y) || x > columnX(GRID.cols, y)) return null;
  for (let i = 0; i < GRID.cols; i++) {
    const x0 = columnX(i, y);
    const x1 = columnX(i + 1, y);
    if (x >= x0 && x <= x1) return { u: i + (x - x0) / (x1 - x0), v };
  }
  return null;
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
