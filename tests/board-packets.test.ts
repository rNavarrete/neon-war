import {
  INBOUND_STAGGER,
  MAX_PACKETS_PER_SECOND,
  fillPacketRates,
  PACKETS_PER_REQUEST,
  PacketPool,
  maxInFlight,
  packetsPerSecond,
  progress,
  travelSeconds,
} from '../src/scenes/board/packets';
import {
  HOT_SPEED,
  MAX_SPARKS_PER_SECOND,
  RETURN_PREFIX,
  SPARK_LIFE,
  SparkPool,
  dropsInto,
  isReturnKey,
  retryBirthsInto,
  sparkRate,
  wireSpeed,
} from '../src/scenes/board/packets';
import { type Board, type Part, type Wire, route } from '../src/sim/board';
import { BROWNOUT_RULES } from '../src/sim/brownout';
import { BOARD_AREA, CHANNEL, inPort, returnPath } from '../src/scenes/board/layout';

describe('packet spacing', () => {
  it('draws packets in proportion to a wire’s req/s', () => {
    expect(packetsPerSecond(30)).toBeCloseTo(30 * PACKETS_PER_REQUEST);
    expect(packetsPerSecond(60)).toBeCloseTo(2 * packetsPerSecond(30));
    expect(packetsPerSecond(0)).toBe(0);
    expect(packetsPerSecond(-5)).toBe(0);
  });

  it('caps a surge so it stays readable', () => {
    expect(packetsPerSecond(10_000)).toBe(MAX_PACKETS_PER_SECOND);
  });

  it('crosses a wire at a steady speed, never instantly', () => {
    expect(travelSeconds(640)).toBeCloseTo(2 * travelSeconds(320));
    expect(travelSeconds(0)).toBeGreaterThan(0);
  });
});

describe('PacketPool', () => {
  const travel = () => 1.5;

  it('emits packets at the wire’s rate', () => {
    const pool = new PacketPool();
    let emitted = 0;
    let last = 0;
    for (let i = 0; i < 600; i++) {
      pool.step(1 / 60, { 'gateway>s1': 30 }, travel);
      const now = pool.active;
      if (now > last) emitted += now - last;
      last = now;
    }
    // 10 s at 30 req/s: packetsPerSecond(30) leave each second, 1.5 s each, so that many times 1.5 alive.
    expect(pool.active).toBeGreaterThanOrEqual(Math.floor(packetsPerSecond(30) * 1.5));
    expect(pool.active).toBeLessThanOrEqual(maxInFlight(30, 1.5));
    expect(emitted).toBeGreaterThan(0);
  });

  it('stops growing at steady demand, however uneven the frames are', () => {
    const pool = new PacketPool();
    const rates = { 'gateway>s1': 30, 's1>database': 30, 'gateway>s2': 47 };
    // Deterministic jitter: frames between 5 ms and 120 ms.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.115 + 0.005;
    let t = 0;
    while (t < 10) {
      const dt = rand();
      pool.step(dt, rates, travel);
      t += dt;
    }
    const size = pool.size;
    expect(size).toBeGreaterThan(0);
    while (t < 120) {
      const dt = rand();
      pool.step(dt, rates, travel);
      t += dt;
      expect(pool.size).toBe(size);
    }
    const bound = Object.values(rates).reduce((n, r) => n + maxInFlight(r, 1.5), 0);
    expect(size).toBeLessThanOrEqual(bound);
  });

  it('reuses freed packets instead of allocating new ones', () => {
    const pool = new PacketPool();
    for (let i = 0; i < 300; i++) pool.step(1 / 60, { a: 30 }, travel);
    const items = pool.items.slice();
    for (let i = 0; i < 300; i++) pool.step(1 / 60, { a: 30 }, travel);
    expect(pool.items.length).toBe(items.length);
    pool.items.forEach((p, i) => expect(p).toBe(items[i]));
  });

  it('drops packets on a wire that was cut or carries nothing', () => {
    const pool = new PacketPool();
    for (let i = 0; i < 120; i++) pool.step(1 / 60, { a: 30, b: 30 }, travel);
    expect(pool.items.some((p) => p.active && p.wire === 'a')).toBe(true);
    pool.step(1 / 60, { b: 30 }, travel);
    expect(pool.items.some((p) => p.active && p.wire === 'a')).toBe(false);
    pool.step(1 / 60, {}, travel);
    expect(pool.active).toBe(0);
  });

  it('moves packets from 0 to 1 along their wire and frees them at the end', () => {
    const pool = new PacketPool();
    pool.step(0.5, { a: 30 }, travel);
    const p = pool.items.find((x) => x.active)!;
    const before = progress(p);
    pool.step(0.5, { a: 30 }, travel);
    expect(progress(p)).toBeGreaterThan(before);
    expect(progress(p)).toBeLessThanOrEqual(1);
    // Keep the packet's identity: stop emitting and let it run out.
    pool.step(2, { a: 1e-9 }, travel);
    expect(p.active).toBe(false);
  });

  it('clear() empties the board without shrinking the pool', () => {
    const pool = new PacketPool();
    for (let i = 0; i < 120; i++) pool.step(1 / 60, { a: 60 }, travel);
    const size = pool.size;
    pool.clear();
    expect(pool.active).toBe(0);
    expect(pool.size).toBe(size);
  });
});

