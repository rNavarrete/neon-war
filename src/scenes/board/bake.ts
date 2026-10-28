// Fixed words drawn once into a texture (board-11): the bank marks, ROOM, REPLACE, the SKIPPED
// tags and the inventory cards' names and prices never change, so each is baked from a Text the
// first time it is needed and shown as an Image. The board keeps the same words on screen with
// fewer live Text objects (docs/LIVE.md: the board's share is 28 texts).

import type Phaser from 'phaser';

/**
 * The texture key for `text` in `style`, baked on first use: a Text made off the display list,
 * its canvas copied into a texture of its own, and the Text destroyed. Same words and style, same key.
 */
export function bakeLabel(
  scene: Phaser.Scene,
  id: string,
  text: string,
  style: Phaser.Types.GameObjects.Text.TextStyle,
): string {
  const key = `label:${id}`;
  if (scene.textures.exists(key)) return key;
  const t = scene.make.text({ x: 0, y: 0, text, style }, false);
  const src = t.canvas;
  const copy = document.createElement('canvas');
  copy.width = Math.max(1, src.width);
  copy.height = Math.max(1, src.height);
  copy.getContext('2d')?.drawImage(src, 0, 0);
  scene.textures.addCanvas(key, copy);
  t.destroy();
  return key;
}

/** A baked label as an Image on the display list, at (x, y). */
export function addLabel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  id: string,
  text: string,
  style: Phaser.Types.GameObjects.Text.TextStyle,
): Phaser.GameObjects.Image {
  return scene.add.image(x, y, bakeLabel(scene, id, text, style));
}
