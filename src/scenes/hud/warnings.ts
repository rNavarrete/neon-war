// What the surge and power-dip warnings show at a moment. Pure functions of sim time; the HUD draws
// whatever they return.

import type { Part } from '../../sim/board';
import { BROWNOUT } from '../../sim/brownout';
import { partAnchor } from '../board/layout';
import { CARDS, type Point, centreOf } from '../live/layout';
import { type Surge, SURGES } from '../../sim/demand';
import type { LineId } from '../../strings';

const C = BROWNOUT.challenges;

/**
 * Shown 2 s before the sim's forecast lead (10 s), so the warning is on screen for at least the full
 * lead even when a long frame (or a sped-up test) steps the clock past the moment the lead starts.
 */
export const SURGE_WARNING_LEAD = BROWNOUT.demand.forecastLeadSeconds + 2;
/** The warning stays up this long after the surge lands, so it can be read. */
export const SURGE_WARNING_LINGER = 4;

export interface SurgeWarning {
  readonly surge: Surge;
  /** Seconds until the surge lands; 0 once it has. */
  readonly inSeconds: number;
  readonly line: LineId;
}

const SURGE_LINES: Readonly<Record<number, LineId>> = {
  [C.c3]: 'C3.warn.01',
  [C.c4]: 'C4.warn.01',
  [C.c6]: 'C6.warn.01',
};

/** The surge warning on screen at `now`, or null. */
export function surgeWarningAt(now: number, surges: readonly Surge[] = SURGES): SurgeWarning | null {
  for (const s of surges) {
    const ahead = s.startsAt - now;
    if (ahead <= SURGE_WARNING_LEAD && ahead > -SURGE_WARNING_LINGER) {
      return {
        surge: s,
        inSeconds: Math.max(0, Math.ceil(ahead)),
        line: SURGE_LINES[s.startsAt] ?? 'C3.warn.01',
      };
    }
  }
  return null;
}

/** The after-midnight forecast (demand falling to about 40), shown from 00:00:05 for 10 s. */
export function fallForecastAt(now: number): { readonly line: LineId; readonly demand: number } | null {
  const t = now - BROWNOUT.clock.midnight;
  return t >= 5 && t < 15 ? { line: 'C7.warn.01', demand: BROWNOUT.demand.afterMidnight } : null;
}

/** A power dip coming to one part (ENG-503 owns when they happen). */
export interface UpcomingDip {
  readonly partId: string;
  /** Sim time the part goes dark. */
  readonly at: number;
}

export interface DipWarning {
  readonly partId: string;
  /** Whether the warning is drawn this frame: it flashes, or stays steady with reduce flicker. */
  readonly lit: boolean;
  readonly flashing: boolean;
}

/** How many times a second the flicker warning flashes. */
export const DIP_FLASH_HZ = 6;

/** The flicker warning at `now` for a coming dip: up for the 2 s before the part goes dark. */
export function dipWarningAt(
  dip: UpcomingDip | null,
  now: number,
  reduceFlicker: boolean,
): DipWarning | null {
  if (!dip) return null;
  const ahead = dip.at - now;
  if (ahead > BROWNOUT.powerDip.warningSeconds || ahead <= 0) return null;
  const lit = reduceFlicker || Math.floor(ahead * DIP_FLASH_HZ * 2) % 2 === 0;
  return { partId: dip.partId, lit, flashing: !reduceFlicker };
}

/** Where the dip mark sits when the board can't place the part: the centre of CARDS.dipFallback. */
export const DIP_FALLBACK: Point = centreOf(CARDS.dipFallback);

/**
 * Where the power-dip mark is drawn, in game pixels: on the part, at the board's own anchor for it
 * (partAnchor in src/scenes/board/layout.ts, the point board.parts[] reports), or on the fallback
 * card when the board can't say where the part is. Replaces HudScene.partLocator.
 */
export function dipMarkAt(
  board: { readonly parts: readonly Pick<Part, 'id' | 'kind' | 'slot'>[] },
  partId: string,
): Point {
  return partAnchor(board, partId) ?? DIP_FALLBACK;
}
