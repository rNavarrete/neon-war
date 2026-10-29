// Turns what the sim did during a frame into the story beats that interrupt the board: the rescue
// scene when the crew arrives, a rewind screen when the board fails, the debrief at 00:01:00.
// The board scene calls flush() right after it ticks the run, so at most one beat starts per frame.

import type Phaser from 'phaser';
import type { Failure } from '../sim/play';
import type { RewindKind } from '../story/rewind';
import { bus } from './bus';
import { playDebrief, playRescue, playRewind } from './flow';
import { run } from './run';

/** Which rewind screen a failure gets: TRIAGE's replay before the crew, Rei's after. */
export function rewindKind(f: Failure): RewindKind {
  if (f.by === 'triage') return 'replay';
  return f.cause === 'dark-at-midnight' ? 'rei-midnight' : 'rei-surge';
}

export class Director {
  private crew = false;
  private failure: Failure | null = null;
  private end = false;
  private offs: (() => void)[];

  constructor() {
    this.offs = [
      bus.on('crewArrived', () => (this.crew = true)),
      bus.on('failure', (f) => (this.failure = f)),
      bus.on('sessionEnd', () => (this.end = true)),
    ];
  }

  /** Start the beat this frame earned, if any. A failure wins: when trust runs out in the surge the
   * crew arrive and Rei rewinds in the same moment, so the rescue scene plays on the replay instead. */
  flush(board: Phaser.Scene): void {
    const { crew, failure, end } = this;
    this.crew = false;
    this.failure = null;
    this.end = false;
    if (failure) {
      playRewind(board, rewindKind(failure), () => {
        run().rewind();
      });
    } else if (crew) {
      playRescue(board);
    } else if (end) {
      playDebrief(board);
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
  }
}
