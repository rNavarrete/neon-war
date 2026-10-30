// Where everything sits on the board, in 1920x1080 game space, and the hit tests the board's
// pointer handling uses. Pure: no Phaser, so the geometry is unit-tested in node.
//
// The board draws two zones of the Live screen: `feed` (a tilted table under the city's skyline)
// and `inventory` (the tray of parts). Both areas come from src/scenes/live/layout.ts, the only
// geometry source for the Live screen (docs/LIVE.md); everything else on screen is the HUD's.
//
// The table is seen from above and in front: its far edge is narrower than its near edge. Parts
// stand on the cells of its painted grid (cells.ts places them on screen, src/sim/grid.ts says
// which cells a part covers). Every coordinate here is already projected (screen pixels), so the
// hit tests and the hook read them exactly as they are drawn.

import { type BoardRules, type Part, type PartKind, type Wire, connect } from '../../sim/board';
import {
  BOARD_CELLS,
  FIXED_ANCHOR,
  FOOTPRINT,
  GRID,
  anchorOf,
  cellId,
  fits,
  footprintCells,
  occupancy,
  parseCell,
  partCells,
  portNode,
} from '../../sim/grid';
import { FEED_WORLD, TRAY_WORLD, boardToScreen, rectToArea } from '../live/layout';
import { anchorAt, blockCentre, blockQuad, nodePoint } from './cells';
import { type Block, traceNodes } from './lattice';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned box given by its centre and size. */
export interface Box extends Point {
  readonly w: number;
  readonly h: number;
}

/**
 * The feed in the board's own space, as edges: {left 455, right 1910, top 110, bottom 640}. The
 * board draws here and its feed camera shows it in ZONES.feed (src/scenes/live/layout.ts FEED_VIEW).
 */
export const BOARD_AREA = rectToArea(FEED_WORLD);
/** The tray in the board's own space, as edges: {left 455, right 1510, top 800, bottom 965}. */
export const TRAY_AREA = rectToArea(TRAY_WORLD);

/** The table top: its far edge (y 222, x 575-1790) and its near edge (y 612, x 462-1903). */
export const TABLE = {
  far: { y: 222, left: 575, right: 1790 },
  near: { y: 612, left: 462, right: 1903 },
} as const;
/** How deep the table's lit front face is, below the near edge. */
export const TABLE_FACE = 18;

/**
 * A point on the table top in screen pixels: u runs 0 to 1 from the left side to the right side,
 * v from the far edge (0) to the near edge (1). The far edge is narrower, so lines of constant u
 * lean in away from the viewer.
 */
export function project(u: number, v: number): Point {
  const { far, near } = TABLE;
  const left = far.left + (near.left - far.left) * v;
  const right = far.right + (near.right - far.right) * v;
  return { x: left + (right - left) * u, y: far.y + (near.y - far.y) * v };
}

/**
 * Each kind's art shape on the board, in game pixels: every part, the gateway and the database
 * among them, is scaled to its footprint's width keeping this shape (never above its art's own size).
 */
export const PART_SIZE: Readonly<Record<PartKind, { w: number; h: number }>> = {
  gateway: { w: 110, h: 128 },
  balancer: { w: 140, h: 95 },
  server: { w: 80, h: 114 },
  database: { w: 150, h: 140 },
};

/** How much of its footprint's width a part's art fills, and how far its foot sits in from the near edge. */
const FILL = 0.92;
const FOOT_INSET = 0.25;

/**
 * Where a part of `kind` anchored at `anchor` stands: its art box over its footprint, as wide as
 * the footprint (FILL of it) and shaped like PART_SIZE, its foot a little in from the footprint's
 * near edge, so it stands on its cells and rises over the ones behind. Null for a non-cell anchor.
 */
export function standBox(kind: PartKind, anchor: string): Box | null {
  const a = parseCell(anchor);
  if (!a) return null;
  const { w, h } = FOOTPRINT[kind];
  const q = blockQuad(a.col, a.row, w, h);
  const width = ((q[1].x - q[0].x + q[2].x - q[3].x) / 2) * FILL;
  const size = PART_SIZE[kind];
  const height = (width * size.h) / size.w;
  const far = (q[0].y + q[1].y) / 2;
  const near = (q[2].y + q[3].y) / 2;
  const foot = near - (near - far) * FOOT_INSET;
  return { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: foot - height / 2, w: width, h: height };
}

/** Centre of the gateway, where the block's traffic comes in: standing on its cells near the grid's left side. */
export const GATEWAY: Point = boxCentre(standBox('gateway', FIXED_ANCHOR.gateway!)!);
/** Centre of the residents' database, at the end of the line: standing on its cells near the grid's right side. */
export const DATABASE: Point = boxCentre(standBox('database', FIXED_ANCHOR.database!)!);

