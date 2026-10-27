// The bark box: a small portrait and one line in the bottom-left corner. It never pauses the board.

import Phaser from 'phaser';
import { panel } from './panel';
import { portraitFor, speakerName } from '../../game/portraits';
import { LINES, type LineId } from '../../strings';
import { BOTTOM, COLORS, FONT, FONT_SANS } from './layout';

const FACE = 124;

export class BarkView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly face: Phaser.GameObjects.Image;
  private readonly name: Phaser.GameObjects.Text;
  private readonly text: Phaser.GameObjects.Text;
  shown: LineId | null = null;

  constructor(scene: Phaser.Scene) {
    const b = BOTTOM.bark;
    const box = panel(scene, 'hud:textbox', b.x, b.y, b.w, b.h, { k: 0.6 });
    this.face = scene.add.image(b.x + 18 + FACE / 2, b.y + b.h / 2, 'portrait:triage/eager');
    this.name = scene.add.text(b.x + FACE + 36, b.y + 20, '', {
      fontFamily: FONT,
      fontSize: '17px',
      color: COLORS.cyanText,
    });
    this.text = scene.add.text(b.x + FACE + 36, b.y + 46, '', {
      fontFamily: FONT_SANS,
      fontSize: '21px',
      color: COLORS.white,
      wordWrap: { width: b.w - FACE - 64 },
    });
    this.root = scene.add.container(0, 0, [box, this.face, this.name, this.text]).setVisible(false);
  }

  show(id: LineId | null): void {
    if (id === this.shown) return;
    this.shown = id;
    if (!id) {
      this.root.setVisible(false);
      return;
    }
    const l = LINES[id];
    const p = portraitFor(l.speaker, 'board');
    this.face.setVisible(p !== null);
    if (p) {
      this.face.setTexture(p.key);
      const k = FACE / Math.max(this.face.width, this.face.height);
      this.face.setScale(k);
    }
    const left = p ? BOTTOM.bark.x + FACE + 36 : BOTTOM.bark.x + 28;
    this.name.setX(left).setText(speakerName(l.speaker).toUpperCase());
    this.text.setX(left).setText(l.text);
    this.root.setVisible(true);
  }
}
