import Phaser from 'phaser';

/**
 * A painted frame stretched to w x h without distorting its corners: a nine-slice built at 1/k of
 * the size and scaled down by k, so the corners shrink with the rest of the painted HUD instead of
 * showing at full size. The origin is top-left unless `centred`.
 */
export function panel(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { k?: number; slice?: [number, number, number, number]; centred?: boolean } = {},
): Phaser.GameObjects.NineSlice {
  const k = opts.k ?? 0.5;
  const [l, r, t, b] = opts.slice ?? [70, 70, 50, 50];
  const s = scene.add.nineslice(x, y, key, undefined, w / k, h / k, l, r, t, b).setScale(k);
  return opts.centred ? s : s.setOrigin(0);
}
