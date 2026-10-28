import type Phaser from 'phaser';
import { provideTestState } from '../../testHook';
import { type HudTestState, hudSection, provideHudSection } from './hook';

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

/**
 * The depth the gauges lane's Live views draw at: above the HUD's own objects (depth 0) and the
 * placeholders (depth -10).
 */
export const GAUGES_DEPTH = 1;

/** The HUD scene as provideHudPart needs it: its own snapshot of the section, when it has one. */
type HudSnapshotSource = { snapshot?: () => HudTestState };

/**
 * Add (or replace) `hud.<key>` in the test hook: provideHudSection (src/scenes/hud/hook.ts) under
 * the name the gauges views already call; new code calls provideHudSection directly. The returned
 * function takes the key out again (call it from shutdown).
 *
 * It also re-provides `hud` as hudSection over the scene's snapshot, exactly what HudScene provides
 * (an equal reader, so the section stays one snapshot); the gauges unit tests read `hud` through a
 * mocked provideTestState and see their keys that way, with no HudScene.
 */
export function provideHudPart<K extends keyof HudTestState>(
  scene: Phaser.Scene,
  key: K,
  read: () => HudTestState[K],
): () => void {
  const off = provideHudSection(key, read);
  const source = scene as unknown as HudSnapshotSource;
  const base = typeof source.snapshot === 'function' ? source.snapshot.bind(scene) : null;
  provideTestState('hud', () => hudSection(base ? base() : ({} as HudTestState)));
  return off;
}
