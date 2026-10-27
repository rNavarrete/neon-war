// Test-only scripted best play (`?test&autopilot`): builds what GAME.md's best-play path builds, as
// the clock reaches each point, through the same Run actions the mouse uses. Browser tests use it to
// reach later challenges and to play the whole session; the player never sees it.
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
 * Best play before each step: every action that is due, at once, so the result doesn't depend on
 * how many frames a slow headless browser draws.
 */
export function bestPlay(r: Run): void {
  if (r.paused || r.now < C.c1) return;
  for (let guard = 0; guard < 8 && act(r); guard++);
}
