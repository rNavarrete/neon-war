// What the board needs from the crew's rules (ENG-503), behind small placeholders until they land.
// PLACEHOLDER (ENG-503): replace these bodies with the sim's answers; the board reads only these.

import type { ActionResult, Run } from '../../game/run';

/** Whether the crew has given Lux the load balancer yet. Always false until ENG-503 says so. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function balancerGiven(run: Run): boolean {
  return false;
}

/** Rack the crew's balancer in its slot. Refused until ENG-503 adds the rule. */
export function placeBalancer(run: Run): ActionResult {
  if (run.session.board.parts.some((p) => p.kind === 'balancer')) {
    return { ok: false, reason: 'the balancer is already racked' };
  }
  return { ok: false, reason: "the crew hasn't given you a load balancer" };
}
