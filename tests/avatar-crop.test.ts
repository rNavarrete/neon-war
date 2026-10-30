import { ART_REQUESTS, artRequest, isPicked, pickedArt, requestFile } from '../src/game/artManifest';
import {
  BUST,
  FULL,
  LUX_BUST,
  avatarTexture,
  circleCorners,
  faceCrop,
  focusFor,
  insideDisc,
} from '../src/scenes/avatarCrop';
import {
  AVATAR_KEYS,
  type AvatarScene,
  BLOCK_AVATARS,
  COMMS_AVATARS,
  STREAM_AVATARS,
  TITLE_AVATAR,
  avatarFiles,
  avatarSource,
  avatarsTestState,
  preloadAvatars,
  resetAvatarsForTests,
  roundAvatar,
} from '../src/scenes/avatars';
import { resetBakedForTests, standInTexture } from '../src/scenes/plates';

// Round avatars (art3d-4): faceCrop picks the square of a picture a disc shows, circleCorners the
// corner shapes a bake erases once; roundAvatar bakes one DynamicTexture per key and size from the
// manifest's picture (picked file, reused fallback or baked stand-in), so nothing masks per frame.

/** Real sizes of the files the stub scene can have loaded (from the manifest's measured cuts). */
function cutOf(texture: string): { width: number; height: number } | null {
  const file = texture.startsWith('art:') ? `art/${texture.slice(4)}.webp` : null;
  const p = file ? pickedArt(file) : undefined;
  if (p) return { width: p.cut.w, height: p.cut.h };
  const r = texture.startsWith('art:') ? artRequest(texture.slice(4)) : undefined;
  return r?.cut ? { width: r.cut.w, height: r.cut.h } : null;
}

type Call = [string, ...unknown[]];

/** A stub scene: a texture set with sizes, a load queue, and recorders for what a bake does. */
function stubScene(loaded: string[] = []) {
  const textures = new Map<string, { w: number; h: number }>();
  const add = (key: string, w: number, h: number) => textures.set(key, { w, h });
  for (const k of loaded) {
    const c = cutOf(k) ?? { width: 64, height: 64 };
    add(k, c.width, c.height);
  }
  const queued: [string, string][] = [];
  const dynamic: { key: string; w: number; h: number; forceEven: unknown; calls: Call[] }[] = [];
  const graphics: { calls: Call[]; destroyed: boolean }[] = [];
  const scene = {
    textures: {
      exists: (k: string) => textures.has(k),
      getFrame: (k: string) => {
        const t = textures.get(k);
        return t ? { width: t.w, height: t.h } : null;
      },
      addDynamicTexture: (key: string, w = 256, h = 256, forceEven?: boolean) => {
        if (textures.has(key)) return null;
        add(key, w, h);
        const calls: Call[] = [];
        const dt = {
          draw: (...a: unknown[]) => (calls.push(['draw', ...a]), dt),
          stamp: (...a: unknown[]) => (calls.push(['stamp', ...a]), dt),
          erase: (...a: unknown[]) => (calls.push(['erase', ...a]), dt),
          render: () => (calls.push(['render']), dt),
        };
        dynamic.push({ key, w, h, forceEven, calls });
        return dt;
      },
    },
    load: { image: (key: string, url: string) => queued.push([key, url]) },
    make: {
      graphics: () => {
        const rec = { calls: [] as Call[], destroyed: false };
        graphics.push(rec);
        const g = new Proxy(
          {},
          {
            get: (_t, name: string) =>
              name === 'destroy'
                ? () => {
                    rec.destroyed = true;
                  }
                : (...a: unknown[]) => (rec.calls.push([name, ...a]), g),
          },
        );
        return g;
      },
      text: (config: { text: string }) => {
        const t = {
          text: config.text,
          width: config.text.length * 8,
          setOrigin: () => t,
          setScale: () => t,
          destroy: () => undefined,
        };
        return t;
      },
    },
  } as unknown as AvatarScene;
  return { scene, textures, queued, dynamic, graphics };
}

beforeEach(() => {
  resetAvatarsForTests();
  resetBakedForTests();
});

