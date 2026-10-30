// The comms band (ZONES.comms) as a Live screen view: the one home of every board bark. Five round
// slots (TRIAGE, REI, MIKA, OZZIE, HOUSE; the crew dark until they are in), a divider, the speaker's
// nameplate with the line's tag pill, and the line typed out in amber. Lux has no slot: her lines
// show with the LUX tag while her cam answers. The band never holds the run.
//
// The HUD scene hands it each bark the cue table fires (enqueue); the pure model in comms.ts
// decides what shows and for how long. When a line starts the band emits bus `line` (and TRIAGE's
// blip), when it ends `lineEnd`; a `voiceStart` for the line holds it until the clip ends + 0.6 s.
// hud.comms mirrors it for tests (src/scenes/live/views/comms.ts), and hud.bark keeps the ids and
// text BarkView reported.
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import { TEXT_CPS, settings } from '../../game/settings';
import { LINES, type LineId } from '../../strings';
import { testHookEnabled } from '../../testHook';
import { COMMS_AVATARS, avatarSource, preloadAvatars, roundAvatar } from '../avatars';
import { FULL, faceCrop } from '../avatarCrop';
import { fileTexture } from '../plates';
import { type Rect, pagePoint, pageRect } from '../live/layout';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import { type CommsTestState, provideCommsHook } from '../live/views/comms';
import {
  COMMS_SLOTS,
  type CommsLayout,
  type CommsSlot,
  type CommsState,
  type ArtUse,
  CHIP_SIZE,
  type ChipArt,
  IDLE_MOOD,
  type PlateArt,
  type Iris,
  LOG_CLOSED,
  LOG_ROWS,
  type LogState,
  NO_COMMS,
  OTHER_RING_ALPHA,
  type TriageMood,
  bandAlpha,
  CALL_SLIDE,
  callAlpha,
  callTarget,
  isCallerLine,
  chipArt,
  clickLog,
  commsLayout,
  crewLight,
  crewTint,
  cutShort,
  enqueueComms,
  extendForVoice,
  irisFor,
  type LeaderTarget,
  leaderPath,
  leaderSubject,
  resolveLeader,
  logLines,
  logOpen,
  moodOf,
  nameOf,
  onRect,
  plateArt,
  plateFile,
  slotOf,
  SWAP_TICK_SECONDS,
  speakRing,
  stepComms,
  stepLog,
  swapTick,
  tag,
  TRIAGE_TILE,
  triageMood,
  typedOf,
} from './comms';
import { COLORS, FONT, FONT_SANS } from './layout';
import { type LocatedPoint, locate, registeredNames } from './locate';
import { LABELS } from './labels';
import { isLesson } from './lineMeta';
import { panel } from './panel';

/** The slot avatars' diameter: the slot's circle, r 42. */
const AVATAR_SIZE = 84;
/** The iris shapes are built at this radius and scaled to the mood's. */
const IRIS_BASE_R = 10;
/** The rims' alpha with nobody speaking. */
const RIM_IDLE_ALPHA = 0.9;
/** The nameplate a dark crew slot wears. */
const DARK_NAME = '---';
/** The band's own words: its title. Slot names are the crew's names; tags are lineMeta's. */
export const COMMS_TEXT = LABELS.comms;
/** The older two log rows sit back. */
const LOG_OLDER_ALPHA = 0.65;
/** Replays the hook remembers. */
const REPLAYED_MAX = 12;

/** Bus events remembered for the hook. */
const EMITTED_MAX = 24;

/** A leader whose subject is not on screen yet is looked for again this often (real seconds). */
const LEADER_RETRY = 0.25;
/** The leader sits a little under the line's own amber. */
const LEADER_ALPHA = 0.9;

/** The leader line as the hook reports it (comms-8), in page CSS pixels. */
export interface CommsLeaderState {
  /** lineMeta's subject ('part:idle', 'zone:gauge', 'key:two'). */
  subject: string;
  /** The part id, or the locate name, it found. */
  target: string;
  /** Where it leaves the band, where it turns, and where it ends (the target's anchor). */
  from: { x: number; y: number };
  corner: { x: number; y: number };
  to: { x: number; y: number };
}

/** A size in game px. */
export interface ArtSize {
  w: number;
  h: number;
}

/**
 * A w x h picture drawn inside `box`: scaled down to fit when it is larger, never up, and centred
 * on whole pixels. A picture with no size (not loaded, or a stub) fills the box. Pure.
 */
export function fitCentred(w: number, h: number, box: Rect): Rect {
  if (!(w > 0) || !(h > 0)) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const k = Math.min(1, box.w / w, box.h / h);
  const dw = Math.round(w * k);
  const dh = Math.round(h * k);
  return { x: box.x + Math.round((box.w - dw) / 2), y: box.y + Math.round((box.h - dh) / 2), w: dw, h: dh };
}

/**
 * Where TRIAGE's lens sits in her picked badge (chars/comms/triage.webp, 244x256), as fractions of
 * the file: the centre of her cat drone's LED screen, left blank in the badge so the iris drawn over
 * it is the screen's eye.
 */
export const TRIAGE_LENS = { fx: 71.5 / 244, fy: 140.8 / 256 } as const;

/**
 * The lens's offset from the slot's centre, in game px, for a w x h badge round-cropped (as
 * roundAvatar crops it, whole and centred) into a `size` px avatar. Zero for a picture with no size.
 * Pure.
 */
export function lensOffset(
  w: number,
  h: number,
  size: number,
  lens = TRIAGE_LENS,
): { dx: number; dy: number } {
  if (!(w > 0) || !(h > 0)) return { dx: 0, dy: 0 };
  const c = faceCrop(w, h, size, FULL);
  const at = (v: number): number => Math.round(v * 10) / 10;
  return {
    dx: at((lens.fx * w - c.x - c.side / 2) * c.scale),
    dy: at((lens.fy * h - c.y - c.side / 2) * c.scale),
  };
}

/** HOUSE's chip: the door for Grandma, the TV for the TV downstairs. */
const houseChip = (speaker: string): string =>
  speaker.startsWith('TV') ? COMMS_AVATARS.HOUSE[1] : COMMS_AVATARS.HOUSE[0];

const TAG_COLOR: Readonly<Record<string, number>> = {
  HINT: COLORS.cyan,
  WARNING: COLORS.red,
  CREW: COLORS.hero,
  LUX: COLORS.magenta,
  HOUSE: COLORS.unlit,
};

