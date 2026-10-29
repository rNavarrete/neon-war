import { Bus } from '../src/game/bus';
import { type Frame, readFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import { LuxCamView } from '../src/scenes/hud/LuxCamView';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';
import {
  CAM_ART,
  CAM_FIT,
  CAM_FITS,
  CAM_LENS,
  CAM_MOODS,
  CAM_PARALLAX,
  CAM_FACE_PARALLAX,
  REC_BADGE_BOX,
  REC_BADGE_KEY,
  backdropScale,
  camArtFile,
  camFileLanded,
  camLayout,
  camTextureOf,
  fitScale,
  placeFace,
} from '../src/scenes/hud/luxcam';
import { ZONES } from '../src/scenes/live/layout';
import type { LiveHost } from '../src/scenes/live/view';
import { resolveArt } from '../src/scenes/plates';

// luxcam-5: the picked cam set (lean-in, relieved), the cam backdrop and the REC badge drawn through
// the manifest, and every mood's fit re-tuned so the head reads at 140-160 px with nothing upscaled
// and the NIRVANA print in the lens.

interface Fs {
  readFileSync(path: string): Uint8Array;
}
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }
).process.getBuiltinModule('node:fs') as Fs;
const PUBLIC = new URL('../public/', import.meta.url).pathname;

/** A .webp file's pixel size, read from its header (VP8X, VP8 or VP8L). */
function webpSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(PUBLIC + file);
  const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
  const u24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (tag === 'VP8X') return { w: u24(24) + 1, h: u24(27) + 1 };
  if (tag === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
  if (tag === 'VP8L') {
    const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
  }
  throw new Error(`${file}: not a webp`);
}

/** The most the breath (2 px) and the face parallax move a face up or down. */
const SWAY = 2 + CAM_FACE_PARALLAX.y;
/** The print stays this far above the lens's bottom edge even at full sway, clear of its 2 px frame. */
const FRAME_CLEAR = 4;

