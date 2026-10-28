import type { Part } from '../src/sim/board';
import { SERVER_SLOTS } from '../src/sim/tick';
import {
  BOARD_AREA,
  DATABASE,
  GATEWAY,
  LB_SLOT,
  LB_SLOT_ID,
  SERVER_PADS,
  TRAY_AREA,
  distToSegment,
  partAt,
  partBox,
  slotAt,
  slotBox,
  INBOUND_LANES,
  PART_SIZE,
  distToPath,
  pathLength,
  pointAlong,
  toPage,
  wireEnds,
  wirePath,
  BUS_IN,
  BUS_OUT,
  CHANNEL,
  GAP_IN,
  GAP_OUT,
  INBOUND_FROM,
  OVER,
  PAD_SIZE,
  RACK_ROWS,
  SERVER_GRID,
  SERVER_RISE,
  SLOT_IDS,
  TABLE,
  TABLE_FACE,
  UNDER,
  channelAt,
  inBox,
  padBox,
  partAnchor,
  partCentre,
  project,
  slotScale,
} from '../src/scenes/board/layout';
import { ZONES, rectToArea } from '../src/scenes/live/layout';
import { LOCKED_KINDS, lockedReason, trayCards } from '../src/scenes/board/tray';
import { dropLegal, padState, targetState } from '../src/scenes/board/layout';
import { BROWNOUT_RULES } from '../src/sim/brownout';

const server = (id: string, slot: string): Part => ({ id, kind: 'server', slot });
const gateway: Part = { id: 'gateway', kind: 'gateway', slot: null };
const database: Part = { id: 'database', kind: 'database', slot: null };

