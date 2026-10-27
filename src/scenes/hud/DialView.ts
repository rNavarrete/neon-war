// The estimate dial: the painted dial frame with its value drawn in code, minus and plus buttons,
// drag and wheel to turn it, and a SET button. It doesn't know what the value means; the HUD reads
// `value` and decides what SET records (req/s in C1, servers for the midnight sizing prompt).

import Phaser from 'phaser';
import { panel } from './panel';
import { type DialMode, dialFraction, dialValueAt, turnDial } from './dial';
import { COLORS, FONT, RIGHT } from './layout';

const SWEEP_START = 135;
const SWEEP = 270;
/** Offsets inside the painted frame, at the dial's display size (from the 823x835 art). */
const KNOB = { dx: -7, dy: -12, r: 44 };
const RING_R = 92;
const WINDOW = { dx: -7, dy: 70 };

export interface DialHandlers {
  /** The player turned the dial (by any means). */
  touched(): void;
  /** The player pressed SET with this value. */
  set(value: number): void;
}

export class DialView {
  value = 0;
  mode: DialMode = 'reqps';
  /** Locked dials show their value but no longer turn (the answer was recorded). */
  locked = false;
  private readonly root: Phaser.GameObjects.Container;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly valueText: Phaser.GameObjects.Text;
  private readonly label: Phaser.GameObjects.Text;
  private readonly setButton: Phaser.GameObjects.NineSlice;
  private readonly setText: Phaser.GameObjects.Text;
  private shown = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly handlers: DialHandlers,
  ) {
    const d = RIGHT.dial;
    this.root = scene.add.container(0, 0);
    this.label = scene.add
      .text(RIGHT.dialLabel.x, RIGHT.dialLabel.y, '', {
        fontFamily: FONT,
        fontSize: '17px',
        color: COLORS.cyanText,
      })
      .setOrigin(0.5);
    const face = scene.add.image(d.x, d.y, 'hud:estimate-dial').setDisplaySize(d.size, d.size * (835 / 823));
    face.setInteractive({ useHandCursor: true, draggable: false });
    face.on('pointerdown', (p: Phaser.Input.Pointer) => this.turnTo(p));
    face.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.turnTo(p);
    });
    face.on('wheel', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => this.step(dy > 0 ? -1 : 1));
    this.g = scene.add.graphics();
    this.valueText = scene.add
      .text(d.x + WINDOW.dx, d.y + WINDOW.dy, '', { fontFamily: FONT, fontSize: '26px', color: COLORS.white })
      .setOrigin(0.5);

    const minus = this.roundButton(RIGHT.dialMinus.x, RIGHT.dialMinus.y, '−', () => this.step(-1));
    const plus = this.roundButton(RIGHT.dialPlus.x, RIGHT.dialPlus.y, '+', () => this.step(1));

    const s = RIGHT.dialSet;
    this.setButton = panel(scene, 'hud:button', s.x, s.y, s.w, s.h, {
      k: 0.4,
      slice: [70, 70, 60, 60],
      centred: true,
    });
    this.setButton.setInteractive({ useHandCursor: true });
    this.setButton.on('pointerover', () => this.setButton.setTexture('hud:button-hover'));
    this.setButton.on('pointerout', () => this.setButton.setTexture('hud:button'));
    this.setButton.on('pointerdown', () => {
      if (this.locked) return;
      this.setButton.setTexture('hud:button-pressed');
      this.handlers.set(this.value);
    });
    this.setText = scene.add
      .text(s.x, s.y, 'SET', { fontFamily: FONT, fontSize: '22px', color: COLORS.cyanText })
      .setOrigin(0.5);

    this.root.add([
      this.label,
      face,
      this.g,
      this.valueText,
      ...minus,
      ...plus,
      this.setButton,
      this.setText,
    ]);
    this.root.setVisible(false);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(v: boolean): void {
    this.root.setVisible(v);
  }

  /** Switch what the dial counts; the value starts again from zero in the new mode. */
  setMode(mode: DialMode, label: string): void {
    if (mode !== this.mode) {
      this.mode = mode;
      this.value = 0;
      this.locked = false;
    }
    this.label.setText(label);
  }

  /** Back to zero and unlocked (a new run). */
  reset(): void {
    this.value = 0;
    this.locked = false;
  }

  lock(value: number): void {
    this.value = value;
    this.locked = true;
  }

  /** Redraw the needle and the value (cheap; only re-sets text when it changes). */
  draw(): void {
    const d = RIGHT.dial;
    const angle = Phaser.Math.DegToRad(SWEEP_START + SWEEP * dialFraction(this.value, this.mode));
    const cx = d.x + KNOB.dx;
    const cy = d.y + KNOB.dy;
    const g = this.g;
    g.clear();
    g.lineStyle(5, this.locked ? COLORS.cyan : COLORS.magenta, 1);
    g.lineBetween(
      cx + Math.cos(angle) * 12,
      cy + Math.sin(angle) * 12,
      cx + Math.cos(angle) * KNOB.r,
      cy + Math.sin(angle) * KNOB.r,
    );
    g.fillStyle(this.locked ? COLORS.cyan : COLORS.magenta, 1);
    g.fillCircle(cx + Math.cos(angle) * RING_R, cy + Math.sin(angle) * RING_R, 6);
    const text = String(this.value);
    if (text !== this.shown) {
      this.shown = text;
      this.valueText.setText(text);
    }
    this.setButton.setAlpha(this.locked ? 0.45 : 1);
    this.setText.setAlpha(this.locked ? 0.45 : 1);
  }

  private step(steps: number): void {
    if (this.locked) return;
    this.value = turnDial(this.value, steps, this.mode);
    this.handlers.touched();
  }

  private turnTo(p: Phaser.Input.Pointer): void {
    if (this.locked) return;
    const d = RIGHT.dial;
    const dx = p.worldX - (d.x + KNOB.dx);
    const dy = p.worldY - (d.y + KNOB.dy);
    if (Math.hypot(dx, dy) < 20 || dy > 60) return;
    let deg = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
    if (deg < SWEEP_START - 45) deg += 360;
    this.value = dialValueAt((deg - SWEEP_START) / SWEEP, this.mode);
    this.handlers.touched();
  }

  private roundButton(
    x: number,
    y: number,
    glyph: string,
    onPress: () => void,
  ): Phaser.GameObjects.GameObject[] {
    const r = RIGHT.dialMinus.r;
    const disc = this.scene.add.circle(x, y, r, COLORS.ink, 0.85).setStrokeStyle(2, COLORS.cyan);
    disc.setInteractive({ useHandCursor: true });
    disc.on('pointerover', () => disc.setFillStyle(0x12304a, 0.95));
    disc.on('pointerout', () => disc.setFillStyle(COLORS.ink, 0.85));
    disc.on('pointerdown', onPress);
    const t = this.scene.add
      .text(x, y, glyph, { fontFamily: FONT, fontSize: '32px', color: COLORS.cyanText })
      .setOrigin(0.5);
    return [disc, t];
  }
}