describe('packet rates refilled in place (board-3)', () => {
  const lanes = ['inbound0', 'inbound1', 'inbound2'];

  it('refills the same object with the wires and the inbound lanes', () => {
    const out: Record<string, number> = {};
    const a = fillPacketRates(out, { 'gateway>s': 30 }, 60, lanes);
    expect(a).toBe(out);
    expect(a['gateway>s']).toBe(30);
    // The lanes share the demand, each a little out of step.
    for (let i = 0; i < lanes.length; i++) expect(a[lanes[i]]).toBeCloseTo((60 * INBOUND_STAGGER[i]) / 3);
    // A wire that stopped carrying reads 0, which the pool treats as missing.
    const b = fillPacketRates(out, { 's>database': 20 }, 0, lanes);
    expect(b).toBe(out);
    expect(b['gateway>s']).toBe(0);
    expect(b['s>database']).toBe(20);
    expect(b.inbound1).toBe(0);
  });

  it('drops a zeroed wire’s packets exactly as a missing one, and the pool stops growing', () => {
    const travel = () => 1;
    const zeroed = new PacketPool();
    const missing = new PacketPool();
    const rates: Record<string, number> = {};
    for (let i = 0; i < 120; i++) {
      zeroed.step(1 / 60, fillPacketRates(rates, { w: 100 }, 0, []), travel);
      missing.step(1 / 60, { w: 100 }, travel);
    }
    const size = zeroed.size;
    zeroed.step(1 / 60, fillPacketRates(rates, {}, 0, []), travel);
    missing.step(1 / 60, {}, travel);
    expect(zeroed.active).toBe(0);
    expect(missing.active).toBe(0);
    for (let i = 0; i < 120; i++) zeroed.step(1 / 60, fillPacketRates(rates, { w: 100 }, 0, []), travel);
    expect(zeroed.size).toBe(size);
  });
});

// ---- board-7: packets v2 ----------------------------------------------------------------------

const lanes = ['inbound0', 'inbound1', 'inbound2'] as const;
const gw: Part = { id: 'gateway', kind: 'gateway', slot: null };
const db: Part = { id: 'database', kind: 'database', slot: null };
const srv = (id: string, slot: string, boost?: number): Part =>
  boost === undefined ? { id, kind: 'server', slot } : { id, kind: 'server', slot, boost };
const boardOf = (parts: Part[], wires: Wire[]): Board => ({
  credits: 0,
  slots: ['s1', 's2', 's3', 's4', 's5', 's6'],
  parts,
  wires,
  nextId: 1,
});

