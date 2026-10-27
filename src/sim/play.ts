// Session 0 played through: the clock, the bad weather, the rescue, Regroup and the rewinds, on top
// of the economy. `step` advances a Play by dt real seconds; player actions are pure functions that
// return a new Play. Time only comes in through `dt`; every number comes from BROWNOUT.

import {
  type Board,
  type Flow,
  type Part,
  type Wire,
  capacityOf,
  decommission,
  errorShare,
  loseUpgrade,
  partById,
  route,
} from './board';
import { BROWNOUT, BROWNOUT_RULES } from './brownout';
import {
  type BannerChoice,
  type Session,
  bannerCapacity,
  chargeUpkeep,
  chooseBanner,
  createSession,
  fitOverclock,
  offlineAt,
  ozzieCover,
  ozzieFront,
  placeServer,
  trustAfter,
} from './economy';
import {
  type Heat,
  type PowerDip,
  type RescueCause,
  DIP_SCRIPT,
  TIME_EPSILON,
  blockDemand,
  coolHeat,
  darkParts,
  dipWarnAt,
  laundryCutAvailable,
  rescueDue,
  resolveDip,
  updateOverheat,
  updateRetries,
  withRetries,
} from './failures';

const C = BROWNOUT.challenges;
const REGROUP = BROWNOUT.regroup;
const EPS = TIME_EPSILON;

const TICK = BROWNOUT.sim.tickSeconds;

/** The in-world clock at t seconds since it opened at 23:51:30, as "HH:MM:SS" (t = 510 is midnight). */
export function clockAt(t: number): string {
  const [h, m, s] = BROWNOUT.clock.opensAt.split(':').map(Number);
  // A fixed UTC date only to roll the seconds over into hours and past midnight; no clock is read.
  return new Date(Date.UTC(1970, 0, 1, h, m, s + Math.floor(t + EPS))).toISOString().slice(11, 19);
}

export type RewindBy = 'triage' | 'rei';
export type FailureCause = 'server-died' | 'trust' | 'dark-at-midnight';

/** The board froze on a failure: the rewind screen plays, then `rewind` goes back to `rewindTo`. */
export interface Failure {
  readonly at: number;
  readonly cause: FailureCause;
  /** TRIAGE's stream replay before the crew exists, Rei's rewind after. */
  readonly by: RewindBy;
  readonly rewindTo: number;
}

export interface Rewind {
  readonly at: number;
  readonly to: number;
  readonly by: RewindBy;
  readonly cause: FailureCause;
}

/** What happened on the stroke of twelve, for the outcome barks and the debrief. */
export interface Midnight {
  /** False when the block was dropping requests at midnight: it went dark. */
  readonly held: boolean;
  /** Requests dropped since 23:59. */
  readonly dropped: number;
  /** Live servers on the board at midnight. */
  readonly servers: number;
  /** 5 or more servers: they hold, but the debrief counts the extra as waste. */
  readonly waste: boolean;
}

export interface Play {
  /** Seconds since the clock opened at 23:51:30. */
  readonly t: number;
  /** Picks which server the midnight dip takes; the same seed gives the same dip on every replay. */
  readonly seed: number;
  readonly session: Session;
  /** How far retries have pushed demand up, from 0 to 0.5. */
  readonly retry: number;
  readonly heat: Heat;
  /** Power dips whose flicker warning has started, with their part picked. */
  readonly dips: readonly PowerDip[];
  readonly laundryCut: { readonly at: number } | null;
  readonly rescue: { readonly at: number; readonly by: RescueCause } | null;
  readonly midnight: Midnight | null;
  readonly failure: Failure | null;
  /** Requests dropped this run. */
  readonly dropped: number;
  /** The state at the start of the challenge a failure rewinds to. */
  readonly checkpoint: { readonly at: number; readonly play: Play } | null;
  // Kept across rewinds:
  /** The crew has arrived at least once. */
  readonly crewMet: boolean;
  /** Regroup: charges left, whether Mika handed it over yet, and real seconds of slow time left. */
  readonly regroup: { readonly charges: number; readonly handedOver: boolean; readonly left: number };
  readonly rewinds: readonly Rewind[];
}

export type PlayResult = { ok: true; play: Play } | { ok: false; reason: string };

const fail = (reason: string): PlayResult => ({ ok: false, reason });

/** Challenge starts a failure can rewind to. C5 belongs to the surge, C7 and C8 never fail. */
const CHECKPOINTS: readonly number[] = [C.c1, C.c2, C.c3, C.c4, C.c6];