describe('luxcam-5: the picked cam set', () => {
  it('leaning draws portrait:lux/cam/lean-in and relieved draws portrait:lux/cam/relieved', () => {
    expect(camFileLanded('art/chars/lux/cam/lean-in.webp')).toBe(true);
    expect(camFileLanded('art/chars/lux/cam/relieved.webp')).toBe(true);
    expect(camTextureOf('leaning')).toBe('portrait:lux/cam/lean-in');
    expect(camTextureOf('relieved')).toBe('portrait:lux/cam/relieved');
    expect(CAM_FIT.leaning).toBe(CAM_FITS['art/chars/lux/cam/lean-in.webp']);
    expect(CAM_FIT.relieved).toBe(CAM_FITS['art/chars/lux/cam/relieved.webp']);
    expect(webpSize('art/chars/lux/cam/lean-in.webp')).toEqual({ w: 924, h: 548 });
    expect(webpSize('art/chars/lux/cam/relieved.webp')).toEqual({ w: 924, h: 548 });
  });

  it('every mood has a measured fit: head 140-160 px, never upscaled, the print in the lens, no gap', () => {
    for (const mood of CAM_MOODS) {
      const file = camArtFile(mood, camFileLanded);
      const fit = CAM_FIT[mood];
      expect(CAM_FITS[file], `${mood}: ${file} has a fit`).toBe(fit);
      expect(CAM_ART[mood].scale).toBe(CAM_FITS[CAM_ART[mood].file].scale);
      const { w, h } = webpSize(file);
      // Never upscaled.
      expect(fit.scale, mood).toBeGreaterThan(0);
      expect(fit.scale, mood).toBeLessThanOrEqual(1);
      // The head, top of the hair to the chin, reads at 140-160 px on screen.
      const head = (fit.chin - fit.headTop) * fit.scale;
      expect(head, `${mood} head ${head.toFixed(1)} px`).toBeGreaterThanOrEqual(140);
      expect(head, `${mood} head ${head.toFixed(1)} px`).toBeLessThanOrEqual(160);
      // The chin is in the lens at any sway, and the print's bottom row too.
      expect((fit.chin - fit.top) * fit.scale + SWAY, mood).toBeLessThanOrEqual(CAM_LENS.h);
      if (fit.keep !== null)
        expect((fit.keep - fit.top) * fit.scale + SWAY + FRAME_CLEAR, `${mood} print`).toBeLessThanOrEqual(
          CAM_LENS.h,
        );
      // No gap above or below the face at any sway: the image reaches past both lens edges.
      expect(fit.top * fit.scale, mood).toBeGreaterThanOrEqual(SWAY);
      expect((h - fit.top) * fit.scale - SWAY, mood).toBeGreaterThanOrEqual(CAM_LENS.h);
      // At most this much of the hair is trimmed by the lens's top edge (32 px on screen).
      expect(Math.max(0, fit.top - fit.headTop) * fit.scale, mood).toBeLessThanOrEqual(32);
      // Centred across the lens: the picked busts are wider than the lens and still show her whole.
      const lens = camLayout(ZONES.cam).lens;
      const at = placeFace(lens, w, fit, 0, 0, { x: 0, y: 0 });
      expect(at.x + (w * fit.scale) / 2).toBeCloseTo(lens.x + lens.w / 2, 6);
      expect(at.y).toBeCloseTo(lens.y - fit.top * fit.scale, 6);
    }
  });

  it('the cam busts keep her raincoat and the NIRVANA print inside the lens across', () => {
    const lens = camLayout(ZONES.cam).lens;
    // The opaque columns of each bust (raincoat edge to raincoat edge), measured on the files.
    const body: Record<string, [number, number]> = {
      'art/chars/lux/cam/lean-in.webp': [130, 797],
      'art/chars/lux/cam/relieved.webp': [112, 769],
    };
    for (const [file, [l, r]] of Object.entries(body)) {
      const fit = CAM_FITS[file];
      const at = placeFace(lens, 924, fit, 0, 0, { x: 0, y: 0 });
      expect(at.x + l * fit.scale, file).toBeGreaterThanOrEqual(lens.x);
      expect(at.x + r * fit.scale, file).toBeLessThanOrEqual(lens.x + lens.w);
    }
  });

  it('the backdrop and the REC badge are picked, drawn no bigger than their files', () => {
    expect(resolveArt('hud/cam-backdrop').fallback).toBe(false);
    expect(resolveArt(REC_BADGE_KEY).fallback).toBe(false);
    expect(webpSize('art/hud/cam-backdrop.webp')).toEqual({ w: 824, h: 504 });
    expect(webpSize('art/hud/live/rec-badge.webp')).toEqual({ w: 121, h: 48 });
    const s = backdropScale(824, 504);
    expect(s).toBeLessThanOrEqual(1);
    expect(824 * s).toBeGreaterThanOrEqual(CAM_LENS.w + 2 * CAM_PARALLAX.x - 1e-9);
    expect(504 * s).toBeGreaterThanOrEqual(CAM_LENS.h + 2 * CAM_PARALLAX.y - 1e-9);
    // The badge: 121x48 into its 72x24 box is 0.5; a stand-in baked at 72x24 draws at 1; never more.
    expect(fitScale(121, 48, REC_BADGE_BOX)).toBe(0.5);
    expect(fitScale(72, 24, REC_BADGE_BOX)).toBe(1);
    expect(fitScale(10, 10, REC_BADGE_BOX)).toBe(1);
  });
});

// ---- the view against a stub scene, with the picked sizes ----

const SIZES: Record<string, { w: number; h: number }> = {
  'portrait:lux/faces-board/deadpan': { w: 410, h: 449 },
  'portrait:lux/faces-board/determined': { w: 436, h: 429 },
  'portrait:lux/faces-board/tense': { w: 425, h: 457 },
  'portrait:lux/faces-board/shocked': { w: 417, h: 456 },
  'portrait:lux/faces-board/triumphant': { w: 506, h: 453 },
  'portrait:lux/faces-room/exhausted': { w: 460, h: 431 },
  'portrait:lux/poses/goggles-up': { w: 382, h: 953 },
  'portrait:lux/cam/lean-in': { w: 924, h: 548 },
  'portrait:lux/cam/relieved': { w: 924, h: 548 },
  'art:hud/cam-backdrop': { w: 824, h: 504 },
  'art:hud/live/rec-badge': { w: 121, h: 48 },
};

interface Obj {
  kind: string;
  texture: string;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  visible: boolean;
  setScaleCalls: number;
  [k: string]: unknown;
}

