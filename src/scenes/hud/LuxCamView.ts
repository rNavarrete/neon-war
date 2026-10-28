// Lux's cam (ZONES.cam) as a Live screen view: LUX_CAM and a REC dot over a 388x230 lens, the dark
// bedroom behind her (it slides a little with the pointer), her face for the mood camStep picks
// (crossfading 220 ms on a change, breathing, a short shake entering panic), scanlines, a slow roll
// band and a vignette over the lens, and an amber frame that turns red while she panics. Three talk
// bars bounce while her line is on the band (bus line.speaker, until its lineEnd). It is a second
// encoding of the room-left bar: no number and no mood word is ever drawn.
//
// The bus facts camStep reads come in on the host's bus: `line` / `lineEnd` (is Lux talking),
// `drag` (a card or wire in hand: she leans in) and `action` (she focuses for 2.5 s). A died or dip
// occurrence shocks her (fillCamView), and from 537 s the goggles go up and stay up.
//
// The face and the backdrop are cropped to the lens (lensCrop), so nothing of them shows outside
// it. The mood is camStep's (src/scenes/hud/luxcam.ts, the only mood selector), stepped once a frame
// from the shared Frame, this frame's occurrences and the bus facts, read into one CamView this view
// keeps. A frame where the mood does not change swaps no texture, starts no tween and allocates
// nothing; the crossfade, breath, shake and blink are plain numbers on the HUD clock.
//
// Phaser is a type here only, so the registry and node tests can import this.

import type Phaser from 'phaser';
import type { Frame } from '../../game/frame';
import type { Occurrence } from '../../game/occurrences';
import { speakerName } from '../../game/portraits';
import { settings } from '../../game/settings';
import type { LineId } from '../../strings';
import { type Point, type Rect, pageRect } from '../live/layout';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import { preloadArt, resolveArt } from '../plates';
import { provideHudSection } from './hook';
import { COLORS, FONT } from './layout';
import {
  CAM_ART,
  CAM_BACKDROP_KEY,
  CAM_FACE_PARALLAX,
  CAM_HISTORY,
  CAM_PARALLAX,
  type CamExtras,
  type CamHistoryEntry,
  type CamLayout,
  type CamMood,
  type CamState,
  type LuxCamTestState,
  type MutableCamView,
  backdropScale,
  breathY,
  camLayout,
  camPortraits,
  camStep,
  camTextureOf,
  emptyCamView,
  emptyCrop,
  fadeAlpha,
  fillCamView,
  initialCam,
  lensCrop,
  placeFace,
  recOn,
  shakeX,
  talkLevel,
} from './luxcam';

/** The depth the cam draws at: over the HUD's own objects and the placeholders, like the gauges. */
export const CAM_DEPTH = 1;

/** The words on the cam's header (not a mood word, not a number). */
export const CAM_WORDS = { title: 'LUX_CAM', rec: 'REC' } as const;

const PLATE_FILL = 0x070b16;
const LENS_FILL = 0x05070f;
/** The backdrop is drawn this much darker while she panics (the manifest's 20% darker). */
const PANIC_DIM = 0x9a9aa6;
/** The roll band drifts down the lens once every this many seconds. */
const ROLL_PERIOD = 5;
const ROLL_HEIGHT = 18;

/** What the hook needs from a canvas: its bounding box on the page. */
interface CanvasLike {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

/** What the parallax reads from the scene: the pointer, in game pixels. */
type PointerScene = { input?: { activePointer?: Point } };

/** A face image and the size of its current texture. */
interface Face {
  img: Phaser.GameObjects.Image;
  mood: CamMood;
  texture: string;
  readonly at: { x: number; y: number };
  readonly crop: ReturnType<typeof emptyCrop>;
}

export class LuxCamView implements LiveView {
  readonly zone = 'cam' as const;
  readonly budget: LiveBudget = { objects: 15, texts: 2 };
  /** Texture swaps and crossfades started so far (tests: only on a mood change). */
  readonly counts = { swaps: 0, fades: 0 };