describe('packets crawl into an overloaded part (board-7)', () => {
  it('runs at half speed into a part over 100%, full speed otherwise', () => {
    expect(HOT_SPEED).toBe(0.5);
    expect(wireSpeed(1.4)).toBe(0.5);
    expect(wireSpeed(1)).toBe(1);
    expect(wireSpeed(0.5)).toBe(1);
    expect(wireSpeed(null)).toBe(1);
  });

  it('speedOf 0.5 halves a packet’s progress per step', () => {
    const travel = () => 2;
    const fast = new PacketPool();
    const slow = new PacketPool();
    fast.step(0.4, { a: 30 }, travel);
    slow.step(0.4, { a: 30 }, travel, { speedOf: () => 0.5 });
    const pf = fast.items.find((p) => p.active)!;
    const ps = slow.items.find((p) => p.active)!;
    const f0 = progress(pf);
    const s0 = progress(ps);
    fast.step(0.5, { a: 30 }, travel);
    slow.step(0.5, { a: 30 }, travel, { speedOf: () => 0.5 });
    expect(progress(ps) - s0).toBeCloseTo((progress(pf) - f0) / 2, 6);
  });

  it('a slowed wire holds more packets but the pool still stops growing and never passes need', () => {
    const pool = new PacketPool();
    const rates = { 'gateway>s1': 250, 's1>database': 60 };
    const opts = { speedOf: (w: string) => (w === 'gateway>s1' ? HOT_SPEED : 1) };
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.1 + 0.005;
    let t = 0;
    while (t < 10) {
      const dt = rand();
      pool.step(dt, rates, () => 1.5, opts);
      t += dt;
    }
    const size = pool.size;
    while (t < 60) {
      const dt = rand();
      pool.step(dt, rates, () => 1.5, opts);
      t += dt;
      expect(pool.size).toBe(size);
      expect(pool.size).toBeLessThanOrEqual(pool.need);
    }
    // Half speed holds about twice the packets on the slowed wire.
    expect(pool.need).toBe(maxInFlight(250, 3) + maxInFlight(60, 1.5));
  });
});

