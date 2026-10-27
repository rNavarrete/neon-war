// What the board needs from the crew's rules: the rescue racks the load balancer itself (between
// the gateway and every server), so the tray card unlocks once the crew has arrived.

import type { ActionResult, Run } from '../../game/run';

/** Whether the crew has given Lux the load balancer yet. */
export function balancerGiven(run: Run): boolean {
  return run.rescued || run.session.board.parts.some((p) => p.kind === 'balancer');
}

/** The crew rack their balancer at the rescue, so there is never a second one to place. */
export function placeBalancer(run: Run): ActionResult {
  if (!balancerGiven(run)) return { ok: false, reason: "the crew hasn't given you a load balancer" };
  return { ok: false, reason: 'the balancer is already racked' };
}
