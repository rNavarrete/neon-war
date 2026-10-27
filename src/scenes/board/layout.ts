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
export const GATEWAY: Point = { x: 480, y: 500 };
/** Centre of the load balancer's slot, between the gateway and the servers. */
export const LB_SLOT: Point = { x: 690, y: 500 };
/** Centre of the residents' database, at the end of the line. */
export const DATABASE: Point = { x: 1430, y: 500 };

/** Id of the load balancer's slot. It is not one of the sim's server slots. */
export const LB_SLOT_ID = 'lb';

/** Server slot pads, by the sim's slot id: two rows of three. A server stands on its pad. */
export const SERVER_PADS: Readonly<Record<string, Point>> = {
  s1: { x: 890, y: 420 },
  s2: { x: 1070, y: 420 },
  s3: { x: 1250, y: 420 },
  s4: { x: 890, y: 720 },
  s5: { x: 1070, y: 720 },
  s6: { x: 1250, y: 720 },
};

/** How far a server's centre sits above its pad's centre. */
export const SERVER_RISE = 60;

/** Drawn size of each kind on the board (its hit box), in game pixels. */
export const PART_SIZE: Readonly<Record<PartKind, { w: number; h: number }>> = {
  gateway: { w: 132, h: 230 },
  balancer: { w: 150, h: 106 },
  server: { w: 118, h: 170 },
  database: { w: 160, h: 150 },
};

/** Size of a slot pad and the box that counts as dropping onto a slot. */
export const PAD_SIZE = { w: 150, h: 90 } as const;
const SLOT_HIT = { w: 160, h: 220 } as const;

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
  if (slot === LB_SLOT_ID) return { ...LB_SLOT, w: SLOT_HIT.w, h: 160 };
  const pad = SERVER_PADS[slot];
  return pad ? { x: pad.x, y: pad.y - 40, ...SLOT_HIT } : null;
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
  return { ax, ay: a.y, bx, by: b.y };
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