describe('faceCrop', () => {
  it('shows a square picture whole', () => {
    expect(faceCrop(512, 512, 32)).toEqual({ x: 0, y: 0, side: 512, scale: 32 / 512 });
  });

  it('centres the shorter side of a tall picture with FULL focus', () => {
    // TRIAGE's eager face is 238 x 290: the whole width, centred down the height.
    expect(faceCrop(238, 290, 84)).toEqual({ x: 0, y: 26, side: 238, scale: 84 / 238 });
  });

  it('takes a bust from the upper third, inside the picture', () => {
    const c = faceCrop(420, 449, 84, BUST);
    expect(c.side).toBe(Math.round(420 * 0.55));
    expect(c.x).toBe(Math.round(210 - c.side / 2));
    expect(c.y).toBe(Math.round(449 * 0.3 - c.side / 2));
    expect(c.scale).toBeCloseTo(84 / c.side);
  });

  it('never leaves the picture, whatever the focus', () => {
    for (const focus of [FULL, BUST, LUX_BUST, { cx: 0, cy: 0, frac: 0.5 }, { cx: 1, cy: 1, frac: 0.8 }]) {
      for (const [w, h] of [
        [238, 290],
        [506, 453],
        [32, 32],
        [64, 20],
      ]) {
        const c = faceCrop(w, h, 40, focus);
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.side).toBeLessThanOrEqual(w);
        expect(c.y + c.side).toBeLessThanOrEqual(h);
        expect(Number.isInteger(c.x) && Number.isInteger(c.y) && Number.isInteger(c.side)).toBe(true);
      }
    }
  });

  it('busts the crew and Lux portraits and shows everything else whole', () => {
    expect(focusFor('art/chars/rei/faces/smirk.webp')).toBe(BUST);
    expect(focusFor('art/chars/mika/faces/calm.webp')).toBe(BUST);
    expect(focusFor('art/chars/ozzie/faces/sums.webp')).toBe(BUST);
    expect(focusFor('art/chars/lux/faces-board/determined.webp')).toBe(LUX_BUST);
    expect(focusFor('art/chars/triage/eager.webp')).toBe(FULL);
    expect(focusFor('art/chars/avatars/kenji.webp')).toBe(FULL);
    expect(focusFor('art/chars/comms/rei.webp')).toBe(FULL);
    expect(focusFor(null)).toBe(FULL);
  });
});

