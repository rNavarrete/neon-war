// Round avatars (art3d-4): the one cropper for the COMMS band, the chat rows and the title avatar.
// roundAvatar(scene, key, size) bakes a key's picture into a size x size DynamicTexture once: it
// stamps the picture scaled and shifted so the face square (src/scenes/avatarCrop.ts faceCrop) fills
// the bake, and erases the four corners outside the disc in the same render, a one-shot mask. Every
// later call with that key and size returns the same texture, so nothing masks per frame and no mask
// or filter object lives on screen (Phaser 4 WebGL has no GeometryMask).
//
// The picture comes from the art manifest: a requested key (chars/comms/rei) draws its picked file
// once the owner's drop sets its cut size, and until then its fallback (rei's smirk face, or a baked
// stand-in plate through ensureArt); a picked file's key (chars/avatars/kenji, chars/rei/faces/stern)
// draws that file. So the new sheets slot in by manifest key and no view changes.
//
// Phaser is a type here only, so the bake is unit-tested in node against a stub scene
// (tests/avatar-crop.test.ts). No view uses it yet: the comms lane adopts it next.

import type Phaser from 'phaser';
import { artRequest, isPicked, pickedArt, requestFile } from '../game/artManifest';
import { provideTestState } from '../testHook';
import { avatarTexture, circleCorners, faceCrop, focusFor } from './avatarCrop';
import { type ArtFile, type PlateScene, ensureArt, fileTexture, resolveArt, standInTexture } from './plates';

/** The COMMS band's faces, slot by slot (05-comms.md, decision D4). HOUSE is a chip, door or TV. */
export const COMMS_AVATARS = {
  TRIAGE: 'chars/comms/triage',
  REI: 'chars/comms/rei',
  MIKA: 'chars/comms/mika',
  OZZIE: 'chars/comms/ozzie',
  HOUSE: ['hud/icons/door', 'hud/icons/tv'],
} as const;

/** The block's residents in the chat rows (picked files) by the script's speaker name. */
export const BLOCK_AVATARS: Readonly<Record<string, string>> = {
  kenji: 'chars/avatars/kenji',
  'mrs okafor': 'chars/avatars/mrs-okafor',
  'young father': 'chars/avatars/young-father',
  'old man noodles': 'chars/avatars/old-man-noodles',
  'unnamed neighbour': 'chars/avatars/unnamed-neighbour',
};

/** The stream viewers' avatars in the chat rows (requested; baked stand-ins until picked). */
export const STREAM_AVATARS: readonly string[] = [1, 2, 3, 4].map((n) => `chars/avatars/stream-${n}`);

/** Lux_Net's profile picture in the title cluster. */
export const TITLE_AVATAR = 'hud/live/avatar-luxnet';

/** Every key a round avatar is drawn for today: comms slots and chips, chat rows, the title. */
export const AVATAR_KEYS: readonly string[] = [
  COMMS_AVATARS.TRIAGE,
  COMMS_AVATARS.REI,
  COMMS_AVATARS.MIKA,
  COMMS_AVATARS.OZZIE,
  ...COMMS_AVATARS.HOUSE,
  ...Object.values(BLOCK_AVATARS),
  ...STREAM_AVATARS,
  TITLE_AVATAR,
];

/** Where a round avatar's picture comes from. */
export interface AvatarSource {
  /** The texture the bake stamps from. */
  readonly texture: string;
  /** The file under public/ that texture loads from, or null for a baked stand-in. */
  readonly file: string | null;
  /** The tint and alpha the fallback asks the view to draw with (white and 1 for a picked file). */
  readonly tint: number;
  readonly alpha: number;
  /** True while a requested key's picked file is not in. */
  readonly fallback: boolean;
}

/**
 * The picture for a key: a requested key's picked file, else its reused file, else its stand-in;
 * a picked file's key ('chars/avatars/kenji') that file; anything else a stand-in. `request` is
 * the manifest's entry, passed in by tests to stand for a pick that has landed. Pure.
 */
export function avatarSource(key: string, request = artRequest(key)): AvatarSource {
  if (request) {
    if (isPicked(request)) {
      const file = requestFile(key);
      return { texture: fileTexture(file), file, tint: 0xffffff, alpha: 1, fallback: false };
    }
    const r = resolveArt(key);
    const file = request.fallback.kind === 'reuse' ? request.fallback.file : null;
    return { texture: r.texture, file, tint: r.tint, alpha: r.alpha, fallback: true };
  }
  const file = requestFile(key);
  if (pickedArt(file)) return { texture: fileTexture(file), file, tint: 0xffffff, alpha: 1, fallback: false };
  return { texture: standInTexture(key), file: null, tint: 0xffffff, alpha: 1, fallback: true };
}

