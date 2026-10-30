import type { Part } from '../src/sim/board';
import { SERVER_SLOTS } from '../src/sim/tick';
import {
  BOARD_AREA,
  DATABASE,
  GATEWAY,
  TRAY_AREA,
  partAt,
  partBox,
  INBOUND_LANES,
  PART_SIZE,
  distToPath,
  pathLength,
  pointAlong,
  toPage,
  wirePath,
  CHANNEL,
  INBOUND_FROM,
  TABLE,
  TABLE_FACE,
  channelAt,
  dropAnchor,
  footprintQuad,
  inPort,
  outPort,
  partAnchor,
  partCentre,
  partScale,
  previewCells,
  project,
  standBox,
} from '../src/scenes/board/layout';
import {
  BALANCER_SPOT,
  BOARD_CELLS,
  FIXED_ANCHOR,
  FOOTPRINT,
  GRID,
  type Node,
  RESERVED,
  SERVER_SPOTS,
  cellId,
  footprintCells,
  parseCell,
  portNode,
} from '../src/sim/grid';
import { blockCentre, cellQuad, nodeAt } from '../src/scenes/board/cells';
import { GLASS } from '../src/scenes/board/glass';
import { edgeBlocked, orthogonal, traceNodes } from '../src/scenes/board/lattice';
import {
  FEED_SHOWN,
  FEED_VIEW,
  FEED_WORLD,
  ZONES,
  boardToScreen,
  rectToArea,
  screenToBoard,
} from '../src/scenes/live/layout';
import { LOCKED_KINDS, lockedReason, trayCards } from '../src/scenes/board/tray';
import { dropLegal, padState, targetState } from '../src/scenes/board/layout';
import { BROWNOUT_RULES } from '../src/sim/brownout';

const server = (id: string, slot: string): Part => ({ id, kind: 'server', slot });
const gateway: Part = { id: 'gateway', kind: 'gateway', slot: null };
const database: Part = { id: 'database', kind: 'database', slot: null };
const balancer: Part = { id: 'lb', kind: 'balancer', slot: BALANCER_SPOT };
/** The centre of a footprint of `kind` anchored at `anchor`, on screen. */
const footCentre = (kind: Part['kind'], anchor: string) => {
  const c = parseCell(anchor)!;
  return blockCentre(c.col, c.row, FOOTPRINT[kind].w, FOOTPRINT[kind].h);
};
/** Every part's footprint as a lattice block. */
const blocks = (parts: readonly Part[]) =>
  parts.flatMap((p) => {
    const a = p.slot ?? FIXED_ANCHOR[p.kind];
    const c = a ? parseCell(a) : null;
    return c ? [{ col: c.col, row: c.row, ...FOOTPRINT[p.kind] }] : [];
  });

