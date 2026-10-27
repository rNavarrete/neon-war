import Phaser from 'phaser';
import { SCENES } from './keys';

// Settings: volume, text speed, reduce flicker, fullscreen. Placeholder until B4.
export class SettingsScene extends Phaser.Scene {
  constructor() {
    super(SCENES.settings);
  }
}