describe('board layout', () => {
  it('has a pad for every server slot the sim knows', () => {
    expect(Object.keys(SERVER_PADS).sort()).toEqual([...SERVER_SLOTS].sort());
  });

  it('keeps every part and slot inside the board area', () => {
    const parts: Part[] = [
      gateway,
      database,
      { id: 'lb', kind: 'balancer', slot: null },
      ...SERVER_SLOTS.map((s) => server(`server-${s}`, s)),
    ];
    for (const p of parts) {
      const b = partBox(p)!;
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(BOARD_AREA.left);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(BOARD_AREA.right);
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(BOARD_AREA.top);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(BOARD_AREA.bottom);
    }
    for (const id of [LB_SLOT_ID, ...SERVER_SLOTS]) {
      const b = slotBox(id)!;
      expect(b.y + b.h / 2).toBeLessThanOrEqual(BOARD_AREA.bottom);
    }
  });

  it('puts the load balancer slot between the gateway and the servers', () => {
    expect(LB_SLOT.x).toBeGreaterThan(GATEWAY.x);
    for (const pad of Object.values(SERVER_PADS)) expect(LB_SLOT.x).toBeLessThan(pad.x);
    expect(DATABASE.x).toBeGreaterThan(Math.max(...Object.values(SERVER_PADS).map((p) => p.x)));
  });

  it('finds the slot and the part under a point', () => {
    for (const id of SERVER_SLOTS) expect(slotAt(SERVER_PADS[id].x, SERVER_PADS[id].y)).toBe(id);
    expect(slotAt(LB_SLOT.x, LB_SLOT.y)).toBe(LB_SLOT_ID);
    expect(slotAt(10, 10)).toBeNull();
    const parts = [gateway, database, server('server-p1', 's1')];
    expect(partAt(parts, GATEWAY.x, GATEWAY.y)?.id).toBe('gateway');
    expect(partAt(parts, DATABASE.x, DATABASE.y)?.id).toBe('database');
    const b = partBox(parts[2])!;
    expect(partAt(parts, b.x, b.y)?.id).toBe('server-p1');
    expect(partAt(parts, LB_SLOT.x, LB_SLOT.y)).toBeNull();
  });

  it('runs wires from the right edge of one part to the left edge of the next', () => {
    const e = wireEnds(gateway, server('a', 's1'))!;
    expect(e.ax).toBeGreaterThan(GATEWAY.x);
    expect(e.bx).toBeLessThan(SERVER_PADS.s1.x);
    expect(e.bx).toBeGreaterThan(e.ax);
    expect(distToSegment((e.ax + e.bx) / 2, (e.ay + e.by) / 2, e.ax, e.ay, e.bx, e.by)).toBeCloseTo(0);
    expect(distToSegment(e.ax - 30, e.ay, e.ax, e.ay, e.bx, e.by)).toBeCloseTo(30);
  });

  it('routes every wire as right-angle traces that never cross a server', () => {
    const lb: Part = { id: 'lb', kind: 'balancer', slot: null };
    const servers = SERVER_SLOTS.map((s) => server(`server-${s}`, s));
    const pairs: [Part, Part][] = [
      [gateway, lb],
      ...servers.map((s): [Part, Part] => [lb, s]),
      ...servers.map((s): [Part, Part] => [gateway, s]),
      ...servers.map((s): [Part, Part] => [s, database]),
    ];
    for (const [a, b] of pairs) {
      const path = wirePath(a, b)!;
      const e = wireEnds(a, b)!;
      expect(path[0]).toEqual({ x: e.ax, y: e.ay });
      expect(path[path.length - 1]).toEqual({ x: e.bx, y: e.by });
      for (let i = 1; i < path.length; i++) {
        const straight = path[i].x === path[i - 1].x || path[i].y === path[i - 1].y;
        expect(straight).toBe(true);
      }
      // Sample the trace: away from its own two ends it stays clear of every server.
      const length = pathLength(path);
      const at = { x: 0, y: 0 };
      for (let k = 0.02; k < 0.98; k += 0.01) {
        pointAlong(path, length, k, at);
        for (const s of servers) {
          if (s === a || s === b) continue;
          const box = partBox(s)!;
          const inside = Math.abs(at.x - box.x) < box.w / 2 && Math.abs(at.y - box.y) < box.h / 2;
          expect(inside).toBe(false);
        }
      }
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
      expect(lane[lane.length - 1]).toEqual({ x: GATEWAY.x - PART_SIZE.gateway.w / 2 + 6, y: GATEWAY.y });
    }
  });

  it('maps game space to page pixels through the canvas rect', () => {
    const rect = { left: 0, top: 0, width: 1280, height: 720 };
    expect(toPage({ x: 1920, y: 1080 }, rect, { width: 1920, height: 1080 })).toEqual({ x: 1280, y: 720 });
    expect(
      toPage({ x: 960, y: 540 }, { ...rect, left: 100, top: 20 }, { width: 1920, height: 1080 }),
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
    expect(lockedReason('balancer')).toMatch(/load balancer/);
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
  const lb: Part = { id: 'lb', kind: 'balancer', slot: null };
  const servers = SERVER_SLOTS.map((s) => server(`server-${s}`, s));
  type B = { x: number; y: number; w: number; h: number };
  const within = (b: B) => {
    expect(b.x - b.w / 2).toBeGreaterThanOrEqual(BOARD_AREA.left);
    expect(b.x + b.w / 2).toBeLessThanOrEqual(BOARD_AREA.right);
    expect(b.y - b.h / 2).toBeGreaterThanOrEqual(BOARD_AREA.top);
    expect(b.y + b.h / 2).toBeLessThanOrEqual(BOARD_AREA.bottom);
  };
  const overlap = (a: B, b: B) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

  it('draws the feed zone of the Live screen', () => {
    expect(BOARD_AREA).toEqual(rectToArea(ZONES.feed));
    expect(BOARD_AREA).toEqual({ left: 455, right: 1910, top: 110, bottom: 640 });
  });

  it('projects the table with a narrow far edge at y 222 and a wide near edge at y 612', () => {
    expect(project(0, 0)).toEqual({ x: 575, y: 222 });
    expect(project(1, 0)).toEqual({ x: 1790, y: 222 });
    expect(project(0, 1)).toEqual({ x: 462, y: 612 });
    expect(project(1, 1)).toEqual({ x: 1903, y: 612 });
    expect(TABLE.far.right - TABLE.far.left).toBeLessThan(TABLE.near.right - TABLE.near.left);
    // The table sits inside the feed, with the skyline showing above its far edge.
    expect(TABLE.far.y).toBeGreaterThan(BOARD_AREA.top + 100);
    expect(TABLE.near.y + TABLE_FACE).toBeLessThanOrEqual(BOARD_AREA.bottom);
    expect(TABLE.near.left).toBeGreaterThanOrEqual(BOARD_AREA.left);
    expect(TABLE.near.right).toBeLessThanOrEqual(BOARD_AREA.right);
  });

  it('places the gateway, balancer slot, database and a depth-scaled 2x3 rack', () => {
    expect(partBox(gateway)).toEqual({ x: 640, y: 412, w: 110, h: 190 });
    expect(partBox(lb)).toEqual({ x: 870, y: 412, w: 140, h: 100 });
    expect(partBox(database)).toEqual({ x: 1760, y: 412, w: 150, h: 140 });
    expect(RACK_ROWS.map((r) => r.y)).toEqual([300, 412, 524]);
    expect(RACK_ROWS.map((r) => r.scale)).toEqual([0.88, 1, 1.06]);
    expect(RACK_ROWS.map((r) => r.x)).toEqual([
      [1077, 1303],
      [1070, 1310],
      [1063, 1317],
    ]);
    expect(PART_SIZE.server).toEqual({ w: 80, h: 114 });
    expect(PAD_SIZE).toEqual({ w: 116, h: 69 });
    expect(SERVER_RISE).toBe(30);
    // The mid row at full size; the far row smaller, the near row bigger.
    expect(partBox(server('a', 's2'))).toEqual({ x: 1070, y: 412, w: 80, h: 114 });
    expect(partBox(server('a', 's1'))!.w).toBeCloseTo(80 * 0.88);
    expect(partBox(server('a', 's6'))!.h).toBeCloseTo(114 * 1.06);
    for (const id of SERVER_SLOTS) {
      const scale = slotScale(id);
      expect(SERVER_PADS[id].y - partCentre(server('a', id))!.y).toBeCloseTo(SERVER_RISE * scale);
      expect(padBox(id)!.w).toBeCloseTo(PAD_SIZE.w * scale);
    }
  });

  it('keeps every part, pad and slot box inside the feed', () => {
    for (const p of [gateway, database, lb, ...servers]) within(partBox(p)!);
    for (const id of SLOT_IDS) within(slotBox(id)!);
    for (const id of SERVER_SLOTS) within(padBox(id)!);
  });

  it('keeps slot hit boxes apart, and finds each slot at its pad', () => {
    for (const a of SLOT_IDS) {
      for (const b of SLOT_IDS) if (a !== b) expect(overlap(slotBox(a)!, slotBox(b)!)).toBe(false);
    }
    for (const id of SERVER_SLOTS) {
      expect(slotAt(SERVER_PADS[id].x, SERVER_PADS[id].y)).toBe(id);
      // A drop on the server standing there counts too.
      const c = partCentre(server('a', id))!;
      expect(slotAt(c.x, c.y)).toBe(id);
    }
    expect(slotAt(LB_SLOT.x, LB_SLOT.y)).toBe(LB_SLOT_ID);
    expect(slotAt(GATEWAY.x, GATEWAY.y)).toBeNull();
    expect(slotAt(DATABASE.x, DATABASE.y)).toBeNull();
  });

  it('routes wires only on the named buses and rim channels, clear of every server', () => {
    const buses = [BUS_IN, BUS_OUT, GAP_IN, GAP_OUT];
    const pairs: [Part, Part][] = [
      [gateway, lb],
      ...servers.map((s): [Part, Part] => [lb, s]),
      ...servers.map((s): [Part, Part] => [gateway, s]),
      ...servers.map((s): [Part, Part] => [s, database]),
    ];
    for (const [a, b] of pairs) {
      const path = wirePath(a, b)!;
      // Every corner between the two ends turns on a named bus.
      for (let i = 1; i < path.length - 1; i++) expect(buses).toContain(path[i].x);
      // Every run but the first and the last is a bus (vertical) or a rim channel (horizontal).
      for (let i = 2; i < path.length - 1; i++) {
        const p = path[i - 1];
        const q = path[i];
        if (p.y === q.y) expect([OVER, UNDER]).toContain(p.y);
        else expect(buses).toContain(p.x);
      }
      for (const p of path) {
        expect(p.y).toBeGreaterThanOrEqual(OVER);
        expect(p.y).toBeLessThanOrEqual(UNDER);
      }
      // Clear of every server and every pad but its own ends.
      const length = pathLength(path);
      const at = { x: 0, y: 0 };
      for (let k = 0.02; k < 0.98; k += 0.005) {
        pointAlong(path, length, k, at);
        for (const s of servers) {
          if (s === a || s === b) continue;
          expect(inBox(partBox(s)!, at.x, at.y)).toBe(false);
          expect(inBox(padBox(s.slot!)!, at.x, at.y)).toBe(false);
        }
      }
    }
    // The rim channels run just inside the table's far and near edges, past the whole rack, and
    // the buses run beside the columns.
    for (const id of SERVER_SLOTS) {
      const s = partBox(server('a', id))!;
      const pad = padBox(id)!;
      expect(OVER).toBeLessThan(s.y - s.h / 2);
      expect(UNDER).toBeGreaterThan(pad.y + pad.h / 2);
      if (SERVER_GRID[id].col === 0) {
        expect(BUS_IN).toBeLessThan(pad.x - pad.w / 2);
        expect(GAP_IN).toBeGreaterThan(pad.x + pad.w / 2);
      } else {
        expect(GAP_OUT).toBeLessThan(pad.x - pad.w / 2);
        expect(BUS_OUT).toBeGreaterThan(pad.x + pad.w / 2);
      }
    }
    expect(OVER).toBeGreaterThan(TABLE.far.y);
    expect(UNDER).toBeLessThan(TABLE.near.y);
    expect(BUS_IN).toBeGreaterThan(LB_SLOT.x + PART_SIZE.balancer.w / 2);
  });

  it('brings the stream in from x 452 through a mouth at x 455 that narrows to the gateway port', () => {
    expect(INBOUND_FROM).toBe(452);
    expect(CHANNEL.mouth).toEqual({ x: 455, top: 322, bottom: 502 });
    expect(CHANNEL.port.x).toBe(585);
    expect(CHANNEL.port.x).toBe(GATEWAY.x - PART_SIZE.gateway.w / 2);
    expect(CHANNEL.port.bottom - CHANNEL.port.top).toBeLessThan(CHANNEL.mouth.bottom - CHANNEL.mouth.top);
    expect(CHANNEL.port.top).toBeGreaterThanOrEqual(GATEWAY.y - PART_SIZE.gateway.h / 2);
    expect(CHANNEL.port.bottom).toBeLessThanOrEqual(GATEWAY.y + PART_SIZE.gateway.h / 2);
    expect(channelAt(455)).toEqual({ top: 322, bottom: 502 });
    expect(channelAt(585)).toEqual({ top: CHANNEL.port.top, bottom: CHANNEL.port.bottom });
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

  it('anchors a part or a slot for the HUD, and nothing else', () => {
    const board = { parts: Object.freeze([gateway, database, lb, server('server-p1', 's4')]) };
    expect(partAnchor(board, 'gateway')).toEqual(GATEWAY);
    expect(partAnchor(board, 'database')).toEqual(DATABASE);
    expect(partAnchor(board, 'lb')).toEqual(LB_SLOT);
    expect(partAnchor(board, 'server-p1')).toEqual({ x: 1303, y: 300 });
    expect(partAnchor(board, 's2')).toEqual(SERVER_PADS.s2);
    expect(partAnchor({ parts: [] }, 'lb')).toEqual(LB_SLOT);
    expect(partAnchor(board, 'server-p9')).toBeNull();
    expect(partAnchor({ parts: [server('lost', 'nowhere')] }, 'lost')).toBeNull();
    for (const id of ['gateway', 'database', 'lb', 'server-p1', 's1', 's6']) {
      const p = partAnchor(board, id)!;
      expect(p.x).toBeGreaterThanOrEqual(BOARD_AREA.left);
      expect(p.x).toBeLessThanOrEqual(BOARD_AREA.right);
      expect(p.y).toBeGreaterThanOrEqual(BOARD_AREA.top);
      expect(p.y).toBeLessThanOrEqual(BOARD_AREA.bottom);
    }
  });
});

// ---- board-8: legality ------------------------------------------------------------------------

describe('pad legality while a card is dragged (board-8)', () => {
  const prices = { server: 80, overclock: 60 };
  const parts: Part[] = [
    gateway,
    database,
    server('a', 's1'),
    { id: 'b', kind: 'server', slot: 's2', boost: 2 },
    server('dead', 's3'),
  ];
  const at = (credits: number, extra: Part[] = []) => ({
    parts: [...parts, ...extra],
    credits,
    dead: ['dead'],
  });

  it('a server card: empty pads are legal, short credits poor, a live box taken, a dead box replaceable', () => {
    const b = at(400);
    expect(padState('s4', b, 'server', prices)).toBe('legal');
    expect(padState('s1', b, 'server', prices)).toBe('taken');
    expect(padState('s3', b, 'server', prices)).toBe('dead');
    expect(padState('s4', at(79), 'server', prices)).toBe('poor');
    expect(padState('s3', at(79), 'server', prices)).toBe('poor');
    expect(padState('lb', b, 'server', prices)).toBe('wrong');
    expect(padState('nowhere', b, 'server', prices)).toBe('wrong');
    expect(dropLegal('server', 'legal')).toBe(true);
    expect(dropLegal('server', 'dead')).toBe(true);
    for (const s of ['taken', 'poor', 'wrong'] as const) expect(dropLegal('server', s)).toBe(false);
  });

  it('the kit: a server without one is legal, a kitted one taken, an empty pad wrong, a dead box not legal', () => {
    const b = at(400);
    expect(padState('s1', b, 'overclock', prices)).toBe('legal');
    expect(padState('s2', b, 'overclock', prices)).toBe('taken');
    expect(padState('s4', b, 'overclock', prices)).toBe('wrong');
    expect(padState('s3', b, 'overclock', prices)).toBe('dead');
    expect(dropLegal('overclock', 'dead')).toBe(false);
    expect(padState('s1', at(59), 'overclock', prices)).toBe('poor');
  });

  it('the splitter pad takes no card from the tray: the crew racks it', () => {
    expect(padState('lb', at(400), 'balancer', prices)).toBe('wrong');
    expect(padState('s4', at(400), 'balancer', prices)).toBe('wrong');
    expect(padState('lb', at(400, [{ id: 'lb1', kind: 'balancer', slot: null }]), 'balancer', prices)).toBe(
      'taken',
    );
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
