// Session 0 played through: the clock, the bad weather, the rescue, Regroup and the rewinds, on top
// of the economy. `step` advances a Play by dt real seconds; player actions are pure functions that
// return a new Play. Time only comes in through `dt`; every number comes from BROWNOUT.

import {
  type Board,
  type Flow,
  type Part,
  type Wire,
  decommission,
  errorShare,
  loseUpgrade,
  partById,
  route,
} from './board';
import { BROWNOUT, BROWNOUT_RULES } from './brownout';
import { BALANCER_SPOT, findSpot } from './grid';
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
  blockDemand,
  coolHeat,
  darkParts,
  dipWarnAt,
  laundryCutAvailable,
  rescueDue,
  resolveDip,
  secondsToOverheat,
  updateOverheat,
  updateRetries,
  withRetries,
} from './failures';
import { NO_TIPS, type TipState, stepTips } from './tips';

const C = BROWNOUT.challenges;
const REGROUP = BROWNOUT.regroup;
const TICK = BROWNOUT.sim.maxStepSeconds;
const EPS = BROWNOUT.sim.timeEpsilon;

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
  /** Seconds since the clock opened at 23:54:25. */
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
  /** Viewer tips so far (src/sim/tips.ts): the session's income. */
  readonly tips: TipState;
  /**
   * Servers that have carried traffic at least once. One that never has (a box nothing feeds) sells
   * back at its full price: trying a second server before the load balancer costs nothing.
   */
  readonly used: readonly string[];
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

/** Fixed times a step must stop at so challenge starts, dips, the rescue and midnight land exactly. */
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
    tips: NO_TIPS,
    used: [],
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

/**
 * The next time after this play's clock that a sim tick must end on: the next point on the fixed
 * tick grid (0.1 s, or 0.025 s of sim time while Regroup slows it, so a tick is 0.1 s of real time
 * either way), a challenge start, the time trigger, a dip warning, going dark or ending, a part
 * finishing its boot, the paid banner running out, or an overloaded server reaching 8 s.
 */
export function nextEdge(play: Play): number {
  const t = play.t;
  const tick = play.regroup.left > 0 ? TICK * REGROUP.speed : TICK;
  let edge = (Math.floor(t / tick + EPS) + 1) * tick;
  const consider = (at: number): void => {
    if (at > t && at < edge) edge = at;
  };
  for (const b of BOUNDARIES) consider(b);
  for (const d of play.dips) {
    consider(d.warnAt);
    consider(d.darkAt);
    consider(d.endsAt);
  }
  for (const id in play.session.offlineUntil) consider(play.session.offlineUntil[id]);
  const banner = play.session.banner;
  if (banner && banner.choice === 'pay') consider(banner.at + BROWNOUT.solace.durationSeconds);
  consider(t + secondsToOverheat(play.heat));
  return edge;
}

function resolveDips(play: Play, now: number): Play {
  const due = DIP_SCRIPT.filter((d) => dipWarnAt(d) <= now && !play.dips.some((p) => p.id === d.id));
  if (due.length === 0) return play;
  return { ...play, dips: [...play.dips, ...due.map((d) => resolveDip(play.session.board, d, play.seed))] };
}

function checkpointed(play: Play): Play {
  const at = CHECKPOINTS.find((c) => c === play.t);
  if (at === undefined || (play.checkpoint && play.checkpoint.at >= at)) return play;
  return { ...play, checkpoint: { at, play: { ...play, checkpoint: null } } };
}

function failed(play: Play, cause: FailureCause, by: RewindBy): Play {
  const rewindTo = play.checkpoint?.at ?? 0;
  return { ...play, failure: { at: play.t, cause, by, rewindTo } };
}