/** Times a step must stop at so challenge starts, dips, the rescue and midnight land exactly. */
const BOUNDARIES: readonly number[] = [
  ...new Set([
    ...Object.values(C),
    C.c4 + BROWNOUT.rescue.surgeSeconds,
    ...DIP_SCRIPT.flatMap((d) => [dipWarnAt(d), d.darkAt, d.darkAt + BROWNOUT.powerDip.darkSeconds]),
  ]),
].sort((a, b) => a - b);

export function createPlay(init: {
  slots: readonly string[];
  parts?: readonly Part[];
  wires?: readonly Wire[];
  seed: number;
}): Play {
  const { seed, ...board } = init;
  return {
    t: 0,
    seed,
    session: createSession(board),
    retry: 0,
    heat: coolHeat(),
    dips: [],
    laundryCut: null,
    rescue: null,
    midnight: null,
    failure: null,
    dropped: 0,
    checkpoint: null,
    crewMet: false,
    regroup: { charges: 0, handedOver: false, left: 0 },
    rewinds: [],
  };
}

const servers = (board: Board): Part[] => board.parts.filter((p) => p.kind === 'server');

/** Parts serving nothing at `now`: booting or rebooting, dead from overheating, or dark in a dip. */
export function offlineParts(play: Play, now: number): string[] {
  return [...offlineAt(play.session, now), ...play.heat.dead, ...darkParts(play.dips, now)];
}

/** Requests per second the block sends at `now`, retries included. */
export function playDemand(play: Play, now: number): number {
  return withRetries(blockDemand(now, play.rescue !== null, play.laundryCut !== null), play.retry);
}

/** Where `demand` goes at `now`: the paid banner first, the rest through the board. */
export function routePlay(play: Play, demand: number, now: number): Flow {
  const extra = Math.min(demand, bannerCapacity(play.session, now));
  const flow = route(play.session.board, BROWNOUT_RULES, demand - extra, offlineParts(play, now));
  return { ...flow, served: flow.served + extra };
}

/** Live servers: on the board and not dead. */
export function liveServers(play: Play): number {
  return servers(play.session.board).filter((p) => !play.heat.dead.includes(p.id)).length;
}

function nextBoundary(t: number): number {
  return BOUNDARIES.find((b) => b > t + EPS) ?? Infinity;
}

function nextGrid(t: number): number {
  return (Math.floor(t / TICK + EPS) + 1) * TICK;
}

/**
 * The next time after now at which the rules change on their own: the next grid tick, a fixed
 * boundary (challenge starts, the rescue deadline, the scripted dips), a part finishing its boot or
 * reboot, a resolved dip's flicker, dark or end, or the paid banner running out.
 */
function nextEvent(play: Play): number {
  const t = play.t;
  let next = Math.min(nextGrid(t), nextBoundary(t));
  const consider = (x: number): void => {
    if (x > t + EPS && x < next) next = x;
  };
  for (const id of Object.keys(play.session.offlineUntil)) consider(play.session.offlineUntil[id]);
  for (const d of play.dips) {
    consider(d.warnAt);
    consider(d.darkAt);
    consider(d.endsAt);
  }
  const b = play.session.banner;
  if (b && b.choice === 'pay') consider(b.at + BROWNOUT.solace.durationSeconds);
  return next;
}

/**
 * How much of `dt` can pass on this one reading before something it decides changes: an overloaded
 * server reaching its overheat time, or trust reaching the rescue line or zero.
 */
function untilChange(play: Play, flow: Flow, share: number, offline: readonly string[], dt: number): number {
  let limit = dt;
  for (const part of servers(play.session.board)) {
    if (play.heat.dead.includes(part.id) || offline.includes(part.id)) continue;
    if ((flow.load[part.id] ?? 0) <= capacityOf(part, BROWNOUT_RULES)) continue;
    limit = Math.min(limit, BROWNOUT.overheat.overloadSeconds - (play.heat.overload[part.id] ?? 0));
  }
  if (share > 0) {
    const drain = BROWNOUT.trust.drainPerSecondAtFullErrors * share;
    const trust = play.session.trust;
    for (const line of [0, BROWNOUT.rescue.trustBelow]) {
      if (trust > line + EPS) limit = Math.min(limit, (trust - line) / drain);
    }
  }
  return limit;
}

