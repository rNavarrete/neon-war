import { ChartRing } from '../src/scenes/hud/chartRing';

describe('chart ring buffer', () => {
  it('holds one window of buckets and drops the oldest', () => {
    const ring = new ChartRing(60, 0.25);
    expect(ring.size).toBe(241);
    for (let t = 0; t <= 100; t += 0.25) ring.push(t, t, 2 * t);
    expect(ring.count).toBe(ring.size);
    expect(ring.timeAt(ring.count - 1)).toBe(100);
    expect(ring.timeAt(0)).toBe(40);
    expect(ring.lastDemand).toBe(100);
    expect(ring.lastCapacity).toBe(200);
    expect(ring.max()).toBe(200);
  });

  it('overwrites the newest bucket within one interval, so the tip moves every frame', () => {
    const ring = new ChartRing(60, 0.25);
    ring.push(10, 30, 60);
    ring.push(10.1, 31, 60);
    ring.push(10.2, 32, 0);
    expect(ring.count).toBe(1);
    expect(ring.lastDemand).toBe(32);
    expect(ring.lastCapacity).toBe(0);
  });

  it('fills skipped buckets after a long frame, at most one window', () => {
    const ring = new ChartRing(10, 1);
    ring.push(0, 1, 1);
    ring.push(3, 5, 5);
    expect(ring.count).toBe(4);
    expect([0, 1, 2, 3].map((i) => ring.timeAt(i))).toEqual([0, 1, 2, 3]);
    ring.push(1000, 9, 9);
    expect(ring.count).toBe(ring.size);
    expect(ring.timeAt(ring.count - 1)).toBe(1000);
    expect(ring.timeAt(0)).toBe(1000 - ring.size + 1);
  });

  it('clears when the clock goes backwards (a rewind)', () => {
    const ring = new ChartRing(60, 0.25);
    ring.push(100, 250, 120);
    ring.push(101, 250, 120);
    ring.push(50, 30, 60);
    expect(ring.count).toBe(1);
    expect(ring.lastDemand).toBe(30);
  });

  it('allocates nothing after construction: the same typed arrays are reused', () => {
    const ring = new ChartRing(60, 0.25);
    const arrays = Object.values(ring).filter((v) => ArrayBuffer.isView(v));
    for (let t = 0; t < 500; t += 0.016) ring.push(t, 1, 1);
    expect(Object.values(ring).filter((v) => ArrayBuffer.isView(v))).toEqual(arrays);
    expect(arrays.length).toBe(3);
  });
});