describe('board layout', () => {
  it('stands a server on every suggested spot the sim knows, each a 2 x 2 footprint of cells', () => {
    expect(SERVER_SLOTS).toEqual(SERVER_SPOTS);
    for (const id of SERVER_SLOTS) {
      expect(parseCell(id)).not.toBeNull();
      expect(footprintCells('server', id)).toHaveLength(4);
      const b = standBox('server', id)!;
      expect(partCentre(server('a', id))).toEqual({ x: b.x, y: b.y });
    }
  });

  it('keeps every part and every cell inside the board area', () => {
    const parts: Part[] = [gateway, database, balancer, ...SERVER_SLOTS.map((s) => server(`server-${s}`, s))];
    for (const p of parts) {
      const b = partBox(p)!;
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(BOARD_AREA.left);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(BOARD_AREA.right);
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(BOARD_AREA.top);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(BOARD_AREA.bottom);
    }
    for (let j = 0; j <= GRID.rows; j++)
      for (let i = 0; i <= GRID.cols; i++) {
        const n = nodeAt(i, j);
        expect(n.x).toBeGreaterThanOrEqual(BOARD_AREA.left);
        expect(n.x).toBeLessThanOrEqual(BOARD_AREA.right);
        expect(n.y).toBeGreaterThanOrEqual(BOARD_AREA.top);
        expect(n.y).toBeLessThanOrEqual(BOARD_AREA.bottom);
      }
  });

  it('stands the gateway on cells at the grid’s left side and the database at its right, the servers between', () => {
    // Each stands on its own footprint: its centre over its cells, its foot inside their outline.
    for (const [part, centre] of [
      [gateway, GATEWAY],
      [database, DATABASE],
    ] as const) {
      const q = footprintQuad(part.kind, FIXED_ANCHOR[part.kind]!)!;
      expect(centre.x).toBeGreaterThan(Math.min(q[0].x, q[3].x));
      expect(centre.x).toBeLessThan(Math.max(q[1].x, q[2].x));
      const b = partBox(part)!;
      expect(b.y + b.h / 2).toBeGreaterThan(q[0].y);
      expect(b.y + b.h / 2).toBeLessThan(q[3].y);
    }
    // In the grid's first two columns and its last three, on their own rows.
    const gw = parseCell(FIXED_ANCHOR.gateway!)!;
    const db = parseCell(FIXED_ANCHOR.database!)!;
    expect(gw.col).toBe(0);
    expect(db.col).toBe(GRID.cols - 3);
    expect(GATEWAY.x).toBeLessThan(nodeAt(2, gw.row).x);
    expect(DATABASE.x).toBeGreaterThan(nodeAt(GRID.cols - 3, db.row).x);
    expect(partBox(balancer)!.x).toBeGreaterThan(GATEWAY.x);
    for (const id of SERVER_SLOTS) {
      const c = partCentre(server('a', id))!;
      expect(c.x).toBeGreaterThan(GATEWAY.x);
      expect(c.x).toBeLessThan(DATABASE.x);
    }
  });

  it('finds the footprint and the part under a point', () => {
    for (const id of SERVER_SLOTS) {
      const c = footCentre('server', id);
      expect(dropAnchor('server', c.x, c.y)).toBe(id);
    }
    expect(dropAnchor('server', 10, 10)).toBeNull();
    const parts = [gateway, database, server('server-p1', SERVER_SLOTS[0])];
    expect(partAt(parts, GATEWAY.x, GATEWAY.y)?.id).toBe('gateway');
    expect(partAt(parts, DATABASE.x, DATABASE.y)?.id).toBe('database');
    const b = partBox(parts[2])!;
    expect(partAt(parts, b.x, b.y)?.id).toBe('server-p1');
    const free = footCentre('server', SERVER_SLOTS[1]);
    expect(partAt(parts, free.x, free.y)).toBeNull();
  });

  it("runs wires from one part's out-port to the next one's in-port", () => {
    const s = server('a', SERVER_SLOTS[0]);
    const path = wirePath(gateway, s, [gateway, database, s])!;
    expect(path[0]).toEqual(outPort(gateway));
    expect(path[0].x).toBeGreaterThan(GATEWAY.x);
    expect(path[path.length - 1]).toEqual(inPort(s));
    expect(path[path.length - 1].x).toBeGreaterThan(path[0].x);
    const back = wirePath(s, database, [gateway, database, s])!;
    expect(back[0]).toEqual(outPort(s));
    expect(back[back.length - 1]).toEqual(inPort(database));
    expect(back[back.length - 1].x).toBeLessThan(DATABASE.x);
  });

  it('routes every wire along the grid lines, at right angles, never through a part', () => {
    const servers = SERVER_SLOTS.map((s) => server(`server-${s}`, s));
    const parts = [gateway, database, balancer, ...servers];
    const pairs: [Part, Part][] = [
      [gateway, balancer],
      ...servers.map((s): [Part, Part] => [balancer, s]),
      ...servers.map((s): [Part, Part] => [gateway, s]),
      ...servers.map((s): [Part, Part] => [s, database]),
    ];
    const all = blocks(parts);
    const crossings = new Set<string>();
    for (let j = 0; j <= GRID.rows; j++)
      for (let i = 0; i <= GRID.cols; i++) crossings.add(`${nodeAt(i, j).x},${nodeAt(i, j).y}`);
    for (const [a, b] of pairs) {
      const from = portNode(a, 'out')!;
      const to = portNode(b, 'in')!;
      const nodes = traceNodes(GRID.cols, GRID.rows, from, to, all);
      expect(nodes[0]).toEqual(from);
      expect(nodes[nodes.length - 1]).toEqual(to);
      expect(orthogonal(nodes)).toBe(true);
      // Step by step along the lattice: no step runs through the inside of any footprint.
      for (let k = 1; k < nodes.length; k++) {
        const p: Node = nodes[k - 1];
        const q: Node = nodes[k];
        const dir = q.i > p.i ? 0 : q.j > p.j ? 1 : q.i < p.i ? 2 : 3;
        const steps = Math.abs(q.i - p.i) + Math.abs(q.j - p.j);
        let i = p.i;
        let j = p.j;
        for (let n = 0; n < steps; n++) {
          expect(edgeBlocked(i, j, dir, all)).toBe(false);
          i += [1, 0, -1, 0][dir];
          j += [0, 1, 0, -1][dir];
        }
      }
      // On screen every corner between the gateway's and the database's art edges is a grid-line crossing.
      const path = wirePath(a, b, parts)!;
      const inner = path.slice(a.kind === 'gateway' ? 1 : 0, b.kind === 'database' ? -1 : undefined);
      for (const pt of inner) expect(crossings.has(`${pt.x},${pt.y}`)).toBe(true);
    }
  });

  it('walks a point along a trace and measures how far a click is from it', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ];
    expect(pathLength(path)).toBe(150);
    expect(pointAlong(path, 150, 0.5, { x: 0, y: 0 })).toEqual({ x: 75, y: 0 });
    expect(pointAlong(path, 150, 1, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
    expect(distToPath(100, 25, path)).toBe(0);
    expect(distToPath(120, 25, path)).toBe(20);
  });

  it('brings the block traffic in from the left rim to the gateway', () => {
    for (const lane of INBOUND_LANES) {
      expect(lane[0].x).toBeLessThan(BOARD_AREA.left);
      expect(lane[lane.length - 1]).toEqual(inPort(gateway));
      // It reads left to right: never steps back toward the left edge.
      for (let k = 1; k < lane.length; k++) expect(lane[k].x).toBeGreaterThan(lane[k - 1].x);
    }
    expect(inPort(gateway)!.x).toBeLessThan(GATEWAY.x);
  });

  it('maps game space to page pixels through the canvas rect', () => {
    // Since layout A (Rolando, 30 Oct 2026) toPage takes board-space points and shows them through
    // the feed's view first, so these screen points go in as the board points that land on them.
    const rect = { left: 0, top: 0, width: 1280, height: 720 };
    expect(toPage(screenToBoard({ x: 1920, y: 1080 }), rect, { width: 1920, height: 1080 })).toEqual({
      x: 1280,
      y: 720,
    });
    expect(
      toPage(
        screenToBoard({ x: 960, y: 540 }),
        { ...rect, left: 100, top: 20 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({
      x: 740,
      y: 380,
    });
  });
});

describe('tray', () => {
  it('offers the scrap server and the overclock kit, and locks the load balancer until it is given', () => {
    const locked = trayCards(false);
    const byId = Object.fromEntries(locked.map((c) => [c.id, c]));
    expect(byId.server.locked).toBe(false);
    expect(byId.overclock.locked).toBe(false);
    expect(byId.balancer.locked).toBe(true);
    expect(trayCards(true).find((c) => c.id === 'balancer')!.locked).toBe(false);
    expect(lockedReason('balancer')).toMatch(/the crew hasn't given you a load balancer yet/);
  });

  it('shows every other catalog part locked', () => {
    const cards = trayCards(true);
    const others = cards.filter((c) => !['server', 'overclock', 'balancer'].includes(c.id));
    expect(others.map((c) => c.id)).toEqual([...LOCKED_KINDS]);
    expect(others.every((c) => c.locked)).toBe(true);
    expect(LOCKED_KINDS).not.toContain('server');
    expect(LOCKED_KINDS).not.toContain('load-balancer');
  });

  it('fits inside the tray area without overlapping cards', () => {
    const cards = trayCards(false);
    for (const c of cards) {
      expect(c.x - c.w / 2).toBeGreaterThanOrEqual(TRAY_AREA.left);
      expect(c.x + c.w / 2).toBeLessThanOrEqual(TRAY_AREA.right);
      expect(c.y - c.h / 2).toBeGreaterThanOrEqual(TRAY_AREA.top);
      expect(c.y + c.h / 2).toBeLessThanOrEqual(TRAY_AREA.bottom);
    }
    for (const a of cards) {
      for (const b of cards) {
        if (a === b) continue;
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe('feed geometry (board-1)', () => {
  const lb = balancer;
  const servers = SERVER_SLOTS.map((s) => server(`server-${s}`, s));
  type B = { x: number; y: number; w: number; h: number };
  const within = (b: B) => {
    expect(b.x - b.w / 2).toBeGreaterThanOrEqual(BOARD_AREA.left);
    expect(b.x + b.w / 2).toBeLessThanOrEqual(BOARD_AREA.right);
    expect(b.y - b.h / 2).toBeGreaterThanOrEqual(BOARD_AREA.top);
    expect(b.y + b.h / 2).toBeLessThanOrEqual(BOARD_AREA.bottom);
  };

  it('draws the feed zone of the Live screen', () => {
    // The board draws in its own space and the feed's view shows it in ZONES.feed (layout A, Rolando,
    // 30 Oct 2026): the area is that space, the box the table was painted for.
    expect(BOARD_AREA).toEqual(rectToArea(FEED_WORLD));
    // Option 2 (Rolando, 30 Oct 2026, table D): the table's box is taller, the steeper table standing in it.
    expect(BOARD_AREA).toEqual({ left: 455, right: 1910, top: 110, bottom: 870 });
    expect(FEED_VIEW.screen).toEqual(ZONES.feed);
  });

  // Option 2 (Rolando, 30 Oct 2026, table D): the table top is the painting's glass (glass.ts GLASS), its far edge at
  // y 149.5 and its near edge at y 667 (it was y 222 and 612 on the old, flatter table).
  it('projects the table with a narrow far edge at y 149.5 and a wide near edge at y 667', () => {
    const near = (p: { x: number; y: number }, x: number, y: number) => {
      expect(p.x).toBeCloseTo(x, 1);
      expect(p.y).toBeCloseTo(y, 1);
    };
    near(project(0, 0), 705.8, 149.5);
    near(project(1, 0), 1656.2, 149.5);
    near(project(0, 1), 572.5, 667);
    near(project(1, 1), 1793.5, 667);
    expect(project(0, 0)).toEqual({ x: GLASS[0].x, y: GLASS[0].y });
    expect(project(1, 0)).toEqual({ x: GLASS[1].x, y: GLASS[0].y });
    expect(project(0, 1)).toEqual({ x: GLASS[3].x, y: GLASS[3].y });
    expect(TABLE.far.right - TABLE.far.left).toBeLessThan(TABLE.near.right - TABLE.near.left);
    // The table sits inside the feed, with the rooftop and the skyline showing above its far edge
    // (table D, Rolando 30 Oct 2026: the scene above the table is the painting's, above the box's top).
    expect(TABLE.far.y).toBeGreaterThan(FEED_SHOWN.y + 200);
    expect(TABLE.far.y).toBeGreaterThan(BOARD_AREA.top);
    expect(TABLE.near.y + TABLE_FACE).toBeLessThanOrEqual(BOARD_AREA.bottom);
    expect(TABLE.near.left).toBeGreaterThanOrEqual(BOARD_AREA.left);
    expect(TABLE.near.right).toBeLessThanOrEqual(BOARD_AREA.right);
  });

  it('stands the gateway and the database on their cells like servers, and parts smaller toward the far edge', () => {
    expect(partBox(gateway)).toEqual(standBox('gateway', FIXED_ANCHOR.gateway!));
    expect(partBox(database)).toEqual(standBox('database', FIXED_ANCHOR.database!));
    // At the table's own perspective and scale: as wide as a server on the same cells, their art's shape.
    expect(partBox(gateway)!.w).toBeCloseTo(standBox('server', FIXED_ANCHOR.gateway!)!.w);
    for (const p of [gateway, database]) {
      const b = partBox(p)!;
      expect(b.w / b.h).toBeCloseTo(PART_SIZE[p.kind].w / PART_SIZE[p.kind].h);
      expect(partScale(p)).toBeLessThanOrEqual(1);
    }
    expect(partBox(database)!.w).toBeGreaterThan(partBox(gateway)!.w);
    expect(PART_SIZE.server).toEqual({ w: 80, h: 114 });
    expect(FOOTPRINT.server).toEqual({ w: 2, h: 2 });
    expect(FOOTPRINT.balancer).toEqual({ w: 2, h: 1 });
    // A server on a far row draws smaller than one on a near row, and never above its full size.
    const far = partBox(server('a', cellId(10, 0)))!;
    const near = partBox(server('a', cellId(10, GRID.rows - 2)))!;
    expect(far.w).toBeLessThan(near.w);
    for (const id of SERVER_SLOTS) {
      const scale = partScale(server('a', id));
      expect(scale).toBeGreaterThan(0.5);
      expect(scale).toBeLessThanOrEqual(1);
      const b = partBox(server('a', id))!;
      expect(b.w / b.h).toBeCloseTo(PART_SIZE.server.w / PART_SIZE.server.h);
      // It stands on its footprint: its foot is inside the footprint's outline.
      const q = footprintQuad('server', id)!;
      const foot = b.y + b.h / 2;
      expect(foot).toBeGreaterThan(q[0].y);
      expect(foot).toBeLessThan(q[3].y);
    }
  });

  it('keeps every part and every footprint inside the feed', () => {
    for (const p of [gateway, database, lb, ...servers]) within(partBox(p)!);
    for (const id of SERVER_SLOTS) {
      for (const pt of footprintQuad('server', id)!) {
        expect(pt.x).toBeGreaterThanOrEqual(BOARD_AREA.left);
        expect(pt.x).toBeLessThanOrEqual(BOARD_AREA.right);
        expect(pt.y).toBeGreaterThanOrEqual(BOARD_AREA.top);
        expect(pt.y).toBeLessThanOrEqual(BOARD_AREA.bottom);
      }
    }
  });

  it('keeps the suggested spots apart, off the fixed parts and the splitter, and finds each under its centre', () => {
    const taken = new Set<string>();
    for (const id of SERVER_SLOTS) {
      for (const c of footprintCells('server', id)) {
        expect(taken.has(c)).toBe(false);
        taken.add(c);
        expect(BOARD_CELLS).toContain(c);
      }
    }
    for (const c of footprintCells('balancer', BALANCER_SPOT)) {
      expect(taken.has(c)).toBe(false);
      expect(BOARD_CELLS).toContain(c);
    }
    for (const id of SERVER_SLOTS) {
      const c = footCentre('server', id);
      expect(dropAnchor('server', c.x, c.y)).toBe(id);
    }
    // Off the grid (past the table's rims) nothing is under the pointer.
    expect(dropAnchor('server', 640, 412)).toBeNull();
    expect(dropAnchor('server', 1760, 412)).toBeNull();
    // Over the gateway's or the database's cells a server footprint is blocked there (it shows red).
    for (const kind of ['gateway', 'database'] as const) {
      const c = footCentre(kind, FIXED_ANCHOR[kind]!);
      const at = dropAnchor('server', c.x, c.y)!;
      expect(at).not.toBeNull();
      const { bad } = previewCells('server', at, [gateway, database]);
      expect(bad.length).toBeGreaterThan(0);
      for (const x of bad) expect(RESERVED[kind]).toContain(x);
      expect(
        padState(at, { parts: [gateway, database], credits: 999, dead: [] }, 'server', {
          server: 80,
          overclock: 60,
        }),
      ).toBe('wrong');
    }
  });

  it('lays the grid as quads that share their edges, rows shallower toward the far edge', () => {
    for (let r = 0; r < GRID.rows; r++)
      for (let c = 0; c < GRID.cols - 1; c++) {
        const a = cellQuad(cellId(c, r))!;
        const b = cellQuad(cellId(c + 1, r))!;
        expect(a[1]).toEqual(b[0]);
        expect(a[2]).toEqual(b[3]);
      }
    const h = (row: number) => cellQuad(cellId(14, row))![3].y - cellQuad(cellId(14, row))![0].y;
    expect(h(0)).toBeLessThan(h(GRID.rows - 1));
    // A footprint's preview names its cells and the ones that are blocked.
    const s = server('a', SERVER_SLOTS[0]);
    const c = parseCell(SERVER_SLOTS[0])!;
    const over = cellId(c.col + 1, c.row);
    expect(previewCells('server', over, [gateway, database, s])).toEqual({
      cells: footprintCells('server', over),
      bad: [cellId(c.col + 1, c.row), cellId(c.col + 1, c.row + 1)],
    });
    const bay = FIXED_ANCHOR.gateway!;
    expect(previewCells('server', bay, [gateway, database]).bad).toEqual(
      footprintCells('server', bay).filter((x) => RESERVED.gateway!.includes(x)),
    );
  });

  it('brings the stream in from x 452 through a mouth at x 455 that narrows toward the gateway port', () => {
    expect(INBOUND_FROM).toBe(452);
    // Option 2 (Rolando, 30 Oct 2026, table D): the channel is centred on the gateway's in-port, its port on the
    // steeper table's left rim (it was 322-502 to x 585 on the old table).
    expect(CHANNEL.mouth).toEqual({ x: 455, top: 352, bottom: 532 });
    expect(CHANNEL.port.x).toBe(607);
    // The channel ends on the table's left rim, short of the gateway on the grid, level with its in-port.
    expect(CHANNEL.port.x).toBeLessThan(inPort(gateway)!.x);
    expect(CHANNEL.port.bottom - CHANNEL.port.top).toBeLessThan(CHANNEL.mouth.bottom - CHANNEL.mouth.top);
    expect(inPort(gateway)!.y).toBeGreaterThan(CHANNEL.port.top);
    expect(inPort(gateway)!.y).toBeLessThan(CHANNEL.port.bottom);
    expect(channelAt(455)).toEqual({ top: 352, bottom: 532 });
    expect(channelAt(607)).toEqual({ top: CHANNEL.port.top, bottom: CHANNEL.port.bottom });
    // Every lane starts at x 452 and stays between the channel's walls up to the port.
    const at = { x: 0, y: 0 };
    for (const lane of INBOUND_LANES) {
      expect(lane[0].x).toBe(452);
      const length = pathLength(lane);
      for (let k = 0; k <= 1; k += 0.01) {
        pointAlong(lane, length, k, at);
        if (at.x < CHANNEL.mouth.x || at.x > CHANNEL.port.x) continue;
        const wall = channelAt(at.x);
        expect(at.y).toBeGreaterThan(wall.top);
        expect(at.y).toBeLessThan(wall.bottom);
      }
    }
  });

  it('anchors a part or a cell for the HUD, and nothing else', () => {
    const board = { parts: Object.freeze([gateway, database, lb, server('server-p1', SERVER_SLOTS[3])]) };
    // Anchors are screen points for the HUD, so they come through the feed's view (layout A).
    expect(partAnchor(board, 'gateway')).toEqual(boardToScreen(GATEWAY));
    expect(partAnchor(board, 'database')).toEqual(boardToScreen(DATABASE));
    expect(partAnchor(board, 'lb')).toEqual(boardToScreen(partCentre(lb)!));
    expect(partAnchor(board, 'server-p1')).toEqual(boardToScreen(partCentre(server('x', SERVER_SLOTS[3]))!));
    const c = parseCell(SERVER_SLOTS[1])!;
    expect(partAnchor(board, SERVER_SLOTS[1])).toEqual(boardToScreen(blockCentre(c.col, c.row, 1, 1)));
    expect(partAnchor({ parts: [] }, 'lb')).toBeNull();
    expect(partAnchor(board, 'server-p9')).toBeNull();
    expect(partAnchor({ parts: [server('lost', 'nowhere')] }, 'lost')).toBeNull();
    for (const id of ['gateway', 'database', 'lb', 'server-p1', SERVER_SLOTS[0], SERVER_SLOTS[5]]) {
      // On screen, so inside the feed's zone (layout A).
      const p = partAnchor(board, id)!;
      const feed = rectToArea(ZONES.feed);
      expect(p.x).toBeGreaterThanOrEqual(feed.left);
      expect(p.x).toBeLessThanOrEqual(feed.right);
      expect(p.y).toBeGreaterThanOrEqual(feed.top);
      expect(p.y).toBeLessThanOrEqual(feed.bottom);
    }
  });
});

// ---- board-8: legality ------------------------------------------------------------------------

describe('pad legality while a card is dragged (board-8)', () => {
  const prices = { server: 80, overclock: 60 };
  const [s1, s2, s3, s4] = SERVER_SLOTS;
  const parts: Part[] = [
    gateway,
    database,
    server('a', s1),
    { id: 'b', kind: 'server', slot: s2, boost: 2 },
    server('dead', s3),
  ];
  const at = (credits: number, extra: Part[] = []) => ({
    parts: [...parts, ...extra],
    credits,
    dead: ['dead'],
  });
  const c1 = parseCell(s1)!;
  /** One cell right of the first server's anchor: a footprint there would overlap that server. */
  const overlapping = cellId(c1.col + 1, c1.row);

  it('a server card: free cells are legal, short credits poor, a live box taken, a dead box replaceable', () => {
    const b = at(400);
    expect(padState(s4, b, 'server', prices)).toBe('legal');
    expect(padState(s1, b, 'server', prices)).toBe('taken');
    expect(padState(overlapping, b, 'server', prices)).toBe('taken');
    expect(padState(s3, b, 'server', prices)).toBe('dead');
    expect(padState(s4, at(79), 'server', prices)).toBe('poor');
    expect(padState(s3, at(79), 'server', prices)).toBe('poor');
    // The gateway's bay, a footprint hanging off the table, and no cell at all.
    expect(padState(FIXED_ANCHOR.gateway!, b, 'server', prices)).toBe('wrong');
    expect(padState(cellId(GRID.cols - 1, 0), b, 'server', prices)).toBe('wrong');
    expect(padState('nowhere', b, 'server', prices)).toBe('wrong');
    expect(dropLegal('server', 'legal')).toBe(true);
    expect(dropLegal('server', 'dead')).toBe(true);
    for (const s of ['taken', 'poor', 'wrong'] as const) expect(dropLegal('server', s)).toBe(false);
  });

  it('the kit: a server without one is legal, a kitted one taken, free cells wrong, a dead box not legal', () => {
    const b = at(400);
    expect(padState(s1, b, 'overclock', prices)).toBe('legal');
    expect(padState(s2, b, 'overclock', prices)).toBe('taken');
    expect(padState(s4, b, 'overclock', prices)).toBe('wrong');
    expect(padState(s3, b, 'overclock', prices)).toBe('dead');
    expect(dropLegal('overclock', 'dead')).toBe(false);
    expect(padState(s1, at(59), 'overclock', prices)).toBe('poor');
  });

  it('the splitter card goes nowhere on the grid: the crew racks it', () => {
    expect(padState(BALANCER_SPOT, at(400), 'balancer', prices)).toBe('wrong');
    expect(padState(s4, at(400), 'balancer', prices)).toBe('wrong');
    expect(padState(s4, at(400, [balancer]), 'balancer', prices)).toBe('taken');
  });

  it('a wire target mirrors connect(): ok, or its reason', () => {
    const wires = [{ from: 'gateway', to: 'a' }];
    expect(targetState({ parts, wires }, BROWNOUT_RULES, 'a', 'database')).toEqual({
      ok: true,
      reason: null,
    });
    const busy = targetState({ parts, wires }, BROWNOUT_RULES, 'gateway', 'b');
    expect(busy.ok).toBe(false);
    expect(busy.reason).toMatch(/feeds one part only/);
    expect(targetState({ parts, wires }, BROWNOUT_RULES, 'database', 'a').ok).toBe(false);
    expect(targetState({ parts, wires }, BROWNOUT_RULES, 'gateway', 'a').reason).toBe('already connected');
  });
});