/**
 * The crew break in: the load balancer goes between the gateway and every server, the overclocked
 * server's kit fries (back to stock, revived if it cooked), the surge's power dip ends, the retry
 * pile settles, Ozzie fronts his credits and Mika hands over Regroup (once per session, where the
 * session has it: Session 0 does not).
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
    // The crew rack it on the nearest free 2 x 1 cells to their spot by the gateway.
    const slot = findSpot(board.slots, board.parts, 'balancer', BALANCER_SPOT);
    board = { ...board, parts: [...board.parts, { id: 'balancer', kind: 'balancer', slot }] };
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
    regroup:
      play.regroup.handedOver || !REGROUP.inSession
        ? play.regroup
        : { charges: REGROUP.charges, handedOver: true, left: 0 },
  };
}

/** Advance the session clock by dt seconds of sim time, which must not cross an edge (see nextEdge). */
function advance(play: Play, dt: number): Play {
  const now = play.t;
  const t = now + dt;
  // C0 is the cold open: the board isn't up yet.
  if (now < C.c1) return checkpointed({ ...play, t });

  const demand = playDemand(play, now);
  const flow = routePlay(play, demand, now);
  const share = errorShare(flow, demand);
  const heat = updateOverheat(
    play.session.board,
    BROWNOUT_RULES,
    flow,
    play.heat,
    offlineParts(play, now),
    dt,
  );
  const session = chargeUpkeep({ ...play.session, trust: trustAfter(play.session.trust, share, dt) }, dt);
  let next: Play = resolveDips(
    {
      ...play,
      t,
      session,
      retry: updateRetries(play.retry, share, dt),
      heat,
      dropped: play.dropped + flow.dropped * dt,
      used: usedAfter(play.used, flow),
    },
    t,
  );
  const trustGone = session.trust <= 0;

  // Failures are judged on the challenge the tick started in, against the checkpoint taken before
  // it: a failure on the tick that reaches a challenge start still rewinds to the earlier one.
  if (now < C.c4) {
    // Before the crew exists, a server cooking or trust running out rewinds this challenge.
    if (heat.dead.length > play.heat.dead.length) return failed(next, 'server-died', 'triage');
    if (trustGone) return failed(next, 'trust', 'triage');
  } else if (now < C.c6) {
    const due = next.rescue ? null : rescueDue(session.trust, t);
    if (due) next = applyRescue(next, t, due);
    // Trust gone in the surge: the crew comes anyway and Rei rewinds to the start of the surge.
    if (trustGone) {
      if (!next.rescue) next = applyRescue(next, t, 'trust');
      return failed(next, 'trust', 'rei');
    }
  } else if (now < C.c7 && trustGone) {
    return failed(next, 'dark-at-midnight', 'rei');
  }
  next = checkpointed(next);

  if (t >= C.c7 && !next.midnight) {
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
    if (!held) return failed(next, 'dark-at-midnight', 'rei');
  }
  return tipped(play, next, flow.served, share);
}

/** The servers that have carried traffic, with any that took some this tick; the same list when none is new. */
function usedAfter(used: readonly string[], flow: Flow): readonly string[] {
  let out = used;
  for (const id in flow.load) {
    if (flow.load[id] > 0 && id.startsWith('server') && !out.includes(id)) out = [...out, id];
  }
  return out;
}

/**
 * What the move that would help costs: before the load balancer the gateway feeds one server, so a
 * second one does nothing and the bigger server is the help (while a server is still without it).
 */
function helpPrice(board: Board): number {
  const lb = board.parts.some((p) => p.kind === 'balancer');
  const kit = BROWNOUT_RULES.upgrade;
  if (!lb && kit && board.parts.some((p) => p.kind === 'server' && p.boost === undefined)) return kit.cost;
  return BROWNOUT_RULES.cost.server ?? 0;
}

/** The viewers' tips for this tick, paid into the credits. */
function tipped(before: Play, next: Play, served: number, share: number): Play {
  const { state, given } = stepTips(next.tips, {
    t: next.t,
    seed: next.seed,
    served,
    errorShare: share,
    credits: next.session.board.credits,
    rescued: next.rescue !== null && before.rescue === null,
    held: next.midnight !== null && next.midnight.held && before.midnight === null,
    beforeMidnight: next.t < C.c7,
    helpPrice: helpPrice(next.session.board),
  });
  if (given.length === 0 && state === next.tips) return next;
  let gain = 0;
  for (const g of given) gain += g.amount;
  const board = { ...next.session.board, credits: next.session.board.credits + gain };
  return { ...next, tips: state, session: { ...next.session, board } };
}

/**
 * Advance the session by dt real seconds. Regroup runs the sim at quarter speed while it lasts. A
 * failure freezes the board until `rewind`. Time is cut into ticks of at most 0.1 s of sim time on a
 * fixed grid, ending exactly on every edge (see nextEdge), so one big step plays out the same as
 * many small ones and no dip, overheat, rescue, challenge start, midnight or Regroup end is skipped.
 */
export function step(play: Play, dt: number): Play {
  let p = play;
  let left = dt;
  while (left > EPS && !p.failure) {
    const slow = p.regroup.left > 0;
    const speed = slow ? REGROUP.speed : 1;
    let real = slow ? Math.min(left, p.regroup.left) : left;
    let simDt = real * speed;
    const edge = nextEdge(p);
    // Past the edge, or short of it by floating-point dust only: end the tick exactly on the edge.
    if (p.t + simDt > edge - EPS) {
      simDt = edge - p.t;
      real = simDt / speed;
    }
    p = advance(p, simDt);
    if (slow) {
      const regroupLeft = p.regroup.left - real;
      p = { ...p, regroup: { ...p.regroup, left: regroupLeft > EPS ? regroupLeft : 0 } };
    }
    left -= real;
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
 * Rack a scrap server with its footprint's anchor at `slot` (a cell) and wire it: behind the load balancer once there is one, otherwise
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

/** Swap a server (a dead one, usually) for a new scrap server on the same cells, on the same wires. */
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
    // A server that never carried a request goes back at its full price, like a return unopened.
    const cost = BROWNOUT_RULES.cost.server ?? 0;
    const back = p.used.includes(id) ? 0 : cost - Math.floor(cost * BROWNOUT_RULES.refund);
    const board = back > 0 ? { ...r.board, credits: r.board.credits + back } : r.board;
    return { ok: true, play: { ...p, session: { ...p.session, board }, heat: forget(p.heat, id) } };
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
