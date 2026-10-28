// The estimate dial on its card over the feed (CARDS.dialCard): the painted 230 px dial frame with
// its value drawn in code, minus and plus buttons in the card's lower corners, drag and wheel to
// turn it. SET is the deck's key 3 (the HUD calls pressSet). It doesn't know what the value means;
// the HUD reads `value` and decides what SET records (req/s in C1, servers for the sizing prompt).
// Geometry from src/scenes/hud/layout.ts RIGHT, derived from CARDS.dialCard.

import Phaser from 'phaser';
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
  private shown = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly handlers: DialHandlers,
  ) {
    const d = RIGHT.dial;
    const c = RIGHT.dialCard;
    this.root = scene.add.container(0, 0);
    const card = scene.add.graphics();
    card.fillStyle(COLORS.ink, 0.88);
    card.fillRoundedRect(c.x, c.y, c.w, c.h, 14);
    card.lineStyle(2, COLORS.cyan, 0.7);
    card.strokeRoundedRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2, 14);
    this.label = scene.add
      .text(RIGHT.dialLabel.x, RIGHT.dialLabel.y, '', {
        fontFamily: FONT,
        fontSize: '14px',
        color: COLORS.cyanText,
        backgroundColor: 'rgba(5,7,15,0.85)',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5, 0);
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

    this.root.add([card, face, this.g, this.valueText, ...minus, ...plus, this.label]);
    this.root.setVisible(false);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** The dial and its card, for the HUD's bounds check. */
  get container(): Phaser.GameObjects.Container {
    return this.root;
  }

  /** SET (the deck's key 3 or the keyboard): record the value unless the dial is locked or hidden. */
  pressSet(): boolean {
    if (this.locked || !this.root.visible) return false;
    this.handlers.set(this.value);
    return true;
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