function boxCentre(b: Box): Point {
  return { x: b.x, y: b.y };
}

/** Centre of a part on the board, or null if it has nowhere to stand. */
export function partCentre(part: Pick<Part, 'kind' | 'slot'>): Point | null {
  const b = partBox(part);
  return b ? { x: b.x, y: b.y } : null;
}

/** A part's drawn size: it follows its footprint (smaller toward the far edge). */
export function partSize(part: Pick<Part, 'kind' | 'slot'>): { w: number; h: number } {
  const b = partBox(part);
  return b ? { w: b.w, h: b.h } : PART_SIZE[part.kind];
}

export function partBox(part: Pick<Part, 'kind' | 'slot'>): Box | null {
  const a = anchorOf(part);
  return a === null ? null : standBox(part.kind, a);
}

/** How big a part draws against its PART_SIZE: text and marks scale with it. */
export function partScale(part: Pick<Part, 'kind' | 'slot'>): number {
  const b = partBox(part);
  return b ? b.w / PART_SIZE[part.kind].w : 1;
}

export function inBox(b: Box, x: number, y: number): boolean {
  return Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2;
}

/** The part under a point, if any. Nearer parts (lower on screen) win, like drawing order. */
export function partAt(parts: readonly Part[], x: number, y: number): Part | null {
  let best: Part | null = null;
  let bestY = -Infinity;
  for (let i = parts.length - 1; i >= 0; i--) {
    const b = partBox(parts[i]);
    if (b && inBox(b, x, y) && b.y > bestY) {
      best = parts[i];
      bestY = b.y;
    }
  }
  return best;
}

/** A footprint's outline on screen: far-left, far-right, near-right, near-left. Null for a non-cell anchor. */
export function footprintQuad(kind: PartKind, anchor: string): [Point, Point, Point, Point] | null {
  const a = parseCell(anchor);
  if (!a) return null;
  const { w, h } = FOOTPRINT[kind];
  return blockQuad(a.col, a.row, w, h);
}

/**
 * The anchor a card of `kind` dragged to (x, y) would take: its footprint centred under the
 * pointer and kept on the grid, or null off the grid.
 */
export function dropAnchor(kind: PartKind, x: number, y: number): string | null {
  const { w, h } = FOOTPRINT[kind];
  const a = anchorAt(x, y, w, h);
  return a ? cellId(a.col, a.row) : null;
}

const BOARD_CELL_SET = new Set(BOARD_CELLS);

/**
 * The cells a part of `kind` would cover at `anchor` and which of them are not free: off the
 * table's playable cells or under another part (one listed in `ignore` does not count).
 */
export function previewCells(
  kind: PartKind,
  anchor: string,
  parts: readonly Pick<Part, 'id' | 'kind' | 'slot'>[],
  ignore: readonly string[] = [],
): { cells: string[]; bad: string[] } {
  const cells = footprintCells(kind, anchor);
  const taken = occupancy(parts.filter((p) => !ignore.includes(p.id)));
  return { cells, bad: cells.filter((c) => taken.has(c) || !BOARD_CELL_SET.has(c)) };
}

// ---- legality (board-8) ------------------------------------------------------------------------

/**
 * What dropping a card at a spot would do, for the drag's tints: `legal` it takes (a server
 * footprint on free cells, the kit on a server without one), `dead` a dead server is there (a server
 * card replaces it), `poor` it would take but the credits are short, `taken` a part is in the way,
 * `wrong` the card does not go there (on or over a fixed part's cells, the crew's splitter, not a cell).
 */
export type PadState = 'legal' | 'taken' | 'dead' | 'poor' | 'wrong';

/** What padState reads: the parts, the credits, the dead servers and the card's prices. */
export interface PadBoard {
  readonly parts: readonly Part[];
  readonly credits: number;
  readonly dead: readonly string[];
}

/** The prices padState checks the credits against. */
export interface PadPrices {
  readonly server: number;
  readonly overclock: number;
}

/**
 * The legality of dropping `card` (a tray card id) with its footprint's anchor at `slot` (a cell
 * id), or onto the part standing on that cell. Pure.
 */
