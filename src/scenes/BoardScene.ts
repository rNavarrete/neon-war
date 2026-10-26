import Phaser from 'phaser';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

// Placeholder board: shows the picked art so the scaffold can be judged in screenshots.
// No game rules here; those arrive in src/sim/ with the first tickets.
export class BoardScene extends Phaser.Scene {
  ready = false;

  constructor() {
    super('board');
  }

  preload(): void {
    this.load.image('board-bg', 'art/board-bg.png');
    this.load.image('db-hot', 'art/db-hot.png');
    this.load.image('partner-worried', 'art/partner-worried.png');
  }

  create(): void {
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'board-bg');
    bg.setScale(Math.max(GAME_WIDTH / bg.width, GAME_HEIGHT / bg.height));

    const db = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'db-hot');
    db.setScale(1.5);

    const frame = this.add.rectangle(24, 24, 184, 188, 0x05070f, 0.85).setOrigin(0);
    frame.setStrokeStyle(2, 0x2de2e6);
    const portrait = this.add.image(32, 32, 'partner-worried').setOrigin(0);
    portrait.setScale(168 / portrait.width);

    this.add
      .text(GAME_WIDTH - 24, GAME_HEIGHT - 24, 'NEON WAR · scaffold', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#2de2e6',
      })
      .setOrigin(1, 1);

    this.ready = true;
  }
}
