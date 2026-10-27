// What the settings screen's buttons do to a value. Pure, so the steps are unit-tested.

import type { TextSpeed } from './settings';

const SPEEDS: readonly TextSpeed[] = ['slow', 'normal', 'fast'];

/** Volume after one press of − or +, in tenths, kept between 0 and 1. */
export function stepVolume(volume: number, direction: -1 | 1): number {
  const tenths = Math.round(volume * 10) + direction;
  return Math.min(10, Math.max(0, tenths)) / 10;
}

/** The text speed after `speed`, wrapping round. */
export function nextTextSpeed(speed: TextSpeed): TextSpeed {
  return SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
}