export function padState(slot: string, board: PadBoard, card: string, prices: PadPrices): PadState {
  if (!parseCell(slot)) return 'wrong';
  let on: Part | null = null;
  for (const p of board.parts) if (partCells(p).includes(slot)) on = p;
  const dead = on !== null && board.dead.includes(on.id);
  if (card === 'server') {
    if (on !== null && on.kind === 'server' && dead) return board.credits >= prices.server ? 'dead' : 'poor';
    if (on !== null) return on.kind === 'gateway' || on.kind === 'database' ? 'wrong' : 'taken';
    if (!fits(BOARD_CELLS, board.parts, 'server', slot).ok) {
      // Blocked only by parts: taken. Hanging off the table or over a fixed part's cells: wrong.
      const { cells, bad } = previewCells('server', slot, board.parts);
      const whole = cells.length === FOOTPRINT.server.w * FOOTPRINT.server.h;
      return whole && bad.every((c) => BOARD_CELL_SET.has(c)) ? 'taken' : 'wrong';
    }
    return board.credits >= prices.server ? 'legal' : 'poor';
  }
  if (card === 'overclock') {
    if (on === null || on.kind !== 'server') return 'wrong';
    if (dead) return 'dead';
    if (on.boost !== undefined) return 'taken';
    return board.credits >= prices.overclock ? 'legal' : 'poor';
  }
  // The crew rack their splitter themselves.
  if (card === 'balancer') return board.parts.some((p) => p.kind === 'balancer') ? 'taken' : 'wrong';
  return 'wrong';
}

/** Whether a drop in this state does something: legal, or a server card on a dead server (replace). */
export function dropLegal(card: string, state: PadState): boolean {
  return state === 'legal' || (card === 'server' && state === 'dead');
}

/** Whether a wire dragged from `from` to `to` would connect, and why not: connect()'s own answer. */
export function targetState(
  board: { readonly parts: readonly Part[]; readonly wires: readonly Wire[] },
  rules: BoardRules,
  from: string,
  to: string,
): { ok: boolean; reason: string | null } {
  const r = connect(
    { credits: 0, slots: [], nextId: 0, parts: board.parts, wires: board.wires },
    rules,
    from,
    to,
  );
  return r.ok ? { ok: true, reason: null } : { ok: false, reason: r.reason };
}

/**
 * Where a part or a cell sits on screen (game pixels, through the feed's view), for the HUD's dip
 * mark and its leader lines: a part's centre by part id, or a cell's centre by cell id. Null when
 * the id names neither, or the part has nowhere to stand.
 */
export function partAnchor(
  board: { readonly parts: readonly Pick<Part, 'id' | 'kind' | 'slot'>[] },
  id: string,
): Point | null {
  for (const p of board.parts) {
    if (p.id !== id) continue;
    const c = partCentre(p);
    return c ? boardToScreen(c) : null;
  }
  const c = parseCell(id);
  return c ? boardToScreen(blockCentre(c.col, c.row, 1, 1)) : null;
}

// Wires run like traces on a circuit board, along the painted grid's lines: straight runs and right
// angles only, never through a part's footprint (lattice.ts finds the way). A trace leaves a part's
// out-port node and enters the next one's in-port node (grid.ts portNode), the gateway's and the
// database's like any other part's.

/** Every part's footprint as a block the traces go round. */
function blocksOf(parts: readonly Pick<Part, 'kind' | 'slot'>[]): Block[] {
  const out: Block[] = [];
  for (const p of parts) {
    const a = anchorOf(p);
    const c = a ? parseCell(a) : null;
    if (c) out.push({ col: c.col, row: c.row, ...FOOTPRINT[p.kind] });
  }
  return out;
}

/**
 * The trace a wire follows from one part to the next, as corner points in game pixels: the
 * lattice route between their ports round every footprint in `parts` (an L when no route exists).
 * Null if either has no cells.
 */
export function wirePath(
  from: Pick<Part, 'kind' | 'slot'>,
  to: Pick<Part, 'kind' | 'slot'>,
  parts: readonly Pick<Part, 'kind' | 'slot'>[],
): Point[] | null {
  const a = portNode(from, 'out');
  const b = portNode(to, 'in');
  if (!a || !b) return null;
  const nodes = traceNodes(GRID.cols, GRID.rows, a, b, blocksOf(parts));
  return tidy(nodes.map(nodePoint));
}

/** Where a part sends its wires out (the trace's first point), or null. */
export function outPort(part: Pick<Part, 'kind' | 'slot'>): Point | null {
  const n = portNode(part, 'out');
  return n ? nodePoint(n) : null;
}

/** Drop repeated points and points in the middle of a straight run. */
function tidy(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Total length of a path. */
export function pathLength(path: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return n;
}

/** The point a fraction k (0 to 1) of the way along a path, written into `out` (no allocation). */
export function pointAlong(path: readonly Point[], length: number, k: number, out: { x: number; y: number }) {
  let left = Math.max(0, Math.min(1, k)) * length;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg || i === path.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, left / seg);
      out.x = a.x + (b.x - a.x) * t;
      out.y = a.y + (b.y - a.y) * t;
      return out;
    }
    left -= seg;
  }
  out.x = path[0].x;
  out.y = path[0].y;
  return out;
}

/** Distance from a point to the nearest segment of a path. */
export function distToPath(px: number, py: number, path: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    best = Math.min(best, distToSegment(px, py, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y));
  }
  return best;
}

