// One chat panel (the block chat or Lux's stream chat): the painted panel, a header, and a fixed set
// of rows (avatar, name, line) that are re-filled only when a message arrives.

import Phaser from 'phaser';
import { panel } from './panel';
import { type ChatEntry, avatarFor } from './chat';
import { COLORS, FONT, FONT_SANS } from './layout';

const AVATAR = 40;
const PAD = 22;

interface Row {
  avatar: Phaser.GameObjects.Image;
  dot: Phaser.GameObjects.Arc;
  name: Phaser.GameObjects.Text;
  text: Phaser.GameObjects.Text;
}

export class ChatView {
  private readonly rows: Row[] = [];
  private readonly rowHeight: number;

  constructor(
    scene: Phaser.Scene,
    box: { x: number; y: number; w: number; h: number; rows: number },
    title: string,
  ) {
    panel(scene, 'hud:chat-panel', box.x, box.y, box.w, box.h, { k: 0.55, slice: [70, 70, 70, 70] });
    scene.add.text(box.x + PAD + 4, box.y + 18, title, {
      fontFamily: FONT,
      fontSize: '15px',
      color: COLORS.cyanText,
    });
    const top = box.y + 46;
    this.rowHeight = (box.h - 46 - PAD) / box.rows;
    for (let i = 0; i < box.rows; i++) {
      const y = top + i * this.rowHeight;
      const x = box.x + PAD;
      const avatar = scene.add
        .image(x, y + 2, 'avatar:kenji')
        .setOrigin(0)
        .setDisplaySize(AVATAR, AVATAR);
      const dot = scene.add.circle(x + AVATAR / 2, y + 2 + AVATAR / 2, AVATAR / 2 - 4, 0x6a3fb5, 0.9);
      const name = scene.add.text(x + AVATAR + 10, y, '', {
        fontFamily: FONT,
        fontSize: '13px',
        color: COLORS.amberText,
      });
      const text = scene.add.text(x + AVATAR + 10, y + 16, '', {
        fontFamily: FONT_SANS,
        fontSize: '15px',
        color: COLORS.white,
        wordWrap: { width: box.w - PAD * 2 - AVATAR - 16 },
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
