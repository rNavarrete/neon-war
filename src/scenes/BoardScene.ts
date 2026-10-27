import Phaser from 'phaser';
import { SCENES } from './keys';

// Desktop only, 16:9: built at 1920x1080 and scaled to fit the window.
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

// Placeholder board: shows the picked Brownout art so the look can be judged in screenshots.
// No game rules here; the board, HUD and story layer arrive with their own tickets.
export class BoardScene extends Phaser.Scene {
  ready = false;

  constructor() {
    super(SCENES.board);
  }

  preload(): void {
    this.load.image('room', 'art/bg/bedroom-lit.webp');
    this.load.image('goggles', 'art/hud/goggles-overlay.webp');
    this.load.image('gateway', 'art/board/gateway.webp');
    this.load.image('server', 'art/board/server.webp');
    this.load.image('database', 'art/board/database.webp');
    this.load.image('lux', 'art/chars/lux/faces-board/tense.webp');
  }

  create(): void {
    // Lux's room behind the board, dimmed as if seen through the goggles.
    const room = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'room');
    room.setScale(Math.max(GAME_WIDTH / room.width, GAME_HEIGHT / room.height));
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05070f, 0.45).setOrigin(0);

    const y = GAME_HEIGHT / 2 + 40;
    const parts: [string, number][] = [
      ['gateway', 0.42],
      ['server', 0.42],
      ['database', 0.42],
    ];
    parts.forEach(([key, scale], i) => {
      this.add.image(GAME_WIDTH / 2 + (i - 1) * 360, y, key).setScale(scale);
    });

    const frame = this.add.rectangle(170, 150, 236, 236, 0x05070f, 0.85).setOrigin(0);
    frame.setStrokeStyle(2, 0x2de2e6);
    const portrait = this.add.image(178, 158, 'lux').setOrigin(0);
    portrait.setScale(220 / Math.max(portrait.width, portrait.height));

    const lens = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'goggles');
    lens.setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    this.add
      .text(GAME_WIDTH - 190, GAME_HEIGHT - 170, 'NEON WAR · Session 0: Brownout', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#2de2e6',
      })
      .setOrigin(1, 1);

    this.ready = true;
  }
}