/** Where the inbound stream starts: just off the feed's left edge, from under the HUD's left column. */
export const INBOUND_FROM = BOARD_AREA.left - 3;

/**
 * The channel the block's traffic arrives along: a mouth on the feed's left edge (x 455, y 322-502)
 * that narrows to its port on the table's left rim (x 585), level with the gateway's in-port; the
 * stream runs on from there across the rim into the gateway standing on the grid. Geometry only; how
 * full it is (the demand level) is a later ticket's.
 */
export const CHANNEL = {
  mouth: { x: BOARD_AREA.left, top: 322, bottom: 502 },
  port: { x: 585, top: 372, bottom: 452 },
} as const;

/** The channel's walls at x, between the mouth and the port. */
export function channelAt(x: number): { top: number; bottom: number } {
  const { mouth, port } = CHANNEL;
  const k = Math.max(0, Math.min(1, (x - mouth.x) / (port.x - mouth.x)));
  return {
    top: mouth.top + (port.top - mouth.top) * k,
    bottom: mouth.bottom + (port.bottom - mouth.bottom) * k,
  };
}

/** How far from the gateway's centre line the two outer inbound lanes run. */
const LANE_SPREAD = 54;

/**
 * Where a part takes its wires in (the end wirePath draws to): its in-port node on the grid. The
 * gateway's is the middle of its footprint's left edge, where the block's traffic comes in.
 */
export function inPort(part: Pick<Part, 'kind' | 'slot'>): Point | null {
  const n = portNode(part, 'in');
  return n ? nodePoint(n) : null;
}

/** The gateway's in-port on the grid: where the inbound stream ends. */
const GATEWAY_IN: Point = inPort({ kind: 'gateway', slot: null })!;

/**
 * The block's traffic arriving at the gateway: three lanes in from the left that run straight
 * through the channel's mouth, merge at its port and run on along the gateway's port row into its
 * in-port, so the stream reads as a crowd, not a single file, left to right. Each lane stays
 * between the channel's walls.
 */
export const INBOUND_LANES: readonly (readonly Point[])[] = [-LANE_SPREAD, 0, LANE_SPREAD].map((dy) => {
  const end = GATEWAY_IN;
  return dy === 0
    ? [{ x: INBOUND_FROM, y: end.y }, end]
    : [
        { x: INBOUND_FROM, y: end.y + dy },
        { x: CHANNEL.mouth.x + 30, y: end.y + dy },
        { x: CHANNEL.port.x, y: end.y },
        end,
      ];
});

/** The far rim the retries run back along, just inside the table's far edge (above the grid). */
export const RETURN_RIM = TABLE.far.y + 4;
/** How far left of a port a returning retry steps before it turns. */
const RETURN_STEP = 14;

/**
 * The way a retry goes back (board-7): from the in-port of the part that dropped it, a step left,
 * up to the far rim, along it to just left of the gateway, down into the channel and out along its
 * upper wall to the mouth, where it comes in again. From the gateway itself it runs straight back
 * along the channel. Every point stays inside the feed.
 */
export function returnPath(part: Pick<Part, 'kind' | 'slot'>): Point[] | null {
  const from = inPort(part);
  if (!from) return null;
  const { mouth, port } = CHANNEL;
  const end = { x: mouth.x + 2, y: mouth.top + 14 };
  const x = port.x - RETURN_STEP;
  const down = { x, y: channelAt(x).top + 12 };
  if (part.kind === 'gateway') return [{ x: from.x, y: port.top + 12 }, down, end];
  const out = from.x - RETURN_STEP;
  return tidy([from, { x: out, y: from.y }, { x: out, y: RETURN_RIM }, { x, y: RETURN_RIM }, down, end]);
}

export function midpoint(e: { ax: number; ay: number; bx: number; by: number }): Point {
  return { x: (e.ax + e.bx) / 2, y: (e.ay + e.by) / 2 };
}

/** Distance from a point to the segment a-b. */
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + k * dx - px;
  const cy = ay + k * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

/** How close (game pixels) a click must land to a wire to pick it. */
export const WIRE_PICK = 14;

/** Map a game-space point to page CSS pixels, given the canvas's bounding rect. */
export function toPage(
  p: Point,
  rect: { left: number; top: number; width: number; height: number },
  game: { width: number; height: number },
): Point {
  // `+ 0` turns a rounded -0 (a point a hair left of the screen edge) into 0.
  const r = (n: number) => Math.round(n * 10) / 10 + 0;
  // The board's own space shows through its views (src/scenes/live/layout.ts): screen first.
  const q = boardToScreen(p);
  return {
    x: r(rect.left + (q.x * rect.width) / game.width),
    y: r(rect.top + (q.y * rect.height) / game.height),
  };
}
