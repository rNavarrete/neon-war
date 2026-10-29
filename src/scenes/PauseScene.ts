import Phaser from 'phaser';
import { quitToTitle, startSession } from '../game/flow';
import { run } from '../game/run';
import { SCENES } from './keys';
import { MAGENTA, UI_FONT, addButton, addDim, addPanel, preloadButtons } from './shellUi';

const W = 1920;

/** Open the pause menu over the board: hold the sim and pause the board and HUD scenes. */
export function openPause(from: Phaser.Scene): void {
  if (!from.scene.isActive(SCENES.board)) return;
  run().hold('pause');
  from.scene.pause(SCENES.board);
  if (from.scene.isActive(SCENES.hud)) from.scene.pause(SCENES.hud);
  from.scene.launch(SCENES.pause);
}

// Pause menu over the board: Resume, Restart session, Settings, Quit to title.
export class PauseScene extends Phaser.Scene {
  ready = false;

  constructor() {
    super(SCENES.pause);
  }

  preload(): void {
    preloadButtons(this);
  }

  create(): void {
    this.ready = false;
    addDim(this, 0.55);
    addPanel(this, W / 2, 530, 640, 800);
    this.add
      .text(W / 2, 210, 'PAUSED', { fontFamily: UI_FONT, fontSize: '52px', color: MAGENTA })
      .setOrigin(0.5);
    addButton(this, 'resume', W / 2, 360, 'RESUME', () => this.resumeGame(), 0.6, 30);
    addButton(this, 'restart', W / 2, 510, 'RESTART SESSION', () => this.restart(), 0.6, 26);
    addButton(this, 'pauseSettings', W / 2, 660, 'SETTINGS', () => this.openSettings(), 0.6, 30);
    addButton(this, 'quit', W / 2, 810, 'QUIT TO TITLE', () => this.quit(), 0.6, 26);
    this.ready = true;
  }

  /** Close the menu and let the board run again. */
  resumeGame(): void {
    run().release('pause');
    if (this.scene.isPaused(SCENES.board)) this.scene.resume(SCENES.board);
    if (this.scene.isPaused(SCENES.hud)) this.scene.resume(SCENES.hud);
    this.scene.stop();
  }

  private restart(): void {
    run().release('pause');
    this.scene.stop(SCENES.hud);
    this.scene.stop(SCENES.board);
    startSession(this);
  }

  private openSettings(): void {
    this.scene.pause();
    this.scene.launch(SCENES.settings, { from: SCENES.pause });
  }

  private quit(): void {
    run().release('pause');
    this.scene.stop(SCENES.board);
    quitToTitle(this);
  }
}