/** The files the avatars for `keys` need loaded, each once. Pure. */
export function avatarFiles(keys: readonly string[]): ArtFile[] {
  const out: ArtFile[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const { texture, file } = avatarSource(key);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    out.push({ texture, file });
  }
  return out;
}

/** The texture calls a bake needs beyond the plates'. */
export interface AvatarTextures {
  exists(key: string): boolean;
  getFrame(key: string, frame?: string | number): { readonly width: number; readonly height: number } | null;
  addDynamicTexture(
    key: string,
    width?: number,
    height?: number,
    forceEven?: boolean,
  ): Phaser.Textures.DynamicTexture | null;
}

/** The scene calls roundAvatar needs; a Phaser scene satisfies it. */
export interface AvatarScene extends PlateScene {
  readonly textures: PlateScene['textures'] & AvatarTextures;
}

/** Queue the files the avatars for `keys` need; call from a scene's preload. */
export function preloadAvatars(scene: AvatarScene, keys: readonly string[] = AVATAR_KEYS): void {
  for (const { texture, file } of avatarFiles(keys))
    if (!scene.textures.exists(texture)) scene.load.image(texture, file);
}

/** A baked round avatar: draw `texture` with `tint` and `alpha`. */
export interface RoundAvatar {
  readonly key: string;
  readonly size: number;
  readonly texture: string;
  readonly tint: number;
  readonly alpha: number;
  readonly fallback: boolean;
}

/** Avatars baked so far, by texture key, in bake order (the texture manager is the game's, so this is too). */
const baked = new Map<string, RoundAvatar>();

/** Corner shapes by size, built once per size. */
const cornersBySize = new Map<number, Phaser.Math.Vector2[][]>();

function cornersFor(size: number): Phaser.Math.Vector2[][] {
  let c = cornersBySize.get(size);
  if (!c) {
    // fillPoints reads x and y only, so plain points stand in for Vector2s.
    c = circleCorners(size) as unknown as Phaser.Math.Vector2[][];
    cornersBySize.set(size, c);
  }
  return c;
}

/**
 * The round avatar for a key at a size in px: baked on the first call into a DynamicTexture, and
 * the same texture on every later call. Call outside the update loop (after preload, or when a row
 * first shows a speaker): the first call per key and size allocates once.
 */
export function roundAvatar(scene: AvatarScene, key: string, size: number): RoundAvatar {
  const px = Math.max(2, Math.round(size));
  const texture = avatarTexture(key, px);
  const known = baked.get(texture);
  if (known && scene.textures.exists(texture)) return known;

  let src = avatarSource(key);
  if (!scene.textures.exists(src.texture)) {
    // The file was not queued or did not load: bake the key's plate and crop that instead.
    const a = ensureArt(scene, key);
    src = { texture: a.texture, file: null, tint: a.tint, alpha: a.alpha, fallback: true };
  }
  const avatar: RoundAvatar = {
    key,
    size: px,
    texture,
    tint: src.tint,
    alpha: src.alpha,
    fallback: src.fallback,
  };
  if (scene.textures.exists(texture)) {
    baked.set(texture, avatar);
    return avatar;
  }

  const frame = scene.textures.getFrame(src.texture);
  const crop = faceCrop(frame?.width ?? px, frame?.height ?? px, px, focusFor(src.file));

  const dt = scene.textures.addDynamicTexture(texture, px, px, false);
  if (!dt) return avatar;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff, 1);
  for (const corner of cornersFor(px)) g.fillPoints(corner, true);
  // A half-erased hairline on the rim softens the polygon edge.
  g.lineStyle(1, 0xffffff, 0.5);
  g.strokeCircle(px / 2, px / 2, px / 2 - 0.5);
  // The whole picture, scaled and shifted so the crop square fills the bake; the rest falls outside.
  dt.stamp(src.texture, undefined, -crop.x * crop.scale, -crop.y * crop.scale, {
    originX: 0,
    originY: 0,
    scale: crop.scale,
  });
  dt.erase(g);
  dt.render();
  g.destroy();
  baked.set(texture, avatar);
  return avatar;
}

// --- Test hook -----------------------------------------------------------------------------------

export interface AvatarsTestState {
  /** Round avatars baked so far, as 'avatar:<key>@<size>', in bake order: one per key and size. */
  baked: string[];
}

declare module '../testHook' {
  interface TestSections {
    avatars: AvatarsTestState;
  }
}

/** The `avatars` section. Pure read of what has been baked. */
export function avatarsTestState(): AvatarsTestState {
  return { baked: [...baked.keys()] };
}

provideTestState('avatars', avatarsTestState);

/** Forget what was baked; for tests that start a fresh texture manager. */
export function resetAvatarsForTests(): void {
  baked.clear();
}
