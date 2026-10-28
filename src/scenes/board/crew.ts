// What the board needs from the crew's rules: the rescue racks the load balancer itself (between
// the gateway and every server), so the tray card unlocks once the crew has arrived.

import type { ActionResult, Run } from '../../game/run';
import type { Part } from '../../sim/board';
import { LABELS } from '../hud/labels';

/** Whether the crew has given Lux the load balancer yet. */
export function balancerGiven(run: Run): boolean {
  return balancerGivenIn(run.rescued, run.session.board.parts);
}

/** balancerGiven from a frame's fields, without a closure: the board asks it every frame. */
export function balancerGivenIn(rescued: boolean, parts: readonly Part[]): boolean {
  if (rescued) return true;
  for (let i = 0; i < parts.length; i++) if (parts[i].kind === 'balancer') return true;
  return false;
}

/** The crew rack their balancer at the rescue, so there is never a second one to place. */
export function placeBalancer(run: Run): ActionResult {
  // Refusals print on screen, so they use the crew's word (splitter), not the debrief's name.
  if (!balancerGiven(run)) return { ok: false, reason: LABELS.inventory.splitterLocked };
  return { ok: false, reason: 'the splitter is already racked' };
}
