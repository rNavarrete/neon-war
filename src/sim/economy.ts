// Session 0's calm-weather economy: credits, upkeep, booting, the overclock kit, the Solace banner,
// Ozzie's tab and trust. Pure functions over plain data; time comes in as `now` or `dt` (seconds).
// Every number comes from BROWNOUT. Failures (overheating, retries, power dips) are B1b's.

import {
  type Board,
  type BoardRules,
  type Flow,
  type Part,
  type Wire,
  createBoard,
  place,
  route,
  updateTrust,
  upgrade,
} from './board';
import { BROWNOUT, BROWNOUT_RULES } from './brownout';

export type BannerChoice = 'pay' | 'ignore' | 'bin';

export interface Session {
  readonly board: Board;
  readonly trust: number;
  /** Parts booting or rebooting, by id: the time they come back online. */
  readonly offlineUntil: Readonly<Record<string, number>>;
  /** The Solace banner choice and when it was made, kept for the debrief. */
  readonly banner: { readonly choice: BannerChoice; readonly at: number } | null;
  /** Ozzie's tab: whether he fronted credits at the rescue, and what he covered (owed in the debrief). */
  readonly ozzie: { readonly fronted: boolean; readonly debt: number };
}

export type SessionResult = { ok: true; session: Session } | { ok: false; reason: string };

export function createSession(init: {
  slots: readonly string[];
  parts?: readonly Part[];
  wires?: readonly Wire[];
}): Session {
  return {
    board: createBoard({ credits: BROWNOUT.credits.starting, ...init }),
    trust: BROWNOUT.trust.starting,
    offlineUntil: {},
    banner: null,
    ozzie: { fronted: false, debt: 0 },
  };
}

/** Ids of parts still booting or rebooting at `now`. */
export function offlineAt(session: Session, now: number): string[] {
  return Object.keys(session.offlineUntil).filter((id) => session.offlineUntil[id] > now);
}

/** Credits that dt seconds of upkeep cost for this many running servers. */
export function upkeepCost(servers: number, dt: number): number {
  return (BROWNOUT.credits.upkeepPerServerPerMinute * servers * dt) / BROWNOUT.clock.secondsPerMinute;
}

/** Servers on the board, each of which costs upkeep while it runs. */
export function runningServers(board: Board): number {
  return board.parts.filter((p) => p.kind === 'server').length;
}

/** Charge dt seconds of upkeep. Credits may go below zero: the session never blocks on them. */
export function chargeUpkeep(session: Session, dt: number): Session {
  const cost = upkeepCost(runningServers(session.board), dt);
  return { ...session, board: { ...session.board, credits: session.board.credits - cost } };
}

/** Place a scrap server: it costs its price and serves nothing until it has booted. */
export function placeServer(session: Session, slot: string, now: number): SessionResult {
  const r = place(session.board, BROWNOUT_RULES, slot, 'server');
  if (!r.ok) return r;
  const id = r.board.parts[r.board.parts.length - 1].id;
  return {
    ok: true,
    session: {
      ...session,
      board: r.board,
      offlineUntil: { ...session.offlineUntil, [id]: now + BROWNOUT.server.bootSeconds },
    },
  };
}

/** Fit the overclock kit to one server: it doubles the server and takes it offline while it reboots. */
export function fitOverclock(session: Session, id: string, now: number): SessionResult {
  const r = upgrade(session.board, BROWNOUT_RULES, id);
  if (!r.ok) return r;
  return {
    ok: true,
    session: {
      ...session,
      board: r.board,
      offlineUntil: { ...session.offlineUntil, [id]: now + BROWNOUT.overclock.rebootSeconds },
    },
  };
}

/** Answer the Solace banner once. Paying costs its price; Ignore and Bin cost nothing. */
export function chooseBanner(session: Session, choice: BannerChoice, now: number): SessionResult {
  if (session.banner) return { ok: false, reason: 'the banner was already answered' };
  const cost = choice === 'pay' ? BROWNOUT.solace.cost : 0;
  if (cost > 0 && session.board.credits < cost) return { ok: false, reason: 'not enough credits' };
  return {
    ok: true,
    session: {
      ...session,
      board: { ...session.board, credits: session.board.credits - cost },
      banner: { choice, at: now },
    },
  };
}

/** Extra req/s the paid banner adds at `now`: its capacity for 60 s after paying, otherwise none. */
export function bannerCapacity(session: Session, now: number): number {
  const b = session.banner;
  if (!b || b.choice !== 'pay') return 0;
  return now >= b.at && now < b.at + BROWNOUT.solace.durationSeconds ? BROWNOUT.solace.extraCapacity : 0;
}

/**
 * Where `demand` goes at `now`: the paid banner serves up to its extra capacity first, the rest is
 * routed through the board with booting and rebooting parts offline.
 */
export function routeSession(
  session: Session,
  demand: number,
  now: number,
  rules: BoardRules = BROWNOUT_RULES,
): Flow {
  const extra = Math.min(demand, bannerCapacity(session, now));
  const flow = route(session.board, rules, demand - extra, offlineAt(session, now));
  return { ...flow, served: flow.served + extra };
}

/** At the rescue Ozzie fronts credits, once. */
export function ozzieFront(session: Session): Session {
  if (session.ozzie.fronted) return session;
  return {
    ...session,
    board: { ...session.board, credits: session.board.credits + BROWNOUT.ozzie.front },
    ozzie: { ...session.ozzie, fronted: true },
  };
}

/**
 * At midnight Ozzie covers any shortfall below zero credits, up to his cap in total, and records it
 * as debt. A shortfall past the cap stays on the books; the session carries on either way.
 */
export function ozzieCover(session: Session): Session {
  const shortfall = Math.max(0, -session.board.credits);
  const cover = Math.min(shortfall, BROWNOUT.ozzie.coverCap - session.ozzie.debt);
  if (cover <= 0) return session;
  return {
    ...session,
    board: { ...session.board, credits: session.board.credits + cover },
    ozzie: { ...session.ozzie, debt: session.ozzie.debt + cover },
  };
}

/** The neighbours' trust after dt seconds at this error share, with Session 0's rates. */
export function trustAfter(trust: number, share: number, dt: number): number {
  return updateTrust(trust, share, dt, {
    drain: BROWNOUT.trust.drainPerSecondAtFullErrors,
    recover: BROWNOUT.trust.recoverPerSecond,
    max: BROWNOUT.trust.max,
  });
}
