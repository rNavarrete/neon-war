// WIRING(ENG-503): placeholders for the failure rules the factory is building in src/sim/ (power
// dips, the laundry cut, Regroup's charge). The HUD's controls and warnings are built against these
// small functions; when ENG-503 merges, each body is replaced with a call into its rule and nothing
// else in the HUD changes. Every placeholder is marked WIRING(ENG-503).

import type { Run } from '../../game/run';
import type { UpcomingDip } from './warnings';

const laundry = new WeakMap<Run, number>();

/** WIRING(ENG-503): the next power dip and the part it hits. No dips yet, so always null. */
export function upcomingDip(r: Run): UpcomingDip | null {
  void r;
  return null;
}

/**
 * WIRING(ENG-503): cut the laundry floor loose (about 40 req/s off demand). For now it only
 * records the cut and when it happened; demand is unchanged until the rule lands.
 */
export function cutLaundry(r: Run): void {
  if (!laundry.has(r)) laundry.set(r, r.now);
}

/** Sim time the laundry floor was cut in this run, or null. */
export function laundryCutAt(r: Run): number | null {
  return laundry.get(r) ?? null;
}

/** WIRING(ENG-503): whether the Regroup charge has been handed over and not used. False for now. */
export function regroupAvailable(r: Run): boolean {
  void r;
  return false;
}
