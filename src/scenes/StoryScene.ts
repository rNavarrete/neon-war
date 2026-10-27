import Phaser from 'phaser';
import { SCENES } from './keys';

// Visual-novel scene player: background, portraits, nameplate, typewriter box, stream chat. Placeholder until B3.
export class StoryScene extends Phaser.Scene {
  constructor() {
    super(SCENES.story);
  }
}
