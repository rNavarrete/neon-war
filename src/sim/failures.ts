// Session 0's bad weather: overheating, retries, power dips, the laundry-floor cut, the rescue
// trigger and the midnight sizing table. Pure functions over plain data; time comes in as `now` or
// `dt` (seconds since the clock opened at 23:54:25). Every number comes from BROWNOUT.

import { type Board, type BoardRules, type Flow, type Part, capacityOf } from './board';
import { BROWNOUT } from './brownout';
import { demandAt } from './demand';

const C = BROWNOUT.challenges;
const D = BROWNOUT.demand;
const DIP = BROWNOUT.powerDip;
const RETRY = BROWNOUT.retries;
const SIZING = BROWNOUT.finalSizing;

/** Seconds each server has been over 100% load in a row, and the servers that cooked. */
export interface Heat {
  readonly overload: Readonly<Record<string, number>>;
  /** Dead servers stay offline until they are replaced. */
  readonly dead: readonly string[];
}

export const coolHeat = (): Heat => ({ overload: {}, dead: [] });

/**
 * Heat after dt seconds of this flow. A live server over 100% load keeps counting; one at or under
 * 100%, or offline (booting, dark), starts again from zero. A server that reaches the overheat time
 * (8 s in a row, with floating-point slack so ten 0.1 s ticks make a full second) dies.
 */
export function updateOverheat(
  board: Board,
  rules: BoardRules,
  flow: Flow,
  heat: Heat,
  offline: readonly string[],
  dt: number,
): Heat {
  const overload: Record<string, number> = {};
  const dead = [...heat.dead];
  for (const part of board.parts) {
    if (part.kind !== 'server' || dead.includes(part.id) || offline.includes(part.id)) continue;
    if ((flow.load[part.id] ?? 0) <= capacityOf(part, rules)) continue;
    const seconds = (heat.overload[part.id] ?? 0) + dt;
    if (seconds >= BROWNOUT.overheat.overloadSeconds - BROWNOUT.sim.timeEpsilon) dead.push(part.id);
    else overload[part.id] = seconds;
  }
  return { overload, dead };
}

/** Seconds until the hottest overloaded server cooks if it stays over load, or Infinity. */
export function secondsToOverheat(heat: Heat): number {
  let left = Infinity;
  for (const id in heat.overload) {
    left = Math.min(left, BROWNOUT.overheat.overloadSeconds - heat.overload[id]);
  }
  return left;
}

/**
 * The retry rise after dt seconds at this error share: failed requests come back, so the rise
 * climbs toward the error share (capped at 50%) while errors last and falls back to 0 when they stop.
 */
export function updateRetries(retry: number, share: number, dt: number): number {
  const target = Math.min(RETRY.maxDemandRise, share);
  if (retry < target) return Math.min(target, retry + RETRY.risePerSecond * dt);
  return Math.max(target, retry - RETRY.fallPerSecond * dt);
}

/** Demand with the retry pile on top. */
export function withRetries(demand: number, retry: number): number {
  return demand * (1 + retry);
}

/** The laundry floor can be cut loose during the district surge, before the crew arrives. */
export function laundryCutAvailable(now: number, rescued: boolean): boolean {
  return !rescued && now >= C.c4 && now < C.c5;
}

/**
 * Requests per second the block sends at `now`, before retries. Once the crew has arrived the surge
 * has settled to its tail until 23:59. A laundry cut sheds its floor for the rest of the surge.
 */
export function blockDemand(now: number, rescued: boolean, laundryCut: boolean): number {
  const base = rescued && now >= C.c4 && now < C.c6 ? D.tail : demandAt(now);
  const shed = laundryCut && laundryCutAvailable(now, rescued) ? D.laundryCut : 0;
  return Math.max(0, base - shed);
}

/**
 * Who a scripted dip takes dark: the overclocked server (C4), or one server picked by the seed (C6):
 * the interview's "lose one, keep serving" (N+1). No racks (Rolando, 30 Oct 2026).
 */
export type DipTarget = 'overclocked' | 'seeded';

export interface ScheduledDip {
  readonly id: string;
  /** When the part goes dark; the flicker warning comes before it. */
  readonly darkAt: number;
  readonly target: DipTarget;
}

