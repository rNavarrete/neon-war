// One read of the run per sim change, shared by every view on the Live screen. A Frame is a plain
// snapshot of what src/game/run.ts exposes (the sim, the routing, the warnings, the waiting flags)
// so views read fields instead of calling run().flow and re-routing the board each. frame(run)
// memoises: it returns the identical object until the sim or a hold changes, then reads
// everything once more. Pure apart from the memo: no Phaser, no clock; time comes from the run.

import { type Flow, type Part, type Wire, capacityOf, errorShare } from '../sim/board';
import { BROWNOUT_RULES } from '../sim/brownout';
import type { BannerChoice } from '../sim/economy';
import { type PowerDip, type RescueCause, darkParts, laundryCutAvailable } from '../sim/failures';
import type { Failure, Midnight, Play, Rewind } from '../sim/play';
import { type SurgeWarning, fallForecastAt, surgeWarningAt } from '../scenes/hud/warnings';
import type { Run } from './run';

/** The power dip whose 2 s flicker warning is showing: the part it takes and the sim time it goes dark. */
export interface UpcomingDip {
  readonly partId: string;
  readonly at: number;
}

/** The after-midnight forecast on screen: demand falling to `demand`. */
export interface FallForecast {
  readonly demand: number;
}

export interface Frame {
  // ---- the clock ----
  /** Sim seconds since the clock opened at 23:51:30. */
  readonly now: number;
  /** The in-world clock as hh:mm:ss. */
  readonly clock: string;
  /** The test speed multiplier (1 in play). */
  readonly speed: number;
  /** Something holds the board still (a card, a scene, the pause menu) or a failure waits for its rewind. */
  readonly paused: boolean;
  /** 0.25 while Regroup runs, otherwise 1. */
  readonly timeScale: number;
  /** C1 waits for a server wired gateway to database; the clock holds. */
  readonly waitingForFirstBuild: boolean;
  /** After the rescue the clock waits until the servers behind the balancer can carry the tail. */
  readonly waitingForCrewBuild: boolean;

  // ---- the board and its routing ----
  readonly parts: readonly Part[];
  readonly wires: readonly Wire[];
  readonly credits: number;
  readonly trust: number;
  /** Parts booting or rebooting, by id: the sim time they come back. */
  readonly offlineUntil: Readonly<Record<string, number>>;
  /** The routing of this frame's demand over the board, read once. */
  readonly flow: Flow;
  /** Req/s the block sends now, after retries. */
  readonly demand: number;
  /** Req/s the block sends before retries: the curve less the laundry cut. */
  readonly blockDemand: number;
  /** How far retries have pushed demand up, 0 to 0.5. */
  readonly retry: number;
  /** Req/s every live server could serve, wired or not. */
  readonly capacity: number;
  /** Req/s the live servers wired in (fed from the gateway, or a balancer the gateway feeds, and on to the database) can serve. */
  readonly wiredCapacity: number;
  readonly served: number;
  readonly dropped: number;
  /** Share of demand that fails, 0 to 1. */
  readonly errorShare: number;

  // ---- parts in trouble ----
  /** Serving nothing now: booting, rebooting, dead or dark in a dip. */
  readonly offline: readonly string[];
  /** Showing the 2 s power-flicker warning. */
  readonly flickering: readonly string[];
  /** Dark in a power dip right now. */
  readonly dark: readonly string[];
  /** Overheating: over 100% load and counting down to death. */
  readonly overheating: readonly string[];
  /** Seconds each overheating server has spent over 100% load, by id (play.heat.overload). */
  readonly overload: Readonly<Record<string, number>>;
  /** Died from overheating and wait to be replaced. */
  readonly dead: readonly string[];
  /** Every power dip whose warning has started, with its part picked. */
  readonly dips: readonly PowerDip[];
  /** The dip whose flicker warning is showing, or null. */
  readonly dip: UpcomingDip | null;

  // ---- warnings and the session's beats ----
  readonly surge: SurgeWarning | null;
  readonly fall: FallForecast | null;
  readonly laundryCut: { readonly at: number } | null;
  /** The laundry cut is offered now (the district surge, before the crew). */
  readonly laundryCutAvailable: boolean;
  readonly rescued: boolean;
  readonly rescue: { readonly at: number; readonly by: RescueCause } | null;
  readonly regroup: { readonly charges: number; readonly handedOver: boolean; readonly left: number };
  readonly banner: { readonly choice: BannerChoice; readonly at: number } | null;
  readonly midnight: Midnight | null;
  readonly failure: Failure | null;
  readonly rewinds: readonly Rewind[];
  readonly crewMet: boolean;
}

