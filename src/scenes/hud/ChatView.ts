// The chat column in ZONES.chat (the block's chat and Lux's stream merged): the painted panel the
// size of the zone, a header, and a fixed set of rows (avatar, name, line) in the body rect, re-filled
// only when a message arrives. Geometry from src/scenes/hud/layout.ts RIGHT, derived from ZONES.chat.

import Phaser from 'phaser';
import { panel } from './panel';
import { type ChatEntry, avatarFor } from './chat';
import { COLORS, FONT, FONT_SANS } from './layout';

const AVATAR = 36;

interface Row {
  avatar: Phaser.GameObjects.Image;
  dot: Phaser.GameObjects.Arc;
  name: Phaser.GameObjects.Text;
  text: Phaser.GameObjects.Text;
}

export class ChatView {
  private readonly rows: Row[] = [];
  private readonly rowHeight: number;

  /** The painted panel, the size of the chat zone. */
  readonly panel: Phaser.GameObjects.NineSlice;

  constructor(
    scene: Phaser.Scene,
    box: { x: number; y: number; w: number; h: number },
    titleAt: { x: number; y: number },
    body: { x: number; y: number; w: number; h: number; rows: number },
    title: string,
  ) {
    this.panel = panel(scene, 'hud:chat-panel', box.x, box.y, box.w, box.h, {
      k: 0.55,
      slice: [70, 70, 70, 70],
    });
    scene.add.text(titleAt.x, titleAt.y, title, {
      fontFamily: FONT,
      fontSize: '14px',
      color: COLORS.cyanText,
    });
    this.rowHeight = body.h / body.rows;
    for (let i = 0; i < body.rows; i++) {
      const y = body.y + i * this.rowHeight;
      const x = body.x;
      const avatar = scene.add
        .image(x, y + 3, 'avatar:kenji')
        .setOrigin(0)
        .setDisplaySize(AVATAR, AVATAR);
      const dot = scene.add.circle(x + AVATAR / 2, y + 3 + AVATAR / 2, AVATAR / 2 - 4, 0x6a3fb5, 0.9);
      const name = scene.add.text(x + AVATAR + 8, y, '', {
        fontFamily: FONT,
        fontSize: '12px',
        color: COLORS.amberText,
      });
      const text = scene.add.text(x + AVATAR + 8, y + 12, '', {
        fontFamily: FONT_SANS,
        fontSize: '13px',
        color: COLORS.white,
        wordWrap: { width: body.w - AVATAR - 8 },
        maxLines: 2,
      });
      this.rows.push({ avatar, dot, name, text });
    }
    this.show([]);
  }

  /** Show the newest messages, oldest at the top. */
  show(log: readonly ChatEntry[]): void {
    const first = log.length - this.rows.length;
    this.rows.forEach((row, i) => {
      const e = log[first + i];
      const has = e !== undefined;
      row.name.setVisible(has);
      row.text.setVisible(has);
      if (!has) {
        row.avatar.setVisible(false);
        row.dot.setVisible(false);
        return;
      }
      const stem = avatarFor(e.who);
      row.avatar.setVisible(stem !== null);
      row.dot.setVisible(stem === null);
      if (stem) row.avatar.setTexture(`avatar:${stem}`).setDisplaySize(AVATAR, AVATAR);
      row.name.setText(e.who);
      row.text.setText(e.text);
    });
  }
}
