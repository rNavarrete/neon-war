// The table's grid (src/sim/grid.ts): every painted square is a cell a part can stand on. A server
// covers 2 x 2 cells, the splitter 2 x 1; the gateway (2 x 2) and the database (3 x 2) stand on fixed cells;
// the midnight dip takes one rack (a band of columns) dark.

import { type Board, type Part, place } from '../src/sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../src/sim/brownout';
import { placeServer } from '../src/sim/economy';
import { DIP_SCRIPT, resolveDip, serverRacks } from '../src/sim/failures';
import {
  BALANCER_SPOT,
  BOARD_CELLS,
  FIXED_ANCHOR,
  FOOTPRINT,
  GRID,
  RACKS,
  RESERVED,
  SERVER_SPOTS,
  cellId,
  findSpot,
  fits,
  footprintCells,
  occupancy,
  parseCell,
  portNode,
  rackOf,
  roomFor,
} from '../src/sim/grid';
import { applyRescue, createPlay } from '../src/sim/play';
import { BOARD_SLOTS, SERVER_SLOTS, STARTING_PARTS, brownoutSession } from '../src/sim/tick';

const START: readonly Part[] = STARTING_PARTS;
const server = (id: string, slot: string): Part => ({ id, kind: 'server', slot });
const board = (parts: readonly Part[], credits = 10_000): Board => ({
  credits,
  parts,
  wires: [],
  slots: BOARD_SLOTS,
  nextId: 1,
});

describe('the grid', () => {
  it('is 28 x 19 cells named c<col>-<row>, and every slot of Session 0 is a cell', () => {
    expect(GRID).toEqual({ cols: 28, rows: 19 });
    expect(cellId(4, 2)).toBe('c4-2');
    expect(parseCell('c4-2')).toEqual({ col: 4, row: 2 });
    expect(parseCell('s1')).toBeNull();
    expect(BOARD_SLOTS.length).toBe(
      GRID.cols * GRID.rows - RESERVED.gateway!.length - RESERVED.database!.length,
    );
    for (const c of BOARD_SLOTS) expect(parseCell(c)).not.toBeNull();
  });

  it('gives a server a 2 x 2 footprint and the splitter a 2 x 1, anchored at the far-left cell', () => {
    expect(FOOTPRINT.server).toEqual({ w: 2, h: 2 });
    expect(FOOTPRINT.balancer).toEqual({ w: 2, h: 1 });
    expect(footprintCells('server', 'c4-2')).toEqual(['c4-2', 'c5-2', 'c4-3', 'c5-3']);
    expect(footprintCells('balancer', 'c4-2')).toEqual(['c4-2', 'c5-2']);
  });

  it('stands the gateway on cells at the left edge and the database on cells at the right, nothing else takes them', () => {
    const gw = parseCell(FIXED_ANCHOR.gateway!)!;
    const db = parseCell(FIXED_ANCHOR.database!)!;
    expect(gw.col).toBe(0);
    expect(db.col + FOOTPRINT.database.w).toBe(GRID.cols);
    // On the grid, like a server: a 2 x 2 gateway and a 3 x 2 database, every cell on the table.
    expect(FOOTPRINT.gateway).toEqual({ w: 2, h: 2 });
    expect(FOOTPRINT.database).toEqual({ w: 3, h: 2 });
    expect(RESERVED.gateway).toHaveLength(4);
    expect(RESERVED.database).toHaveLength(6);
    expect(RESERVED.gateway).toEqual(footprintCells('gateway', FIXED_ANCHOR.gateway!));
    expect(RESERVED.database).toEqual(footprintCells('database', FIXED_ANCHOR.database!));
    // Both stand on the first server spot's port row, so the first wire runs straight.
    expect(
      portNode(
        STARTING_PARTS.find((p) => p.kind === 'gateway')!,
        'out',
      )!.j,
    ).toBe(portNode(server('s', SERVER_SPOTS[0]), 'in')!.j);
    expect(
      portNode(
        STARTING_PARTS.find((p) => p.kind === 'database')!,
        'in',
      )!.j,
    ).toBe(portNode(server('s', SERVER_SPOTS[3]), 'out')!.j);
    for (const c of [...RESERVED.gateway!, ...RESERVED.database!]) expect(BOARD_SLOTS).not.toContain(c);
    const taken = occupancy(START);
    for (const c of RESERVED.gateway!) expect(taken.get(c)).toBe('gateway');
    for (const c of RESERVED.database!) expect(taken.get(c)).toBe('database');
  });
});