  private host: LiveHost | null = null;
  private layout: CamLayout | null = null;
  private canvas: CanvasLike | null = null;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private off: (() => void)[] = [];

  private backdrop: Phaser.GameObjects.Image | null = null;
  private readonly backdropAt = { x: 0, y: 0 };
  private readonly backdropCrop = emptyCrop();
  private backdropScale = 1;
  private backdropTint = 0xffffff;
  /** The face fading in (front) and the one fading out (back). */
  private front: Face | null = null;
  private back: Face | null = null;
  private frameG: Phaser.GameObjects.Graphics | null = null;
  private roll: Phaser.GameObjects.Rectangle | null = null;
  private recDot: Phaser.GameObjects.Arc | null = null;
  private bars: Phaser.GameObjects.Rectangle[] = [];

  /** The cam's state, the view it steps on (refilled every frame) and the bus facts. */
  private state: CamState = initialCam();
  private readonly view: MutableCamView = emptyCamView();
  private readonly extras: { -readonly [K in keyof CamExtras]: CamExtras[K] } = {
    dragging: false,
    luxSpeaking: false,
    actionAt: null,
    shockAt: null,
  };
  private history: CamHistoryEntry[] = [];
  /** The id of Lux's line on the band, until its lineEnd. */
  private speakingId: LineId | null = null;
  /** HUD clock of the last update, the crossfade's start (or null) and the panic's start (or null). */
  private clock = 0;
  private fadeAt: number | null = null;
  private panicAt: number | null = null;
  private lastNow = -Infinity;
  private frameRed = false;
  private recShown = true;
  private reduced = false;
  private dx = Number.NaN;
  private dy = Number.NaN;

