// Session 0 (Brownout): every number from docs/GAME.md's "Rules and numbers" and "Flow", in one
// object so Rolando can tune them by playing. No other file in src/sim/ hard-codes these numbers;
// the rules read them from here. Times are seconds since the session clock opened at 23:54:25.

import type { BoardRules } from './board';

export const BROWNOUT = {
  clock: {
    opensAt: '23:54:25',
    secondsPerMinute: 60,
    /** Seconds since the clock opened when midnight lands (5:35 in; Rolando 29 Oct 2026: fewer dead stretches). */
    midnight: 335,
  },

  /** When each challenge starts, from GAME.md's Flow table. */
  challenges: { c0: 0, c1: 15, c2: 45, c3: 90, c4: 165, c5: 215, c6: 275, c7: 335, c8: 365 },

  block: { flats: 120, callEverySeconds: 4 },

  server: { capacity: 60, cost: 80, bootSeconds: 3 },
  overclock: { cost: 60, factor: 2, rebootSeconds: 3 },
  database: { capacity: 200 },
  loadBalancer: { cost: 0 },
  /** Share of a part's price given back on decommission: half (Rolando, 27 Oct 2026). */
  decommissionRefund: 0.5,

  demand: {
    /** Evening climb (C3): ramps from the block's base to this over climbRampSeconds, then holds. */
    climb: 90,
    climbRampSeconds: 45,
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

  /**
   * Viewer tips, the stream's donations (Rolando, 30 Oct 2026: earn credits the way streamers do).
   * Milestones: the first serve, the lights back after a failing spell, the rescue, a held midnight.
   * A trickle every 20 to 40 s while nothing fails. And when the block is failing and a server is out
   * of reach, a viewer sends what it takes plus a little, so the player is never left with no move.
   */
  tips: {
    milestone: { first: 40, recovered: 30, rescue: 50, midnight: 100 },
    /** Errors held this long, then calm this long, earn the recovered tip (at most once per cooldown). */
    recover: { spellSeconds: 3, calmSeconds: 3, cooldownSeconds: 30 },
    trickle: { minSeconds: 20, maxSeconds: 40, min: 5, max: 20, step: 5 },
    /** Failing this long with less than a server's price: a viewer covers it, plus `extra`. */
    help: { afterSeconds: 4, extra: 10, cooldownSeconds: 20 },
  },

  solace: {
    cost: 200,
    durationSeconds: 60,
    /** Extra req/s while the banner runs. GAME.md doesn't set it: a draft for Rolando. */
    extraCapacity: 60,
  },

  // Failure rules below are B1b's; their numbers live here so the whole table is in one place.
  overheat: { overloadSeconds: 8 },
  /**
   * Failed requests come back: demand rises toward the error share, capped at maxDemandRise, by
   * risePerSecond while errors last, and falls back by fallPerSecond when they stop. The rates are
   * drafts for Rolando: GAME.md only sets the cap.
   */
  retries: { maxDemandRise: 0.5, risePerSecond: 0.05, fallPerSecond: 0.1 },
  powerDip: { warningSeconds: 2, darkSeconds: 20, beforeMidnightSeconds: 10 },
  /**
   * Regroup: quarter speed for 10 s, once. Kept for a later session but not handed over in Session 0
   * (Rolando, 29 Oct 2026: "cool but maybe not a mechanic for the tutorial stage").
   */
  regroup: { speed: 0.25, seconds: 10, charges: 1, inSession: false },
  rescue: { trustBelow: 30, surgeSeconds: 40 },
  finalSizing: { holds: 4, holdsWithFastReplacement: 3, drops: 2, waste: 5 },
  /** The C4 script: the power dip takes the overclocked server dark this long into the surge (a draft). */
  surgeScript: { dipAfterSeconds: 5 },
  /**
   * The table's grid (src/sim/grid.ts): the painted silkscreen's squares, the cells each kind
   * covers, where the fixed parts stand on it (`fixed`: each one's anchor cell; the gateway near the
   * left side, the database near the right, both on the first server spots' port row), the racks (bands of `rackColumns` columns, each on its own power feed), where the
   * crew rack their splitter, and the suggested server spots (one per rack along each row in turn).
   */
  board: {
    cols: 28,
    rows: 19,
    footprint: {
      server: { w: 2, h: 2 },
      balancer: { w: 2, h: 1 },
      gateway: { w: 2, h: 2 },
      database: { w: 3, h: 2 },
    },
    fixed: { gateway: { col: 0, row: 11 }, database: { col: 25, row: 11 } },
    racks: ['A', 'B', 'C', 'D'],
    rackColumns: 7,
    balancerSpot: { col: 5, row: 12 },
    serverSpots: { cols: [3, 9, 16, 22], rows: [11, 5, 15] },
  },
  /** C7: decommissioning down to this many servers counts as scaling down in the debrief. */
  scaleDown: { to: 2 },
  /**
   * How `step` cuts time: no sim tick is longer than maxStepSeconds, so a big step plays out the same
   * as many small ones; times closer than timeEpsilon count as equal (floating-point slack).
   */
  sim: { maxStepSeconds: 0.1, timeEpsilon: 1e-9 },
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