/** The bark state in the shape hud.bark has always reported. */
export interface BarkSnapshot {
  current: LineId | null;
  text: string | null;
  history: LineId[];
}

/** TRIAGE's iris as the hook mirrors it (comms-4): her mood, irisFor's numbers, and the gate. */
export interface CommsIrisState {
  /** The current TRIAGE line's mood, or her resting mood while someone else (or no one) speaks. */
  mood: TriageMood;
  dx: number;
  dy: number;
  r: number;
  open: number;
  /** 'reduced' under reduce flicker: no jitter, sway or blinks. */
  motion: 'full' | 'reduced';
}

/** The speaker's ring (comms-4). */
export interface CommsGlowState {
  /** The slot whose ring glows, or null (nobody speaking, or Lux, who has no slot). */
  slot: CommsSlot | null;
  /** The ring's alpha now (speakRing), before the band's fade. */
  alpha: number;
  color: 'amber' | 'red' | null;
  /** 'steady' under reduce flicker, else a 1.2 Hz 'pulse'. */
  motion: 'pulse' | 'steady';
  /** The other slots' rims while a line shows. */
  others: number;
}

/** One face's art: the manifest key, where its picture came from and the texture drawn. */
export interface CommsFaceArt {
  slot: CommsSlot;
  key: string;
  use: ArtUse;
  texture: string;
}

/** The band's art as drawn (comms-9). */
export interface CommsArtState {
  /**
   * The plate: the picked comms-plate, the text-box plate it falls back to, or a code rectangle.
   * `source` is the picked file's size (null for a nine-sliced fallback or the code plate) and
   * `drawn` where it is drawn, in page CSS px; `size` its drawn size in game px.
   */
  plate: { use: ArtUse; texture: string | null; source: ArtSize | null; size: ArtSize; drawn: Rect };
  /** TRIAGE, REI, MIKA and OZZIE's round avatars. */
  faces: CommsFaceArt[];
  /** The HOUSE chip: which one shows, where each comes from, and whether art or the code glyph draws. */
  house: {
    shown: 'door' | 'tv';
    chips: { key: string; use: ArtUse }[];
    drawn: 'art' | 'glyph';
    /** The shown chip's file size and its drawn size in game px; null while the code glyph draws. */
    source: ArtSize | null;
    size: ArtSize | null;
  };
  /** Where TRIAGE's iris sits from her slot's centre, in game px: over the picked badge's lens, else 0. */
  lens: { dx: number; dy: number };
}

declare module '../live/views/comms' {
  interface CommsTestState {
    /** Where the plate, faces and HOUSE chips came from (comms-9). */
    art: CommsArtState;
    /** TRIAGE's iris over slot 0 (comms-4). */
    iris: CommsIrisState;
    glow: CommsGlowState;
    /** The crew's light-up: 0 dark, 1 lit, eased over 400 ms once run().rescued. */
    crew: { light: number };
    /** comms-8: every name registered with locate.ts now, and where it is (page px; null when off screen). */
    located: Record<string, { x: number; y: number } | null>;
  }
}

declare global {
  interface Window {
    /** Test-only stand-in for the mixer's voiceStart (installed only with `?test`). */
    __neonComms?: { voiceStart(id: string, seconds: number): void };
  }
}

export class CommsView implements LiveView {
  readonly zone = 'comms' as const;
  readonly budget: LiveBudget = { objects: 31, texts: 13 };

  /** The band's model; replaced, never mutated. */
  state: CommsState = NO_COMMS;
  private clock = 0;
  private scene: Phaser.Scene | null = null;
  private bus: Bus | null = null;
  private rect: Rect | null = null;
  private L: CommsLayout | null = null;
  private off: (() => void)[] = [];
  private emitted: string[] = [];