  preload(scene: Phaser.Scene): void {
    preloadArt(scene as never, [CAM_BACKDROP_KEY]);
    for (const p of camPortraits()) if (!scene.textures.exists(p.key)) scene.load.image(p.key, p.file);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.host = host;
    const L = camLayout(host.rect);
    this.layout = L;
    this.canvas = (scene as unknown as { game?: { canvas?: CanvasLike } }).game?.canvas ?? null;
    const add = scene.add;
    const lens = L.lens;
    const z = L.plate;

    // The plate and the lens's black.
    const plate = add.graphics();
    plate.fillStyle(PLATE_FILL, 0.94);
    plate.fillRect(z.x, z.y, z.w, z.h);
    plate.lineStyle(1, COLORS.cyan, 0.3);
    plate.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
    plate.fillStyle(LENS_FILL, 1);
    plate.fillRect(lens.x, lens.y, lens.w, lens.h);

    // The backdrop: the requested plate once picked, the dark bedroom until then.
    const art = resolveArt(CAM_BACKDROP_KEY);
    const texture = scene.textures.exists(art.texture) ? art.texture : null;
    if (texture) {
      const img = add.image(lens.x, lens.y, texture).setOrigin(0);
      this.backdropScale = backdropScale(img.width, img.height);
      img.setScale(this.backdropScale);
      this.backdropTint = art.tint;
      img.setTint(art.tint);
      img.setAlpha(art.alpha);
      this.backdrop = img;
    }

    // Two faces, for the crossfade. Both start on the calm face.
    const calm = camTextureOf('calm');
    this.front = this.makeFace(scene, calm);
    this.back = this.makeFace(scene, calm);
    this.back.img.setVisible(false);

    // Scanlines and the vignette, drawn once.
    const scan = add.graphics();
    scan.fillStyle(LENS_FILL, 0.16);
    for (let y = lens.y + 1; y < lens.y + lens.h; y += 3) scan.fillRect(lens.x, y, lens.w, 1);
    for (let i = 0; i < 10; i++) {
      scan.lineStyle(2, LENS_FILL, 0.07 * (10 - i) * 0.5);
      scan.strokeRect(lens.x + 1 + i * 2, lens.y + 1 + i * 2, lens.w - 2 - i * 4, lens.h - 2 - i * 4);
    }
    this.roll = add.rectangle(lens.x, lens.y, lens.w, ROLL_HEIGHT, 0xffffff, 0.035).setOrigin(0);

    this.frameG = add.graphics();
    this.frameRed = false;
    this.drawFrame(false);

    const label = add.text(L.label.x, L.label.y, CAM_WORDS.title, {
      fontFamily: FONT,
      fontSize: '16px',
      color: COLORS.amberText,
    });
    this.recDot = add.circle(L.recDot.x, L.recDot.y, 5, COLORS.red, 1);
    const rec = add.text(L.recText.x, L.recText.y, CAM_WORDS.rec, {
      fontFamily: FONT,
      fontSize: '16px',
      color: COLORS.amberText,
    });
    this.bars = L.bars.map((b) =>
      add.rectangle(b.x, b.y, L.barWidth, L.barHeight, COLORS.amber, 1).setOrigin(0.5, 1),
    );

    this.objects = [plate];
    if (this.backdrop) this.objects.push(this.backdrop);
    this.objects.push(this.back.img, this.front.img, scan, this.roll, this.frameG, label, this.recDot, rec);
    this.objects.push(...this.bars);
    for (const o of this.objects) (o as unknown as { setDepth(d: number): unknown }).setDepth(CAM_DEPTH);

    this.state = initialCam(0);
    this.history = [{ mood: this.state.mood, at: 0 }];
    this.fadeAt = null;
    this.panicAt = null;
    this.lastNow = -Infinity;
    this.recShown = true;
    this.dx = Number.NaN;
    this.dy = Number.NaN;
    this.reduced = settings().reduceFlicker;
    this.layoutAll(0);
    this.off.push(provideHudSection('luxCam', () => this.snapshot()));

    // The bus facts camStep reads (luxcam-3): Lux's band line, the board's drag, every action.
    const ex = this.extras;
    ex.dragging = false;
    ex.luxSpeaking = false;
    ex.actionAt = null;
    ex.shockAt = null;
    this.speakingId = null;
    const bus = host.bus;
    this.off.push(
      bus.on('line', (l) => {
        // One line is on the band at a time: a new line that is not hers ends her talking.
        const hers = speakerName(l.speaker) === 'Lux';
        this.speakingId = hers ? l.id : null;
        ex.luxSpeaking = hers;
      }),
      bus.on('lineEnd', (l) => {
        if (l.id !== this.speakingId) return;
        this.speakingId = null;
        ex.luxSpeaking = false;
      }),
      bus.on('drag', (d) => {
        ex.dragging = d.kind !== null;
      }),
      bus.on('action', () => {
        ex.actionAt = this.clock;
      }),
    );
  }

  private makeFace(scene: Phaser.Scene, texture: string): Face {
    const img = scene.add.image(0, 0, texture).setOrigin(0);
    return { img, mood: 'calm', texture, at: { x: 0, y: 0 }, crop: emptyCrop() };
  }

  /** Bring the cam in line with this frame. Allocates nothing unless the mood changes. */
  update(frame: Frame, clock: LiveClock, occurrences: readonly Occurrence[]): void {
    if (!this.front || !this.layout) return;
    const c = clock.now;
    this.clock = c;
    this.reduced = settings().reduceFlicker;

    // A new run (the clock went back with no rewind): the cam starts over.
    if (frame.now < this.lastNow && frame.rewinds.length <= this.state.rewinds) this.restart(c, frame);
    this.lastNow = frame.now;

    const v = fillCamView(this.view, frame, occurrences, this.extras, c);
    this.extras.shockAt = v.shockAt;
    const next = camStep(this.state, v);
    if (next !== this.state) {
      const was = this.state.mood;
      this.state = next;
      if (next.mood !== was) this.onMood(next.mood, c);
    }

    // The crossfade, as plain numbers on the HUD clock.
    if (this.fadeAt !== null) {
      const a = fadeAlpha(c - this.fadeAt);
      this.front.img.setAlpha(a);
      this.back?.img.setAlpha(1 - a);
      if (a >= 1) {
        this.fadeAt = null;
        this.back?.img.setVisible(false);
      }
    }

    this.layoutAll(c);

    const rec = recOn(c, this.reduced);
    if (rec !== this.recShown) {
      this.recShown = rec;
      this.recDot?.setVisible(rec);
    }
    this.updateRoll(c);
    this.updateBars(c);
  }

