// Viewer tips: the stream's donations, Session 0's only income (Rolando, 30 Oct 2026). Pure: the
// play's clock and facts come in, the tips this tick and the next tip state go out. Who tipped and
// what they wrote is the HUD's business (it picks a handle and a message from the tip's number).

import { BROWNOUT } from './brownout';
import { seededIndex } from './failures';

const T = BROWNOUT.tips;

export type TipKind = 'first' | 'recovered' | 'rescue' | 'midnight' | 'trickle' | 'help';

export interface Tip {
  /** Sim seconds it came in. */
  readonly at: number;
  readonly amount: number;
  readonly kind: TipKind;
  /** 0, 1, 2... in the order they came, for the HUD's pick of handle and message. */
  readonly n: number;
}

export interface TipState {
  readonly tips: readonly Tip[];
  readonly served: boolean;
  /** When the next trickle tip is due, or null before the first serve. */
  readonly trickleAt: number | null;
  /** When the current failing spell started, and whether it lasted long enough to thank for. */
  readonly errSince: number | null;
  readonly spellLong: boolean;
  readonly calmSince: number | null;
  readonly recoveredAt: number;
  readonly helpAt: number;
}

export const NO_TIPS: TipState = {
  tips: [],
  served: false,
  trickleAt: null,
  errSince: null,
  spellLong: false,
  calmSince: null,
  recoveredAt: -Infinity,
  helpAt: -Infinity,
};

/** What the tips read from one tick of the play. */
export interface TipFacts {
  /** Sim seconds at the end of the tick. */
  readonly t: number;
  readonly seed: number;
  /** Requests served this tick (req/s). */
  readonly served: number;
  /** Share of requests dropped (0 to 1). */
  readonly errorShare: number;
  readonly credits: number;
  /** The crew arrived on this tick. */
  readonly rescued: boolean;
  /** Midnight was held on this tick. */
  readonly held: boolean;
  /** Before midnight: a help tip still matters. */
  readonly beforeMidnight: boolean;
  /**
   * What the move that would help costs: a bigger server while the gateway can feed only one (no
   * load balancer yet, a server still without the kit), else another server. Missing means a server.
   */
  readonly helpPrice?: number;
}

/** The same seed and tip number always give the same pick of n. */
const pick = (seed: number, k: number, n: number): number => seededIndex(seed + k * 7919, n);

function trickleDelay(seed: number, k: number): number {
  const { minSeconds, maxSeconds } = T.trickle;
  return minSeconds + pick(seed, k, maxSeconds - minSeconds + 1);
}

function trickleAmount(seed: number, k: number): number {
  const { min, max, step } = T.trickle;
  return min + step * pick(seed, k + 1000, Math.floor((max - min) / step) + 1);
}

/** The tips after one tick, and the tips it brought (in the order they came). Never mutates. */
export function stepTips(s: TipState, f: TipFacts): { state: TipState; given: readonly Tip[] } {
  const given: Tip[] = [];
  let st: TipState = s;
  const give = (kind: TipKind, amount: number): void => {
    const tip: Tip = { at: f.t, amount, kind, n: st.tips.length };
    st = { ...st, tips: [...st.tips, tip] };
    given.push(tip);
  };

  if (!st.served && f.served > 0) {
    give('first', T.milestone.first);
    st = { ...st, served: true, trickleAt: f.t + trickleDelay(f.seed, 0) };
  }

  // A failing spell, then calm: the lights are back.
  const failing = f.errorShare > 0;
  if (failing) {
    const errSince = st.errSince ?? f.t;
    st = {
      ...st,
      errSince,
      calmSince: null,
      spellLong: st.spellLong || f.t - errSince >= T.recover.spellSeconds,
    };
  } else if (st.errSince !== null || st.calmSince === null) {
    st = { ...st, errSince: null, calmSince: st.calmSince ?? f.t };
  }
  if (
    !failing &&
    st.spellLong &&
    st.calmSince !== null &&
    f.t - st.calmSince >= T.recover.calmSeconds &&
    f.t - st.recoveredAt >= T.recover.cooldownSeconds
  ) {
    give('recovered', T.milestone.recovered);
    st = { ...st, spellLong: false, recoveredAt: f.t };
  } else if (!failing && st.spellLong && f.t - st.recoveredAt < T.recover.cooldownSeconds) {
    st = { ...st, spellLong: false };
  }

  if (f.rescued) give('rescue', T.milestone.rescue);
  if (f.held) give('midnight', T.milestone.midnight);

  // Failing and broke: a viewer covers the move that would help, plus a little.
  const price = f.helpPrice ?? BROWNOUT.server.cost;
  if (
    f.beforeMidnight &&
    failing &&
    st.errSince !== null &&
    f.t - st.errSince >= T.help.afterSeconds &&
    f.credits < price &&
    f.t - st.helpAt >= T.help.cooldownSeconds
  ) {
    const need = price - Math.max(0, f.credits) + T.help.extra;
    give('help', Math.ceil(need / T.trickle.step) * T.trickle.step);
    st = { ...st, helpAt: f.t };
  }

  // The trickle, while nothing fails.
  if (st.trickleAt !== null && f.t >= st.trickleAt) {
    const k = st.tips.length;
    if (!failing) give('trickle', trickleAmount(f.seed, k));
    st = { ...st, trickleAt: f.t + trickleDelay(f.seed, k + 1) };
  }

  return given.length === 0 && st === s ? { state: s, given } : { state: st, given };
}

/** Credits the tips brought in all. */
export function tipTotal(s: TipState): number {
  let n = 0;
  for (const t of s.tips) n += t.amount;
  return n;
}
