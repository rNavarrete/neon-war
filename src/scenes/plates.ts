// Art with stand-ins: every requested key (src/game/artManifest.ts ART_REQUESTS) resolves to a
// texture the scene can draw today. A picked file is used as it is; until it is picked, the key's
// fallback draws instead: a picked file reused with a tint, or a plate baked once in code at the
// key's display size, tinted and labelled with the key. When the owner drops a picked file and sets
// its cut size in the manifest, preloadArt starts loading it and resolveArt returns it; no view
// changes.
//
// Phaser is a type here only, so the resolution, the bake and the hook section are unit-tested in
// node against a stub scene (tests/art-plates.test.ts). Views adopt it one lane at a time
// (board-12, comms-9, chat-6, luxcam-5); nothing calls it from BoardScene or the HUD yet.

import type Phaser from 'phaser';
import { type ArtRequest, ART_REQUESTS, artRequest, isPicked, requestFile } from '../game/artManifest';
import { provideTestState } from '../testHook';

/** What a view draws for a key: the texture, and the tint and alpha to draw it with. */
export interface ResolvedArt {
  readonly key: string;
  /** A texture key in the scene's texture manager. */
  readonly texture: string;
  readonly tint: number;
  readonly alpha: number;
  /** True while the key's picked file is not in, so a stand-in draws. */
  readonly fallback: boolean;
}

/** The texture key a file under public/ loads as: 'art/board/server.webp' -> 'art:board/server'. */
export function fileTexture(file: string): string {
  return `art:${file.replace(/^art\//, '').replace(/\.webp$/, '')}`;
}

/** The texture a picked request loads as; the same as fileTexture of its file. */
export function artTexture(key: string): string {
  return fileTexture(requestFile(key));
}

/** The texture a key's baked stand-in is drawn into. */
export function standInTexture(key: string): string {
  return `art-standin:${key}`;
}

/** No tint: Phaser multiplies by white. */
const WHITE = 0xffffff;

/** A baked plate's fill when the key is unknown or its fallback is a reused file that did not load. */
const PLATE = 0x0b1424;

/** The size a stand-in is baked at for a key the manifest doesn't know. */
const UNKNOWN_SIZE = { w: 64, h: 64 } as const;

function bakedFor(key: string, alpha: number): ResolvedArt {
  return { key, texture: standInTexture(key), tint: WHITE, alpha, fallback: true };
}

/**
 * What draws for a key, from the manifest alone: the picked file once its cut size is set, else the
 * fallback's reused file with its tint, else the baked stand-in. Pure.
 */
export function resolveArt(key: string): ResolvedArt {
  const r = artRequest(key);
  if (!r) return bakedFor(key, 1);
  if (isPicked(r)) return { key, texture: artTexture(key), tint: WHITE, alpha: 1, fallback: false };
  const f = r.fallback;
  if (f.kind === 'reuse')
    return { key, texture: fileTexture(f.file), tint: f.tint, alpha: f.alpha, fallback: true };
  return bakedFor(key, f.alpha);
}

/** A texture to queue for a key and the file it loads from. */
export interface ArtFile {
  readonly texture: string;
  readonly file: string;
}

/** The files that resolving `keys` needs loaded: picked files and reused fallbacks, each once. Pure. */
export function artFiles(keys: readonly string[]): ArtFile[] {
  const out: ArtFile[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const r = artRequest(key);
    if (!r) continue;
    const file = isPicked(r) ? requestFile(key) : r.fallback.kind === 'reuse' ? r.fallback.file : null;
    if (!file || seen.has(file)) continue;
    seen.add(file);
    out.push({ texture: fileTexture(file), file });
  }
  return out;
}

/** The texture calls the plates need, so a node test can hand in a stub. */
export interface TexturesLike {
  exists(key: string): boolean;
}

/** The scene calls the plates need. */
export interface PlateScene {
  readonly textures: TexturesLike & {
    addDynamicTexture(key: string, width?: number, height?: number): Phaser.Textures.DynamicTexture | null;
  };
  readonly load: { image(key: string, url: string): unknown };
  readonly make: {
    graphics(config?: object, addToScene?: boolean): Phaser.GameObjects.Graphics;
    text(config: Phaser.Types.GameObjects.Text.TextConfig, addToScene?: boolean): Phaser.GameObjects.Text;
  };
}

/** Queue the files `keys` need; call from a scene's preload. Files already loaded are skipped. */
export function preloadArt(scene: PlateScene, keys: readonly string[]): void {
  for (const { texture, file } of artFiles(keys))
    if (!scene.textures.exists(texture)) scene.load.image(texture, file);
}

/** Keys baked so far, in the order they were baked (the texture manager is the game's, so this is too). */
const baked: string[] = [];

/** The rim is the fill lifted toward amber, so every stand-in reads as a plate, not a hole. */
function rimOf(color: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + 0x90);
  const g = Math.min(255, ((color >> 8) & 0xff) + 0x60);
  const b = Math.min(255, (color & 0xff) + 0x20);
  return (r << 16) | (g << 8) | b;
}