  private root: Phaser.GameObjects.Container | null = null;
  private ring: Phaser.GameObjects.Graphics | null = null;
  private pill: Phaser.GameObjects.Graphics | null = null;
  private faces: Phaser.GameObjects.Image[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private nameText: Phaser.GameObjects.Text | null = null;
  private tagText: Phaser.GameObjects.Text | null = null;
  private lineText: Phaser.GameObjects.Text | null = null;

  /** What is drawn now, so update only touches what changed. */
  private shownTyped = -1;
  private shownAlpha = -1;
  private shownPresent: boolean | null = null;
  /** comms-9: where the plate, each face and each HOUSE chip came from (the manifest or a fallback). */
  private plateUse: PlateArt | null = null;
  private chips: ChipArt[] = [];
  /** The picked plate's file size, and the rect it is drawn in (game px). */
  private plateSource: ArtSize | null = null;
  private plateRect: Rect | null = null;
  /** Each HOUSE chip's file size, and the size it is drawn at (fitted in CHIP_SIZE, never upscaled). */
  private chipSource: (ArtSize | null)[] = [];
  private chipSize: (ArtSize | null)[] = [];
  /** TRIAGE's iris offset from her slot's centre: over the picked badge's lens. */
  private lens = { dx: 0, dy: 0 };
  private faceArt: CommsFaceArt[] = [];
  /** The HOUSE chip showing: 0 the door, 1 the TV. */
  private houseShown: 0 | 1 = 0;
  private houseGlyph: Phaser.GameObjects.Graphics | null = null;

  /** comms-4: the slots' rims (sit back while a line shows), TRIAGE's iris, the glow and the tick. */
  private host: LiveHost | null = null;
  private rims: Phaser.GameObjects.Graphics | null = null;
  private irisRing: Phaser.GameObjects.Arc | null = null;
  private irisPupil: Phaser.GameObjects.Arc | null = null;
  /** Real seconds (the game loop's clock) the current line started, for its glow. */
  private lineAt = 0;
  /** The speaking slot (index) and when its face ticked; -1 for none. */
  private speakingSlot = -1;
  private tickAt = -Infinity;
  private tickShown = false;
  /** The faces' scale after setDisplaySize, so the tick multiplies it. */
  private faceScale: number[] = [];
  /** The faces' fallback tint and alpha from roundAvatar. */
  private faceTint: number[] = [];
  private faceAlpha: number[] = [];
  /** Real seconds the crew came in (run().rescued), or null while they are out. */
  private crewSince: number | null = null;
  private shownLight = -1;
  /** Real seconds now, read once per update from the game loop. */
  private real = 0;

  /** The reread log (comms-3): hover or pin, its rows and the replay glyph. */
  private log: LogState = LOG_CLOSED;
  private logRows: Phaser.GameObjects.Text[] = [];
  private replayGlyph: Phaser.GameObjects.Text | null = null;
  /** The lines the log rows show, newest last, and the band state they were read from. */
  private logIds: LineId[] = [];
  private logFor: CommsState | null = null;
  private shownLogOpen = false;
  private replayed: LineId[] = [];
  /** The board's drag (bus drag): hover is ignored while it is non-null. */
  private dragKind: string | null = null;
  /** The run is held (a card, a scene): clicks on the band are ignored. */
  private held = true;

  /**
   * comms-8: the leader line from the band to the part or zone the current line is about. Drawn
   * outside the band's container (it leaves the zone by design), once per line.
   */
  private leaderGfx: Phaser.GameObjects.Graphics | null = null;
  private leader: LeaderTarget | null = null;
  private leaderPts: readonly [LocatedPoint, LocatedPoint, LocatedPoint] | null = null;
  /** The line the leader belongs to, and the real time of the last try while it found nothing. */
  private leaderFor: LineId | null = null;
  /** The call panel (layout A): the speaker's video tile, and how far the panel has popped up (0 to 1). */
  private tileBg: Phaser.GameObjects.Graphics | null = null;
  private tileImg: Phaser.GameObjects.Image | null = null;
  private callA = 0;
  /** The last line a caller (not Lux) spoke, which the caller cam keeps up between lines. */
  private lastCaller: LineId | null = null;
  private callReal = 0;
  private leaderTry = -Infinity;
  private shownLeaderAlpha = -1;

  preload(scene: Phaser.Scene): void {
    preloadAvatars(scene as never, [
      COMMS_AVATARS.TRIAGE,
      COMMS_AVATARS.REI,
      COMMS_AVATARS.MIKA,
      COMMS_AVATARS.OZZIE,
      ...COMMS_AVATARS.HOUSE,
    ]);
    // TRIAGE's painted moods for the call panel's video tile.
    for (const [mood, file] of Object.entries(TRIAGE_TILE)) {
      const key = `call:triage:${mood}`;
      if (scene.load && !scene.textures.exists(key)) scene.load.image(key, file);
    }
    // The picked plate, once the manifest carries its cut (its fallback is the HUD's text box).
    const file = plateFile();
    if (file && !scene.textures.exists(fileTexture(file))) scene.load.image(fileTexture(file), file);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.scene = scene;
    this.host = host;
    this.bus = host.bus;
    this.rect = host.rect;
    const L = commsLayout(host.rect);
    this.L = L;
    const add = scene.add;
    const r = host.rect;

    // comms-9: the plate, the faces and the HOUSE chips come through the art manifest, each with
    // its fallback, so a pick dropped in later needs no change here.
    const exists = (t: string): boolean => scene.textures.exists(t);
    const pa = plateArt(exists);
    // The call panel (layout A, A2) draws its plate in code, so the snapshot says so.
    this.plateUse = L.tile ? { use: 'code', texture: null, nine: false, tint: 0xffffff, alpha: 1 } : pa;
    let plate:
      | Phaser.GameObjects.Image
      | Phaser.GameObjects.NineSlice
      | Phaser.GameObjects.Rectangle
      | Phaser.GameObjects.Graphics;
    this.plateSource = null;
    this.plateRect = { x: r.x, y: r.y, w: r.w, h: r.h };
    if (L.tile) {
      // The call panel is drawn in code: the painted band's plate is a 1455 x 149 strip.
      const g = add.graphics();
      g.fillStyle(COLORS.ink, 0.92);
      g.fillRoundedRect(r.x, r.y, r.w, r.h, 10);
      g.lineStyle(2, COLORS.cyan, 0.55);
      g.strokeRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 10);
      plate = g;
    } else if (pa.texture && !pa.nine) {
      // The picked plate is a little under the band (1455x149 in 1455x150): drawn at its own
      // size, centred on whole pixels, never stretched up to the band.
      const src = this.frameSize(scene, pa.texture);
      const at = fitCentred(src.w, src.h, r);
      this.plateSource = src.w > 0 ? src : null;
      this.plateRect = at;
      plate = add.image(at.x, at.y, pa.texture).setOrigin(0).setDisplaySize(at.w, at.h);
      plate.setTint(pa.tint).setAlpha(pa.alpha);
    } else if (pa.texture) {
      plate = panel(scene, pa.texture, r.x, r.y, r.w, r.h, { k: 0.6 });
      plate.setTint(pa.tint).setAlpha(pa.alpha);
    } else {
      plate = add.rectangle(r.x, r.y, r.w, r.h, COLORS.ink, 0.9).setOrigin(0);
    }
    const title = add.text(L.title.x, L.title.y, COMMS_TEXT.title, {
      fontFamily: FONT,
      fontSize: '13px',
      color: COLORS.cyanText,
    });
    // Over the call tile, on a dark chip so a face under it never hides it.
    if (L.tile) title.setBackgroundColor('#05070fcc').setPadding(4, 2, 4, 2);

    const slots = add.graphics();
    const rims = add.graphics();
    for (const s of L.slots) {
      slots.fillStyle(COLORS.ink, 0.85);
      slots.fillCircle(s.x, s.y, s.r);
      rims.lineStyle(2, COLORS.unlit, 1);
      rims.strokeCircle(s.x, s.y, s.r);
    }
    rims.setAlpha(RIM_IDLE_ALPHA);
    this.rims = rims;
    slots.lineStyle(1, COLORS.cyan, 0.35);
    slots.lineBetween(L.divider.x, L.divider.top, L.divider.x, L.divider.bottom);

    // Bake every face once here, so a swap in update is a setTexture.
    const avatarScene = scene as unknown as Parameters<typeof roundAvatar>[0];
    const house = [
      roundAvatar(avatarScene, COMMS_AVATARS.HOUSE[0], AVATAR_SIZE),
      roundAvatar(avatarScene, COMMS_AVATARS.HOUSE[1], AVATAR_SIZE),
    ];
    // Until the door and TV chips are picked, HOUSE is a code glyph rather than a blank stand-in disc.
    this.chips = [chipArt(COMMS_AVATARS.HOUSE[0], exists), chipArt(COMMS_AVATARS.HOUSE[1], exists)];
    // The picked chips are 128x120: fitted in the 64 px chip box at their own aspect, never upscaled.
    const chipBox = { x: 0, y: 0, w: CHIP_SIZE, h: CHIP_SIZE };
    this.chipSource = this.chips.map((c) => (c.texture ? this.frameSize(scene, c.texture) : null));
    this.chipSize = this.chipSource.map((src) => {
      if (!src) return null;
      const f = fitCentred(src.w, src.h, chipBox);
      return { w: f.w, h: f.h };
    });
    this.houseGlyph = add.graphics();
    this.faceTint = [];
    this.faceAlpha = [];
    this.faceScale = [];
    this.faces = L.slots.map((s) => {
      const a = s.name === 'HOUSE' ? house[0] : roundAvatar(avatarScene, COMMS_AVATARS[s.name], AVATAR_SIZE);
      const img = add.image(s.x, s.y, a.texture);
      img.setDisplaySize(AVATAR_SIZE, AVATAR_SIZE);
      img.setTint(a.tint);
      img.setAlpha(a.alpha);
      this.faceTint.push(a.tint);
      this.faceAlpha.push(a.alpha);
      this.faceScale.push(img.scaleX);
      return img;
    });
    this.faceArt = L.slots.map((s, i) => {
      const key = s.name === 'HOUSE' ? COMMS_AVATARS.HOUSE[0] : COMMS_AVATARS[s.name];
      const src = avatarSource(key);
      const a = s.name === 'HOUSE' ? house[0] : null;
      const fallback = a ? a.fallback : src.fallback || !exists(src.texture);
      const use: ArtUse = !fallback ? 'picked' : src.file !== null && exists(src.texture) ? 'reuse' : 'code';
      return { slot: s.name, key, use, texture: this.faces[i].texture.key };
    });
    // TRIAGE's picked badge paints her lens left of centre: the iris sits over it. Her fallback face
    // keeps the iris on the slot's centre.
    const triageArt = this.faceArt[COMMS_SLOTS.indexOf('TRIAGE')];
    const triageSrc = avatarSource(COMMS_AVATARS.TRIAGE);
    if (triageArt?.use === 'picked') {
      const src = this.frameSize(scene, triageSrc.texture);
      this.lens = lensOffset(src.w, src.h, AVATAR_SIZE);
    } else {
      this.lens = { dx: 0, dy: 0 };
    }

    // TRIAGE's iris: code over her lens, built once and moved, scaled and squashed per frame.
    const t0 = L.slots[COMMS_SLOTS.indexOf('TRIAGE')];
    this.irisRing = add.circle(t0.x, t0.y, IRIS_BASE_R).setStrokeStyle(2, COLORS.cyan, 0.9);
    this.irisRing.setFillStyle(COLORS.ink, 0.55);
    this.irisPupil = add.circle(t0.x, t0.y, IRIS_BASE_R * 0.45, COLORS.cyan, 0.95);
    this.labels = L.slots.map((s) =>
      add
        .text(s.x, L.slotLabelY, s.name, { fontFamily: FONT, fontSize: '12px', color: COLORS.dim })
        .setOrigin(0.5, 0),
    );

    this.ring = add.graphics();
    this.pill = add.graphics();
    this.nameText = add.text(L.name.x, L.name.y, '', {
      fontFamily: FONT,
      fontSize: '17px',
      color: COLORS.cyanText,
    });
    this.tagText = add
      .text(L.tag.x, L.tag.y + L.tag.h / 2, '', { fontFamily: FONT, fontSize: '13px', color: COLORS.white })
      .setOrigin(0, 0.5);
    this.lineText = add.text(L.text.x, L.text.y, '', {
      fontFamily: FONT_SANS,
      fontSize: '28px',
      color: COLORS.heroText,
      wordWrap: { width: L.text.w },
      maxLines: 3,
    });

    this.logRows = L.log.map((row, i) =>
      add
        .text(row.x, row.y, '', {
          fontFamily: FONT_SANS,
          fontSize: '20px',
          color: COLORS.heroText,
          wordWrap: { width: row.w },
          maxLines: 1,
        })
        .setAlpha(i < LOG_ROWS - 1 ? LOG_OLDER_ALPHA : 1)
        .setVisible(false),
    );
    this.replayGlyph = add
      .text(L.replay.x + L.replay.w / 2, L.replay.y + L.replay.h / 2, COMMS_TEXT.replay, {
        fontFamily: FONT_SANS,
        fontSize: '26px',
        color: COLORS.cyanText,
      })
      .setOrigin(0.5)
      .setVisible(false);

    // The call panel's video tile: a dark screen with the speaker's face on it while they talk.
    const tileParts: Phaser.GameObjects.GameObject[] = [];
    this.tileBg = null;
    this.tileImg = null;
    if (L.tile) {
      const t = L.tile;
      const bg = add.graphics();
      bg.fillStyle(0x0b1220, 1);
      bg.fillRoundedRect(t.x, t.y, t.w, t.h, 8);
      bg.lineStyle(2, COLORS.cyan, 0.8);
      bg.strokeRoundedRect(t.x, t.y, t.w, t.h, 8);
      this.tileBg = bg;
      this.tileImg =
        typeof add.image === 'function'
          ? add.image(t.x + t.w / 2, t.y + t.h, '__DEFAULT').setOrigin(0.5, 1)
          : null;
      this.tileImg?.setVisible(false);
      tileParts.push(bg, ...(this.tileImg ? [this.tileImg] : []));
    }
    this.callA = L.tile ? 0 : 1;

    // The roster of round faces: hidden in the caller column (Rolando, 30 Oct 2026), where the cam
    // shows who talks; the slots still track who is present and who speaks.
    const roster = [
      slots,
      ...this.faces,
      rims,
      this.irisRing,
      this.irisPupil,
      this.houseGlyph,
      ...this.labels,
      this.ring,
    ];
    if (!L.roster) for (const o of roster) o.setVisible(false);
    this.root = add.container(0, 0, [
      plate,
      ...tileParts,
      title,
      ...roster,
      this.pill,
      this.nameText,
      this.tagText,
      this.lineText,
      ...this.logRows,
      this.replayGlyph,
    ]);
    this.root.setAlpha(this.callA);
    // The leader leaves the band, so it is not in the band's container (hud.bounds keeps the band).
    this.leaderGfx = add.graphics().setVisible(false);

    const onDown = (p: Phaser.Input.Pointer): void => this.onPointerDown(p.x, p.y);
    scene.input.on('pointerdown', onDown);

    this.off.push(
      host.bus.on('voiceStart', (v) => {
        this.state = extendForVoice(this.state, v.id, this.clock, v.seconds);
      }),
      host.bus.on('drag', (d) => {
        this.dragKind = d.kind;
      }),
      () => scene.input?.off('pointerdown', onDown),
      provideCommsHook(scene, () => this.snapshot()),
    );
    // Node tests build the view without a window; the handle is a browser-test aid only.
    if (typeof window !== 'undefined' && testHookEnabled(window.location.search))
      this.installTestHandle(host.bus);
    this.drawLine(null);
    this.setPresent(false);
    this.showHouse(0);
  }

