// WIRING POINTS FOR ENG-503. The story layer needs a few facts and effects that only ENG-503's sim
// rules provide (the laundry cut, the rescue's gifts, the night's dropped requests). Until it
// merges these are placeholders; the wiring replaces the functions on `storyWiring`, nothing else.

import { run } from '../game/run';
import { runningServers } from '../sim/economy';
import type { PendingResults } from './debrief';
import type { RewindKind } from './rewind';

export interface StoryWiring {
  /** PLACEHOLDER (ENG-503): did the player cut the laundry floor loose in C4? */
  laundryCut(): boolean;
  /** PLACEHOLDER (ENG-503): the rescue's effects once the scene ends (load balancer, Ozzie's front, Regroup). */
  afterRescue(): void;
  /**
   * PLACEHOLDER (ENG-503): put the run back to `target` (credits, parts, trust as they were then).
   * Called when a rewind screen finishes, before the board resumes.
   */
  rewind(kind: RewindKind, target: number): void;
  /** PLACEHOLDER (ENG-503): the results the run does not track yet. */
  pendingResults(): PendingResults;
}

export const storyWiring: StoryWiring = {
  laundryCut: () => false,
  afterRescue: () => {},
  rewind: (_kind, target) => {
    // Only the clock goes back until ENG-503 restores the rest.
    run().now = target;
  },
  pendingResults: () => ({
    droppedRequests: 0,
    wastedCredits: 0,
    scaledDown: false,
    midnightHeld: true,
    serversAtMidnight: runningServers(run().session.board),
  }),
};
