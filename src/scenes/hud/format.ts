// Small pure helpers the HUD uses to turn sim numbers into what it shows. No Phaser here, so every
// rule is unit-tested in node (tests/hud-format.test.ts).

import { BROWNOUT } from '../../sim/brownout';

/** Whole seconds left until midnight at `now`, rounded up so the display reaches 0 at midnight. */
export function secondsToMidnight(now: number, midnight: number = BROWNOUT.clock.midnight): number {
  return Math.max(0, Math.ceil(midnight - now - 1e-9));
}

/**
 * An hh:mm:ss in-world clock as the player reads it, in 12-hour time: '23:51:45' is '11:51:45 PM',
 * '00:00:00' is '12:00:00 AM' (Rolando, 28 Oct 2026: no 24-hour clock on screen).
 */
export function twelveHour(hms: string): string {
  const [h, m, s] = hms.split(':');
  const hour = Number(h);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m}:${s} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The "midnight in m:ss" countdown: 8:30 when the clock opens, 0:00 from midnight on. */
export function countdownText(now: number, midnight: number = BROWNOUT.clock.midnight): string {
  const left = secondsToMidnight(now, midnight);
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/** Chart scale steps in req/s: the smallest one that fits the highest value plotted. */
export const CHART_STEPS: readonly number[] = [60, 120, 180, 240, 300, 400, 500, 600];

/** The top of the chart's y axis for a highest value `v`, with a little headroom above it. */
export function chartCeiling(v: number, steps: readonly number[] = CHART_STEPS): number {
  const want = v * 1.1;
  for (const s of steps) if (s >= want) return s;
  return steps[steps.length - 1];
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Which chat filler pool the block's error share picks: all fine, some errors, heavy errors. */
export type ErrorState = 'ok' | 'slow' | 'down';

export function errorState(share: number): ErrorState {
  if (share <= 0) return 'ok';
  return share < 0.5 ? 'slow' : 'down';
}
