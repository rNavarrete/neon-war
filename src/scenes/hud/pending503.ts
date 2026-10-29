// The HUD's view of the failure rules in src/sim/play.ts: the next power dip, the laundry cut and
// Regroup's charge. The HUD's controls and warnings read only these small functions.

import type { ActionResult, Run } from '../../game/run';
import type { UpcomingDip } from './warnings';

/** The power dip whose flicker warning is showing, and the part it is about to take dark. */
export function upcomingDip(r: Run): UpcomingDip | null {
  const d = r.play.dips.find((x) => x.part !== null && x.warnAt <= r.now && r.now < x.darkAt);
  return d && d.part !== null ? { partId: d.part, at: d.darkAt } : null;
}

/** Cut the laundry floor loose: about 40 req/s off demand for the rest of the district surge. */
export function cutLaundry(r: Run): ActionResult {
  return r.cutLaundry();
}

/** Sim time the laundry floor was cut in this run, or null. */
export function laundryCutAt(r: Run): number | null {
  return r.play.laundryCut?.at ?? null;
}

/** Whether Mika has handed Regroup over and its one charge is still unspent. */
export function regroupAvailable(r: Run): boolean {
  return r.play.regroup.handedOver && r.play.regroup.charges > 0;
}