describe('fits: where a part may stand', () => {
  const a = server('a', 'c10-5');

  it('fits a server on four free cells', () => {
    expect(fits(BOARD_SLOTS, START, 'server', 'c10-5')).toEqual({ ok: true });
    expect(fits(BOARD_SLOTS, [...START, a], 'server', 'c12-5')).toEqual({ ok: true });
    expect(fits(BOARD_SLOTS, [...START, a], 'server', 'c10-7')).toEqual({ ok: true });
  });

  it('blocks a footprint that overlaps a part, by any one cell', () => {
    for (const anchor of ['c10-5', 'c11-5', 'c9-4', 'c11-6', 'c9-6']) {
      const r = fits(BOARD_SLOTS, [...START, a], 'server', anchor);
      expect(r.ok, anchor).toBe(false);
    }
    expect(fits(BOARD_SLOTS, [...START, a], 'server', 'c9-4')).toEqual({
      ok: false,
      reason: 'it would overlap a part already there',
    });
    expect(fits(BOARD_SLOTS, [...START, a], 'server', 'c10-5')).toEqual({
      ok: false,
      reason: 'that spot is taken',
    });
  });

  it('blocks a footprint hanging off the table or over a fixed part’s cells', () => {
    expect(fits(BOARD_SLOTS, START, 'server', cellId(GRID.cols - 1, 3))).toEqual({
      ok: false,
      reason: 'it would hang off the table',
    });
    expect(fits(BOARD_SLOTS, START, 'server', cellId(3, GRID.rows - 1)).ok).toBe(false);
    expect(fits(BOARD_SLOTS, START, 'server', FIXED_ANCHOR.gateway!)).toEqual({
      ok: false,
      reason: 'the gateway needs that space',
    });
    // One column into the database's cells is enough to block.
    const db = parseCell(FIXED_ANCHOR.database!)!;
    expect(fits(BOARD_SLOTS, START, 'server', cellId(db.col - 1, db.row + 1)).ok).toBe(false);
    expect(fits(BOARD_SLOTS, START, 'server', cellId(db.col - 2, db.row + 1)).ok).toBe(true);
  });

  it('fits the 2 x 1 splitter where a 2 x 2 server would not', () => {
    // A server below it leaves one free row: room for the splitter, not for a server.
    const parts = [...START, server('a', 'c10-6')];
    expect(fits(BOARD_SLOTS, parts, 'balancer', 'c10-5').ok).toBe(true);
    expect(fits(BOARD_SLOTS, parts, 'server', 'c10-5').ok).toBe(false);
    expect(fits(BOARD_SLOTS, START, 'balancer', cellId(3, GRID.rows - 1)).ok).toBe(true);
  });

  it('lets a replacement ignore the box it replaces', () => {
    expect(fits(BOARD_SLOTS, [...START, a], 'server', 'c10-5', ['a']).ok).toBe(true);
  });

  it('places a server through the board rules only where it fits, never mutating the board', () => {
    const b = board(START);
    const r = place(b, BROWNOUT_RULES, 'c10-5', 'server');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.board.parts[r.board.parts.length - 1]).toMatchObject({ kind: 'server', slot: 'c10-5' });
    expect(b.parts).toBe(START);
    const again = place(r.board, BROWNOUT_RULES, 'c9-4', 'server');
    expect(again).toEqual({ ok: false, reason: 'it would overlap a part already there' });
    const s = placeServer(brownoutSession(), 'c11-6', 0);
    expect(s.ok).toBe(true);
  });
});