  /** The band, for the HUD's bounds check. */
  get container(): Phaser.GameObjects.Container | null {
    return this.root;
  }

  /**
   * A bark the cue table fired; it shows when the band's rules let it. A WARNING that cuts the
   * current HINT short cuts its voice too (bus voiceStop): a line never waits for its voice.
   */
  enqueue(id: LineId): void {
    const prev = this.state;
    this.state = enqueueComms(prev, id, this.clock);
    const cut = cutShort(prev, this.state);
    if (cut) this.emit('voiceStop', cut);
  }

  /** A new run: forget every line (the HUD scene calls it when the run is replaced). */
  reset(): void {
    if (this.state.current) this.emit('lineEnd', this.state.current.id);
    this.state = NO_COMMS;
  }

  update(frame: Frame, clock: LiveClock): void {
    this.clock = clock.now;
    if (!this.root) return;
    this.real = this.scene!.game.loop.now / 1000;
    const cps = TEXT_CPS[settings().textSpeed];
    const prev = this.state;
    const next = stepComms(prev, clock.now, cps);
    if (next !== prev) {
      this.state = next;
      const was = prev.current?.id ?? null;
      const now = next.current?.id ?? null;
      if (was !== now || (prev.current && next.current && prev.current.since !== next.current.since)) {
        if (was) this.emit('lineEnd', was);
        if (now) this.startLine(now, next.current!.since);
      }
    }

    const c = this.state.current;
    // A Lux line leaves the caller cam on the last caller's words.
    if (c && !(this.L!.tile && !isCallerLine(c.id))) {
      const typed = typedOf(c, clock.now, cps);
      if (typed !== this.shownTyped) {
        this.shownTyped = typed;
        this.lineText!.setText(LINES[c.id].text.slice(0, typed));
      }
    }
    // The caller cam dims as a whole between lines (callTarget), so its last words stay readable.
    const alpha = this.L!.tile && this.lastCaller ? 1 : bandAlpha(this.state, clock.now);
    if (alpha !== this.shownAlpha) {
      this.shownAlpha = alpha;
      this.nameText!.setAlpha(alpha);
      this.tagText!.setAlpha(alpha);
      this.pill!.setAlpha(alpha);
      this.lineText!.setAlpha(alpha);
    }
    if (frame.rescued !== this.shownPresent) this.setPresent(frame.rescued);
    this.updateCall();
    this.updateMotion(alpha);
    this.updateLeader(frame, alpha);
    this.held = frame.paused;
    this.updateLog();
  }

