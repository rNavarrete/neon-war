// The demand-versus-capacity chart's memory: the last 60 s of sim time in fixed buckets, held in
// preallocated typed arrays so the chart can be fed and drawn every frame without allocating.
// The newest bucket is overwritten every frame, so the line's tip moves every frame.

import { BROWNOUT } from '../../sim/brownout';
import { SURGES, type Surge, demandAt } from '../../sim/demand';
import type { Rect } from '../live/layout';
import { chartCeiling } from './format';
import { DEMAND_SCALE_MAX } from './thresholds';

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

// ---- the scope around the ring (gauges-6): its layout, time axis, ceiling and forecast ----
//
// Pure: no Phaser, time comes in as `now`.

/** Seconds of the past the scope shows (LAST 60 s), and of the future the forecast region shows. */
export const SCOPE_PAST_SECONDS = 60;
export const SCOPE_AHEAD_SECONDS = BROWNOUT.demand.forecastLeadSeconds;

/** The plot inside the scope, as edges, and where the scope's words sit. */
export interface ScopeLayout {
  readonly plot: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  /** The playhead: now, with the past to its left and the forecast region to its right. */
  readonly playhead: number;
  readonly title: { readonly x: number; readonly y: number };
  /** The ceiling's number, right-aligned. */
  readonly top: { readonly right: number; readonly y: number };
  readonly legend: { readonly x: number; readonly y: number };
  /** The 'racked, not fed' note, right-aligned on the legend's line. */
  readonly racked: { readonly right: number; readonly y: number };
}

/**
 * The scope laid out in `rect` (ZONES.scope, 408 x 180): a 354 x 145 plot at x rect.x + 30 ..
 * rect.x + 384, y rect.y + 15 .. rect.y + 160 (the same as hud/layout.ts LEFT.plot), the playhead
 * 60/70 of the way across so the last 10 s are the forecast region.
 */
export function scopeLayout(rect: Rect): ScopeLayout {
  const left = rect.x + 30;
  const right = rect.x + 384;
  return {
    plot: { left, right, top: rect.y + 15, bottom: rect.y + 160 },
    playhead: left + ((right - left) * SCOPE_PAST_SECONDS) / (SCOPE_PAST_SECONDS + SCOPE_AHEAD_SECONDS),
    title: { x: left, y: rect.y + 1 },
    top: { right, y: rect.y + 1 },
    legend: { x: left, y: rect.y + 163 },
    racked: { right, y: rect.y + 163 },
  };
}

/** The x of sim time `t` on the plot when the playhead is at `now`. */
export function scopeX(L: ScopeLayout, t: number, now: number): number {
  return L.playhead + ((t - now) / SCOPE_PAST_SECONDS) * (L.playhead - L.plot.left);
}

/** The y of `v` req/s under `ceiling`, clamped to the plot. */
export function scopeY(L: ScopeLayout, v: number, ceiling: number): number {
  const k = Math.min(Math.max(v, 0), ceiling) / ceiling;
  return L.plot.bottom - k * (L.plot.bottom - L.plot.top);
}

/**
 * The top of the scope's y axis: the chart step over the highest value it has to show, never past
 * the shared demand scale's 400.
 */
export function scopeCeiling(highest: number): number {
  return Math.min(chartCeiling(highest), DEMAND_SCALE_MAX);
}

/** The forecast region: the next rise's start and number, and the highest demand in the region. */
export interface ScopeForecast {
  /** Sim time the rise starts. */
  startsAt: number;
  /** The rise's number, req/s. */
  demand: number;
  /** The highest demandAt(t) for t in [now, now + 10]. */
  peak: number;
}

/** demandAt is sampled this often across the forecast region. */
export const FORECAST_STEP_SECONDS = 0.5;

/**
 * The forecast region at `now`, written into `out`: non-null exactly while forecastAt(now) is, and
 * null otherwise. Allocates nothing.
 */
export function scopeForecastInto(out: ScopeForecast, now: number): ScopeForecast | null {
  // forecastAt(now) without its closure: the first surge still ahead, if within the lead.
  let f: Surge | null = null;
  for (let i = 0; i < SURGES.length; i++) {
    if (SURGES[i].startsAt > now) {
      f = SURGES[i];
      break;
    }
  }
  if (!f || f.startsAt - now > SCOPE_AHEAD_SECONDS) return null;
  out.startsAt = f.startsAt;
  out.demand = f.demand;
  let peak = 0;
  for (let t = now; t <= now + SCOPE_AHEAD_SECONDS + 1e-9; t += FORECAST_STEP_SECONDS) {
    peak = Math.max(peak, demandAt(t));
  }
  out.peak = peak;
  return out;
}

/** The forecast region at `now`, or null (for tests). */
export function scopeForecast(now: number): ScopeForecast | null {
  return scopeForecastInto({ startsAt: 0, demand: 0, peak: 0 }, now);
}
