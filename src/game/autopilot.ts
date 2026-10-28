// Test-only scripted best play (`?test&autopilot`): builds what GAME.md's best-play path builds, as
// the clock reaches each point, through the same Run actions the mouse uses. Browser tests use it to
// reach later challenges and to play the whole session; the player never sees it.
//
// `?test&autopilot&idle=<t>` (learning-5): the same best play until sim time t, then the autopilot
// never acts again, so a spec can leave the board alone and watch that nothing advances on a timer.
// `?idle` with no number keeps it from acting at all (the C1 clock then waits for a first build).
//
// Best play: one server wired in C1, leave the banner unanswered, overclock before the climb, three servers
// behind the crew's balancer after the rescue, four before the midnight dip, back down to two after.

import { BROWNOUT } from '../sim/brownout';
import { SERVER_SLOTS } from '../sim/tick';
import type { Run } from './run';

const C = BROWNOUT.challenges;

/** Servers to run behind the balancer at `now`, once the crew has arrived. */
export function bestPlayServers(now: number): number {
  if (now >= C.c7 + 5) return 2;
  if (now >= C.c6) return BROWNOUT.finalSizing.holds;
  return 3;
}

function servers(r: Run) {
  return r.session.board.parts.filter((p) => p.kind === 'server');
}

/** Place a server in the first free slot and wire it in front of the database, from `feed`. */
function rack(r: Run, feed: string): boolean {
  const taken = new Set(r.session.board.parts.map((p) => p.slot));
  const slot = SERVER_SLOTS.find((s) => !taken.has(s));
  if (!slot || !r.placeServer(slot).ok) return false;
  const parts = r.session.board.parts;
  const id = parts[parts.length - 1].id;
  r.connect(feed, id);
  r.connect(id, 'database');
  return true;
}

/** One best-play action, if one is due now; false when there is nothing to do. */
function act(r: Run): boolean {
  const now = r.now;
  const list = servers(r);
  const lb = r.session.board.parts.find((p) => p.kind === 'balancer');
  if (!lb) {
    if (list.length === 0) return rack(r, 'gateway');
    if (now >= C.c3 - 20 && list[0].boost === undefined && !r.rescued) return r.overclock(list[0].id).ok;
    return false;
  }
  const dead = list.find((p) => r.dead.includes(p.id));
  if (dead) return r.replaceServer(dead.id).ok;
  const want = bestPlayServers(now);
  if (list.length < want && now < C.c7) return rack(r, lb.id);
  if (list.length > want) return r.decommission(list[list.length - 1].id).ok;
  return false;
}

/**
 * The sim time `?test&idle` stops the autopilot at: the number given, 0 for a bare `?idle` (or one
 * that is not a number at least 0), null without the flag or outside test mode. Pure.
 */
export function idleFrom(search: string): number | null {
  const params = new URLSearchParams(search);
  if (!params.has('test') || !params.has('idle')) return null;
  const raw = params.get('idle') ?? '';
  const n = Number(raw);
  return raw === '' || !Number.isFinite(n) || n < 0 ? 0 : n;
}

/** The page's `?idle`, read once at load (null in node, where there is no page). */
const PAGE_IDLE: number | null = typeof location === 'undefined' ? null : idleFrom(location.search);

/** Whether the autopilot keeps its hands off at `now`, with the flag stopping it at `idle`. */
export function idleAt(now: number, idle: number | null): boolean {
  return idle !== null && now >= idle;
}

/**
 * Best play before each step, unless `idle` (the sim time the autopilot stops at) has come: every
 * action that is due, at once, so the result doesn't depend on how many frames a slow headless
 * browser draws.
 */
export function bestPlayUntil(r: Run, idle: number | null): void {
  if (r.paused || r.now < C.c1 || idleAt(r.now, idle)) return;
  for (let guard = 0; guard < 8 && act(r); guard++);
}

/** Best play before each step, stopped by the page's `?idle` when it has one. */
export function bestPlay(r: Run): void {
  bestPlayUntil(r, PAGE_IDLE);
}
