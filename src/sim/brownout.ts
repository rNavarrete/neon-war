// Session 0 (Brownout): every number from docs/GAME.md's "Rules and numbers" and "Flow", in one
// object so Rolando can tune them by playing. No other file in src/sim/ hard-codes these numbers;
// the rules read them from here. Times are seconds since the session clock opened at 23:51:30.

import type { BoardRules } from './board';

export const BROWNOUT = {
  clock: {
    opensAt: '23:51:30',
    secondsPerMinute: 60,
    /** Seconds since the clock opened when midnight lands (8:30 in). */
    midnight: 510,
  },

  /** When each challenge starts, from GAME.md's Flow table. */
  challenges: { c0: 0, c1: 15, c2: 90, c3: 180, c4: 300, c5: 360, c6: 450, c7: 510, c8: 540 },

  block: { flats: 120, callEverySeconds: 4 },

  server: { capacity: 60, cost: 80, bootSeconds: 3 },
  overclock: { cost: 60, factor: 2, rebootSeconds: 3 },
  database: { capacity: 200 },
  loadBalancer: { cost: 0 },
  /** Share of a part's price given back on decommission: half (the B2a ticket; GAME.md is silent). */
  decommissionRefund: 0.5,

  demand: {
    /** Evening climb (C3): ramps from the block's base to this over climbRampSeconds, then holds. */
    climb: 90,
    climbRampSeconds: 60,
    /** District surge (C4). */
    surge: 250,
    surgeWithRetries: 375,
    /** Surge tail (C5). */
    tail: 120,
    /** Final surge (C6): climbs from the tail to this, peaking at midnight. */
    final: 150,
    /** After midnight (C7): falls from the final surge to this within afterMidnightFallSeconds. */
    afterMidnight: 40,
    afterMidnightFallSeconds: 20,
    /** A surge's number is forecast at least this long before it starts. */
    forecastLeadSeconds: 10,
    laundryCut: 40,
  },

  credits: { starting: 400, upkeepPerServerPerMinute: 5 },

  trust: { starting: 100, max: 100, drainPerSecondAtFullErrors: 10, recoverPerSecond: 1 },

  ozzie: { front: 100, coverCap: 200 },

  solace: {
    cost: 200,
    durationSeconds: 60,
    /** Extra req/s while the banner runs. GAME.md doesn't set it: a draft for Rolando. */
    extraCapacity: 60,
  },

  // Failure rules below are B1b's; their numbers live here so the whole table is in one place.
  overheat: { overloadSeconds: 8 },
  retries: { maxDemandRise: 0.5 },
  powerDip: { warningSeconds: 2, darkSeconds: 20, beforeMidnightSeconds: 10 },
  regroup: { speed: 0.25, seconds: 10, charges: 1 },
  rescue: { trustBelow: 30, surgeSeconds: 45 },
  finalSizing: { holds: 4, holdsWithFastReplacement: 3, drops: 2, waste: 5 },
} as const;

/** The board's plumbing rules for Session 0, built from BROWNOUT. */
export const BROWNOUT_RULES: BoardRules = {
  cost: { server: BROWNOUT.server.cost },
  refund: BROWNOUT.decommissionRefund,
  capacity: { server: BROWNOUT.server.capacity, database: BROWNOUT.database.capacity },
  wiring: { gateway: ['balancer', 'server'], balancer: ['server'], server: ['database'], database: [] },
  // The gateway feeds one part only.
  maxOut: { gateway: 1 },
  healthCheck: ['balancer'],
  upgrade: { kinds: ['server'], cost: BROWNOUT.overclock.cost, factor: BROWNOUT.overclock.factor },
};
