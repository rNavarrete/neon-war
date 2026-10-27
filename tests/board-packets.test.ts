import {
  MAX_PACKETS_PER_SECOND,
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
    // 10 s at 30 req/s: about 60 packets left, 1.5 s each, so about 9 alive at once.
    expect(pool.active).toBeGreaterThanOrEqual(8);
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
    pool.step(0.2, { a: 30 }, travel);
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
