// The order Session 0 plays in: title, cold open, board, rescue, midnight, debrief. Scenes call
// these instead of starting each other directly, so the story layer owns the order.

import type Phaser from 'phaser';
import { SCENES } from '../scenes/keys';
import { newRun, run } from './run';

/** Start Session 0 from the top with a fresh run. Called by Start on the title screen. */
export function startSession(from: Phaser.Scene): void {
  newRun();
  from.scene.start(SCENES.board);
}

/** Leave the session for the title screen. */
export function quitToTitle(from: Phaser.Scene): void {
  run().paused = true;
  for (const key of [SCENES.hud, SCENES.pause, SCENES.settings]) from.scene.stop(key);
  from.scene.start(SCENES.title);
}
