// Where everything sits on the board, in 1920x1080 game space, and the hit tests the board's
// pointer handling uses. Pure: no Phaser, so the geometry is unit-tested in node.
//
// The board draws two zones of the Live screen: `feed` (a tilted table under the city's skyline)
// and `inventory` (the tray of parts). Both areas come from src/scenes/live/layout.ts, the only
// geometry source for the Live screen (docs/LIVE.md); everything else on screen is the HUD's.
//
// The table is seen from above and in front: its far edge is narrower than its near edge, and the
// rack's rows grow toward the viewer (0.88, 1.00, 1.06). Every coordinate here is already
// projected (screen pixels), so the hit tests and the hook read them exactly as they are drawn.

import type { Part, PartKind } from '../../sim/board';
import { ZONES, rectToArea } from '../live/layout';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned box given by its centre and size. */
export interface Box extends Point {
  readonly w: number;
  readonly h: number;
}

/** The feed zone as edges: {left 455, right 1910, top 110, bottom 640}. */
export const BOARD_AREA = rectToArea(ZONES.feed);
/** The inventory zone as edges: {left 455, right 1510, top 800, bottom 965}. */
export const TRAY_AREA = rectToArea(ZONES.inventory);

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

/** Centre of the gateway, where the block's traffic comes in. */
export const GATEWAY: Point = { x: 640, y: 412 };
/** Centre of the load balancer's slot, between the gateway and the servers. */
export const LB_SLOT: Point = { x: 870, y: 412 };
/** Centre of the residents' database, at the end of the line. */
export const DATABASE: Point = { x: 1760, y: 412 };

/** Id of the load balancer's slot. It is not one of the sim's server slots. */
export const LB_SLOT_ID = 'lb';

export interface RackRow {
  /** Where the row's servers stand (their centres). */
  readonly y: number;
  /** How big things draw on this row, against the mid row. */
  readonly scale: number;
  /** The two columns' centres on this row: they lean in toward the far edge. */
  readonly x: readonly [number, number];
}

/** The server rack: three rows (far, mid, near) of two columns. */
export const RACK_ROWS: readonly RackRow[] = [
  { y: 300, scale: 0.88, x: [1077, 1303] },
  { y: 412, scale: 1.0, x: [1070, 1310] },
  { y: 524, scale: 1.06, x: [1063, 1317] },
];

/** Each server slot's column and row in the rack. The first column fills first (s1-s3). */
export const SERVER_GRID: Readonly<Record<string, { col: number; row: number }>> = {
  s1: { col: 0, row: 0 },
  s2: { col: 0, row: 1 },
  s3: { col: 0, row: 2 },
  s4: { col: 1, row: 0 },
  s5: { col: 1, row: 1 },
  s6: { col: 1, row: 2 },
};

/** How far a server's centre sits above its pad's centre at the mid row (scaled by the row). */
export const SERVER_RISE = 30;

/** The draw scale of a server slot's row; 1 for anything outside the rack. */
export function slotScale(slot: string | null | undefined): number {
  const g = slot ? SERVER_GRID[slot] : undefined;
  return g ? RACK_ROWS[g.row].scale : 1;
}

/** Server slot pads, by the sim's slot id. A server stands on its pad, SERVER_RISE above it. */
export const SERVER_PADS: Readonly<Record<string, Point>> = Object.fromEntries(
  Object.entries(SERVER_GRID).map(([id, g]) => {
    const row = RACK_ROWS[g.row];
    return [id, { x: row.x[g.col], y: row.y + SERVER_RISE * row.scale }];
  }),
);

/** Drawn size of each kind on the board (its hit box), in game pixels; a server's at the mid row. */
export const PART_SIZE: Readonly<Record<PartKind, { w: number; h: number }>> = {
  gateway: { w: 110, h: 190 },
  balancer: { w: 140, h: 100 },
  server: { w: 80, h: 114 },
  database: { w: 150, h: 140 },
};

/** Size of a slot pad at the mid row (scaled by the row). */
export const PAD_SIZE = { w: 116, h: 69 } as const;
/** The load balancer slot's hit box. */
const LB_HIT = { w: 150, h: 150 } as const;
/** How far a server slot's hit box reaches above the server's centre, at the mid row. */
const SLOT_REACH = 40;

