// What the story layer reads from the sim: the laundry cut, and the night's numbers for the debrief.
// The rescue's effects (balancer, Ozzie's front, Regroup) and rewinds happen in the sim itself
// (src/sim/play.ts); the story only shows them.

import { run } from '../game/run';
import type { PendingResults } from './debrief';
import type { RewindKind } from './rewind';

export interface StoryWiring {
  /** Did the player cut the laundry floor loose in C4? */
  laundryCut(): boolean;
  /** Anything to do once the rescue scene ends (the sim already applied the rescue). */
  afterRescue(): void;
  /** Put the run back after a rewind screen (default for screens opened without a failure). */
  rewind(kind: RewindKind, target: number): void;
  /** The results only the sim tracks. */
  pendingResults(): PendingResults;
}

export const storyWiring: StoryWiring = {
  laundryCut: () => run().play.laundryCut !== null,
  afterRescue: () => {},
  rewind: (_kind, target) => {
    // A failure rewinds through run().rewind(); a screen forced by a test only moves the clock.
    if (!run().rewind().ok) run().now = target;
  },
  pendingResults: () => {
    const d = run().debrief;
    return {
      droppedRequests: d.dropped,
      wastedCredits: d.wastedCredits,
      scaledDown: d.scaledDown,
      midnightHeld: d.midnightHeld ?? false,
      serversAtMidnight: run().play.midnight?.servers ?? 0,
    };
  },
};