  /** The mood changed: swap the front face (the old one fades out behind it), record it, recolour. */
  private onMood(mood: CamMood, c: number): void {
    const front = this.front;
    const back = this.back;
    if (!front || !back) return;
    const texture = camTextureOf(mood);
    // The old face moves to the back image; the front takes the new one and fades in.
    back.img.setTexture(front.texture);
    back.texture = front.texture;
    back.mood = front.mood;
    back.img.setVisible(true);
    back.img.setAlpha(1);
    front.img.setTexture(texture);
    front.texture = texture;
    front.mood = mood;
    front.img.setAlpha(0);
    this.counts.swaps++;
    this.counts.fades++;
    this.fadeAt = c;
    this.dx = Number.NaN;

    this.history.push({ mood, at: c });
    if (this.history.length > CAM_HISTORY) this.history.shift();

    const red = mood === 'panicking';
    this.panicAt = red ? c : null;
    if (red !== this.frameRed) {
      this.frameRed = red;
      this.drawFrame(red);
      if (this.backdrop) this.backdrop.setTint(red ? PANIC_DIM : this.backdropTint);
    }
  }

  private restart(c: number, frame: Frame): void {
    this.state = initialCam(c, frame.rewinds.length);
    this.extras.shockAt = null;
    this.extras.actionAt = null;
    if (this.front && this.front.mood !== 'calm') this.onMood('calm', c);
  }

  /** Place the backdrop and the faces for this frame's breath, shake and parallax, cropped to the lens. */
  private layoutAll(c: number): void {
    const L = this.layout;
    const front = this.front;
    if (!L || !front) return;
    const steady = this.reduced || (this.host?.flags.lite ?? false);
    let px = 0;
    let py = 0;
    if (!steady) {
      const p = (this.host?.scene as unknown as PointerScene | undefined)?.input?.activePointer;
      if (p) {
        px = Math.max(-1, Math.min(1, p.x / 960 - 1));
        py = Math.max(-1, Math.min(1, p.y / 540 - 1));
      }
    }
    const art = CAM_ART[front.mood];
    const dx = shakeX(this.panicAt === null ? -1 : c - this.panicAt, steady) - px * CAM_FACE_PARALLAX.x;
    const dy = breathY(c, art.breath, steady) - py * CAM_FACE_PARALLAX.y;
    if (dx === this.dx && dy === this.dy) return;
    this.dx = dx;
    this.dy = dy;
    const lens = L.lens;

    const b = this.backdrop;
    if (b) {
      const s = this.backdropScale;
      const bx = lens.x + (lens.w - b.width * s) / 2 + px * CAM_PARALLAX.x;
      const by = lens.y + (lens.h - b.height * s) / 2 + py * CAM_PARALLAX.y;
      this.backdropAt.x = bx;
      this.backdropAt.y = by;
      lensCrop(lens, bx, by, b.width, b.height, s, this.backdropCrop);
      b.setPosition(bx, by);
      b.setCrop(this.backdropCrop.x, this.backdropCrop.y, this.backdropCrop.w, this.backdropCrop.h);
    }
    this.placeOne(front, dx, dy);
    if (this.back?.img.visible) this.placeOne(this.back, dx, dy);
  }

  private placeOne(face: Face, dx: number, dy: number): void {
    const L = this.layout;
    if (!L) return;
    const art = CAM_ART[face.mood];
    const img = face.img;
    placeFace(L.lens, img.width, img.height, art, dx, dy, face.at);
    img.setScale(art.scale);
    img.setPosition(face.at.x, face.at.y);
    const k = lensCrop(L.lens, face.at.x, face.at.y, img.width, img.height, art.scale, face.crop);
    img.setCrop(k.x, k.y, k.w, k.h);
  }