  // ---- comms-8: the leader line ----

  /**
   * Resolve the current line's leader once when it starts; a line whose subject is not on screen
   * yet (a role no part plays, a name nobody registered) tries again every LEADER_RETRY seconds.
   * Allocates only when it resolves.
   */
  private updateLeader(frame: Frame, alpha: number): void {
    const id = this.state.current?.id ?? null;
    if (id !== this.leaderFor) {
      this.leaderFor = id;
      this.leaderTry = -Infinity;
      if (this.leader) this.setLeader(null);
    }
    if (id && !this.leader && leaderSubject(id) !== null && this.real - this.leaderTry >= LEADER_RETRY) {
      this.leaderTry = this.real;
      const t = resolveLeader(id, frame);
      if (t) this.setLeader(t);
    }
    if (this.leader && alpha !== this.shownLeaderAlpha) {
      this.shownLeaderAlpha = alpha;
      this.leaderGfx!.setAlpha(alpha * LEADER_ALPHA);
    }
  }

  /** Draw the leader (a 2 px amber right-angled path ending in a dot) or take it away. */
  private setLeader(t: LeaderTarget | null): void {
    const g = this.leaderGfx!;
    this.leader = t;
    g.clear();
    this.shownLeaderAlpha = -1;
    if (!t) {
      this.leaderPts = null;
      g.setVisible(false);
      return;
    }
    const pts = leaderPath(this.rect!, t.to);
    this.leaderPts = pts;
    g.lineStyle(2, COLORS.hero, 1);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    g.lineTo(pts[1].x, pts[1].y);
    g.lineTo(pts[2].x, pts[2].y);
    g.strokePath();
    g.fillStyle(COLORS.hero, 1);
    g.fillCircle(pts[2].x, pts[2].y, 4);
    g.setVisible(true);
  }

  // ---- comms-4: glow, iris, tick, crew light-up ----

  /** Reduce flicker (the setting): the hook's gate. Lite only changes the looks, never the hook. */
  private reduced(): boolean {
    return settings().reduceFlicker;
  }

  /** The calm variants draw under reduce flicker and under the lite flag. */
  private steady(): boolean {
    return this.reduced() || (this.host?.flags.lite ?? false);
  }

  /** TRIAGE's mood now: the current TRIAGE line's, or her resting one. */
  private mood(): TriageMood {
    const c = this.state.current;
    return c ? moodOf(triageMood(c.id)) : IDLE_MOOD;
  }

