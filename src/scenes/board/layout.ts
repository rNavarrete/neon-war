// Where everything sits on the board, in 1920x1080 game space, and the hit tests the board's
// pointer handling uses. Pure: no Phaser, so the geometry is unit-tested in node.
//
// The board keeps its parts and slots inside x 380-1540, y 140-880; the tray sits in the bottom
// centre (x 560-1360, y > 880). Everything else on screen belongs to the HUD.

import type { Part, PartKind } from '../../sim/board';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned box given by its centre and size. */
export interface Box extends Point {
  readonly w: number;
  readonly h: number;
}

export const BOARD_AREA = { left: 380, right: 1540, top: 140, bottom: 880 } as const;
export const TRAY_AREA = { left: 560, right: 1360, top: 890, bottom: 1072 } as const;

/** Centre of the gateway, where the block's traffic comes in. */
export const GATEWAY: Point = { x: 600, y: 510 };
/** Centre of the load balancer's slot, between the gateway and the servers. */
export const LB_SLOT: Point = { x: 790, y: 510 };
/** Centre of the residents' database, at the end of the line. */
export const DATABASE: Point = { x: 1445, y: 510 };

/** Id of the load balancer's slot. It is not one of the sim's server slots. */
export const LB_SLOT_ID = 'lb';

/** The server rack: two columns of three pads between the balancer and the database. */
const RACK_COLUMNS = [1020, 1230] as const;
const RACK_ROWS = [330, 530, 730] as const;

/** Each server slot's column and row in the rack. The first column fills first (s1-s3). */
export const SERVER_GRID: Readonly<Record<string, { col: number; row: number }>> = {
  s1: { col: 0, row: 0 },
  s2: { col: 0, row: 1 },
  s3: { col: 0, row: 2 },
  s4: { col: 1, row: 0 },
  s5: { col: 1, row: 1 },
  s6: { col: 1, row: 2 },
};

/** Server slot pads, by the sim's slot id. A server stands on its pad. */
export const SERVER_PADS: Readonly<Record<string, Point>> = Object.fromEntries(
  Object.entries(SERVER_GRID).map(([id, g]) => [id, { x: RACK_COLUMNS[g.col], y: RACK_ROWS[g.row] }]),
);

/** How far a server's centre sits above its pad's centre. */
export const SERVER_RISE = 50;

/** Drawn size of each kind on the board (its hit box), in game pixels. */
export const PART_SIZE: Readonly<Record<PartKind, { w: number; h: number }>> = {
  gateway: { w: 110, h: 190 },
  balancer: { w: 140, h: 100 },
  server: { w: 104, h: 150 },
  database: { w: 150, h: 140 },
};

/** Size of a slot pad and the box that counts as dropping onto a slot. */
export const PAD_SIZE = { w: 132, h: 78 } as const;
const SLOT_HIT = { w: 150, h: 190 } as const;

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
      const pad = part.slot ? SERVER_PADS[part.slot] : undefined;
      return pad ? { x: pad.x, y: pad.y - SERVER_RISE } : null;
    }
  }
}

export function partBox(part: Pick<Part, 'kind' | 'slot'>): Box | null {
  const c = partCentre(part);
  return c ? { ...c, ...PART_SIZE[part.kind] } : null;
}

