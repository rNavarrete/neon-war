// The board's one read of the run per frame. BoardScene calls next() once at the top of each sync
// and draws everything from the Frame it returns, so run().flow (which re-routes the board) and
// run().offline are read at most once a frame, and not at all while the sim stands still: frame()
// memoises and hands back the identical object. No Phaser here, so node tests drive it.

import { type Frame, frame } from '../../game/frame';
import type { Run } from '../../game/run';

export class BoardSnapshot {
  /** Board frames synced so far. */
  count = 0;
  /** The board frame the snapshot was last read on: equals `count` once next() has run. */
  readAt = 0;
  /** How many times frame() handed back a new object (the sim, the notes or a hold changed). */
  changes = 0;
  /** The frame this sync draws from, or null before the first one. */
  current: Frame | null = null;
  /**
   * Seconds each server has been over 100% in a row (the sim's play.heat.overload), read with the
   * Frame for the DIES IN countdown: the Frame lists who overheats but not how long they have left.
   */
  overload: Readonly<Record<string, number>> = {};

  /** Start a board frame: read the run's Frame once and keep it as `current`. */
  next(r: Run): Frame {
    this.count++;
    const f = frame(r);
    if (f !== this.current) this.changes++;
    this.current = f;
    this.overload = r.play.heat.overload;
    this.readAt = this.count;
    return f;
  }

  /** Forget everything (a scene restart). */
  reset(): void {
    this.count = 0;
    this.readAt = 0;
    this.changes = 0;
    this.current = null;
    this.overload = {};
  }
}
