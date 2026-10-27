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
  toPage,
  wireEnds,
} from '../src/scenes/board/layout';
import { LOCKED_KINDS, lockedReason, trayCards } from '../src/scenes/board/tray';

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
