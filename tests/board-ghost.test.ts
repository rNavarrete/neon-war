import { wiredCapacity } from '../src/game/frame';
import { type Board, type Part, type Wire, connect, place } from '../src/sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../src/sim/brownout';
import { GHOST_ID, freeFeed, ghostCapacity, ghostInfo, ghostOpen } from '../src/scenes/board/ghost';
import { padState } from '../src/scenes/board/layout';
import { DEMAND_SCALE_MAX } from '../src/scenes/hud/thresholds';

// The what-if ghost (board-8, LRN-6): the room the wired boxes would have after the drop, told
// truthfully about the feed, and hidden while the player answers a dial question alone.

const gw: Part = { id: 'gateway', kind: 'gateway', slot: null };
const db: Part = { id: 'database', kind: 'database', slot: null };
const lb: Part = { id: 'balancer', kind: 'balancer', slot: null };
const srv = (id: string, slot: string): Part => ({ id, kind: 'server', slot });
const w = (from: string, to: string): Wire => ({ from, to });
const C = BROWNOUT.challenges;
const prices = { server: BROWNOUT.server.cost, overclock: BROWNOUT.overclock.cost };

/** The board as the sim would hold it, so the ghost can be checked against a real drop and wire. */
function simBoard(parts: Part[], wires: Wire[], credits = 400): Board {
  return { credits, slots: ['s1', 's2', 's3', 's4', 's5', 's6'], parts, wires, nextId: 9 };
}