function stub() {
  const made: Obj[] = [];
  const object = (kind: string, texture = ''): Obj => {
    const s = SIZES[texture] ?? { w: 0, h: 0 };
    const o: Obj = {
      kind,
      texture,
      width: s.w,
      height: s.h,
      scaleX: 1,
      scaleY: 1,
      visible: true,
      setScaleCalls: 0,
    };
    const self: Obj = new Proxy(o, {
      get(t, prop: string) {
        if (prop in t) return t[prop];
        if (prop === 'setTexture')
          return (key: string) => {
            t.texture = key;
            const z = SIZES[key] ?? { w: 0, h: 0 };
            t.width = z.w;
            t.height = z.h;
            return self;
          };
        if (prop === 'setScale')
          return (x: number, y = x) => {
            t.scaleX = x;
            t.scaleY = y;
            t.setScaleCalls++;
            return self;
          };
        if (prop === 'setVisible') return (v: boolean) => ((t.visible = v), self);
        return () => self;
      },
      set(t, prop: string, v) {
        t[prop] = v;
        return true;
      },
    });
    made.push(o);
    return self;
  };
  const scene = {
    add: {
      graphics: () => object('Graphics'),
      image: (_x: number, _y: number, key: string) => object('Image', key),
      text: () => object('Text'),
      rectangle: () => object('Rectangle'),
      circle: () => object('Arc'),
    },
    textures: { exists: (key: string) => key in SIZES },
    load: { image: () => undefined },
    input: { activePointer: { x: 960, y: 540 } },
    game: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }) } },
  };
  return { scene, made };
}

const frameAt = (now: number, over: Partial<Frame> = {}): Frame => ({
  ...readFrame(new Run()),
  now,
  ...over,
});

function hook() {
  const h = hudSection({} as HudTestState).luxCam;
  if (!h) throw new Error('hud.luxCam missing');
  return h;
}

describe('luxcam-5: LuxCamView with the picked art', () => {
  it('draws lean-in on a drag and relieved after the rescue, at their fits, through the hook art key', () => {
    const { scene, made } = stub();
    const bus = new Bus();
    const host: LiveHost = { scene: scene as never, bus, rect: ZONES.cam, flags: { lite: false } };
    const v = new LuxCamView();
    v.create(scene as never, host);
    const images = made.filter((m) => m.kind === 'Image');
    // Backdrop, front face, back face, REC badge.
    expect(images.map((m) => m.texture)).toEqual([
      'art:hud/cam-backdrop',
      'portrait:lux/faces-board/deadpan',
      'portrait:lux/faces-board/deadpan',
      'art:hud/live/rec-badge',
    ]);
    const [backdrop, front, , badge] = images;
    expect(backdrop.scaleX).toBeLessThanOrEqual(1);
    expect(badge.scaleX).toBe(0.5);
    expect(made.length).toBeLessThanOrEqual(v.budget.objects);

    let clock = 0;
    const step = (over: Partial<Frame> = {}) => {
      clock += 0.016;
      v.update(
        frameAt(100 + clock, { demand: 20, wiredCapacity: 100, errorShare: 0, ...over }),
        { now: clock, dt: 0.016 },
        [],
      );
    };
    for (let i = 0; i < 40; i++) step();
    expect(hook().mood).toBe('calm');
    expect(front.scaleX).toBe(CAM_FIT.calm.scale);

    // A card in hand: she leans in, and the front face is the picked lean-in at 0.5.
    bus.emit('drag', { kind: 'card', card: 'server', over: null });
    for (let i = 0; i < 10; i++) step();
    expect(hook().mood).toBe('leaning');
    expect(hook().art).toBe('portrait:lux/cam/lean-in');
    expect(front.texture).toBe('portrait:lux/cam/lean-in');
    expect(front.scaleX).toBe(0.5);
    // A quiet frame sets no scale again.
    const calls = front.setScaleCalls;
    step();
    expect(front.setScaleCalls).toBe(calls);
    bus.emit('drag', { kind: null, card: null, over: null });
    for (let i = 0; i < 120; i++) step();

    // The rescue: a relieved beat on the picked relieved bust.
    step({ rescued: true });
    expect(hook().mood).toBe('relieved');
    expect(hook().art).toBe('portrait:lux/cam/relieved');
    expect(front.texture).toBe('portrait:lux/cam/relieved');
    expect(front.scaleX).toBe(0.53);
    // Every face image is drawn at 1 or under, whatever mood it shows.
    for (const img of images) expect(img.scaleX).toBeLessThanOrEqual(1);
    v.shutdown();
  });
});