  /** Per frame: the speaker's glow, the rims, the swap tick, the iris and the crew's light. Allocates nothing. */
  private updateMotion(alpha: number): void {
    const now = this.real;
    const steady = this.steady();
    const speaking = this.speakingSlot >= 0 && this.state.current !== null;
    this.ring!.setAlpha(alpha * speakRing(now - this.lineAt, steady));
    this.rims!.setAlpha(speaking ? OTHER_RING_ALPHA : RIM_IDLE_ALPHA);

    const ticking = speaking && now - this.tickAt < SWAP_TICK_SECONDS;
    if (ticking || this.tickShown) {
      for (let i = 0; i < this.faces.length; i++) {
        const k = i === this.speakingSlot && ticking ? swapTick(now - this.tickAt) : 1;
        this.faces[i].setScale(this.faceScale[i] * k);
      }
      this.tickShown = ticking;
    }

    const iris = irisFor(this.mood(), now, steady);
    this.irisRing!.setPosition(this.irisX() + iris.dx, this.irisY() + iris.dy);
    this.irisRing!.setScale(iris.r / IRIS_BASE_R, (iris.r / IRIS_BASE_R) * iris.open);
    this.irisPupil!.setPosition(this.irisX() + iris.dx, this.irisY() + iris.dy);
    this.irisPupil!.setScale(iris.r / IRIS_BASE_R, (iris.r / IRIS_BASE_R) * iris.open);

    const light = crewLight(this.crewSince, now);
    if (light !== this.shownLight) {
      this.shownLight = light;
      const t = crewTint(light);
      const L = this.L!;
      for (let i = 0; i < L.slots.length; i++) {
        const name = L.slots[i].name;
        if (name === 'TRIAGE' || name === 'HOUSE') continue;
        this.faces[i].setTint(light >= 1 ? this.faceTint[i] : t.tint);
        this.faces[i].setAlpha(this.faceAlpha[i] * t.alpha);
      }
    }
  }

  private irisX(): number {
    return this.L!.slots[0].x + this.lens.dx;
  }

  private irisY(): number {
    return this.L!.slots[0].y + this.lens.dy;
  }

  /** A loaded texture's size in px, or 0 x 0 when the scene can't say (a node stub). */
  private frameSize(scene: Phaser.Scene, texture: string): ArtSize {
    const f = scene.textures.getFrame(texture);
    const w = Number(f?.width);
    const h = Number(f?.height);
    return { w: w > 0 ? w : 0, h: h > 0 ? h : 0 };
  }

  /** The speaker's ring as the hook reports it. */
  private glowNow(): CommsGlowState {
    const c = this.state.current;
    const slot = c && this.speakingSlot >= 0 ? COMMS_SLOTS[this.speakingSlot] : null;
    const reduced = this.reduced();
    return {
      slot,
      alpha: slot ? speakRing(this.real - this.lineAt, reduced) : 0,
      color: slot && c ? (tag(c.id) === 'WARNING' ? 'red' : 'amber') : null,
      motion: reduced ? 'steady' : 'pulse',
      others: slot ? OTHER_RING_ALPHA : RIM_IDLE_ALPHA,
    };
  }

  /** The iris the hook reports: irisFor at the gate the setting asks for (lite never changes it). */
  private irisNow(): Iris {
    return irisFor(this.mood(), this.real, this.reduced());
  }

  // ---- the reread log ----

  /** Hover (ignored during a drag) and pin decide whether the log replaces the line. */
  private updateLog(): void {
    const scene = this.scene!;
    const r = this.rect!;
    const p = scene.input.activePointer;
    const over = onRect(r, p.x, p.y);
    // A press that started off the band and is still down is a drag passing over it (board-2's bus
    // drag says so too, once it lands).
    const dragging = this.dragKind !== null || (p.isDown && !onRect(r, p.downX, p.downY));
    const now = scene.game.loop.now / 1000;
    this.log = stepLog(this.log, over, dragging, now);
    const open = logOpen(this.log, now);
    if (open === this.shownLogOpen && (!open || this.logFor === this.state)) return;
    this.shownLogOpen = open;
    for (const o of [this.nameText!, this.tagText!, this.pill!, this.lineText!]) o.setVisible(!open);
    this.replayGlyph!.setVisible(open);
    if (!open) {
      for (const row of this.logRows) row.setVisible(false);
      return;
    }
    this.logFor = this.state;
    this.logIds = logLines(this.state.history, this.state.current, LOG_ROWS);
    // Newest on the last row; fewer lines leave the top rows empty.
    const skip = LOG_ROWS - this.logIds.length;
    for (let i = 0; i < LOG_ROWS; i++) {
      const id = i >= skip ? this.logIds[i - skip] : null;
      this.logRows[i].setText(id ? `${nameOf(id)}  ${LINES[id].text}` : '').setVisible(id !== null);
    }
  }

  private onPointerDown(x: number, y: number): void {
    if (!this.rect || !this.L || this.held) return;
    if (this.shownLogOpen && onRect(this.L.replay, x, y)) {
      this.replay();
      return;
    }
    if (this.dragKind !== null) return;
    this.log = clickLog(this.log, onRect(this.rect, x, y));
  }

  /** The replay glyph: ask the mixer for the newest line's voice again. */
  private replay(): void {
    const id = this.logIds[this.logIds.length - 1];
    if (!id) return;
    this.emit('voice', id);
    this.replayed.push(id);
    if (this.replayed.length > REPLAYED_MAX) this.replayed.shift();
  }

  /**
   * `window.__neonComms` under `?test` only: reports a voiceStart of a chosen length, so a spec
   * knows exactly how long the band must hold a voiced line. The mixer's own voiceStart for the
   * recorded clip (public/audio/voice) also arrives in headless runs, and the band keeps the longer
   * hold. Nothing at runtime reads it.
   */
  private installTestHandle(bus: Bus): void {
    window.__neonComms = {
      voiceStart: (id, seconds) => bus.emit('voiceStart', { id: id as LineId, seconds }),
    };
    this.off.push(() => {
      delete window.__neonComms;
    });
  }

  /** hud.bark: the same ids and text BarkView's queue reported. */
  barkSnapshot(): BarkSnapshot {
    const c = this.state.current;
    return { current: c?.id ?? null, text: c ? LINES[c.id].text : null, history: [...this.state.history] };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    this.root?.destroy();
    this.root = null;
    this.ring = null;
    this.pill = null;
    this.nameText = null;
    this.tagText = null;
    this.lineText = null;
    this.faces = [];
    this.labels = [];
    this.houseGlyph = null;
    this.rims = null;
    this.irisRing = null;
    this.irisPupil = null;
    this.speakingSlot = -1;
    this.shownPresent = null;
    this.crewSince = null;
    this.host = null;
    this.logRows = [];
    this.replayGlyph = null;
    this.leaderGfx?.destroy();
    this.leaderGfx = null;
    this.leader = null;
    this.leaderPts = null;
    this.leaderFor = null;
    this.log = LOG_CLOSED;
    this.shownLogOpen = false;
    this.logFor = null;
    this.scene = null;
    this.bus = null;
  }