/** Land trust exactly on the rescue line or zero when a step was cut to reach it. */
function snapTrust(trust: number): number {
  for (const line of [0, BROWNOUT.rescue.trustBelow]) if (Math.abs(trust - line) < 1e-6) return line;
  return trust;
}

function resolveDips(play: Play, now: number): Play {
  const due = DIP_SCRIPT.filter((d) => dipWarnAt(d) <= now + EPS && !play.dips.some((p) => p.id === d.id));
  if (due.length === 0) return play;
  return { ...play, dips: [...play.dips, ...due.map((d) => resolveDip(play.session.board, d, play.seed))] };
}

/** At a challenge start, save `base` (the state before anything this instant changed) as the checkpoint. */
function checkpointed(play: Play, base: Play = play): Play {
  const at = CHECKPOINTS.find((c) => Math.abs(c - play.t) < EPS);
  if (at === undefined || (play.checkpoint && play.checkpoint.at >= at)) return play;
  return { ...play, t: at, checkpoint: { at, play: { ...base, t: at, checkpoint: null } } };
}

function failed(play: Play, cause: FailureCause, by: RewindBy): Play {
  const rewindTo = play.checkpoint?.at ?? 0;
  return { ...play, failure: { at: play.t, cause, by, rewindTo } };
}

/**
 * The crew break in: the load balancer goes between the gateway and every server, the overclocked
 * server's kit fries (back to stock, revived if it cooked), the surge's power dip ends, the retry
 * pile settles, Ozzie fronts his credits and Mika hands over Regroup (once per session).
 */
export function applyRescue(play: Play, now: number, by: RescueCause): Play {
  let board = play.session.board;
  const fried = servers(board)
    .filter((p) => p.boost !== undefined)
    .map((p) => p.id);
  for (const id of fried) {
    const r = loseUpgrade(board, id);
    if (r.ok) board = r.board;
  }
  if (!board.parts.some((p) => p.kind === 'balancer')) {
    board = { ...board, parts: [...board.parts, { id: 'balancer', kind: 'balancer', slot: null }] };
  }
  const lb = board.parts.find((p) => p.kind === 'balancer')!.id;
  const gateways = board.parts.filter((p) => p.kind === 'gateway').map((p) => p.id);
  const wires: Wire[] = [
    ...board.wires.filter((w) => !gateways.includes(w.from) && w.from !== lb),
    ...gateways.map((g) => ({ from: g, to: lb })),
    ...servers(board).map((s) => ({ from: lb, to: s.id })),
  ];
  board = { ...board, wires };
  return {
    ...play,
    session: ozzieFront({ ...play.session, board }),
    retry: 0,
    heat: { overload: {}, dead: play.heat.dead.filter((id) => !fried.includes(id)) },
    dips: play.dips.map((d) => (d.darkAt <= now && d.endsAt > now ? { ...d, endsAt: now } : d)),
    rescue: { at: now, by },
    crewMet: true,
    regroup: play.regroup.handedOver ? play.regroup : { charges: REGROUP.charges, handedOver: true, left: 0 },
  };
}

/**
 * Advance the session clock by up to `maxDt` seconds of sim time on one reading of demand and
 * routing. `maxDt` must not cross an event (see nextEvent); the step is cut shorter still where a
 * server would cook or trust would reach a line. Returns the new Play and the sim time used.
 */