/** The size and fill a key's stand-in is baked at. */
function plateFor(r: ArtRequest | undefined): { w: number; h: number; color: number } {
  if (!r) return { ...UNKNOWN_SIZE, color: PLATE };
  const w = Math.max(2, Math.round(r.display.w));
  const h = Math.max(2, Math.round(r.display.h));
  return { w, h, color: r.fallback.kind === 'bake' ? r.fallback.color : PLATE };
}

/** Bake a key's stand-in once: a filled plate in its display size with a rim and the key as a label. */
function bakeStandIn(scene: PlateScene, key: string): void {
  const texture = standInTexture(key);
  if (scene.textures.exists(texture)) return;
  const { w, h, color } = plateFor(artRequest(key));
  const dt = scene.textures.addDynamicTexture(texture, w, h);
  if (!dt) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(color, 1);
  g.fillRect(0, 0, w, h);
  g.lineStyle(2, rimOf(color), 1);
  g.strokeRect(1, 1, w - 2, h - 2);
  const label = scene.make.text(
    {
      x: w / 2,
      y: h / 2,
      text: key,
      style: { fontFamily: 'monospace', fontSize: '14px', color: '#c9b48a' },
    },
    false,
  );
  label.setOrigin(0.5);
  if (label.width > w - 8) label.setScale(Math.max(0.1, (w - 8) / label.width));
  dt.draw(g);
  dt.draw(label);
  dt.render();
  g.destroy();
  label.destroy();
  baked.push(key);
}

/**
 * The art to draw for a key in this scene. Uses what resolveArt names when that texture is loaded;
 * otherwise (the reused file was not queued, or the key is unknown) bakes the stand-in once and
 * returns it. Call after preload, outside the update loop: the bake allocates once per key.
 */
export function ensureArt(scene: PlateScene, key: string): ResolvedArt {
  const r = resolveArt(key);
  if (scene.textures.exists(r.texture)) return r;
  bakeStandIn(scene, key);
  const f = artRequest(key)?.fallback;
  return bakedFor(key, f?.kind === 'bake' ? f.alpha : 1);
}

// --- Test hook -----------------------------------------------------------------------------------

export interface ArtTestState {
  /** Every requested key not yet picked, in manifest order: these draw a stand-in. */
  fallback: string[];
  /** Every picked key whose texture is loaded in the game. */
  loaded: string[];
  /** Keys whose stand-in plate has been baked so far, in bake order. */
  baked: string[];
  /**
   * Objects on the running scenes that draw Phaser's missing-texture stand-in ('<scene>:<type>'),
   * which Phaser falls back to without a console line when a texture key is unknown.
   */
  missing: string[];
}

declare module '../testHook' {
  interface TestSections {
    art: ArtTestState;
  }
}

/** The least of a display object the missing-texture scan reads; a Container carries `list`. */
export interface DrawnObject {
  readonly type: string;
  readonly texture?: { readonly key: string } | null;
  readonly list?: readonly DrawnObject[];
}

/** The least of a running scene the scan reads. */
export interface DrawnScene {
  readonly sys: { readonly settings: { readonly key: string } };
  readonly children: { readonly list: readonly DrawnObject[] };
}

/** Phaser's texture key for an unknown texture. */
const MISSING_TEXTURE = '__MISSING';

/** Every object on `scenes` (inside containers too) drawing the missing texture, as '<scene>:<type>'. Pure. */
export function missingDrawn(scenes: readonly DrawnScene[]): string[] {
  const out: string[] = [];
  const walk = (scene: string, list: readonly DrawnObject[]): void => {
    for (const o of list) {
      if (o.texture?.key === MISSING_TEXTURE) out.push(`${scene}:${o.type}`);
      if (o.list) walk(scene, o.list);
    }
  };
  for (const s of scenes) walk(s.sys.settings.key, s.children.list);
  return out;
}

/** The `art` section for a texture manager (or none, before the game has one) and the running scenes. Pure. */
export function artTestState(
  textures: TexturesLike | null,
  scenes: readonly DrawnScene[] = [],
): ArtTestState {
  return {
    fallback: ART_REQUESTS.filter((r) => !isPicked(r)).map((r) => r.key),
    loaded: ART_REQUESTS.filter(
      (r) => isPicked(r) && textures !== null && textures.exists(artTexture(r.key)),
    ).map((r) => r.key),
    baked: [...baked],
    missing: missingDrawn(scenes),
  };
}

/** The least of a Phaser game the hook reads. */
export interface HookGame {
  readonly textures: TexturesLike;
  readonly scene: { getScenes(isActive?: boolean): readonly DrawnScene[] };
}

/**
 * Publish the `art` section of the test hook for a game. Read only when a test reads the hook, never
 * per frame; cheap when the hook is off.
 */
export function installArtHook(game: HookGame): void {
  provideTestState('art', () => artTestState(game.textures, game.scene.getScenes(true)));
}

/** Forget what was baked; for tests that start a fresh texture manager. */
export function resetBakedForTests(): void {
  baked.length = 0;
}
