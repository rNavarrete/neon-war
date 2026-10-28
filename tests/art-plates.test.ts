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

const bakeKey = ART_REQUESTS.find((r) => r.fallback.kind === 'bake')!.key;
const reuseKey = ART_REQUESTS.find((r) => r.fallback.kind === 'reuse')!.key;

beforeEach(() => resetBakedForTests());

describe('resolveArt', () => {
  it('names the texture keys the files load as', () => {
    expect(fileTexture('art/board/server.webp')).toBe('art:board/server');
    expect(artTexture('hud/city-grid')).toBe('art:hud/city-grid');
    expect(artTexture('hud/city-grid')).toBe(fileTexture(requestFile('hud/city-grid')));
    expect(standInTexture('hud/city-grid')).toBe('art-standin:hud/city-grid');
  });

  it('gives a key with a reused fallback the picked file, tinted, flagged as a fallback', () => {
    const r = artRequest('board/server-dark')!;
    expect(isPicked(r)).toBe(false);
    expect(resolveArt('board/server-dark')).toEqual({
      key: 'board/server-dark',
      texture: 'art:board/server',
      tint: 0x55556a,
      alpha: 1,
      fallback: true,
    });
  });

  it('gives a key with a baked fallback its stand-in texture at the fallback alpha', () => {
    const r = artRequest(bakeKey)!;
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

  it('resolves every requested key to a fallback today, since none is picked yet', () => {
    for (const r of ART_REQUESTS) {
      const a = resolveArt(r.key);
      expect(a.key).toBe(r.key);
      expect(a.fallback, r.key).toBe(!isPicked(r));
    }
  });
});

describe('artFiles and preloadArt', () => {
  it('queues each reused file once, and nothing for baked keys', () => {
    const files = artFiles(['board/server-dark', 'board/server-booting-a', bakeKey, 'hud/not-a-key']);
    expect(files).toEqual([{ texture: 'art:board/server', file: 'art/board/server.webp' }]);
  });

  it('skips files the scene already has', () => {
    const s = stubScene(['art:board/server']);
    preloadArt(s.scene, ['board/server-dark', 'chars/comms/rei']);
    expect(s.queued).toEqual([['art:chars/rei/faces/smirk', 'art/chars/rei/faces/smirk.webp']]);
  });
});

describe('ensureArt', () => {
  it('uses the reused file when it is loaded, and bakes nothing', () => {
    const s = stubScene(['art:board/server']);
    expect(ensureArt(s.scene, 'board/server-dark')).toEqual(resolveArt('board/server-dark'));
    expect(s.dynamic).toEqual([]);
    expect(artTestState(s.scene.textures).baked).toEqual([]);
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
  it('lists every unpicked key as a fallback and no loaded key while nothing is picked', () => {
    const state = artTestState(stubScene().scene.textures);
    expect(state.fallback).toEqual(ART_REQUESTS.filter((r) => !isPicked(r)).map((r) => r.key));
    expect(state.fallback).toHaveLength(ART_REQUESTS.length);
    expect(state.loaded).toEqual([]);
    expect(artTestState(null).loaded).toEqual([]);
    expect(artTestState(null).missing).toEqual([]);
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
