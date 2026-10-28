// The channel the block's traffic arrives along (board-4): how full it is, where the ROOM tick and
// the forecast level sit, the red retry band on top of the fill, the bank marks at the mouth and
// how many cubes a second stream in. Pure: no Phaser, no clock; BoardScene draws from it and the
// test hook mirrors it.
//
// Everything sits on the one demand scale the Live screen shares (DEMAND_SCALE_MAX 400, contract
// 'thresholds'), so 375 reads the same on the gauge's needle and the channel. The ROOM tick sits on
// wired capacity (Frame.wiredCapacity, the same rule as headroom.ts), never run().capacity, which
// counts servers nothing feeds.

import type { SurgeWarning } from '../hud/warnings';
import { DEMAND_SCALE_MAX } from '../hud/thresholds';
import { CHANNEL, channelAt } from './layout';
import { INBOUND_STAGGER, PACKETS_PER_REQUEST } from './packets';

/** The top of the channel's bank, in req/s: the shared demand scale. */
export const CHANNEL_MAX = DEMAND_SCALE_MAX;

export interface BankMark {
  /** Req/s the mark stands for. */
  readonly value: number;
  /** The words engraved beside it. */
  readonly label: string;
}

/** The five bank marks at the mouth, bottom to top: 0, a quarter, a half, three quarters, the top. */
export const BANK_MARKS: readonly BankMark[] = [
  { value: 0, label: '0' },
  { value: CHANNEL_MAX / 4, label: '1/4' },
  { value: CHANNEL_MAX / 2, label: '1/2' },
  { value: (CHANNEL_MAX * 3) / 4, label: '3/4' },
  { value: CHANNEL_MAX, label: 'MAX' },
];

/** How full the channel runs: demand on the 0..400 bank, never past the top. */
export function channelLevel(demand: number): number {
  if (!(demand > 0)) return 0;
  return Math.min(1, demand / CHANNEL_MAX);
}

/** Where the ROOM tick sits: the wired boxes' req/s on the same bank (may pass 1; drawn clamped). */
export function capacityLevel(wiredCapacity: number): number {
  if (!(wiredCapacity > 0)) return 0;
  return wiredCapacity / CHANNEL_MAX;
}

/**
 * The dashed forecast level: the coming surge's number on the bank while its warning is up and it
 * has not landed yet (Frame.surge), else null.
 */
export function forecastLevel(surge: Pick<SurgeWarning, 'surge' | 'inSeconds'> | null): number | null {
  if (!surge || surge.inSeconds <= 0) return null;
  return channelLevel(surge.surge.demand);
}

/** The red band on top of the fill: the share of what comes in that is people trying again. */
export function retryShare(retry: number): number {
  if (!(retry > 0)) return 0;
  return retry / (1 + retry);
}

/**
 * Cubes a second streaming into the channel for `demand` req/s, all lanes together: piecewise
 * linear through (30, 3) (90, 9) (150, 15) (250, 24) (375, 36), so the C4 surge with and without
 * retries look different; past 375 it carries on at the last slope.
 */
export const LANE_RATE_POINTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [30, 3],
  [90, 9],
  [150, 15],
  [250, 24],
  [375, 36],
];

export function inboundLaneRates(demand: number): number {
  if (!(demand > 0)) return 0;
  const pts = LANE_RATE_POINTS;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (demand <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (demand - x0)) / (x1 - x0);
    }
  }
  const [xa, ya] = pts[pts.length - 2];
  const [xb, yb] = pts[pts.length - 1];
  return yb + ((yb - ya) * (demand - xb)) / (xb - xa);
}

/** Cubes a second on lane `i` of `n` for `demand` req/s: the lanes share them a little out of step. */
export function lanePps(demand: number, i: number, n: number): number {
  if (n <= 0) return 0;
  const len = INBOUND_STAGGER.length;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += INBOUND_STAGGER[k % len];
  return (inboundLaneRates(demand) * INBOUND_STAGGER[i % len]) / sum;
}

/**
 * Overwrite the inbound lanes' entries in a packet-rate map (as fillPacketRates left it) so the
 * PacketPool, which turns req/s into packets with PACKETS_PER_REQUEST, launches lanePps cubes a
 * second on each. Writes in place and returns `out`; allocates nothing.
 */
export function fillInboundRates(
  out: Record<string, number>,
  demand: number,
  inboundKeys: readonly string[],
): Record<string, number> {
  const n = inboundKeys.length;
  for (let i = 0; i < n; i++) out[inboundKeys[i]] = lanePps(demand, i, n) / PACKETS_PER_REQUEST;
  return out;
}

/** The channel's state for one frame, refilled in place (channelInto) so drawing allocates nothing. */
export interface ChannelState {
  demand: number;
  max: number;
  level: number;
  capacityLevel: number;
  forecast: number | null;
  retryShare: number;
  /** Cubes a second streaming in, all lanes together. */
  lanePps: number;
}

export function emptyChannel(): ChannelState {
  return {
    demand: 0,
    max: CHANNEL_MAX,
    level: 0,
    capacityLevel: 0,
    forecast: null,
    retryShare: 0,
    lanePps: 0,
  };
}

/** What the channel reads from the Frame. */
export interface ChannelInput {
  readonly demand: number;
  readonly wiredCapacity: number;
  readonly retry: number;
  readonly surge: Pick<SurgeWarning, 'surge' | 'inSeconds'> | null;
}

/** Refill `out` from this frame and return it. */
export function channelInto(out: ChannelState, f: ChannelInput): ChannelState {
  out.demand = f.demand;
  out.max = CHANNEL_MAX;
  out.level = channelLevel(f.demand);
  out.capacityLevel = capacityLevel(f.wiredCapacity);
  out.forecast = forecastLevel(f.surge);
  out.retryShare = retryShare(f.retry);
  out.lanePps = inboundLaneRates(f.demand);
  return out;
}

/** The channel's state for one frame, as a new object. */
export function channelState(f: ChannelInput): ChannelState {
  return channelInto(emptyChannel(), f);
}

/**
 * The y of a level (0 at the floor, 1 at the top bank) across the channel at x: the channel narrows
 * from the mouth to the gateway's port, so the same level sits lower and higher in the walls there.
 * Levels past 1 are drawn at the top bank.
 */
export function levelY(level: number, x: number): number {
  const k = Math.max(0, Math.min(1, level));
  const w = channelAt(x);
  return w.bottom - k * (w.bottom - w.top);
}

/** Where each bank mark's label sits at the mouth, in game pixels: bottom to top. */
export const MARK_X = CHANNEL.mouth.x + 6;

export function bankMarkPoints(): { label: string; value: number; x: number; y: number }[] {
  return BANK_MARKS.map((m) => ({
    label: m.label,
    value: m.value,
    x: MARK_X,
    y: levelY(m.value / CHANNEL_MAX, CHANNEL.mouth.x),
  }));
}