  private drawFrame(red: boolean): void {
    const g = this.frameG;
    const L = this.layout;
    if (!g || !L) return;
    const lens = L.lens;
    g.clear();
    g.lineStyle(2, red ? COLORS.red : COLORS.amber, 0.95);
    g.strokeRect(lens.x, lens.y, lens.w, lens.h);
    // Bracket corners just inside the plate.
    const z = L.plate;
    const k = 14;
    g.lineStyle(2, red ? COLORS.red : COLORS.amber, 0.8);
    g.beginPath();
    g.moveTo(z.x + 3, z.y + 3 + k);
    g.lineTo(z.x + 3, z.y + 3);
    g.lineTo(z.x + 3 + k, z.y + 3);
    g.moveTo(z.x + z.w - 3 - k, z.y + 3);
    g.lineTo(z.x + z.w - 3, z.y + 3);
    g.lineTo(z.x + z.w - 3, z.y + 3 + k);
    g.moveTo(z.x + 3, z.y + z.h - 3 - k);
    g.lineTo(z.x + 3, z.y + z.h - 3);
    g.lineTo(z.x + 3 + k, z.y + z.h - 3);
    g.moveTo(z.x + z.w - 3 - k, z.y + z.h - 3);
    g.lineTo(z.x + z.w - 3, z.y + z.h - 3);
    g.lineTo(z.x + z.w - 3, z.y + z.h - 3 - k);
    g.strokePath();
  }

  private updateRoll(c: number): void {
    const r = this.roll;
    const L = this.layout;
    if (!r || !L) return;
    const steady = this.reduced || (this.host?.flags.lite ?? false);
    if (r.visible === steady) r.setVisible(!steady);
    if (steady) return;
    const t = (c % ROLL_PERIOD) / ROLL_PERIOD;
    r.y = L.lens.y + t * (L.lens.h - ROLL_HEIGHT);
  }

  /** The talk bars: low and dim while she is quiet, bouncing while her line is on. */
  private updateBars(c: number): void {
    const speaking = this.extras.luxSpeaking;
    for (let i = 0; i < this.bars.length; i++) {
      const bar = this.bars[i];
      const level = talkLevel(i, c, speaking, this.reduced);
      if (bar.scaleY !== level) bar.scaleY = level;
      const alpha = speaking ? 1 : 0.35;
      if (bar.alpha !== alpha) bar.setAlpha(alpha);
    }
  }

  /** The current mood (tests). */
  get mood(): CamMood {
    return this.state.mood;
  }

  /** The cam's state object (tests: identical across quiet frames). */
  get camState(): CamState {
    return this.state;
  }

  /** hud.luxCam, built only when the hook is read. */
  snapshot(): LuxCamTestState {
    const L = this.layout;
    const zero: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const canvas = this.canvas?.getBoundingClientRect() ?? { left: 0, top: 0, width: 1920, height: 1080 };
    const page = (r: Rect): Rect => pageRect(r, canvas);
    const s = this.state;
    return {
      mood: s.mood,
      art: this.front?.texture ?? '',
      since: s.since,
      stressedFor: s.stressSince === null ? 0 : Math.max(0, this.clock - s.stressSince),
      rec: this.recShown,
      frame: this.frameRed ? 'red' : 'amber',
      fading: this.fadeAt !== null,
      speaking: this.extras.luxSpeaking,
      dragging: this.extras.dragging,
      motion: this.reduced ? 'reduced' : 'full',
      history: this.history.map((h) => ({ ...h })),
      zone: page(L ? L.plate : zero),
      lens: page(L ? L.lens : zero),
      face: page(this.front ? { ...this.front.crop.visible } : zero),
      backdrop: page(this.backdrop ? { ...this.backdropCrop.visible } : zero),
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.backdrop = null;
    this.front = null;
    this.back = null;
    this.frameG = null;
    this.roll = null;
    this.recDot = null;
    this.bars = [];
    this.layout = null;
    this.host = null;
    this.canvas = null;
  }
}
