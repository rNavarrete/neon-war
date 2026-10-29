// Buttons and text shared by the shell scenes (title, pause, settings, overlay), drawn with the
// picked HUD button art. Every button registers its id so the test hook can report where to click.

import Phaser from 'phaser';
import { bus } from '../game/bus';

export const UI_FONT = 'monospace';
export const CYAN = '#2de2e6';
export const MAGENTA = '#ff3fa4';
export const INK = 0x05070f;

const ART: readonly [string, string][] = [
  ['shell:button', 'art/hud/button.webp'],
  ['shell:button-hover', 'art/hud/button-hover.webp'],
  ['shell:button-pressed', 'art/hud/button-pressed.webp'],
];

/** Queue the button art unless another scene already loaded it. */
export function preloadButtons(scene: Phaser.Scene): void {
  for (const [key, file] of ART) if (!scene.textures.exists(key)) scene.load.image(key, file);
}

export interface ShellButton {
  readonly id: string;
  readonly image: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  setText(text: string): void;
  setVisible(visible: boolean): void;
}

const registry = new Map<string, ShellButton & { scene: Phaser.Scene }>();

/**
 * A button from the HUD button art with a text label. Hover and press swap the art; release over the
 * button runs `onClick` and plays the click sound. `scale` sizes the 479x245 art (keep it at or below 1).
 */
export function addButton(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  text: string,
  onClick: () => void,
  scale = 0.6,
  fontSize = 34,
): ShellButton {
  const image = scene.add.image(x, y, 'shell:button').setScale(scale);
  const label = scene.add
    .text(x, y, text, { fontFamily: UI_FONT, fontSize: `${fontSize}px`, color: CYAN, align: 'center' })
    .setOrigin(0.5);
  image.setInteractive({ useHandCursor: true });
  image.on('pointerover', () => {
    image.setTexture('shell:button-hover');
    bus.emit('sfx', { key: 'ui-hover' });
  });
  image.on('pointerout', () => image.setTexture('shell:button'));
  image.on('pointerdown', () => image.setTexture('shell:button-pressed'));
  image.on('pointerup', () => {
    image.setTexture('shell:button-hover');
    bus.emit('sfx', { key: 'ui-click' });
    onClick();
  });
  const button: ShellButton = {
    id,
    image,
    label,
    setText: (t) => label.setText(t),
    setVisible: (v) => {
      image.setVisible(v);
      label.setVisible(v);
      if (!v) image.setTexture('shell:button');
    },
  };
  registry.set(id, { ...button, scene });
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (registry.get(id)?.image === image) registry.delete(id);
  });
  return button;
}

/** A dark panel with a cyan edge, for menus over the board or the skyline. */
export function addPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number): void {
  scene.add.rectangle(x, y, w, h, INK, 0.92).setStrokeStyle(3, 0x2de2e6, 0.9);
}

/** Dim everything under a menu. */
export function addDim(scene: Phaser.Scene, alpha = 0.6): void {
  const { width, height } = scene.scale;
  scene.add.rectangle(0, 0, width, height, INK, alpha).setOrigin(0).setInteractive();
}

/**
 * Where to click each button a player can press right now, in page CSS pixels: only buttons that are
 * visible in a running scene. For the test hook.
 */
export function buttonPositions(
  canvas: DOMRect,
  gameWidth: number,
): Record<string, { x: number; y: number }> {
  const scale = canvas.width / gameWidth;
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, b] of registry) {
    if (!b.scene.sys.isActive() || !b.image.visible || !b.image.input?.enabled) continue;
    out[id] = {
      x: Math.round(canvas.left + b.image.x * scale),
      y: Math.round(canvas.top + b.image.y * scale),
    };
  }
  return out;
}
