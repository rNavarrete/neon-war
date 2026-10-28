import type Phaser from 'phaser';
import { ART_REQUESTS, artRequest, isPicked, requestFile } from '../src/game/artManifest';
import {
  type HookGame,
  type DrawnScene,
  missingDrawn,
  installArtHook,
  type PlateScene,
  artFiles,
  artTestState,
  artTexture,
  ensureArt,
  fileTexture,
  preloadArt,
  resetBakedForTests,
  resolveArt,
  standInTexture,
} from '../src/scenes/plates';

// Plates with stand-ins (art3d-2): resolveArt picks the picked file, the tinted reuse or the baked
// plate from the manifest; ensureArt bakes a key's plate once, in its display size and labelled with
// its key, when the texture it needs is not loaded; the art hook section lists the fallbacks.

/** A stub scene: a texture set, a load queue and recorders for what a bake draws. */
function stubScene(loaded: string[] = []) {
  const textures = new Set(loaded);
  const queued: [string, string][] = [];
  const dynamic: { key: string; w: number; h: number; drawn: unknown[]; rendered: number }[] = [];
  const texts: { text: string; destroyed: boolean; scale: number }[] = [];
  let graphicsMade = 0;
  let graphicsDestroyed = 0;
  const fills: number[] = [];
  const scene = {
    textures: {
      exists: (k: string) => textures.has(k),
      addDynamicTexture: (key: string, w = 0, h = 0) => {
        textures.add(key);
        const dt = {
          key,
          w,
          h,
          drawn: [] as unknown[],
          rendered: 0,
          draw(o: unknown) {
            this.drawn.push(o);
            return this;
          },
          render() {
            this.rendered++;
            return this;
          },
        };
        dynamic.push(dt);
        return dt;
      },
    },
    load: { image: (key: string, url: string) => queued.push([key, url]) },
    make: {
      graphics: () => {
        graphicsMade++;
        const g = {
          fillStyle: (c: number) => (fills.push(c), g),
          fillRect: () => g,
          lineStyle: () => g,
          strokeRect: () => g,
          destroy: () => {
            graphicsDestroyed++;
          },
        };
        return g;
      },
      text: (config: { text: string }) => {
        const t = {
          text: config.text,
          width: config.text.length * 8,
          destroyed: false,
          scale: 1,
          setOrigin: () => t,
          setScale: (s: number) => ((t.scale = s), t),
          destroy: () => {
            t.destroyed = true;
          },
        };
        texts.push(t);
        return t;
      },
    },
  } as unknown as PlateScene;
  return {
    scene,
    textures,
    queued,
    dynamic,
    texts,
    fills,
    graphics: () => ({ made: graphicsMade, destroyed: graphicsDestroyed }),
  };
}

// Batches 1 to 4 are picked (28 Oct 2026), so the fallback examples are batch 5 keys still unpicked.
const unpicked = ART_REQUESTS.filter((r) => !isPicked(r));
const bakeKey = unpicked.find((r) => r.fallback.kind === 'bake')!.key;
const reuseKey = unpicked.find((r) => r.fallback.kind === 'reuse')!.key;
/** An unpicked key that reuses the packet icon, tinted cyan. */
const PACKET = 'board/packet-cube';
/** A picked key, and the texture its file loads as. */
const PICKED = 'board/server-dark';
const PICKED_TEXTURE = 'art:board/server-dark';

beforeEach(() => resetBakedForTests());