describe('circleCorners', () => {
  it('gives four corner shapes that cover the square outside the disc and none of the disc', () => {
    const size = 32;
    const corners = circleCorners(size);
    expect(corners).toHaveLength(4);
    const inPoly = (poly: { x: number; y: number }[], x: number, y: number): boolean => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    for (let y = 0.5; y < size; y++)
      for (let x = 0.5; x < size; x++) {
        const covered = corners.some((p) => inPoly(p, x, y));
        const r = Math.hypot(x - size / 2, y - size / 2);
        // Pixel centres clearly outside the disc are erased; those clearly inside are kept. The
        // 12-segment arc may differ from the true circle by under half a pixel at the rim.
        if (r > size / 2 + 0.5) expect(covered, `${x},${y}`).toBe(true);
        if (r < size / 2 - 0.5) expect(covered, `${x},${y}`).toBe(false);
        expect(insideDisc({ x, y }, size)).toBe(r <= size / 2);
      }
  });

  it('returns new arrays each call', () => {
    const a = circleCorners(40);
    const b = circleCorners(40);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe('avatarSource: the art each round avatar draws today', () => {
  // Since the M4 picks landed, every avatar key draws its own picked file (no portraits reused,
  // no stand-ins); the stand-in path stays covered by 'slots a newly picked sheet in' below and by
  // 'crops a stand-in plate when a file did not load'.
  const pickedSource = (key: string) => ({
    texture: `art:${key}`,
    file: `art/${key}.webp`,
    tint: 0xffffff,
    alpha: 1,
    fallback: false,
  });

  it('draws the four COMMS faces from their picked round badges', () => {
    for (const key of [COMMS_AVATARS.TRIAGE, COMMS_AVATARS.REI, COMMS_AVATARS.MIKA, COMMS_AVATARS.OZZIE]) {
      expect(isPicked(artRequest(key)!), key).toBe(true);
      expect(avatarSource(key), key).toEqual(pickedSource(key));
    }
  });

  it('draws the HOUSE chips from their picked icons', () => {
    for (const key of COMMS_AVATARS.HOUSE) expect(avatarSource(key), key).toEqual(pickedSource(key));
  });

  it("draws the block's and the viewers' chat avatars from their picked files", () => {
    for (const name of ['kenji', 'mrs okafor', 'young father', 'old man noodles', 'unnamed neighbour']) {
      const key = BLOCK_AVATARS[name];
      expect(avatarSource(key), name).toEqual({ ...pickedSource(key), file: requestFile(key) });
    }
    for (const key of [...STREAM_AVATARS, TITLE_AVATAR])
      expect(avatarSource(key), key).toEqual(pickedSource(key));
  });

  it('draws any picked face by its key, so per-line moods crop the same way', () => {
    expect(avatarSource('chars/rei/faces/stern')).toMatchObject({
      texture: 'art:chars/rei/faces/stern',
      file: 'art/chars/rei/faces/stern.webp',
      fallback: false,
    });
    expect(avatarSource('chars/triage/panic').texture).toBe('art:chars/triage/panic');
  });

  it('slots a newly picked sheet in by manifest key, with no view change', () => {
    for (const key of [COMMS_AVATARS.REI, ...COMMS_AVATARS.HOUSE, STREAM_AVATARS[0], TITLE_AVATAR]) {
      const r = artRequest(key)!;
      expect(avatarSource(key, { ...r, cut: r.target })).toEqual({
        texture: `art:${key}`,
        file: `art/${key}.webp`,
        tint: 0xffffff,
        alpha: 1,
        fallback: false,
      });
    }
  });

  it('knows every avatar key: each is requested or picked', () => {
    for (const key of AVATAR_KEYS)
      expect(artRequest(key) !== undefined || pickedArt(requestFile(key)) !== undefined, key).toBe(true);
    expect(ART_REQUESTS.filter((r) => r.key.startsWith('chars/comms/')).map((r) => r.key)).toEqual([
      COMMS_AVATARS.TRIAGE,
      COMMS_AVATARS.REI,
      COMMS_AVATARS.MIKA,
      COMMS_AVATARS.OZZIE,
    ]);
  });

  it('queues each needed file once and skips loaded ones', () => {
    const files = avatarFiles(AVATAR_KEYS);
    expect(new Set(files.map((f) => f.file)).size).toBe(files.length);
    expect(files.map((f) => f.file)).toContain('art/chars/avatars/kenji.webp');
    expect(files.map((f) => f.file)).toContain('art/chars/comms/rei.webp');
    expect(files).toHaveLength(AVATAR_KEYS.length);
    const s = stubScene(['art:chars/avatars/kenji']);
    preloadAvatars(s.scene);
    expect(s.queued.map(([k]) => k)).not.toContain('art:chars/avatars/kenji');
    expect(s.queued).toHaveLength(files.length - 1);
  });
});

describe('roundAvatar: one baked texture per key and size', () => {
  it('bakes a crop and a one-shot corner erase into one DynamicTexture, then reuses it', () => {
    const s = stubScene(['art:chars/comms/rei']);
    const a = roundAvatar(s.scene, COMMS_AVATARS.REI, 84);
    expect(a).toEqual({
      key: COMMS_AVATARS.REI,
      size: 84,
      texture: avatarTexture(COMMS_AVATARS.REI, 84),
      tint: 0xffffff,
      alpha: 1,
      fallback: false,
    });
    expect(s.dynamic).toHaveLength(1);
    const dt = s.dynamic[0];
    expect(dt).toMatchObject({ key: 'avatar:chars/comms/rei@84', w: 84, h: 84, forceEven: false });
    // Stamp the bust, erase the corners, render once: the mask exists for this one render only.
    expect(dt.calls.map((c) => c[0])).toEqual(['stamp', 'erase', 'render']);
    // 236 wide since the rei badge was swapped for the right face (30 Oct 2026); it was 240.
    const crop = faceCrop(236, 256, 84, FULL);
    // The picked badge, shown whole: its centred square lands on the 84 x 84 bake.
    expect(dt.calls[0]).toEqual([
      'stamp',
      'art:chars/comms/rei',
      undefined,
      -crop.x * crop.scale,
      -crop.y * crop.scale,
      { originX: 0, originY: 0, scale: crop.scale },
    ]);
    expect(s.graphics).toHaveLength(1);
    expect(s.graphics[0].destroyed).toBe(true);
    expect(s.graphics[0].calls.filter((c) => c[0] === 'fillPoints')).toHaveLength(4);

    // Every later call, every frame, returns the same texture and draws nothing.
    for (let i = 0; i < 60; i++) expect(roundAvatar(s.scene, COMMS_AVATARS.REI, 84)).toEqual(a);
    expect(s.dynamic).toHaveLength(1);
    expect(dt.calls).toHaveLength(3);
    expect(s.graphics).toHaveLength(1);
    expect(avatarsTestState().baked).toEqual(['avatar:chars/comms/rei@84']);
  });

  it('bakes a separate texture for another size', () => {
    const s = stubScene(['art:chars/avatars/kenji']);
    const a = roundAvatar(s.scene, 'chars/avatars/kenji', 32);
    const b = roundAvatar(s.scene, 'chars/avatars/kenji', 40);
    roundAvatar(s.scene, 'chars/avatars/kenji', 32);
    expect(a.texture).toBe('avatar:chars/avatars/kenji@32');
    expect(b.texture).toBe('avatar:chars/avatars/kenji@40');
    expect(s.dynamic.map((d) => d.key)).toEqual([a.texture, b.texture]);
    expect(avatarsTestState().baked).toEqual([a.texture, b.texture]);
  });

  it('never masks a game object: the bake uses only the texture and a throwaway Graphics', () => {
    const s = stubScene(['art:chars/triage/eager']);
    roundAvatar(s.scene, COMMS_AVATARS.TRIAGE, 84);
    const names = s.graphics[0].calls.map((c) => c[0]);
    expect(names.some((n) => /mask|filter/i.test(n))).toBe(false);
    expect(s.dynamic[0].calls.some((c) => /mask|filter/i.test(c[0]))).toBe(false);
  });

  it('crops round avatars for all COMMS slots, chips, chat rows and the title from what is loaded today', () => {
    const s = stubScene(avatarFiles(AVATAR_KEYS).map((f) => f.texture));
    for (const key of AVATAR_KEYS) {
      const a = roundAvatar(s.scene, key, 32);
      expect(a.texture, key).toBe(avatarTexture(key, 32));
      const src = avatarSource(key);
      const dt = s.dynamic.find((d) => d.key === a.texture)!;
      // Picked or reused files stamp the file; baked fallbacks stamp the stand-in plate.
      expect(dt.calls[0][1], key).toBe(src.texture);
      expect(s.textures.has(src.texture), key).toBe(true);
    }
    expect(s.dynamic).toHaveLength(
      AVATAR_KEYS.length + AVATAR_KEYS.filter((k) => avatarSource(k).file === null).length,
    );
    expect(avatarsTestState().baked).toEqual(AVATAR_KEYS.map((k) => avatarTexture(k, 32)));
  });

  it('crops a stand-in plate when a file did not load, rather than drawing a missing texture', () => {
    const s = stubScene();
    const a = roundAvatar(s.scene, 'chars/avatars/kenji', 32);
    expect(a.fallback).toBe(true);
    const dt = s.dynamic.find((d) => d.key === a.texture)!;
    expect(dt.calls[0][1]).toBe(standInTexture('chars/avatars/kenji'));
    expect(s.textures.has(standInTexture('chars/avatars/kenji'))).toBe(true);
  });

  it('keeps the size even when odd and whole when fractional', () => {
    const s = stubScene(['art:chars/avatars/kenji']);
    expect(roundAvatar(s.scene, 'chars/avatars/kenji', 33).size).toBe(33);
    expect(roundAvatar(s.scene, 'chars/avatars/kenji', 31.6).texture).toBe('avatar:chars/avatars/kenji@32');
    expect(s.dynamic.map((d) => [d.w, d.h])).toEqual([
      [33, 33],
      [32, 32],
    ]);
  });
});
