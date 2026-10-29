// The table's grid: every square of the painted silkscreen is a cell a part can stand on. Pure
// logic over cell ids ('c<col>-<row>'); where a cell sits on screen is the board scene's business
// (src/scenes/board/cells.ts). A placed part's slot is its anchor cell, the top-left (far-left) cell
// of its footprint; the board's slots list is every free cell.
//
// The gateway and the residents' database stand on the table's left and right rims, each with a
// bay of cells in front of it that nothing else can take. The table is split into four racks (bands
// of columns), each on its own power feed: the midnight power dip takes one rack dark.

import type { Part, PartKind } from './board';
import { BROWNOUT } from './brownout';

const B = BROWNOUT.board;

/** The painted grid: 28 columns by 19 rows of squares. */
export const GRID = { cols: B.cols, rows: B.rows } as const;

/** Cells a kind covers on the table: a server 2 x 2, the splitter 2 x 1, each fixed part's bay 2 x 4. */
export const FOOTPRINT: Readonly<Record<PartKind, { readonly w: number; readonly h: number }>> = B.footprint;

export interface Cell {
  readonly col: number;
  readonly row: number;
}

export const cellId = (col: number, row: number): string => `c${col}-${row}`;

const CELL_ID = /^c(\d+)-(\d+)$/;

/** The column and row a cell id names, or null for anything else (an old slot name, say). */
export function parseCell(id: string): Cell | null {
  const m = CELL_ID.exec(id);
  if (!m) return null;
  const [, col, row] = m;
  return { col: Number(col), row: Number(row) };
}

export function inGrid(col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < GRID.cols && row < GRID.rows;
}

/** Where the fixed parts' bays start: the gateway's at the left edge, the database's at the right. */
export const FIXED_ANCHOR: Readonly<Partial<Record<PartKind, string>>> = {
  gateway: cellId(0, B.bayRow),
  database: cellId(GRID.cols - FOOTPRINT.database.w, B.bayRow),
};

/**
 * The cells a part of `kind` anchored at `anchor` covers, in reading order. Cells past the grid's
 * edge are left out. An anchor that is not a cell id (an old fixed slot such as 's1') stands for
 * itself: the footprint is that one slot.
 */
export function footprintCells(kind: PartKind, anchor: string): string[] {
  const a = parseCell(anchor);
  if (!a) return [anchor];
  const { w, h } = FOOTPRINT[kind];
  const out: string[] = [];
  for (let r = a.row; r < a.row + h; r++)
    for (let c = a.col; c < a.col + w; c++) if (inGrid(c, r)) out.push(cellId(c, r));
  return out;
}

/** A part's anchor: its slot, or its fixed bay for the gateway and the database; null otherwise. */
export function anchorOf(part: Pick<Part, 'kind' | 'slot'>): string | null {
  return part.slot ?? FIXED_ANCHOR[part.kind] ?? null;
}

/** The cells a part stands on (none for a part with nowhere to stand). */
export function partCells(part: Pick<Part, 'kind' | 'slot'>): string[] {
  const a = anchorOf(part);
  return a === null ? [] : footprintCells(part.kind, a);
}

/** Every cell of the grid, row by row. */
export const ALL_CELLS: readonly string[] = (() => {
  const out: string[] = [];
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) out.push(cellId(c, r));
  return out;
})();

/** The fixed parts' bays, by kind: cells nothing else can take. */
export const RESERVED: Readonly<Partial<Record<PartKind, readonly string[]>>> = {
  gateway: footprintCells('gateway', FIXED_ANCHOR.gateway!),
  database: footprintCells('database', FIXED_ANCHOR.database!),
};

const RESERVED_SET = new Set([...RESERVED.gateway!, ...RESERVED.database!]);

/** The board's slots on Session 0: every cell outside the fixed parts' bays. */
export const BOARD_CELLS: readonly string[] = ALL_CELLS.filter((c) => !RESERVED_SET.has(c));

export interface Rack {
  /** 'A' to 'D', left to right. */
  readonly id: string;
  /** The columns it spans, first and last. */
  readonly from: number;
  readonly to: number;
}

/** Four racks across the table, seven columns each, each on its own power feed. */
export const RACKS: readonly Rack[] = B.racks.map((id, i) => ({
  id,
  from: i * B.rackColumns,
  to: (i + 1) * B.rackColumns - 1,
}));

/**
 * The rack a slot belongs to: the rack its anchor cell's column lies in. A slot that is not a cell
 * (an old fixed slot) is a rack of its own, so a board without the grid loses one part per dip.
 * Null for no slot.
 */
export function rackOf(slot: string | null): string | null {
  if (slot === null) return null;
  const c = parseCell(slot);
  if (!c) return slot;
  for (const r of RACKS) if (c.col >= r.from && c.col <= r.to) return r.id;
  return null;
}

