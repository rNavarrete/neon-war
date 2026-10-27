// The demand-versus-capacity chart's memory: the last 60 s of sim time in fixed buckets, held in
// preallocated typed arrays so the chart can be fed and drawn every frame without allocating.
// The newest bucket is overwritten every frame, so the line's tip moves every frame.

export class ChartRing {
  readonly size: number;
  /** Seconds of sim time per bucket. */
  readonly interval: number;
  private readonly t: Float64Array;
  private readonly d: Float32Array;
  private readonly c: Float32Array;
  /** Index of the newest sample, and how many samples are held. */
  private head = -1;
  private n = 0;
  private lastBucket = -Infinity;

  constructor(windowSeconds = 60, interval = 0.25) {
    this.size = Math.ceil(windowSeconds / interval) + 1;
    this.interval = interval;
    this.t = new Float64Array(this.size);
    this.d = new Float32Array(this.size);
    this.c = new Float32Array(this.size);
  }

  get count(): number {
    return this.n;
  }

  /** Forget everything (a rewind moves the clock backwards). */
  clear(): void {
    this.head = -1;
    this.n = 0;
    this.lastBucket = -Infinity;
  }

  /** Record demand and capacity at sim time `now`. Going back in time clears the chart. */
  push(now: number, demand: number, capacity: number): void {
    if (this.n > 0 && now < this.t[this.head]) this.clear();
    const bucket = Math.floor(now / this.interval);
    if (bucket === this.lastBucket) {
      this.write(this.head, now, demand, capacity);
      return;
    }
    // A long jump fills at most one window of buckets.
    const steps = Math.min(this.size, this.n === 0 ? 1 : bucket - this.lastBucket);
    for (let i = steps - 1; i >= 0; i--) {
      this.head = (this.head + 1) % this.size;
      if (this.n < this.size) this.n++;
      this.write(this.head, i === 0 ? now : (bucket - i) * this.interval, demand, capacity);
    }
    this.lastBucket = bucket;
  }

  /** Sample i, oldest first (0 .. count-1). */
  timeAt(i: number): number {
    return this.t[this.index(i)];
  }

  demandAt(i: number): number {
    return this.d[this.index(i)];
  }

  capacityAt(i: number): number {
    return this.c[this.index(i)];
  }

  get lastDemand(): number {
    return this.n > 0 ? this.d[this.head] : 0;
  }

  get lastCapacity(): number {
    return this.n > 0 ? this.c[this.head] : 0;
  }

  /** The highest demand or capacity held. */
  max(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, this.d[i], this.c[i]);
    return m;
  }

  private index(i: number): number {
    return (this.head - this.n + 1 + i + this.size) % this.size;
  }

  private write(at: number, now: number, demand: number, capacity: number): void {
    this.t[at] = now;
    this.d[at] = demand;
    this.c[at] = capacity;
  }
}