function advance(play: Play, maxDt: number): { play: Play; dt: number } {
  const now = play.t;
  // C0 is the cold open: the board isn't up yet.
  if (now < C.c1 - EPS) {
    const dt = Math.min(maxDt, C.c1 - now);
    return { play: checkpointed({ ...play, t: now + dt }), dt };
  }

  const demand = playDemand(play, now);
  const flow = routePlay(play, demand, now);
  const share = errorShare(flow, demand);
  const offline = offlineParts(play, now);
  const dt = untilChange(play, flow, share, offline, maxDt);
  const t = now + dt;
  const heat = updateOverheat(play.session.board, BROWNOUT_RULES, flow, play.heat, offline, dt);
  const trust = snapTrust(trustAfter(play.session.trust, share, dt));
  const session = chargeUpkeep({ ...play.session, trust }, dt);
  let next: Play = resolveDips(
    {
      ...play,
      t,
      session,
      retry: updateRetries(play.retry, share, dt),
      heat,
      dropped: play.dropped + flow.dropped * dt,
    },
    t,
  );
  const trustGone = trust <= 0;
  const done = (p: Play): { play: Play; dt: number } => ({ play: p, dt });

  // Failures are judged on the stretch just played, against the checkpoint it started under, so a
  // failure landing exactly on a challenge start rewinds to the challenge it happened in.
  // Before the crew exists, a server cooking or trust running out rewinds this challenge.
  if (now < C.c4) {
    if (heat.dead.length > play.heat.dead.length) return done(failed(next, 'server-died', 'triage'));
    if (trustGone) return done(failed(next, 'trust', 'triage'));
  }
  // A checkpoint taken on this instant saves the state before any rescue due on it.
  const base = next;
  if (now >= C.c4 && now < C.c6) {
    const due = next.rescue ? null : rescueDue(trust, t);
    // Trust gone in the surge: the crew comes anyway and Rei rewinds to the start of the surge.
    if (trustGone) {
      if (!next.rescue) next = applyRescue(next, t, 'trust');
      return done(failed(next, 'trust', 'rei'));
    }
    if (due) next = applyRescue(next, t, due);
  }
  if (now >= C.c6 && now < C.c7 && trustGone) return done(failed(next, 'dark-at-midnight', 'rei'));

  if (t >= C.c7 - EPS && !next.midnight) {
    const at = playDemand(next, t);
    const flowAt = routePlay(next, at, t);
    const held = flowAt.dropped <= 0;
    const live = liveServers(next);
    next = {
      ...next,
      session: ozzieCover(next.session),
      midnight: {
        held,
        dropped: next.dropped - (next.checkpoint?.play.dropped ?? 0),
        servers: live,
        waste: live >= BROWNOUT.finalSizing.waste,
      },
    };
    if (!held) return done(failed(next, 'dark-at-midnight', 'rei'));
  }
  return done(checkpointed(next, base));
}

/**
 * Advance the session by dt real seconds. Regroup runs the sim at quarter speed while it lasts. A
 * failure freezes the board until `rewind`. However long dt is, the session is played in short
 * stretches cut at every event, so one long step gives the same result as many short ones.
 */
export function step(play: Play, dt: number): Play {
  let p = play;
  let left = dt;
  while (left > 0 && !p.failure) {
    const slow = p.regroup.left > 0;
    const speed = slow ? REGROUP.speed : 1;
    const real = slow ? Math.min(left, p.regroup.left) : left;
    const r = advance(p, Math.min(real * speed, nextEvent(p) - p.t));
    const used = Math.min(left, r.dt / speed);
    p = r.play;
    if (slow) {
      const rest = p.regroup.left - used;
      p = { ...p, regroup: { ...p.regroup, left: rest > EPS ? rest : 0 } };
    }
    left = left - used > EPS ? left - used : 0;
  }
  return p;
}

/** Go back to the checkpoint after a failure: credits, parts, trust and the clock as they were. */
export function rewind(play: Play): PlayResult {
  const f = play.failure;
  const cp = play.checkpoint;
  if (!f || !cp) return fail('nothing to rewind');
  return {
    ok: true,
    play: {
      ...cp.play,
      checkpoint: cp,
      crewMet: play.crewMet,
      regroup: { ...play.regroup, left: 0 },
      rewinds: [...play.rewinds, { at: f.at, to: cp.at, by: f.by, cause: f.cause }],
    },
  };
}

function act(play: Play, change: (play: Play) => PlayResult): PlayResult {
  if (play.failure) return fail('the board is rewinding');
  return change(play);
}

/**
 * Rack a scrap server in a slot and wire it: behind the load balancer once there is one, otherwise
 * from the gateway if the gateway feeds nothing yet (it feeds one part only), and on to the database.
 */
export function rackServer(play: Play, slot: string): PlayResult {
  return act(play, (p) => {
    const r = placeServer(p.session, slot, p.t);
    if (!r.ok) return r;
    const board = r.session.board;
    const id = board.parts[board.parts.length - 1].id;
    const lb = board.parts.find((q) => q.kind === 'balancer');
    const gw = board.parts.find((q) => q.kind === 'gateway');
    const db = board.parts.find((q) => q.kind === 'database');
    const feed = lb ?? (gw && !board.wires.some((w) => w.from === gw.id) ? gw : undefined);
    const wires: Wire[] = [
      ...board.wires,
      ...(feed ? [{ from: feed.id, to: id }] : []),
      ...(db ? [{ from: id, to: db.id }] : []),
    ];
    return { ok: true, play: { ...p, session: { ...r.session, board: { ...board, wires } } } };
  });
}

