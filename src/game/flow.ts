// The order Session 0 plays in: title, cold open, board, rescue, midnight, debrief. Scenes call
// these instead of starting each other directly, so the story layer owns the order.
//
// Wiring after ENG-503: the sim's rescue trigger calls playRescue(boardScene); a failure calls
// playRewind(boardScene, rewindKindFor(run().now, rescued)); the end of C7 calls playDebrief(boardScene).
// The facts and effects only ENG-503 knows go through src/story/wiring.ts.

import type Phaser from 'phaser';
import { SCENES } from '../scenes/keys';
import { BROWNOUT } from '../sim/brownout';
import { type DebriefResults, debriefResults } from '../story/debrief';
import { type RewindKind, rewindTarget } from '../story/rewind';
import type { ScriptId } from '../story/scripts';
import { storyState } from '../story/state';
import { storyWiring } from '../story/wiring';
import { newRun, run } from './run';

/** What the story scene is asked to play, and what happens when it ends. */
export interface StoryData {
  scriptId: ScriptId;
  laundryCut?: boolean;
  /** For a rewind screen: the clock it counts back from and to. */
  rewind?: { kind: RewindKind; from: number; target: number };
  /** Called once, with the story scene, when it has finished (or was skipped). */
  onDone: (story: Phaser.Scene) => void;
}

/** The scenes a story overlay pauses underneath it (the board and its HUD), if they are running. */
const UNDER = [SCENES.board, SCENES.hud] as const;

/** Start Session 0 from the top with a fresh run: the cold open, then the board at C1. */
export function startSession(from: Phaser.Scene): void {
  newRun();
  run().hold('scene');
  for (const key of [SCENES.board, SCENES.hud, SCENES.pause, SCENES.settings, SCENES.debrief]) {
    if (key !== from.scene.key) from.scene.stop(key);
  }
  const data: StoryData = {
    scriptId: 'C0',
    onDone: (story) => {
      run().now = BROWNOUT.challenges.c1;
      run().release('scene');
      // The board launches the HUD, whose job card holds the run until it is clicked away.
      story.scene.start(SCENES.board);
    },
  };
  // A scene can't launch itself: from the story scene, restart it with the cold open instead.
  from.scene.start(SCENES.story, data);
}

/**
 * Play a story scene over the board: hold the run, pause the board and HUD under it, and when the
 * scene ends put everything back (or start the board if it wasn't running) and call `after`.
 */
function playOver(from: Phaser.Scene, data: Omit<StoryData, 'onDone'>, after: () => void): void {
  const sp = from.scene;
  run().hold('scene');
  const paused = UNDER.filter((k) => sp.isActive(k));
  for (const k of paused) sp.pause(k);
  const story: StoryData = {
    ...data,
    onDone: (scene) => {
      after();
      run().release('scene');
      for (const k of paused) scene.scene.resume(k);
      if (paused.length === 0) scene.scene.start(SCENES.board);
      else scene.scene.stop();
    },
  };
  if (sp.key === SCENES.story) {
    sp.restart(story);
    return;
  }
  sp.stop(SCENES.story);
  sp.run(SCENES.story, story);
  sp.bringToTop(SCENES.story);
}

/**
 * The rescue (C5): the crew's scene over the full-immersive backdrop, then back to the board.
 * `laundryCut` defaults to what the run says (ENG-503); tests may force it.
 */
export function playRescue(from: Phaser.Scene, opts: { laundryCut?: boolean } = {}): void {
  const laundryCut = opts.laundryCut ?? storyWiring.laundryCut();
  playOver(from, { scriptId: 'C5', laundryCut }, () => storyWiring.afterRescue());
}

const REWIND_SCRIPT: Record<RewindKind, ScriptId> = {
  replay: 'rewind-replay',
  'rei-surge': 'rewind-rei-surge',
  'rei-midnight': 'rewind-rei-midnight',
};

/**
 * A rewind screen: TRIAGE's stream replay ('replay', back to the start of the current challenge)
 * or Rei's ('rei-surge' to the surge start, 'rei-midnight' to 23:59). When it ends `onRewind` puts
 * the run back to the target time (ENG-503 restores credits, parts and trust), then the board resumes.
 */
export function playRewind(
  from: Phaser.Scene,
  kind: RewindKind,
  onRewind: (target: number) => void = (target) => storyWiring.rewind(kind, target),
): void {
  const now = run().now;
  const target = rewindTarget(kind, now);
  storyState.rewind = { kind, target };
  playOver(from, { scriptId: REWIND_SCRIPT[kind], rewind: { kind, from: now, target } }, () =>
    onRewind(target),
  );
}

/** The night's results from the run, with what only ENG-503 knows from src/story/wiring.ts. */
export function defaultDebriefResults(): DebriefResults {
  return debriefResults(run().session, run().notes, storyWiring.pendingResults());
}

/** The debrief (C8), the interview-version card, Night Book page 1 and the title card. */
export function playDebrief(from: Phaser.Scene, results: DebriefResults = defaultDebriefResults()): void {
  run().hold('scene');
  for (const key of [SCENES.hud, SCENES.pause, SCENES.settings, SCENES.story, SCENES.board]) {
    if (key !== from.scene.key) from.scene.stop(key);
  }
  from.scene.start(SCENES.debrief, { results });
}

/** Leave the session for the title screen. */
export function quitToTitle(from: Phaser.Scene): void {
  run().hold('quit');
  for (const key of [SCENES.hud, SCENES.pause, SCENES.settings, SCENES.story, SCENES.debrief]) {
    if (key !== from.scene.key) from.scene.stop(key);
  }
  from.scene.start(SCENES.title);
}
