import type Phaser from 'phaser';
import { provideTestState } from '../../testHook';
import type { HudTestState } from './hook';

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
 * The depth the gauges lane's Live views draw at: above the HUD's own objects (depth 0), so a view
 * covers the legacy piece it replaces until the HUD scene stops drawing it.
 */
export const GAUGES_DEPTH = 1;

// ---- the gauges lane's sub-sections of the `hud` hook ----
//
// The gauges views (title, clock, deck, the dial card) add their own keys to the `hud` section of the
// read-only test hook (hud.title, hud.headroom, ...). The HUD scene owns the section itself
// (HudScene.snapshot); until the tech lane's provideHudSection lands, this re-provides `hud` as the
// scene's snapshot plus every part registered here. Test mirror only: no view reads it back.

/** The parts the gauges lane adds to the `hud` section, by key. */
const parts = new Map<string, () => unknown>();

/** The HUD scene as this helper needs it: its own snapshot of the section, when it has one. */
type HudSnapshotSource = { snapshot?: () => HudTestState };

/**
 * Add (or replace) `hud.<key>` in the test hook, read from `read` each time the hook is read. Call it
 * from a view's create (after the HUD scene has provided its section); the returned function takes
 * the part out again (call it from shutdown).
 */
export function provideHudPart<K extends keyof HudTestState>(
  scene: Phaser.Scene,
  key: K,
  read: () => HudTestState[K],
): () => void {
  parts.set(key, read);
  const source = scene as unknown as HudSnapshotSource;
  const base = typeof source.snapshot === 'function' ? source.snapshot.bind(scene) : null;
  provideTestState('hud', () => {
    const snap = (base ? base() : {}) as Record<string, unknown>;
    for (const [k, get] of parts) snap[k] = get();
    return snap as unknown as HudTestState;
  });
  return () => {
    if (parts.get(key) === read) parts.delete(key);
  };
}
