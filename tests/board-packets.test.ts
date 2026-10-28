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
