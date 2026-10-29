// Wires run along the table's grid lines like traces on a circuit board: from one part's port to
// the next, straight runs and right-angle turns only, never through another part's footprint. Pure:
// a shortest path on the lattice of grid-line crossings, with a small cost for every turn so a trace
// bends as little as it can. Positions are lattice nodes (see grid.ts Node); turning them into
// screen points is the board scene's job.

import type { Node } from '../../sim/grid';

/** A footprint on the grid: `w` x `h` cells from column `col`, row `row`. */
export interface Block {
  readonly col: number;
  readonly row: number;
  readonly w: number;
  readonly h: number;
}

/** What a step costs, and what a turn adds on top: a trace prefers one bend over a zigzag. */
export const STEP_COST = 1;
export const TURN_COST = 3;

// Directions: 0 right (+i), 1 down (+j), 2 left, 3 up.
const DI = [1, 0, -1, 0];
const DJ = [0, 1, 0, -1];

/**
 * Whether the lattice edge from (i, j) one step in `dir` runs through the inside of a block. Edges
 * along a block's outline are free: a trace may skirt a part, never cross it.
 */
export function edgeBlocked(i: number, j: number, dir: number, blocks: readonly Block[]): boolean {
  const horizontal = dir === 0 || dir === 2;
  // The edge's lower-left end, so both directions test the same segment.
  const i0 = dir === 2 ? i - 1 : i;
  const j0 = dir === 3 ? j - 1 : j;
  for (const b of blocks) {
    if (horizontal) {
      // Along row line j0, between column lines i0 and i0 + 1.
      if (j0 > b.row && j0 < b.row + b.h && i0 >= b.col && i0 < b.col + b.w) return true;
    } else if (i0 > b.col && i0 < b.col + b.w && j0 >= b.row && j0 < b.row + b.h) {
      // Along column line i0, between row lines j0 and j0 + 1.
      return true;
    }
  }
  return false;
}

/**
 * The cheapest trace from `from` to `to` on a lattice of (cols + 1) x (rows + 1) nodes, avoiding the
 * insides of `blocks`: the corner nodes in order (start, each turn, end). Null when no trace
 * exists. Deterministic: ties go to the direction tried first (right, down, left, up).
 */
export function routeLattice(
  cols: number,
  rows: number,
  from: Node,
  to: Node,
  blocks: readonly Block[],
): Node[] | null {
  const W = cols + 1;
  const H = rows + 1;
  const inside = (n: Node) => n.i >= 0 && n.j >= 0 && n.i < W && n.j < H;
  if (!inside(from) || !inside(to)) return null;
  if (from.i === to.i && from.j === to.j) return [from];
  const states = W * H * 4;
  const cost = new Float64Array(states).fill(Infinity);
  const prev = new Int32Array(states).fill(-1);
  const heap = new MinHeap();
  for (let d = 0; d < 4; d++) {
    const s = (from.j * W + from.i) * 4 + d;
    cost[s] = 0;
    heap.push(0, s);
  }
  let end = -1;
  while (heap.size > 0) {
    const [c, s] = heap.pop();
    if (c > cost[s]) continue;
    const node = s >> 2;
    const dir = s & 3;
    const i = node % W;
    const j = (node - i) / W;
    if (i === to.i && j === to.j) {
      end = s;
      break;
    }
    for (let d = 0; d < 4; d++) {
      if (d === (dir + 2) % 4) continue;
      const ni = i + DI[d];
      const nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      if (edgeBlocked(i, j, d, blocks)) continue;
      const step = c + STEP_COST + (d === dir || (i === from.i && j === from.j) ? 0 : TURN_COST);
      const t = (nj * W + ni) * 4 + d;
      if (step < cost[t]) {
        cost[t] = step;
        prev[t] = s;
        heap.push(step, t);
      }
    }
  }
  if (end < 0) return null;
  const nodes: Node[] = [];
  for (let s = end; s >= 0; s = prev[s]) {
    const node = s >> 2;
    const i = node % W;
    const n = { i, j: (node - i) / W };
    const last = nodes[nodes.length - 1];
    if (!last || last.i !== n.i || last.j !== n.j) nodes.push(n);
  }
  return corners(nodes.reverse());
}

/** The fallback when no trace exists: across along the start's row line, then along the end's column line. */
export function lPath(from: Node, to: Node): Node[] {
  return corners([from, { i: to.i, j: from.j }, to]);
}

/** A trace from `from` to `to`, or the L-shaped fallback when the blocks leave no way through. */
export function traceNodes(
  cols: number,
  rows: number,
  from: Node,
  to: Node,
  blocks: readonly Block[],
): Node[] {
  return routeLattice(cols, rows, from, to, blocks) ?? lPath(from, to);
}

/** Keep only the ends and the turns of a path of nodes (drop repeats and points mid-run). */
export function corners(path: readonly Node[]): Node[] {
  const out: Node[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last && last.i === p.i && last.j === p.j) continue;
    const before = out[out.length - 2];
    if (
      last &&
      before &&
      ((before.i === last.i && last.i === p.i) || (before.j === last.j && last.j === p.j))
    ) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Whether every step of a path is straight along one grid line (no diagonal). */
export function orthogonal(path: readonly Node[]): boolean {
  for (let k = 1; k < path.length; k++)
    if (path[k].i !== path[k - 1].i && path[k].j !== path[k - 1].j) return false;
  return true;
}

/** A binary heap of (cost, state) pairs, cheapest first. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let n = k.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (k[p] <= key) break;
      k[n] = k[p];
      v[n] = v[p];
      n = p;
    }
    k[n] = key;
    v[n] = val;
  }

  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0], v[0]];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (k.length > 0) {
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        if (l >= k.length) break;
        const r = l + 1;
        const c = r < k.length && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[n] = k[c];
        v[n] = v[c];
        n = c;
      }
      k[n] = lastK;
      v[n] = lastV;
    }
    return top;
  }
}