/**
 * Req/s the live servers wired in can serve: a server counts when it is not offline, has a wire in
 * from the gateway (or from a balancer the gateway feeds) and a wire out to the database, the same
 * test the run's waiting flags make. Derived from the board alone, so it is pure.
 */
export function wiredCapacity(
  parts: readonly Part[],
  wires: readonly Wire[],
  offline: readonly string[],
): number {
  let total = 0;
  for (const p of parts) {
    if (p.kind !== 'server' || offline.includes(p.id)) continue;
    let fed = false;
    let out = false;
    for (const w of wires) {
      if (w.to === p.id && (w.from === 'gateway' || feedsThrough(parts, wires, w.from))) fed = true;
      if (w.from === p.id && w.to === 'database') out = true;
    }
    if (fed && out) total += capacityOf(p, BROWNOUT_RULES);
  }
  return total;
}

/**
 * Req/s every live server could serve, wired or not: the run's `capacity` worked out from the offline
 * list the frame already holds, so the frame reads run().offline once. Pure.
 */
export function liveCapacity(parts: readonly Part[], offline: readonly string[]): number {
  let total = 0;
  for (const p of parts) {
    if (p.kind === 'server' && !offline.includes(p.id)) total += capacityOf(p, BROWNOUT_RULES);
  }
  return total;
}

/** Whether `id` is a balancer with a wire in from the gateway. */
function feedsThrough(parts: readonly Part[], wires: readonly Wire[], id: string): boolean {
  const part = parts.find((p) => p.id === id);
  return part?.kind === 'balancer' && wires.some((w) => w.from === 'gateway' && w.to === id);
}

/** Read every field of a frame from the run, once. Not memoised: see frame(). */
export function readFrame(r: Run): Frame {
  const play: Play = r.play;
  const now = r.now;
  const board = r.session.board;
  const flow = r.flow;
  const demand = r.demand;
  const offline = r.offline;
  const dipShowing = play.dips.find((d) => d.part !== null && d.warnAt <= now && now < d.darkAt);
  const fall = fallForecastAt(now);
  return {
    now,
    clock: r.clock(now),
    speed: r.speed,
    paused: r.paused,
    timeScale: r.timeScale,
    waitingForFirstBuild: r.waitingForFirstBuild,
    waitingForCrewBuild: r.waitingForCrewBuild,
    parts: board.parts,
    wires: board.wires,
    credits: board.credits,
    trust: r.session.trust,
    offlineUntil: r.session.offlineUntil,
    flow,
    demand,
    blockDemand: r.blockDemand,
    retry: play.retry,
    capacity: liveCapacity(board.parts, offline),
    wiredCapacity: wiredCapacity(board.parts, board.wires, offline),
    served: flow.served,
    dropped: flow.dropped,
    errorShare: errorShare(flow, demand),
    offline,
    flickering: r.flickering,
    dark: darkParts(play.dips, now),
    overheating: Object.keys(play.heat.overload),
    overload: play.heat.overload,
    dead: play.heat.dead,
    dips: play.dips,
    dip: dipShowing && dipShowing.part !== null ? { partId: dipShowing.part, at: dipShowing.darkAt } : null,
    surge: surgeWarningAt(now),
    fall: fall ? { demand: fall.demand } : null,
    laundryCut: play.laundryCut,
    laundryCutAvailable: laundryCutAvailable(now, r.rescued),
    rescued: r.rescued,
    rescue: play.rescue,
    regroup: play.regroup,
    banner: r.session.banner,
    midnight: play.midnight,
    failure: play.failure,
    rewinds: play.rewinds,
    crewMet: play.crewMet,
  };
}

/** What the memo was read from: the run replaces each of these on a change, never mutates them. */
interface Memo {
  run: Run;
  play: Play;
  paused: boolean;
  frame: Frame;
}

let memo: Memo | null = null;

/**
 * The frame for this run, read once per sim change. Calling it again before the sim or a hold
 * changes returns the identical object and reads nothing from the run (no routing).
 */
export function frame(r: Run): Frame {
  const paused = r.paused;
  if (memo && memo.run === r && memo.play === r.play && memo.paused === paused) {
    return memo.frame;
  }
  const next = readFrame(r);
  memo = { run: r, play: r.play, paused, frame: next };
  return next;
}

/** Forget the memo (tests, and a fresh run). The next frame() reads the run again. */
export function resetFrame(): void {
  memo = null;
}
