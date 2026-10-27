import Phaser from 'phaser';
import { SCENES } from './keys';

// Pause menu over the board: Resume, Restart session, Settings, Quit to title. Placeholder until B4.
export class PauseScene extends Phaser.Scene {
  constructor() {
    super(SCENES.pause);
  }
}