describe('resolveArt', () => {
  it('names the texture keys the files load as', () => {
    expect(fileTexture('art/board/server.webp')).toBe('art:board/server');
    expect(artTexture('hud/city-grid')).toBe('art:hud/city-grid');
    expect(artTexture('hud/city-grid')).toBe(fileTexture(requestFile('hud/city-grid')));
    expect(standInTexture('hud/city-grid')).toBe('art-standin:hud/city-grid');
  });

  it('gives a key with a reused fallback the picked file, tinted, flagged as a fallback', () => {
    const r = artRequest(PACKET)!;
    expect(isPicked(r)).toBe(false);
    expect(resolveArt(PACKET)).toEqual({
      key: PACKET,
      texture: 'art:hud/icons/packet',
      tint: 0x5ce1ff,
      alpha: 1,
      fallback: true,
    });
  });

  it('gives a picked key its own file, untinted, not flagged as a fallback', () => {
    expect(isPicked(artRequest(PICKED)!)).toBe(true);
    expect(resolveArt(PICKED)).toEqual({
      key: PICKED,
      texture: PICKED_TEXTURE,
      tint: 0xffffff,
      alpha: 1,
      fallback: false,
    });
  });

  it('gives a key with a baked fallback its stand-in texture at the fallback alpha', () => {
    const r = artRequest(bakeKey)!;
    expect(isPicked(r)).toBe(false);
    expect(resolveArt(bakeKey)).toEqual({
      key: bakeKey,
      texture: standInTexture(bakeKey),
      tint: 0xffffff,
      alpha: r.fallback.alpha,
      fallback: true,
    });
  });

  it('gives an unknown key a baked stand-in rather than throwing', () => {
    expect(resolveArt('hud/not-a-key')).toEqual({
      key: 'hud/not-a-key',
      texture: 'art-standin:hud/not-a-key',
      tint: 0xffffff,
      alpha: 1,
      fallback: true,
    });
  });

  it('resolves every requested key to a fallback exactly while it is not picked', () => {
    for (const r of ART_REQUESTS) {
      const a = resolveArt(r.key);
      expect(a.key).toBe(r.key);
      expect(a.fallback, r.key).toBe(!isPicked(r));
    }
  });
});

describe('artFiles and preloadArt', () => {
  it('queues each reused file once, and nothing for baked keys', () => {
    const files = artFiles([PACKET, PACKET, bakeKey, 'hud/not-a-key']);
    expect(files).toEqual([{ texture: 'art:hud/icons/packet', file: 'art/hud/icons/packet.webp' }]);
  });

  it("queues a picked key's own file, once, instead of the file its fallback reused", () => {
    const files = artFiles([PICKED, PICKED, 'board/server-booting-a']);
    expect(files).toEqual([
      { texture: PICKED_TEXTURE, file: 'art/board/server-dark.webp' },
      { texture: 'art:board/server-booting-a', file: 'art/board/server-booting-a.webp' },
    ]);
    expect(files.map((f) => f.file)).not.toContain('art/board/server.webp');
  });

  it('skips files the scene already has', () => {
    const s = stubScene(['art:hud/icons/packet', PICKED_TEXTURE]);
    preloadArt(s.scene, [PACKET, 'chars/lux/cam/cheer', PICKED, 'chars/comms/rei']);
    expect(s.queued).toEqual([
      ['art:chars/lux/faces-board/triumphant', 'art/chars/lux/faces-board/triumphant.webp'],
      ['art:chars/comms/rei', 'art/chars/comms/rei.webp'],
    ]);
  });
});

describe('ensureArt', () => {
  it('uses the reused file when it is loaded, and bakes nothing', () => {
    const s = stubScene(['art:hud/icons/packet']);
    expect(ensureArt(s.scene, PACKET)).toEqual(resolveArt(PACKET));
    expect(ensureArt(s.scene, PACKET).fallback).toBe(true);
    expect(s.dynamic).toEqual([]);
    expect(artTestState(s.scene.textures).baked).toEqual([]);
  });

  it('uses a picked file when it is loaded, untinted, and bakes nothing', () => {
    const s = stubScene([PICKED_TEXTURE]);
    expect(ensureArt(s.scene, PICKED)).toEqual({
      key: PICKED,
      texture: PICKED_TEXTURE,
      tint: 0xffffff,
      alpha: 1,
      fallback: false,
    });
    expect(s.dynamic).toEqual([]);
    expect(artTestState(s.scene.textures).baked).toEqual([]);
  });

  it('bakes a stand-in for a picked key whose file did not load, rather than draw a missing texture', () => {
    const s = stubScene();
    const a = ensureArt(s.scene, PICKED);
    expect(a.texture).toBe(standInTexture(PICKED));
    expect(a.fallback).toBe(true);
    expect(s.dynamic.map((d) => d.key)).toEqual([standInTexture(PICKED)]);
  });

  it('bakes a plate once in the display size, labelled with the key, and frees what it drew with', () => {
    const s = stubScene();
    const r = artRequest(bakeKey)!;
    const a = ensureArt(s.scene, bakeKey);
    const b = ensureArt(s.scene, bakeKey);
    expect(a).toEqual(b);
    expect(a.texture).toBe(standInTexture(bakeKey));
    expect(a.fallback).toBe(true);
    expect(s.dynamic).toHaveLength(1);
    expect(s.dynamic[0]).toMatchObject({
      key: standInTexture(bakeKey),
      w: r.display.w,
      h: r.display.h,
      rendered: 1,
    });
    expect(s.dynamic[0].drawn).toHaveLength(2);
    expect(r.fallback.kind === 'bake' && s.fills[0]).toBe(r.fallback.kind === 'bake' && r.fallback.color);
    expect(s.texts.map((t) => t.text)).toEqual([bakeKey]);
    expect(s.texts[0].destroyed).toBe(true);
    expect(s.graphics()).toEqual({ made: 1, destroyed: 1 });
    expect(artTestState(s.scene.textures).baked).toEqual([bakeKey]);
  });

  it('bakes a stand-in, untinted, when a reused file did not load', () => {
    const s = stubScene();
    const a = ensureArt(s.scene, reuseKey);
    expect(a).toEqual({
      key: reuseKey,
      texture: standInTexture(reuseKey),
      tint: 0xffffff,
      alpha: 1,
      fallback: true,
    });
    expect(s.dynamic.map((d) => d.key)).toEqual([standInTexture(reuseKey)]);
  });

  it('shrinks the label to fit a small plate', () => {
    const s = stubScene();
    ensureArt(s.scene, 'hud/icons/system');
    expect(s.texts[0].scale).toBeLessThan(1);
  });
});