/** The session's power dips: one in the surge, one seeded dip before midnight. */
export const DIP_SCRIPT: readonly ScheduledDip[] = [
  { id: 'surge', darkAt: C.c4 + BROWNOUT.surgeScript.dipAfterSeconds, target: 'overclocked' },
  { id: 'midnight', darkAt: BROWNOUT.clock.midnight - DIP.beforeMidnightSeconds, target: 'seeded' },
];

/** A dip with its parts picked: flickers from warnAt, dark from darkAt until endsAt. */
export interface PowerDip {
  readonly id: string;
  /** The (first) part it takes dark, or null when there was no server to take. */
  readonly part: string | null;
  /** Every part it takes dark (missing means just `part`). */
  readonly parts?: readonly string[];
  /** The rack that lost power (C6), or null for a dip on one part. */
  readonly rack?: string | null;
  readonly warnAt: number;
  readonly darkAt: number;
  readonly endsAt: number;
}

export const dipWarnAt = (dip: ScheduledDip): number => dip.darkAt - DIP.warningSeconds;

/** The same seed always picks the same one of n. */
export function seededIndex(seed: number, n: number): number {
  return n > 0 ? (Math.imul(seed | 0, 0x9e3779b1) >>> 0) % n : 0;
}

/** Every part a dip takes dark. */
export function dipParts(dip: PowerDip): readonly string[] {
  return dip.parts ?? (dip.part === null ? [] : [dip.part]);
}

/**
 * Pick what a scheduled dip takes dark on this board: the overclocked server in the surge (C4); at
 * midnight (C6) one server loses power, picked by the seed, so one spare rides it out (N+1).
 */
export function resolveDip(board: Board, dip: ScheduledDip, seed: number): PowerDip {
  const servers = board.parts.filter((p) => p.kind === 'server');
  const timing = { warnAt: dipWarnAt(dip), darkAt: dip.darkAt, endsAt: dip.darkAt + DIP.darkSeconds };
  if (dip.target === 'overclocked') {
    const part: Part | undefined = servers.find((p) => p.boost !== undefined) ?? servers[0];
    return { id: dip.id, part: part?.id ?? null, parts: part ? [part.id] : [], rack: null, ...timing };
  }
  const part = servers.length > 0 ? servers[seededIndex(seed, servers.length)] : undefined;
  return { id: dip.id, part: part?.id ?? null, parts: part ? [part.id] : [], rack: null, ...timing };
}

export type DipPhase = 'flicker' | 'dark' | null;

export function dipPhase(dip: PowerDip, now: number): DipPhase {
  if (dipParts(dip).length === 0 || now < dip.warnAt || now >= dip.endsAt) return null;
  return now < dip.darkAt ? 'flicker' : 'dark';
}

/** Parts in a power dip at `now`: offline, so the load balancer skips them and the gateway does not. */
export function darkParts(dips: readonly PowerDip[], now: number): string[] {
  return dips.filter((d) => dipPhase(d, now) === 'dark').flatMap((d) => dipParts(d));
}

/** Parts showing the flicker warning at `now`: still online. */
export function flickeringParts(dips: readonly PowerDip[], now: number): string[] {
  return dips.filter((d) => dipPhase(d, now) === 'flicker').flatMap((d) => dipParts(d));
}

export type RescueCause = 'trust' | 'time';

/** Whether the crew breaks in at `now`: trust under 30 or 45 s into the district surge, whichever first. */
export function rescueDue(trust: number, now: number): RescueCause | null {
  if (now < C.c4 || now >= C.c6) return null;
  if (trust < BROWNOUT.rescue.trustBelow) return 'trust';
  if (now - C.c4 >= BROWNOUT.rescue.surgeSeconds) return 'time';
  return null;
}

export type SizingVerdict = 'drops' | 'holds-with-fast-replacement' | 'holds' | 'waste';

/** GAME.md's final sizing table for this many servers behind the balancer at midnight. */
export function sizingVerdict(servers: number): SizingVerdict {
  if (servers >= SIZING.waste) return 'waste';
  if (servers >= SIZING.holds) return 'holds';
  if (servers >= SIZING.holdsWithFastReplacement) return 'holds-with-fast-replacement';
  return 'drops';
}