  // ---- drawing ----

  private emit(kind: 'lineEnd' | 'voice' | 'voiceStop', id: LineId): void {
    this.emitted.push(`${kind}:${id}`);
    if (this.emitted.length > EMITTED_MAX) this.emitted.shift();
    if (kind === 'lineEnd') this.bus?.emit('lineEnd', { id });
    else if (kind === 'voice') this.bus?.emit('voice', { id });
    else this.bus?.emit('voiceStop', { id });
  }

  /**
   * A line starts: tell chat and the cam, and give TRIAGE her blip. Bus `line` is also the line's
   * one voice request: the mixer asks for the clip on it (docs/AUDIO.md), so the band sends no
   * separate `voice` for it (that would ask twice); `voice` is the replay glyph's.
   */
  private startLine(id: LineId, since: number): void {
    const l = LINES[id];
    this.emitted.push(`line:${id}`);
    if (this.emitted.length > EMITTED_MAX) this.emitted.shift();
    this.bus?.emit('line', { id, speaker: l.speaker, tag: tag(id), lesson: isLesson(id), since });
    // The caller cam keeps the last caller up between lines; Lux's own lines caption her cam.
    if (this.L?.tile && !isCallerLine(id)) return;
    if (this.L?.tile) this.lastCaller = id;
    this.drawLine(id);
    if (slotOf(l.speaker) === 'TRIAGE') {
      this.bus?.emit('sfx', { key: tag(id) === 'WARNING' ? 'triage-panic' : 'triage-blip' });
    }
  }

  /**
   * The call panel pops up while someone is on the line (or the log is open) and away after, and the
   * speaker's tile slides in as their line starts. The old full-width band never fades (no tile).
   */
  private updateCall(): void {
    const L = this.L!;
    if (!L.tile) return;
    const dt = Math.min(0.1, Math.max(0, this.real - this.callReal));
    this.callReal = this.real;
    const target = callTarget(this.state.current?.id ?? null, logOpen(this.log, this.real), this.lastCaller);
    const a = callAlpha(this.callA, target, dt, this.steady());
    if (a !== this.callA) {
      this.callA = a;
      this.root!.setAlpha(a);
    }
    const img = this.tileImg;
    if (img?.visible) {
      const k = this.steady() ? 1 : Math.min(1, (this.real - this.lineAt) / 0.25);
      img.setX(L.tile.x + L.tile.w / 2 + CALL_SLIDE * (1 - k) * (1 - k));
    }
  }

  /** The speaker's face on the call tile: TRIAGE's mood, a crew member's face, the door or the TV. */
  private showTile(id: LineId | null): void {
    const img = this.tileImg;
    const t = this.L?.tile;
    if (!img || !t || !this.scene) return;
    const slot = id ? slotOf(LINES[id].speaker) : null;
    let key: string | null = null;
    if (slot === 'TRIAGE') key = `call:triage:${moodOf(triageMood(id!))}`;
    else if (slot === 'HOUSE') key = this.chips[this.houseShown]?.texture ?? null;
    else if (slot) key = avatarSource(COMMS_AVATARS[slot]).texture;
    if (!key || !this.scene.textures.exists(key)) {
      img.setVisible(false);
      return;
    }
    img.setTexture(key);
    const src = this.frameSize(this.scene, key);
    const k = src.w > 0 && src.h > 0 ? Math.min((t.w - 12) / src.w, (t.h - 8) / src.h, 1) : 1;
    img
      .setScale(k)
      .setPosition(t.x + t.w / 2, t.y + t.h - 4)
      .setVisible(true);
  }

  /** Redraw the nameplate, tag pill and speaker ring for a line (or clear them). Once per line. */
  private drawLine(id: LineId | null): void {
    const L = this.L!;
    this.shownTyped = -1;
    this.ring!.clear();
    this.pill!.clear();
    const was = this.speakingSlot;
    this.speakingSlot = -1;
    this.lineAt = this.real;
    if (!id) {
      this.nameText!.setText('');
      this.tagText!.setText('');
      this.lineText!.setText('');
      this.showTile(null);
      return;
    }
    const l = LINES[id];
    const t = tag(id);
    const colour = TAG_COLOR[t] ?? COLORS.cyan;
    this.nameText!.setText(nameOf(id));
    const px = L.name.x + this.nameText!.width + 14;
    this.tagText!.setText(t);
    this.tagText!.setPosition(px + 9, L.tag.y + L.tag.h / 2);
    this.pill!.fillStyle(colour, 0.25);
    this.pill!.fillRoundedRect(px, L.tag.y, this.tagText!.width + 18, L.tag.h, 6);
    this.pill!.lineStyle(1, colour, 0.9);
    this.pill!.strokeRoundedRect(px, L.tag.y, this.tagText!.width + 18, L.tag.h, 6);
    this.lineText!.setText('');

    const slot = slotOf(l.speaker);
    if (slot) {
      const i = COMMS_SLOTS.indexOf(slot);
      const s = L.slots[i];
      this.speakingSlot = i;
      if (i !== was) this.tickAt = this.real;
      if (slot === 'HOUSE') this.showHouse(houseChip(l.speaker) === COMMS_AVATARS.HOUSE[1] ? 1 : 0);
      this.ring!.lineStyle(3, t === 'WARNING' ? COLORS.red : COLORS.hero, 1);
      this.ring!.strokeCircle(s.x, s.y, s.r);
    }
    this.showTile(id);
  }

