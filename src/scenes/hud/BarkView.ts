// The bark as the comms band's current line (ZONES.comms): five crew slots on the left (TRIAGE, REI,
// MIKA, OZZIE, HOUSE; placeholders until the comms lane's view lands), a divider, and the line the
// crew is saying now, from x 1000 wrapped to 760 px. The speaker's slot lights amber and shows their
// face. It never pauses the board, and it is redrawn only when the line changes.
// Geometry from src/scenes/hud/layout.ts BOTTOM, derived from ZONES.comms.

import Phaser from 'phaser';
import { panel } from './panel';
import { portraitFor, speakerName } from '../../game/portraits';
import { LINES, type LineId } from '../../strings';
import { BOTTOM, COLORS, FONT, FONT_SANS, slotFor } from './layout';

export class BarkView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly face: Phaser.GameObjects.Image;
  private readonly name: Phaser.GameObjects.Text;
  private readonly text: Phaser.GameObjects.Text;
  shown: LineId | null = null;

  constructor(scene: Phaser.Scene) {
    const b = BOTTOM.comms;
    const box = panel(scene, 'hud:textbox', b.x, b.y, b.w, b.h, { k: 0.6 });
    const title = scene.add.text(BOTTOM.commsTitle.x, BOTTOM.commsTitle.y, 'COMMS', {
      fontFamily: FONT,
      fontSize: '13px',
      color: COLORS.cyanText,
    });
    const slots = scene.add.graphics();
    const labels: Phaser.GameObjects.Text[] = [];
    for (const s of BOTTOM.slots) {
      slots.fillStyle(COLORS.ink, 0.85);
      slots.fillCircle(s.x, s.y, s.r);
      slots.lineStyle(2, COLORS.unlit, 0.9);
      slots.strokeCircle(s.x, s.y, s.r);
      labels.push(
        scene.add
          .text(s.x, BOTTOM.slotLabelY, s.name, { fontFamily: FONT, fontSize: '12px', color: COLORS.dim })
          .setOrigin(0.5, 0),
      );
    }
    const d = BOTTOM.divider;
    slots.lineStyle(1, COLORS.cyan, 0.35);
    slots.lineBetween(d.x, d.top, d.x, d.bottom);
    this.ring = scene.add.graphics();
    // Parked in the first slot at its fitted size while hidden, so the band's bounds stay its own.
    const first = BOTTOM.slots[0];
    this.face = scene.add.image(first.x, first.y, 'portrait:triage/eager').setVisible(false);
    this.face.setScale(BOTTOM.slotFace / Math.max(this.face.width, this.face.height));
    this.name = scene.add.text(BOTTOM.lineName.x, BOTTOM.lineName.y, '', {
      fontFamily: FONT,
      fontSize: '16px',
      color: COLORS.cyanText,
    });
    this.text = scene.add.text(BOTTOM.lineText.x, BOTTOM.lineText.y, '', {
      fontFamily: FONT_SANS,
      fontSize: '21px',
      color: COLORS.heroText,
      wordWrap: { width: BOTTOM.lineText.w },
      maxLines: 4,
    });
    this.root = scene.add.container(0, 0, [
      box,
      title,
      slots,
      ...labels,
      this.ring,
      this.face,
      this.name,
      this.text,
    ]);
    this.show(null);
  }

  /** The band, for the HUD's bounds check. */
  get container(): Phaser.GameObjects.Container {
    return this.root;
  }

  show(id: LineId | null): void {
    if (id === this.shown && id !== null) return;
    this.shown = id;
    this.ring.clear();
    if (!id) {
      this.face.setVisible(false);
      this.name.setVisible(false);
      this.text.setVisible(false);
      return;
    }
    const l = LINES[id];
    const slot = BOTTOM.slots[slotFor(l.speaker)];
    this.ring.lineStyle(3, COLORS.hero, 1);
    this.ring.strokeCircle(slot.x, slot.y, slot.r);
    const p = portraitFor(l.speaker, 'board');
    this.face.setVisible(p !== null);
    if (p) {
      this.face.setTexture(p.key);
      this.face.setScale(BOTTOM.slotFace / Math.max(this.face.width, this.face.height));
      this.face.setPosition(slot.x, slot.y);
    }
    this.name.setText(speakerName(l.speaker).toUpperCase()).setVisible(true);
    this.text.setText(l.text).setVisible(true);
  }
}
