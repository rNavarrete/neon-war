import Phaser from 'phaser';
import { SCENES } from './keys';

// The board's HUD, drawn over BoardScene: job card, dial, chart, countdown, banner, barks. Placeholder until B2b.
export class HudScene extends Phaser.Scene {
  constructor() {
    super(SCENES.hud);
  }
}
