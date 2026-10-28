import { readFrame, resetFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import type { Part, Wire } from '../src/sim/board';
import { BROWNOUT } from '../src/sim/brownout';
import {
  BALANCER_OUT,
  CREW_NEED,
  GATEWAY_OUT,
  TUMBLE_LIFE,
  TUMBLE_MAX,
  TumblePool,
  crewChip,
  crewCover,
  emptyWait,
  padPulseAlpha,
  portLit,
  waitInto,
} from '../src/scenes/board/waits';

const C = BROWNOUT.challenges;

describe('the board waits (board-6)', () => {
  beforeEach(() => resetFrame());

  it('shows the C1 wait at the gateway until a box is wired gateway to database', () => {
    const r = new Run();
    r.now = C.c1;
    const w = emptyWait();
    expect(waitInto(w, readFrame(r), 0, false)).toMatchObject({
      first: true,
      crew: false,
      port: GATEWAY_OUT,
    });
    expect(r.placeServer('s1').ok).toBe(true);
    const id = r.session.board.parts[r.session.board.parts.length - 1].id;
    expect(r.connect('gateway', id).ok).toBe(true);
    expect(waitInto(w, readFrame(r), 0, false).first).toBe(true);
    // The clock holds meanwhile.
    for (let i = 0; i < 30; i++) r.tick(1 / 30);
    expect(r.now).toBe(C.c1);
    expect(r.connect(id, 'database').ok).toBe(true);
    expect(waitInto(w, readFrame(r), 0, false)).toMatchObject({ first: false, crew: false, port: null });
    expect(w.portLit).toBe(false);
  });

  it('counts the boxes behind the balancer the way the run waits on them (booting count, dead do not)', () => {
    const parts: Part[] = [
      { id: 'gateway', kind: 'gateway', slot: null },
      { id: 'balancer', kind: 'balancer', slot: null },
      { id: 'a', kind: 'server', slot: 's1' },
      { id: 'b', kind: 'server', slot: 's2' },
      { id: 'c', kind: 'server', slot: 's3', boost: 2 },
      { id: 'database', kind: 'database', slot: null },
    ];
    const wires: Wire[] = [
      { from: 'gateway', to: 'balancer' },
      { from: 'balancer', to: 'a' },
      { from: 'a', to: 'database' },
      { from: 'balancer', to: 'b' },
      { from: 'c', to: 'database' },
    ];
    // a counts; b has no wire out; c has no wire in.
    expect(crewCover(parts, wires, [])).toBe(60);
    expect(crewCover(parts, [...wires, { from: 'balancer', to: 'c' }], [])).toBe(180);
    expect(crewCover(parts, [...wires, { from: 'balancer', to: 'c' }], ['c'])).toBe(60);
    expect(
      crewCover(
        parts.filter((p) => p.kind !== 'balancer'),
        wires,
        [],
      ),
    ).toBe(0);
    expect(CREW_NEED).toBe(BROWNOUT.demand.tail);
    expect(crewChip(60, 120)).toBe('60/120');
  });

  it('shows the crew wait at the balancer with what the boxes behind it cover', () => {
    const parts: Part[] = [
      { id: 'balancer', kind: 'balancer', slot: null },
      { id: 'a', kind: 'server', slot: 's1' },
    ];
    const wires: Wire[] = [
      { from: 'balancer', to: 'a' },
      { from: 'a', to: 'database' },
    ];
    const w = waitInto(
      emptyWait(),
      { waitingForFirstBuild: false, waitingForCrewBuild: true, parts, wires, dead: [] },
      0,
      false,
    );
    expect(w).toMatchObject({
      first: false,
      crew: true,
      behind: 60,
      need: 120,
      port: BALANCER_OUT,
      blinking: true,
    });
  });

  it('blinks the waiting port at 2 Hz, lit steady under reduce flicker; pads pulse unless reduced', () => {
    const ts = Array.from({ length: 40 }, (_, i) => i / 20);
    expect(new Set(ts.map((t) => portLit(t, false)))).toEqual(new Set([true, false]));
    for (const t of ts) {
      expect(portLit(t, true)).toBe(true);
      expect(padPulseAlpha(t, true)).toBe(1);
      expect(padPulseAlpha(t, false)).toBeGreaterThanOrEqual(0.6);
      expect(padPulseAlpha(t, false)).toBeLessThanOrEqual(1);
    }
    expect(new Set(ts.map((t) => padPulseAlpha(t, false))).size).toBeGreaterThan(5);
    const w = waitInto(
      emptyWait(),
      { waitingForFirstBuild: true, waitingForCrewBuild: false, parts: [], wires: [], dead: [] },
      0.3,
      true,
    );
    expect(w).toMatchObject({ portLit: true, blinking: false });
  });

  it('tumbles cubes off the waiting port from a fixed pool, and none when nothing waits', () => {
    const pool = new TumblePool();
    expect(pool.items).toHaveLength(TUMBLE_MAX);
    const items = pool.items;
    for (let i = 0; i < 120; i++) pool.step(1 / 60, 9, GATEWAY_OUT);
    expect(pool.items).toBe(items);
    expect(pool.items).toHaveLength(TUMBLE_MAX);
    // About 9 a second, each alive under a second.
    expect(pool.active).toBeGreaterThanOrEqual(6);
    expect(pool.active).toBeLessThanOrEqual(10);
    const at = { x: 0, y: 0 };
    for (const p of pool.items.filter((x) => x.active)) {
      pool.at(p, at);
      expect(at.x).toBeGreaterThanOrEqual(GATEWAY_OUT.x);
      expect(p.age).toBeLessThan(TUMBLE_LIFE);
    }
    for (let i = 0; i < 60; i++) pool.step(1 / 60, 0, null);
    expect(pool.active).toBe(0);
  });
});