/** Centre of a part on the board, or null if it has nowhere to stand. */
export function partCentre(part: Pick<Part, 'kind' | 'slot'>): Point | null {
  switch (part.kind) {
    case 'gateway':
      return GATEWAY;
    case 'database':
      return DATABASE;
    case 'balancer':
      return LB_SLOT;
    case 'server': {
      const g = part.slot ? SERVER_GRID[part.slot] : undefined;
      if (!g) return null;
      const row = RACK_ROWS[g.row];
      return { x: row.x[g.col], y: row.y };
    }
  }
}

/** A part's drawn size: a server's shrinks toward the far row. */
export function partSize(part: Pick<Part, 'kind' | 'slot'>): { w: number; h: number } {
  const size = PART_SIZE[part.kind];
  if (part.kind !== 'server') return size;
  const s = slotScale(part.slot);
  return { w: size.w * s, h: size.h * s };
}

export function partBox(part: Pick<Part, 'kind' | 'slot'>): Box | null {
  const c = partCentre(part);
  return c ? { ...c, ...partSize(part) } : null;
}

/** A server slot's pad as drawn: centred on the pad, scaled by its row. */
export function padBox(slot: string): Box | null {
  const pad = SERVER_PADS[slot];
  if (!pad) return null;
  const s = slotScale(slot);
  return { x: pad.x, y: pad.y, w: PAD_SIZE.w * s, h: PAD_SIZE.h * s };
}

/**
 * The box that counts as dropping onto a slot. A server slot's runs from a little above the
 * server's centre down to the bottom of its pad, as wide as the pad, so the three rows' boxes
 * never overlap. The balancer's is a square on its slot.
 */
export function slotBox(slot: string): Box | null {
  if (slot === LB_SLOT_ID) return { ...LB_SLOT, ...LB_HIT };
  const g = SERVER_GRID[slot];
  const pad = padBox(slot);
  if (!g || !pad) return null;
  const top = RACK_ROWS[g.row].y - SLOT_REACH * slotScale(slot);
  const bottom = pad.y + pad.h / 2;
  return { x: pad.x, y: (top + bottom) / 2, w: pad.w, h: bottom - top };
}

export function inBox(b: Box, x: number, y: number): boolean {
  return Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2;
}

/** The part under a point, if any. Later parts win, like drawing order. */
export function partAt(parts: readonly Part[], x: number, y: number): Part | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const b = partBox(parts[i]);
    if (b && inBox(b, x, y)) return parts[i];
  }
  return null;
}

/** Every slot the board draws: the balancer's first, then the six server slots. */
export const SLOT_IDS: readonly string[] = [LB_SLOT_ID, ...Object.keys(SERVER_GRID)];

/** The slot (a server slot or 'lb') under a point, if any. */
export function slotAt(x: number, y: number): string | null {
  for (const id of SLOT_IDS) {
    const b = slotBox(id);
    if (b && inBox(b, x, y)) return id;
  }
  return null;
}

/**
 * Where a part or a slot sits on screen (projected game pixels), for the HUD's dip mark and its
 * leader lines: a part's centre by part id, or a slot's pad (the balancer slot's centre) by slot
 * id. Null when the id names neither, or the part has nowhere to stand.
 */
export function partAnchor(
  board: { readonly parts: readonly Pick<Part, 'id' | 'kind' | 'slot'>[] },
  id: string,
): Point | null {
  for (const p of board.parts) if (p.id === id) return partCentre(p);
  if (id === LB_SLOT_ID) return LB_SLOT;
  return SERVER_PADS[id] ?? null;
}

/** How far a server's ports sit above (in, on its left) and below (out, on its right) its centre. */
const SERVER_PORT = 18;

/** Where a wire leaves a part (its right edge) and enters one (its left edge). */
export function wireEnds(from: Pick<Part, 'kind' | 'slot'>, to: Pick<Part, 'kind' | 'slot'>) {
  const a = partCentre(from);
  const b = partCentre(to);
  if (!a || !b) return null;
  const ax = a.x + partSize(from).w / 2 - 6;
  const bx = b.x - partSize(to).w / 2 + 6;
  // A server takes wires in high on its left and sends them out low on its right, so a trace
  // leaving one column never lines up with a trace entering the next.
  const ay = a.y + (from.kind === 'server' ? SERVER_PORT * slotScale(from.slot) : 0);
  const by = b.y - (to.kind === 'server' ? SERVER_PORT * slotScale(to.slot) : 0);
  return { ax, ay, bx, by };
}