describe('retries come back from the part that dropped them (board-7)', () => {
  const travel = (w: string) => (isReturnKey(w) ? 2 : 1);

  it('a return path cube is born red, runs back, and re-enters on an inbound lane still red', () => {
    const pool = new PacketPool();
    const back = `${RETURN_PREFIX}server-p1`;
    pool.step(0.5, { [back]: 30 }, travel, { reenter: lanes });
    const p = pool.items.find((x) => x.active)!;
    expect(p.wire).toBe(back);
    expect(p).toMatchObject({ returning: true, red: true });
    expect(pool.born).toBe(1);
    // Keep stepping with nothing more born: the cube reaches the mouth and comes in again.
    pool.step(2, { [back]: 1e-9, inbound0: 30, inbound1: 30, inbound2: 30 }, travel, { reenter: lanes });
    expect(p.active).toBe(true);
    expect(lanes).toContain(p.wire as (typeof lanes)[number]);
    expect(p).toMatchObject({ returning: false, red: true });
    expect(p.age).toBe(0);
    expect(pool.reentered).toBe(1);
  });

  it('a retry already going back finishes its trip when its part stops dropping', () => {
    const pool = new PacketPool();
    const back = `${RETURN_PREFIX}s`;
    pool.step(0.5, { [back]: 30 }, travel, { reenter: lanes });
    const p = pool.items.find((x) => x.active)!;
    pool.step(0.5, {}, travel, { reenter: lanes });
    expect(p.active).toBe(true);
    expect(p.returning).toBe(true);
  });

  it('never spawns a red cube at the mouth: lane cubes are born amber, red only after a return', () => {
    const pool = new PacketPool();
    const rates: Record<string, number> = { inbound0: 200, inbound1: 200, inbound2: 200 };
    let redOnLane = 0;
    for (let i = 0; i < 600; i++) {
      // Retries born at one dropping part for the first 5 s, then nothing drops.
      rates[`${RETURN_PREFIX}s1`] = i < 300 ? 60 : 0;
      pool.step(1 / 60, rates, travel, { reenter: lanes });
      for (const p of pool.items) if (p.active && p.red && !p.returning) redOnLane++;
      // Every red cube on a lane came back from a part: never more than have re-entered.
      const onLanes = pool.items.filter((p) => p.active && p.red && !p.returning).length;
      expect(onLanes).toBeLessThanOrEqual(pool.reentered);
    }
    expect(pool.born).toBeGreaterThan(0);
    expect(pool.reentered).toBeGreaterThan(0);
    expect(redOnLane).toBeGreaterThan(0);
    // Without any return path nothing is ever red.
    const plain = new PacketPool();
    for (let i = 0; i < 300; i++)
      plain.step(1 / 60, { inbound0: 200, inbound1: 200 }, travel, { reenter: lanes });
    expect(plain.red).toBe(0);
    expect(plain.born).toBe(0);
  });

  it('retry births follow what each part drops, and none come from the mouth when nothing drops', () => {
    const out: Record<string, number> = {};
    expect(retryBirthsInto(out, {}, 0.3, 30)).toEqual({});
    expect(retryBirthsInto(out, { s1: 0, gateway: 0 }, 0.3, 30)).toEqual({ s1: 0, gateway: 0 });
    const b = retryBirthsInto(out, { s1: 30, s2: 10, gateway: 0 }, 0.25, 36);
    expect(b).toBe(out);
    expect(b.s1 + b.s2).toBeCloseTo(0.25 * 36, 6);
    expect(b.s1).toBeCloseTo(3 * b.s2, 6);
    expect(b.gateway).toBe(0);
    // No retries: nothing is born even where requests drop.
    const none = retryBirthsInto(out, { s1: 30 }, 0, 36);
    expect(none.s1).toBe(0);
    expect(none.s2).toBe(0);
  });

  it('dropsInto finds the parts the sim drops at, summing to route()’s dropped', () => {
    const cases: { parts: Part[]; wires: Wire[]; demand: number; offline: string[] }[] = [
      // One box over its limit.
      {
        parts: [gw, db, srv('a', 's1')],
        wires: [w('gateway', 'a'), w('a', 'database')],
        demand: 250,
        offline: [],
      },
      // The overclocked box dark in the dip: everything it gets drops.
      {
        parts: [gw, db, srv('a', 's1', 2)],
        wires: [w('gateway', 'a'), w('a', 'database')],
        demand: 250,
        offline: ['a'],
      },
      // A box serving with nowhere to send it, and the gateway unwired.
      { parts: [gw, db, srv('a', 's1')], wires: [w('gateway', 'a')], demand: 30, offline: [] },
      { parts: [gw, db], wires: [], demand: 30, offline: [] },
      // Behind a balancer: one box dark is skipped, the other overloaded.
      {
        parts: [gw, db, { id: 'lb', kind: 'balancer', slot: null }, srv('a', 's1'), srv('b', 's2')],
        wires: [w('gateway', 'lb'), w('lb', 'a'), w('lb', 'b'), w('a', 'database'), w('b', 'database')],
        demand: 150,
        offline: ['a'],
      },
    ];
    for (const c of cases) {
      const flow = route(boardOf(c.parts, c.wires), BROWNOUT_RULES, c.demand, c.offline);
      const drops = dropsInto({}, c.parts, c.wires, flow.load, c.offline, BROWNOUT_RULES);
      const sum = Object.values(drops).reduce((a, x) => a + x, 0);
      expect(sum).toBeCloseTo(flow.dropped, 6);
    }
    // The hot box is where it drops.
    const flow = route(boardOf(cases[0].parts, cases[0].wires), BROWNOUT_RULES, 250, []);
    const drops = dropsInto({}, cases[0].parts, cases[0].wires, flow.load, [], BROWNOUT_RULES);
    expect(drops).toEqual({ gateway: 0, database: 0, a: 190 });
  });

  it('the pool stays bounded at a steady surge with retries going back and coming in again', () => {
    const pool = new PacketPool();
    const rates: Record<string, number> = {
      inbound0: 80,
      inbound1: 100,
      inbound2: 90,
      'gateway>s1': 375,
      's1>database': 120,
      [`${RETURN_PREFIX}s1`]: 90,
    };
    const opts = { reenter: lanes, speedOf: (k: string) => (k === 'gateway>s1' ? HOT_SPEED : 1) };
    const tr = (k: string) => (isReturnKey(k) ? 3.2 : k.startsWith('inbound') ? 0.6 : 1.4);
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.1 + 0.005;
    let t = 0;
    while (t < 15) {
      const dt = rand();
      pool.step(dt, rates, tr, opts);
      t += dt;
    }
    const size = pool.size;
    // Ten more seconds of the same surge: no growth.
    while (t < 25) {
      const dt = rand();
      pool.step(dt, rates, tr, opts);
      t += dt;
      expect(pool.size).toBe(size);
      expect(pool.size).toBeLessThanOrEqual(pool.need);
    }
    expect(pool.red).toBeGreaterThan(0);
    expect(pool.returning).toBeGreaterThan(0);
  });
});