describe('room for twenty servers and more', () => {
  it('fits at least 20 servers on the table, side by side, none overlapping', () => {
    let b = board(START);
    let placed = 0;
    for (let row = 0; row + 2 <= GRID.rows; row += 2)
      for (let col = 0; col + 2 <= GRID.cols; col += 2) {
        const r = place(b, BROWNOUT_RULES, cellId(col, row), 'server');
        if (r.ok) {
          b = r.board;
          placed++;
        }
      }
    expect(placed).toBeGreaterThanOrEqual(20);
    // No cell is claimed twice: every server's four cells are its own.
    const seen = new Set<string>();
    for (const p of b.parts)
      for (const c of footprintCells(p.kind, p.slot ?? FIXED_ANCHOR[p.kind]!)) {
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
    expect(roomFor(BOARD_CELLS, START, 'server')).toBeGreaterThanOrEqual(20);
  });

  it('counts the room left as servers go down', () => {
    const empty = roomFor(BOARD_CELLS, START, 'server');
    const after = roomFor(BOARD_CELLS, [...START, server('a', SERVER_SPOTS[0])], 'server');
    expect(after).toBeLessThan(empty);
    expect(after).toBeGreaterThanOrEqual(20);
  });
});

describe('suggested spots and the crew’s splitter', () => {
  it('suggests one server spot per rack before any rack gets a second, none overlapping', () => {
    expect(SERVER_SLOTS).toBe(SERVER_SPOTS);
    const first = SERVER_SPOTS.slice(0, RACKS.length).map(rackOf);
    expect(first).toEqual(RACKS.map((r) => r.id));
    let parts: Part[] = [...START];
    for (const s of SERVER_SPOTS) {
      expect(fits(BOARD_SLOTS, parts, 'server', s).ok, s).toBe(true);
      parts = [...parts, server(`x-${s}`, s)];
    }
    expect(fits(BOARD_SLOTS, parts, 'balancer', BALANCER_SPOT).ok).toBe(true);
  });

  it('finds the free spot nearest where it is asked for', () => {
    expect(findSpot(BOARD_SLOTS, START, 'server', 'c10-5')).toBe('c10-5');
    const taken = [...START, server('a', 'c10-5')];
    const near = findSpot(BOARD_SLOTS, taken, 'server', 'c10-5')!;
    expect(fits(BOARD_SLOTS, taken, 'server', near).ok).toBe(true);
    const n = parseCell(near)!;
    expect(Math.abs(n.col - 10) + Math.abs(n.row - 5)).toBe(2);
    expect(findSpot(BOARD_SLOTS, START, 'server', 's1')).toBeNull();
  });

  it('racks the crew’s splitter on cells at the rescue, by the gateway', () => {
    const play = createPlay({ slots: BOARD_SLOTS, parts: START, seed: 1 });
    const rescued = applyRescue(play, BROWNOUT.challenges.c5, 'time');
    const lb = rescued.session.board.parts.find((p) => p.kind === 'balancer')!;
    expect(lb.slot).toBe(BALANCER_SPOT);
    // Its in-port sits left of its out-port, on the grid's lines.
    expect(portNode(lb, 'in')!.i).toBeLessThan(portNode(lb, 'out')!.i);
  });
});

describe('racks: the midnight dip takes one rack dark', () => {
  it('splits the table into four racks of seven columns', () => {
    expect(RACKS.map((r) => [r.id, r.from, r.to])).toEqual([
      ['A', 0, 6],
      ['B', 7, 13],
      ['C', 14, 20],
      ['D', 21, 27],
    ]);
    expect(rackOf('c0-0')).toBe('A');
    expect(rackOf('c13-4')).toBe('B');
    expect(rackOf('c27-18')).toBe('D');
    expect(rackOf(null)).toBeNull();
  });

  it('takes every server anchored in the picked rack, and only those', () => {
    const parts: Part[] = [
      ...START,
      server('a1', 'c3-11'),
      server('a2', 'c3-5'),
      server('b1', 'c9-11'),
      server('c1', 'c16-11'),
    ];
    const b = board(parts);
    expect(serverRacks(b)).toEqual(['A', 'B', 'C']);
    const midnight = DIP_SCRIPT.find((d) => d.target === 'seeded')!;
    for (let seed = 0; seed < 12; seed++) {
      const dip = resolveDip(b, midnight, seed);
      const ids = parts.filter((p) => p.kind === 'server' && rackOf(p.slot) === dip.rack).map((p) => p.id);
      expect(dip.parts).toEqual(ids);
      expect(dip.part).toBe(ids[0]);
    }
  });

  it('servers spread one per rack lose one box to the dip', () => {
    const parts: Part[] = [...START, ...SERVER_SPOTS.slice(0, 4).map((s, i) => server(`s${i}`, s))];
    const midnight = DIP_SCRIPT.find((d) => d.target === 'seeded')!;
    for (let seed = 0; seed < 8; seed++)
      expect(resolveDip(board(parts), midnight, seed).parts).toHaveLength(1);
  });
});