// Wires run like traces on a circuit board: straight lines and right angles only, and never across
// a server. Into the rack they come down a bus left of the first column; out of it they go along a
// bus right of the second. A wire into the second column runs over the rack along the far rim and
// comes down the gap between the columns; a wire out of the first column goes down the gap and
// along the near rim. Every corner of a trace lies on one of these named lines.
/** The vertical bus into the rack, left of its first column. */
export const BUS_IN = 989;
/** The vertical bus out of the rack, right of its second column. */
export const BUS_OUT = 1395;
/** Between the columns: where a wire comes down into the second column. */
export const GAP_IN = 1178;
/** Between the columns: where a wire leaves the first column for the near rim. */
export const GAP_OUT = 1202;
/** The rim channel along the table's far edge, over the rack. */
export const OVER = 236;
/** The rim channel along the table's near edge, under the rack. */
export const UNDER = 601;

/** The trace a wire follows from one part to the next, as corner points. */
export function wirePath(from: Pick<Part, 'kind' | 'slot'>, to: Pick<Part, 'kind' | 'slot'>): Point[] | null {
  const e = wireEnds(from, to);
  if (!e) return null;
  const a = { x: e.ax, y: e.ay };
  const b = { x: e.bx, y: e.by };
  const into = to.kind === 'server' && to.slot ? SERVER_GRID[to.slot] : undefined;
  const outOf = from.kind === 'server' && from.slot ? SERVER_GRID[from.slot] : undefined;
  if (into) {
    if (into.col === 0) return tidy([a, { x: BUS_IN, y: a.y }, { x: BUS_IN, y: b.y }, b]);
    return tidy([
      a,
      { x: BUS_IN, y: a.y },
      { x: BUS_IN, y: OVER },
      { x: GAP_IN, y: OVER },
      { x: GAP_IN, y: b.y },
      b,
    ]);
  }
  if (outOf) {
    if (outOf.col === 1) return tidy([a, { x: BUS_OUT, y: a.y }, { x: BUS_OUT, y: b.y }, b]);
    return tidy([
      a,
      { x: GAP_OUT, y: a.y },
      { x: GAP_OUT, y: UNDER },
      { x: BUS_OUT, y: UNDER },
      { x: BUS_OUT, y: b.y },
      b,
    ]);
  }
  const mid = (a.x + b.x) / 2;
  return tidy([a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]);
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
 * that narrows to the gateway's port on its left face (x 585). Geometry only; how full it is (the
 * demand level) is a later ticket's.
 */
export const CHANNEL = {
  mouth: { x: BOARD_AREA.left, top: 322, bottom: 502 },
  port: { x: GATEWAY.x - PART_SIZE.gateway.w / 2, top: 372, bottom: 452 },
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
 * The block's traffic arriving at the gateway: three lanes in from the left that run straight
 * through the channel's mouth and merge into the gateway's port, so the stream reads as a crowd,
 * not a single file. Each lane stays between the channel's walls.
 */
export const INBOUND_LANES: readonly (readonly Point[])[] = [-LANE_SPREAD, 0, LANE_SPREAD].map((dy) => {
  const end = { x: GATEWAY.x - PART_SIZE.gateway.w / 2 + 6, y: GATEWAY.y };
  return dy === 0
    ? [{ x: INBOUND_FROM, y: GATEWAY.y }, end]
    : [{ x: INBOUND_FROM, y: GATEWAY.y + dy }, { x: CHANNEL.mouth.x + 30, y: GATEWAY.y + dy }, end];
});

/** Where a part takes its wires in: its left edge, high on a server (the end wirePath draws to). */
export function inPort(part: Pick<Part, 'kind' | 'slot'>): Point | null {
  const c = partCentre(part);
  if (!c) return null;
  return {
    x: c.x - partSize(part).w / 2 + 6,
    y: c.y - (part.kind === 'server' ? SERVER_PORT * slotScale(part.slot) : 0),
  };
}

/** The far rim the retries run back along, just inside the table's far edge (above OVER's traces). */
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
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    x: r(rect.left + (p.x * rect.width) / game.width),
    y: r(rect.top + (p.y * rect.height) / game.height),
  };
}
