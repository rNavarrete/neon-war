// Where everything sits on the 1280x720 board, in game coordinates. Kept apart from the
// scene so the test hook can report the same positions the scene draws at.
import type { Placeable } from '../sim/mission';

export type Point = readonly [number, number];

export const NODE_POS: Readonly<Record<string, Point>> = {
  gateway: [380, 330],
  balancer: [510, 330],
  'server-1': [660, 250],
  'server-2': [660, 410],
  database: [1010, 330],
};

export const SLOT_POS: Readonly<Record<string, Point>> = {
  'slot-1': [835, 190],
  'slot-2': [835, 330],
  'slot-3': [835, 470],
};

export const TRAY_POS: Readonly<Record<Placeable, Point>> = {
  cache: [520, 662],
  server: [680, 662],
};

export const LOCKED_TRAY = ['Queue', 'Replica', 'Monitor'] as const;
export const LOCKED_X0 = 840;

export const RETRY_POS: Point = [640, 470];

/** How close (game px) a dropped card must land to a slot to count. */
export const SLOT_SNAP = 70;

/** Orthogonal route between two points, like the data lines in the mockup. */
export function route(a: Point, b: Point): Point[] {
  const mx = Math.round((a[0] + b[0]) / 2);
  return [a, [mx, a[1]], [mx, b[1]], b];
}

export function routeLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.abs(points[i][0] - points[i - 1][0]) + Math.abs(points[i][1] - points[i - 1][1]);
  }
  return total;
}

/** The point at distance d along an orthogonal route. */
export function pointAt(points: readonly Point[], d: number): Point {
  let left = d;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const seg = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (left <= seg) {
      const t = seg === 0 ? 0 : left / seg;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    left -= seg;
  }
  return points[points.length - 1];
}

/** The middle of a route, where its cut handle sits. */
export function midpoint(points: readonly Point[]): Point {
  return pointAt(points, routeLength(points) / 2);
}