function w(from: string, to: string): Wire {
  return { from, to };
}

describe('the return path (board-7)', () => {
  const parts: Part[] = [
    gw,
    db,
    { id: 'lb', kind: 'balancer', slot: null },
    ...['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => srv(`x-${s}`, s)),
  ];

  it('starts at the dropping part’s in-port and ends at the channel’s mouth, inside the feed', () => {
    for (const p of parts) {
      const path = returnPath(p)!;
      expect(path, p.id).not.toBeNull();
      const end = path[path.length - 1];
      expect(end.x).toBeCloseTo(CHANNEL.mouth.x, -1);
      expect(end.y).toBeGreaterThanOrEqual(CHANNEL.mouth.top);
      expect(end.y).toBeLessThanOrEqual(CHANNEL.mouth.bottom);
      if (p.kind !== 'gateway') expect(path[0]).toEqual(inPort(p));
      for (const q of path) {
        expect(q.x).toBeGreaterThanOrEqual(BOARD_AREA.left);
        expect(q.x).toBeLessThanOrEqual(BOARD_AREA.right);
        expect(q.y).toBeGreaterThanOrEqual(BOARD_AREA.top);
        expect(q.y).toBeLessThanOrEqual(BOARD_AREA.bottom);
      }
      // A retry is born at the part, not at the mouth.
      expect(path[0].x).toBeGreaterThan(CHANNEL.mouth.x + 100);
    }
  });
});

describe('sparks at a dropping port (board-7)', () => {
  it('throws one spark per 10 req/s dropped, at most 6 a second', () => {
    expect(sparkRate(0)).toBe(0);
    expect(sparkRate(-1)).toBe(0);
    expect(sparkRate(30)).toBeCloseTo(3);
    expect(sparkRate(1000)).toBe(MAX_SPARKS_PER_SECOND);
  });

  it('keeps a fixed pool: sparks past its size are skipped and every spark goes out', () => {
    const sp = new SparkPool(8);
    const items = sp.items.slice();
    sp.emit(100, 100, 20);
    expect(sp.active).toBe(8);
    expect(sp.items).toHaveLength(8);
    sp.items.forEach((s, i) => expect(s).toBe(items[i]));
    sp.step(SPARK_LIFE / 2);
    expect(sp.active).toBe(8);
    sp.step(SPARK_LIFE);
    expect(sp.active).toBe(0);
  });
});