describe('ghostCapacity (board-8)', () => {
  it('C1: a server over an empty pad with the gateway free adds 60', () => {
    const board = { parts: [gw, db], wires: [] };
    expect(freeFeed(board, BROWNOUT_RULES)).toBe('gateway');
    expect(ghostCapacity(board, BROWNOUT_RULES, [], 'server', 's1')).toBe(60);
  });

  it('C3: with the gateway feeding s1, a box over the second pad adds nothing: nothing feeds it', () => {
    const board = { parts: [gw, db, srv('a', 's1')], wires: [w('gateway', 'a'), w('a', 'database')] };
    expect(freeFeed(board, BROWNOUT_RULES)).toBeNull();
    const wired = wiredCapacity(board.parts, board.wires, []);
    expect(wired).toBe(60);
    expect(ghostCapacity(board, BROWNOUT_RULES, [], 'server', 's2')).toBe(wired);
    const g = ghostInfo(board, BROWNOUT_RULES, [], 'server', 's2', 's2', 'legal', true)!;
    expect(g).toMatchObject({ legal: true, adds: 0, capacity: 60, wired: 60, tick: null });
    expect(g.plate).toBe('+0 room · nothing feeds it');
    // The what-if level is the wired room: the same place as the ROOM tick.
    expect(g.whatIf).toBeCloseTo(60 / DEMAND_SCALE_MAX, 9);
  });

  it('after the rescue: the splitter is a free feed, so a box behind it adds 60', () => {
    const board = {
      parts: [gw, db, lb, srv('a', 's1')],
      wires: [w('gateway', 'balancer'), w('balancer', 'a'), w('a', 'database')],
    };
    expect(freeFeed(board, BROWNOUT_RULES)).toBe('balancer');
    expect(ghostCapacity(board, BROWNOUT_RULES, [], 'server', 's2')).toBe(120);
    const g = ghostInfo(board, BROWNOUT_RULES, [], 'server', 's2', 's2', 'legal', true)!;
    expect(g.plate).toBe(`+60 room · boots ${BROWNOUT.server.bootSeconds} s · -${BROWNOUT.server.cost} cr`);
    expect(g.tick).toBe('ROOM +60');
    expect(g.whatIf).toBeCloseTo(120 / DEMAND_SCALE_MAX, 9);
  });

  it('reads the same wired number the board shows after the real drop and the wire along the free feed', () => {
    const cases: { parts: Part[]; wires: Wire[]; pad: string }[] = [
      { parts: [gw, db], wires: [], pad: 's4' },
      { parts: [gw, db, srv('a', 's1')], wires: [w('gateway', 'a'), w('a', 'database')], pad: 's2' },
      {
        parts: [gw, db, lb, srv('a', 's1'), srv('b', 's2')],
        wires: [w('gateway', 'balancer'), w('balancer', 'a'), w('a', 'database'), w('balancer', 'b')],
        pad: 's6',
      },
    ];
    for (const c of cases) {
      const ghost = ghostCapacity({ parts: c.parts, wires: c.wires }, BROWNOUT_RULES, [], 'server', c.pad);
      // Drop it for real, then wire it from the free feed and on to the database where the rules allow.
      const placed = place(simBoard(c.parts, c.wires), BROWNOUT_RULES, c.pad, 'server');
      expect(placed.ok).toBe(true);
      if (!placed.ok) continue;
      let board = placed.board;
      const id = board.parts[board.parts.length - 1].id;
      const feed = freeFeed({ parts: c.parts, wires: c.wires }, BROWNOUT_RULES);
      if (feed) {
        const a = connect(board, BROWNOUT_RULES, feed, id);
        if (a.ok) board = a.board;
      }
      const b = connect(board, BROWNOUT_RULES, id, 'database');
      if (b.ok) board = b.board;
      expect(ghost).toBe(wiredCapacity(board.parts, board.wires, []));
    }
  });

  it('a server card on a dead box: the replacement on the same wires brings its 60 back', () => {
    const board = {
      parts: [gw, db, lb, srv('a', 's1'), srv('dead', 's2')],
      wires: [
        w('gateway', 'balancer'),
        w('balancer', 'a'),
        w('a', 'database'),
        w('balancer', 'dead'),
        w('dead', 'database'),
      ],
    };
    const offline = ['dead'];
    expect(wiredCapacity(board.parts, board.wires, offline)).toBe(60);
    expect(padState('s2', { parts: board.parts, credits: 400, dead: offline }, 'server', prices)).toBe(
      'dead',
    );
    expect(ghostCapacity(board, BROWNOUT_RULES, offline, 'server', 's2')).toBe(120);
    const g = ghostInfo(board, BROWNOUT_RULES, offline, 'server', 's2', 's2', 'dead', true)!;
    expect(g).toMatchObject({ legal: true, adds: 60, tick: 'ROOM +60' });
  });

  it('the kit doubles a wired box and adds nothing to one nothing feeds', () => {
    const board = {
      parts: [gw, db, srv('a', 's1'), srv('b', 's2')],
      wires: [w('gateway', 'a'), w('a', 'database')],
    };
    expect(ghostCapacity(board, BROWNOUT_RULES, [], 'overclock', 's1')).toBe(120);
    expect(ghostCapacity(board, BROWNOUT_RULES, [], 'overclock', 's2')).toBe(60);
    const g = ghostInfo(board, BROWNOUT_RULES, [], 'overclock', 's2', 's2', 'legal', true)!;
    expect(g.plate).toBe('+0 room · nothing feeds it');
  });

  it('short of credits: the ghost still shows what the box would add, but the drop is not legal', () => {
    const board = { parts: [gw, db], wires: [] };
    const g = ghostInfo(board, BROWNOUT_RULES, [], 'server', 's1', 's1', 'poor', true)!;
    expect(g).toMatchObject({ legal: false, adds: 60, tick: 'ROOM +60' });
    expect(g.plate).toBe('+60 room · boots 3 s · -80 cr');
  });

  it('never invents room: the splitter card and taken pads leave the number alone', () => {
    const board = { parts: [gw, db, srv('a', 's1')], wires: [w('gateway', 'a'), w('a', 'database')] };
    expect(ghostCapacity(board, BROWNOUT_RULES, [], 'balancer', 's2')).toBe(60);
    expect(ghostCapacity(board, BROWNOUT_RULES, [], 'server', 's1')).toBe(60);
    const g = ghostInfo(board, BROWNOUT_RULES, [], 'server', 's1', 's1', 'taken', true)!;
    expect(g).toMatchObject({ legal: false, plate: null, whatIf: null, tick: null, adds: 0 });
  });

  it('the what-if box never stays on the board it was asked about', () => {
    const parts = [gw, db];
    const wires: Wire[] = [];
    ghostCapacity({ parts, wires }, BROWNOUT_RULES, [], 'server', 's1');
    expect(parts.some((p) => p.id === GHOST_ID)).toBe(false);
    expect(wires).toEqual([]);
  });
});

describe('the ghost waits for SET (board-8)', () => {
  it('C1: hidden until the estimate is SET', () => {
    expect(ghostOpen(C.c1 + 5, { estimate: null, sizing: null })).toBe(false);
    expect(ghostOpen(C.c1 + 5, { estimate: 30, sizing: null })).toBe(true);
    expect(ghostOpen(C.c3 + 5, { estimate: 30, sizing: null })).toBe(true);
  });

  it('C6: hidden while the sizing prompt is open, until the sizing is SET', () => {
    for (const now of [C.c6 - 5, C.c6, C.c6 + 30]) {
      expect(ghostOpen(now, { estimate: 30, sizing: null }), `at ${now}`).toBe(false);
      expect(ghostOpen(now, { estimate: 30, sizing: 4 }), `at ${now}`).toBe(true);
    }
  });

  it('gives no ghost at all while shut: board.ghost null, whatIf null', () => {
    const board = { parts: [gw, db], wires: [] };
    expect(ghostInfo(board, BROWNOUT_RULES, [], 'server', 's1', 's1', 'legal', false)).toBeNull();
    const open = ghostInfo(
      board,
      BROWNOUT_RULES,
      [],
      'server',
      's1',
      's1',
      'legal',
      ghostOpen(C.c1 + 5, { estimate: 30, sizing: null }),
    );
    expect(open?.whatIf).toBeCloseTo(60 / DEMAND_SCALE_MAX, 9);
  });
});