/** The point the slot's hit box is centred on (a server slot's box covers the pad and the server on it). */
export function slotBox(slot: string): Box | null {
  if (slot === LB_SLOT_ID) return { ...LB_SLOT, w: SLOT_HIT.w, h: 150 };
  const pad = SERVER_PADS[slot];
  return pad ? { x: pad.x, y: pad.y - 35, ...SLOT_HIT } : null;
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

/** The slot (a server slot or 'lb') under a point, if any. */
export function slotAt(x: number, y: number): string | null {
  for (const id of [LB_SLOT_ID, ...Object.keys(SERVER_PADS)]) {
    const b = slotBox(id);
    if (b && inBox(b, x, y)) return id;
  }
  return null;
}

/** Where a wire leaves a part (its right edge) and enters one (its left edge). */
export function wireEnds(from: Pick<Part, 'kind' | 'slot'>, to: Pick<Part, 'kind' | 'slot'>) {
  const a = partCentre(from);
  const b = partCentre(to);
  if (!a || !b) return null;
  const ax = a.x + PART_SIZE[from.kind].w / 2 - 6;
  const bx = b.x - PART_SIZE[to.kind].w / 2 + 6;
  // A server takes wires in high on its left and sends them out low on its right, so a trace
  // leaving one column never lines up with a trace entering the next.
  const ay = a.y + (from.kind === 'server' ? SERVER_PORT : 0);
  const by = b.y - (to.kind === 'server' ? SERVER_PORT : 0);
  return { ax, ay, bx, by };
}

const SERVER_PORT = 18;

// Wires run like traces on a circuit board: straight lines and right angles only, and never across
// a server. Into the rack they drop down a bus left of the first column; out of it they climb a bus
// right of the second. A wire to or from the far column runs along the gap under (or over) a row.
const SERVER_HALF = PART_SIZE.server.w / 2;
/** The vertical bus into the rack, left of its first column. */
export const BUS_IN = RACK_COLUMNS[0] - SERVER_HALF - 30;
/** The vertical bus out of the rack, right of its second column. */
export const BUS_OUT = RACK_COLUMNS[1] + SERVER_HALF + 34;
/** Between the columns: where a wire turns into or out of the second column. */
const COLUMN_GAP = (RACK_COLUMNS[0] + RACK_COLUMNS[1]) / 2;
/** Gap channels: under a pad for wires leaving column one, over a server for wires entering column two. */
const channelUnder = (pad: Point) => pad.y + 52;
const channelOver = (pad: Point) => pad.y - SERVER_RISE - PART_SIZE.server.h / 2 - 14;

/** The trace a wire follows from one part to the next, as corner points. */
export function wirePath(from: Pick<Part, 'kind' | 'slot'>, to: Pick<Part, 'kind' | 'slot'>): Point[] | null {
  const e = wireEnds(from, to);
  if (!e) return null;
  const a = { x: e.ax, y: e.ay };
  const b = { x: e.bx, y: e.by };
  const into = to.kind === 'server' && to.slot ? SERVER_GRID[to.slot] : undefined;
  const outOf = from.kind === 'server' && from.slot ? SERVER_GRID[from.slot] : undefined;
  if (into) {
    const pad = SERVER_PADS[to.slot!];
    if (into.col === 0) return tidy([a, { x: BUS_IN, y: a.y }, { x: BUS_IN, y: b.y }, b]);
    const over = channelOver(pad);
    return tidy([
      a,
      { x: BUS_IN, y: a.y },
      { x: BUS_IN, y: over },
      { x: COLUMN_GAP, y: over },
      { x: COLUMN_GAP, y: b.y },
      b,
    ]);
  }
  if (outOf) {
    const pad = SERVER_PADS[from.slot!];
    if (outOf.col === 1) return tidy([a, { x: BUS_OUT, y: a.y }, { x: BUS_OUT, y: b.y }, b]);
    const under = channelUnder(pad);
    return tidy([
      a,
      { x: COLUMN_GAP, y: a.y },
      { x: COLUMN_GAP, y: under },
      { x: BUS_OUT, y: under },
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

/** Where the inbound stream starts: off the board's left rim, from under the HUD's chat panels. */
const INBOUND_FROM = BOARD_AREA.left - 40;

/**
 * The block's traffic arriving at the gateway: three lanes from the board's left rim that merge
 * into the gateway, so the incoming stream reads as a crowd, not a single file.
 */
export const INBOUND_LANES: readonly (readonly Point[])[] = [-26, 0, 26].map((dy) => {
  const end = { x: GATEWAY.x - PART_SIZE.gateway.w / 2 + 6, y: GATEWAY.y };
  return dy === 0
    ? [{ x: INBOUND_FROM, y: GATEWAY.y }, end]
    : [{ x: INBOUND_FROM, y: GATEWAY.y + dy }, { x: end.x - 46, y: GATEWAY.y + dy }, end];
});

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