describe('the art hook section', () => {
  it('lists every unpicked key as a fallback and no loaded key while no picked file is loaded', () => {
    const state = artTestState(stubScene().scene.textures);
    expect(state.fallback).toEqual(ART_REQUESTS.filter((r) => !isPicked(r)).map((r) => r.key));
    expect(state.fallback).toEqual(unpicked.map((r) => r.key));
    expect(state.loaded).toEqual([]);
    expect(artTestState(null).loaded).toEqual([]);
    expect(artTestState(null).missing).toEqual([]);
  });

  it('lists only the unpicked keys as fallbacks: batch 5, none of the 47 picks', () => {
    const fallback = artTestState(null).fallback;
    expect(fallback).toEqual(ART_REQUESTS.filter((r) => r.batch === 5).map((r) => r.key));
    for (const r of ART_REQUESTS) expect(fallback.includes(r.key), r.key).toBe(!isPicked(r));
    expect(ART_REQUESTS.length - fallback.length).toBe(47);
  });

  it('lists a picked key as loaded once its texture is in, and only then', () => {
    expect(artTestState(stubScene([PICKED_TEXTURE]).scene.textures).loaded).toEqual([PICKED]);
    // A reused fallback's texture being loaded does not make its key loaded.
    expect(artTestState(stubScene(['art:hud/icons/packet']).scene.textures).loaded).toEqual([]);
    const all = ART_REQUESTS.filter(isPicked);
    const every = stubScene(all.map((r) => artTexture(r.key)));
    expect(artTestState(every.scene.textures).loaded).toEqual(all.map((r) => r.key));
  });

  it("names every object drawing Phaser's missing texture, inside containers too", () => {
    const scene = (key: string, list: DrawnScene['children']['list']): DrawnScene => ({
      sys: { settings: { key } },
      children: { list },
    });
    const scenes = [
      scene('board', [
        { type: 'Image', texture: { key: 'art:board/server' } },
        { type: 'Image', texture: { key: '__MISSING' } },
        { type: 'Graphics' },
      ]),
      scene('hud', [{ type: 'Container', list: [{ type: 'Sprite', texture: { key: '__MISSING' } }] }]),
    ];
    expect(missingDrawn(scenes)).toEqual(['board:Image', 'hud:Sprite']);
    expect(artTestState(null, scenes).missing).toEqual(['board:Image', 'hud:Sprite']);
  });

  it('returns fresh arrays each read', () => {
    const a = artTestState(null);
    a.fallback.push('x');
    a.baked.push('y');
    expect(artTestState(null).fallback).not.toContain('x');
    expect(artTestState(null).baked).not.toContain('y');
  });
});

describe('the plates fit Phaser', () => {
  it('take a real scene and a real game (checked by the typechecker)', () => {
    // A Phaser scene must be a PlateScene and a game must carry TexturesLike, or `npm run typecheck` fails.
    const asPlateScene = (s: Phaser.Scene): PlateScene => s;
    const asHookGame = (g: Phaser.Game): HookGame => g;
    expect(typeof asPlateScene).toBe('function');
    expect(typeof asHookGame).toBe('function');
    expect(typeof installArtHook).toBe('function');
  });
});