/** Every cell some part stands on, with the part standing there. */
export function occupancy(parts: readonly Pick<Part, 'id' | 'kind' | 'slot'>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of parts) for (const c of partCells(p)) out.set(c, p.id);
  return out;
}

export type Fit = { ok: true } | { ok: false; reason: string };

/**
 * Whether a part of `kind` fits with its anchor at `anchor` on a board with these slots and parts.
 * Every cell of its footprint must be on the table, outside the fixed parts' bays, and free (a part
 * listed in `ignore` does not count, for a replacement). The reasons print on screen.
 */
export function fits(
  slots: readonly string[],
  parts: readonly Pick<Part, 'id' | 'kind' | 'slot'>[],
  kind: PartKind,
  anchor: string,
  ignore: readonly string[] = [],
): Fit {
  const a = parseCell(anchor);
  if (!a) {
    if (!slots.includes(anchor)) return { ok: false, reason: `no slot ${anchor}` };
    if (parts.some((p) => p.slot === anchor && !ignore.includes(p.id)))
      return { ok: false, reason: 'that slot is taken' };
    return { ok: true };
  }
  const { w, h } = FOOTPRINT[kind];
  if (!inGrid(a.col, a.row) || !inGrid(a.col + w - 1, a.row + h - 1))
    return { ok: false, reason: 'it would hang off the table' };
  const cells = footprintCells(kind, anchor);
  for (const fixed of ['gateway', 'database'] as const) {
    if (cells.some((c) => RESERVED[fixed]!.includes(c)) && parts.some((p) => p.kind === fixed))
      return { ok: false, reason: `the ${fixed} needs that space` };
  }
  if (cells.some((c) => !slots.includes(c))) return { ok: false, reason: 'no room there' };
  const taken = occupancy(parts.filter((p) => !ignore.includes(p.id)));
  if (taken.has(anchor)) return { ok: false, reason: 'that spot is taken' };
  if (cells.some((c) => taken.has(c))) return { ok: false, reason: 'it would overlap a part already there' };
  return { ok: true };
}

/**
 * The free anchor for `kind` nearest `prefer` (by grid distance, ties to the earlier cell in
 * reading order), or null when nothing fits or the board has no grid.
 */
export function findSpot(
  slots: readonly string[],
  parts: readonly Pick<Part, 'id' | 'kind' | 'slot'>[],
  kind: PartKind,
  prefer: string,
): string | null {
  const p = parseCell(prefer);
  if (!p) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const id of ALL_CELLS) {
    const c = parseCell(id)!;
    const d = Math.abs(c.col - p.col) + Math.abs(c.row - p.row);
    if (d >= bestD) continue;
    if (fits(slots, parts, kind, id).ok) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

/** Where the crew like to rack their splitter: on the gateway's port row, just past the first server spot (clear of every server's art). */
export const BALANCER_SPOT = cellId(B.balancerSpot.col, B.balancerSpot.row);

/**
 * Good server spots, in the order the autopilot fills them and the board suggests them: one in
 * each rack along the gateway's port row first (the first sits right at the gateway's port), then
 * a second row above and a third below. They never overlap each other, the bays or BALANCER_SPOT.
 */
export const SERVER_SPOTS: readonly string[] = B.serverSpots.rows.flatMap((row) =>
  B.serverSpots.cols.map((col) => cellId(col, row)),
);

/** A lattice node: where grid line `i` (columns, 0..cols) crosses grid line `j` (rows, 0..rows). */
export interface Node {
  readonly i: number;
  readonly j: number;
}

/**
 * Where a part takes wires in and sends them out, on the grid's lines: a server's in-port is the
 * middle of its footprint's left edge and its out-port the middle of its right edge; the splitter's
 * are its left and right ends on its far edge; the gateway sends out from the right edge of its bay
 * and the database takes in on the left edge of its bay. Null for a part with no cells.
 */
export function portNode(part: Pick<Part, 'kind' | 'slot'>, side: 'in' | 'out'): Node | null {
  const a = anchorOf(part);
  const c = a ? parseCell(a) : null;
  if (!c) return null;
  const { w, h } = FOOTPRINT[part.kind];
  const j = c.row + (h >> 1);
  return { i: side === 'in' ? c.col : c.col + w, j };
}

/**
 * How many more parts of `kind` the free cells could still take, packed greedily in reading order
 * (a lower bound on what fits; the inventory caps its count with it).
 */
export function roomFor(
  slots: readonly string[],
  parts: readonly Pick<Part, 'kind' | 'slot'>[],
  kind: PartKind,
): number {
  const free = new Set(slots);
  for (const p of parts) for (const c of partCells(p)) free.delete(c);
  let n = 0;
  for (const id of ALL_CELLS) {
    const cells = footprintCells(kind, id);
    const a = parseCell(id)!;
    const { w, h } = FOOTPRINT[kind];
    if (!inGrid(a.col + w - 1, a.row + h - 1) || !cells.every((c) => free.has(c))) continue;
    for (const c of cells) free.delete(c);
    n++;
  }
  return n;
}