/** Swap a server (a dead one, usually) for a new scrap server in its slot, on the same wires. */
export function replaceServer(play: Play, id: string): PlayResult {
  return act(play, (p) => {
    const old = partById(p.session.board, id);
    if (!old || old.kind !== 'server' || old.slot === null) return fail(`no placed server ${id}`);
    const gone = decommission(p.session.board, BROWNOUT_RULES, id);
    if (!gone.ok) return gone;
    const r = placeServer({ ...p.session, board: gone.board }, old.slot, p.t);
    if (!r.ok) return r;
    const board = r.session.board;
    const fresh = board.parts[board.parts.length - 1].id;
    const rewired = p.session.board.wires
      .filter((w) => w.from === id || w.to === id)
      .map((w) => ({ from: w.from === id ? fresh : w.from, to: w.to === id ? fresh : w.to }));
    return {
      ok: true,
      play: {
        ...p,
        session: { ...r.session, board: { ...board, wires: [...board.wires, ...rewired] } },
        heat: forget(p.heat, id),
      },
    };
  });
}

/** Take a server off the board (scaling down after midnight). */
export function decommissionServer(play: Play, id: string): PlayResult {
  return act(play, (p) => {
    const part = partById(p.session.board, id);
    if (!part || part.kind !== 'server') return fail(`no server ${id}`);
    const r = decommission(p.session.board, BROWNOUT_RULES, id);
    if (!r.ok) return r;
    return { ok: true, play: { ...p, session: { ...p.session, board: r.board }, heat: forget(p.heat, id) } };
  });
}

function forget(heat: Heat, id: string): Heat {
  const overload = { ...heat.overload };
  delete overload[id];
  return { overload, dead: heat.dead.filter((d) => d !== id) };
}

export function overclockServer(play: Play, id: string): PlayResult {
  return act(play, (p) => {
    const r = fitOverclock(p.session, id, p.t);
    return r.ok ? { ok: true, play: { ...p, session: r.session } } : r;
  });
}

export function answerBanner(play: Play, choice: BannerChoice): PlayResult {
  return act(play, (p) => {
    const r = chooseBanner(p.session, choice, p.t);
    return r.ok ? { ok: true, play: { ...p, session: r.session } } : r;
  });
}

/** Cut the laundry floor loose: about 40 req/s less for the rest of the surge, recorded for the debrief. */
export function cutLaundry(play: Play): PlayResult {
  return act(play, (p) => {
    if (p.laundryCut) return fail('the laundry floor is already cut');
    if (!laundryCutAvailable(p.t, p.rescue !== null)) return fail('only during the district surge');
    return { ok: true, play: { ...p, laundryCut: { at: p.t } } };
  });
}

/** Spend Regroup's one charge: quarter speed for the next 10 s. Only after the rescue. */
export function useRegroup(play: Play): PlayResult {
  return act(play, (p) => {
    if (!p.rescue) return fail('Regroup arrives with the crew');
    if (p.regroup.charges <= 0) return fail('Regroup is spent');
    if (p.regroup.left > 0) return fail('Regroup is already running');
    return {
      ok: true,
      play: { ...p, regroup: { ...p.regroup, charges: p.regroup.charges - 1, left: REGROUP.seconds } },
    };
  });
}

/** The debrief's raw numbers. Grade thresholds aren't set yet, so nothing here is graded. */
export interface DebriefNumbers {
  readonly dropped: number;
  /** Price of the servers past the 4 that ride out the dip, racked at midnight. */
  readonly wastedCredits: number;
  readonly trust: number;
  readonly banner: BannerChoice | null;
  readonly ozzieDebt: number;
  readonly scaledDown: boolean;
  readonly laundryCut: boolean;
  readonly midnightHeld: boolean | null;
  readonly rewinds: number;
}

export function debriefNumbers(play: Play): DebriefNumbers {
  const m = play.midnight;
  const extra = m ? Math.max(0, m.servers - BROWNOUT.finalSizing.holds) : 0;
  return {
    dropped: play.dropped,
    wastedCredits: extra * BROWNOUT.server.cost,
    trust: play.session.trust,
    banner: play.session.banner?.choice ?? null,
    ozzieDebt: play.session.ozzie.debt,
    scaledDown: m !== null && liveServers(play) <= BROWNOUT.scaleDown.to,
    laundryCut: play.laundryCut !== null,
    midnightHeld: m ? m.held : null,
    rewinds: play.rewinds.length,
  };
}