  /** HOUSE's chip: 0 the door, 1 the TV; its picked art, or a code glyph until that lands. */
  private showHouse(which: 0 | 1): void {
    const i = COMMS_SLOTS.indexOf('HOUSE');
    const s = this.L!.slots[i];
    const face = this.faces[i];
    const g = this.houseGlyph!;
    g.clear();
    this.houseShown = which;
    const chip = this.chips[which];
    if (chip?.texture) {
      // The picked chip fitted in its 64 px box at its own aspect, inside the slot's disc.
      const size = this.chipSize[which] ?? { w: CHIP_SIZE, h: CHIP_SIZE };
      face.setTexture(chip.texture).setDisplaySize(size.w, size.h).setVisible(this.L!.roster);
      face.setTint(0xffffff).setAlpha(1);
      this.faceScale[i] = face.scaleX;
      return;
    }
    face.setVisible(false);
    g.lineStyle(2, COLORS.cyan, 0.7);
    if (which === 0) {
      // A door: a tall frame with a knob.
      g.strokeRect(s.x - 13, s.y - 21, 26, 42);
      g.fillStyle(COLORS.cyan, 0.7);
      g.fillCircle(s.x + 7, s.y + 2, 2.5);
    } else {
      // A TV: a screen on a stand.
      g.strokeRoundedRect(s.x - 22, s.y - 17, 44, 30, 4);
      g.lineBetween(s.x - 8, s.y + 21, s.x + 8, s.y + 21);
      g.lineBetween(s.x, s.y + 13, s.x, s.y + 21);
    }
  }

  /**
   * The crew are in (run().rescued) or out: their names show, and their faces light from the dark
   * silhouette over 400 ms (updateMotion); out again (a rewind) they go dark at once.
   */
  private setPresent(present: boolean): void {
    const first = this.shownPresent === null;
    this.shownPresent = present;
    this.crewSince = present ? (first ? -Infinity : this.real) : null;
    this.shownLight = -1;
    const L = this.L!;
    for (let i = 0; i < L.slots.length; i++) {
      const name = L.slots[i].name;
      if (name === 'TRIAGE' || name === 'HOUSE') continue;
      this.labels[i].setText(present ? name : DARK_NAME);
      if (!present) {
        const dark = crewTint(0);
        this.faces[i].setTint(dark.tint).setAlpha(this.faceAlpha[i] * dark.alpha);
      }
    }
  }

  // ---- the hook ----

  /** hud.comms, built only when the hook is read. */
  snapshot(): CommsTestState {
    const canvas = this.scene?.game.canvas.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    };
    const r = this.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    const L = this.L ?? commsLayout(r);
    const c = this.state.current;
    const cps = TEXT_CPS[settings().textSpeed];
    const scale = canvas.width / 1920;
    const speaking = c ? slotOf(LINES[c.id].speaker) : null;
    const houseArt = this.chips[this.houseShown]?.texture != null;
    const present = this.shownPresent === true;
    const b = this.root?.getBounds();
    const typed = c ? typedOf(c, this.clock, cps) : 0;
    return {
      line: c
        ? {
            id: c.id,
            speaker: LINES[c.id].speaker,
            name: nameOf(c.id),
            tag: tag(c.id),
            text: LINES[c.id].text,
            typed,
            typingDone: typed >= LINES[c.id].text.length,
            since: c.since,
            until: c.until,
            voiced: c.voiced,
          }
        : null,
      slots: L.slots.map((s) => {
        const p = pagePoint(s, canvas);
        return {
          name: s.name,
          x: p.x,
          y: p.y,
          r: Math.round(s.r * scale * 10) / 10,
          present: s.name === 'TRIAGE' || s.name === 'HOUSE' || present,
          speaking: speaking === s.name,
        };
      }),
      queue: this.state.queue.map((q) => q.id),
      history: [...this.state.history],
      dropped: [...this.state.dropped],
      log: {
        open: this.shownLogOpen,
        pinned: this.log.pinned,
        lines: this.shownLogOpen
          ? this.logIds.map((id) => ({ id, name: nameOf(id), text: LINES[id].text }))
          : logLines(this.state.history, this.state.current, LOG_ROWS).map((id) => ({
              id,
              name: nameOf(id),
              text: LINES[id].text,
            })),
        band: pagePoint({ x: L.text.x + 200, y: r.y + r.h / 2 }, canvas),
        outside: pagePoint({ x: L.text.x + 200, y: r.y - 60 }, canvas),
        replay: pagePoint({ x: L.replay.x + L.replay.w / 2, y: L.replay.y + L.replay.h / 2 }, canvas),
        replayed: [...this.replayed],
      },
      leader: this.leaderNow(canvas),
      located: Object.fromEntries(
        registeredNames().map((name) => {
          const p = locate(name);
          return [name, p ? pagePoint(p, canvas) : null];
        }),
      ),
      triage: c && triageMood(c.id) ? { mood: triageMood(c.id)! } : null,
      iris: { ...this.irisNow(), mood: this.mood(), motion: this.reduced() ? 'reduced' : 'full' },
      glow: this.glowNow(),
      crew: { light: crewLight(this.crewSince, this.real) },
      art: {
        plate: {
          use: this.plateUse?.use ?? 'code',
          texture: this.plateUse?.texture ?? null,
          source: this.plateSource ? { ...this.plateSource } : null,
          size: { w: this.plateRect?.w ?? r.w, h: this.plateRect?.h ?? r.h },
          drawn: pageRect(this.plateRect ?? r, canvas),
        },
        faces: this.faceArt.filter((f) => f.slot !== 'HOUSE').map((f) => ({ ...f })),
        house: {
          shown: this.houseShown === 0 ? 'door' : 'tv',
          chips: this.chips.map((c) => ({ key: c.key, use: c.use })),
          // The chip the band would draw: since the caller column hides the roster (30 Oct 2026) the
          // picked art can be chosen yet not on screen, so this reads the choice, not the visibility.
          drawn: this.chips[this.houseShown]?.texture ? 'art' : 'glyph',
          source: houseArt ? (this.chipSource[this.houseShown] ?? null) : null,
          size: houseArt ? (this.chipSize[this.houseShown] ?? null) : null,
        },
        lens: { ...this.lens },
      },
      alpha: bandAlpha(this.state, this.clock),
      call: { alpha: this.callA, last: this.lastCaller },
      rect: pageRect(r, canvas),
      drawn: b ? pageRect({ x: b.x, y: b.y, w: b.width, h: b.height }, canvas) : pageRect(r, canvas),
      emitted: [...this.emitted],
    };
  }

  /** The leader in page CSS pixels, or null while the line points at nothing on screen. */
  private leaderNow(canvas: Parameters<typeof pagePoint>[1]): CommsLeaderState | null {
    const t = this.leader;
    const pts = this.leaderPts;
    if (!t || !pts) return null;
    return {
      subject: t.subject,
      target: t.target,
      from: pagePoint(pts[0], canvas),
      corner: pagePoint(pts[1], canvas),
      to: pagePoint(pts[2], canvas),
    };
  }
}
