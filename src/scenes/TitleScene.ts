import Phaser from 'phaser';
import { SCENES } from './keys';

// Title screen: logo over the skyline with Start, Settings and Credits. Placeholder until B4.
export class TitleScene extends Phaser.Scene {
  constructor() {
    super(SCENES.title);
  }
}
