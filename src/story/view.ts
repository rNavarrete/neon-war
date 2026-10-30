// The visual-novel layout the story scenes share: speaker portraits (others dimmed), a nameplate, a
// typewriter text box, Lux's stream chat in a corner and a Skip button. Phaser view code only: what
// plays when lives in the scenes and in src/story/scripts.ts.

import Phaser from 'phaser';
import { allPortraits, portraitFor, speakerName } from '../game/portraits';
import { TEXT_CPS, settings } from '../game/settings';
import { LINES, type LineId } from '../strings';
import { LABELS } from './labels';
import { StoryChat, chatMessage, preloadChat } from './chatPanel';
import { chatText, scriptFaces, typedChars } from './scripts';
import { HOVERING, TEXT_LINE, TEXT_POS, bobAt, frameFor, hoverFor, slotsBetween, slotsFor } from './stage';
import { type PagePoint, type ViewSnapshot, playVoice, storyState } from './state';

export const W = 1920;
export const H = 1080;

/** Story-layer texture keys and their files under public/. */
export const TEX = {
  textbox: ['story:textbox', 'art/hud/textbox.webp'],
  nameplate: ['story:nameplate', 'art/hud/nameplate.webp'],
  button: ['story:button', 'art/hud/button.webp'],
  buttonHover: ['story:button-hover', 'art/hud/button-hover.webp'],
} as const;

/** Texture key for a background or story file under public/. */
export const fileKey = (file: string): string => `story:${file}`;

/** The speaker steps forward a little; everyone else dims (src/story/stage.ts places them). */
const SPEAKER_SCALE = 1.03;
const DIM = 0x55556a;

const BODY_FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

export function preloadView(scene: Phaser.Scene, files: readonly string[]): void {
  for (const [key, file] of Object.values(TEX)) scene.load.image(key, file);
  for (const p of allPortraits()) scene.load.image(p.key, p.file);
  for (const f of scriptFaces()) scene.load.image(`portrait:${f}`, `art/chars/${f}.webp`);
  for (const f of files) scene.load.image(fileKey(f), f);
  preloadChat(scene);
}

/** Convert a game-space point to CSS pixels on the page, for the test hook. */
export function toPage(scene: Phaser.Scene, x: number, y: number): PagePoint {
  const rect = scene.game.canvas.getBoundingClientRect();
  return {
    x: Math.round(rect.left + (x * rect.width) / W),
    y: Math.round(rect.top + (y * rect.height) / H),
  };
}

/** Cover the screen with an image, cropping rather than leaving bars. */
export function cover(scene: Phaser.Scene, key: string): Phaser.GameObjects.Image {
  const img = scene.add.image(W / 2, H / 2, key);
  img.setScale(Math.max(W / img.width, H / img.height));
  return img;
}

/**
 * Real seconds between frames from Phaser's raw frame time. Phaser's smoothed delta is capped at
 * one 60 fps frame while the page is out of focus, which would stretch the rain, the room clock and
 * the rewind animation; they follow the wall clock instead (at most 0.25 s per frame).
 */
export class FrameClock {
  private last = -1;

  step(time: number): number {
    const dt = this.last < 0 ? 0 : Math.min(Math.max(0, time - this.last), 250) / 1000;
    this.last = time;
    return dt;
  }
}

export interface VnViewOptions {
  /** Lux's room faces or her goggles-down board faces. */
  where: 'room' | 'board';
  /** Show the stream chat panel in the top-right corner. */
  chat: boolean;
  /** The chat's filler between script lines (src/story/chatPanel.ts fillerFor); none by default. */
  filler?: readonly LineId[];
  /** Show the Skip button (the scene was seen before). */
  skippable: boolean;
  /** Stand the cast between these x only (game px), clear of the scene's own panels; the whole stage by default. */
  stage?: { readonly from: number; readonly to: number };
  onClick: () => void;
  onSkip: () => void;
}

export class VnView {
  private readonly portraits = new Map<string, Phaser.GameObjects.Image>();
  private readonly box: Phaser.GameObjects.Image;
  private readonly plate: Phaser.GameObjects.Image;
  private readonly plateText: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private readonly more: Phaser.GameObjects.Text;
  private readonly chatPanel: StoryChat | null = null;
  private readonly skipButton: Phaser.GameObjects.Image | null = null;
  private full = '';
  private shown = -1;
  private typingFor = 0;
  private speaking: string | null = null;
  private blink = 0;
  private bobT = 0;
  /** The flyers on stage and where they hover, refreshed by stage(). */
  private flyers: { img: Phaser.GameObjects.Image; baseY: number }[] = [];
  lineId: LineId | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: VnViewOptions,
  ) {
    const zone = scene.add.zone(0, 0, W, H).setOrigin(0).setInteractive();
    zone.on('pointerdown', () => {
      opts.onClick();
      storyState.clicks++;
    });

    this.box = scene.add
      .image(W / 2, 945, TEX.textbox[0])
      .setScale(1.3)
      .setDepth(20);
    this.plate = scene.add.image(560, 822, TEX.nameplate[0]).setScale(0.8).setDepth(21);
    this.plateText = scene.add
      .text(560, 822, '', { fontFamily: BODY_FONT, fontSize: '30px', fontStyle: 'bold', color: '#ffd27a' })
      .setOrigin(0.5)
      .setDepth(22);
    this.body = scene.add
      .text(TEXT_POS.x, TEXT_POS.y, '', {
        fontFamily: BODY_FONT,
        fontSize: `${TEXT_LINE.size}px`,
        color: '#f2ecff',
        wordWrap: { width: 1000 },
        lineSpacing: TEXT_LINE.gap,
      })
      .setDepth(22);
    this.more = scene.add
      .text(1490, 1020, '▼', { fontFamily: BODY_FONT, fontSize: '26px', color: '#2de2e6' })
      .setOrigin(0.5)
      .setDepth(22)
      .setVisible(false);

    // Lux's stream chat, top right (src/story/chatPanel.ts): the honest tiny audience, as on the board.
    if (opts.chat) this.chatPanel = new StoryChat(scene, opts.filler ?? [], LABELS.chat, 1, 20);

    if (opts.skippable) {
      const b = scene.add.image(1730, 960, TEX.button[0]).setScale(0.4).setDepth(30).setInteractive();
      scene.add
        .text(1730, 958, LABELS.skip, { fontFamily: BODY_FONT, fontSize: '30px', color: '#ffffff' })
        .setOrigin(0.5)
        .setDepth(31);
      b.on('pointerover', () => b.setTexture(TEX.buttonHover[0]));
      b.on('pointerout', () => b.setTexture(TEX.button[0]));
      b.on('pointerdown', () => opts.onSkip());
      this.skipButton = b;
    }
    // A scene that ends (or is skipped) never leaves its last voice talking.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => playVoice(null));
    this.hideBox();
  }

  /** Show a line in the text box with its speaker's portrait; other speakers dim. */
  say(id: LineId, face?: string): void {
    const { speaker, text } = LINES[id];
    const narration = speaker.startsWith('(');
    const name = narration ? null : speakerName(speaker);
    this.lineId = id;
    this.speaking = name;
    // The line's voice; asking for it cuts the one before (comms-6).
    playVoice(id);
    this.box.setVisible(true);
    this.plate.setVisible(name !== null);
    this.plateText.setVisible(name !== null).setText(name ?? '');
    this.body.setVisible(true).setFontStyle(narration ? 'italic' : '');

    const portrait = name ? (face ? `portrait:${face}` : portraitFor(speaker, this.opts.where)?.key) : null;
    if (name && portrait) {
      const img = this.portraits.get(name);
      if (!img) this.portraits.set(name, this.scene.add.image(0, 0, portrait).setOrigin(0.5, 1).setDepth(10));
      else img.setTexture(portrait);
    }
    this.stage();

    // Wrap once up front so words don't jump lines as they type in.
    this.body.setText('');
    this.full = this.body.getWrappedText(text).join('\n');
    this.typingFor = 0;
    this.shown = -1;
    this.update(0);
  }

  /**
   * Stands everyone on stage in the slots for that many people, in the order they came on, at their
   * art's frame (src/story/stage.ts). The speaker is a touch bigger and lit; the others dim.
   */
  private stage(): void {
    let standing = 0;
    for (const who of this.portraits.keys()) if (!HOVERING.has(who)) standing++;
    const zone = this.opts.stage;
    const xs = zone ? slotsBetween(standing, zone.from, zone.to) : slotsFor(standing);
    let i = 0;
    this.flyers = [];
    for (const [who, img] of this.portraits) {
      const f = HOVERING.has(who) ? hoverFor(xs) : frameFor(img.height, xs[i++]!, H);
      const speaking = who === this.speaking;
      img.setPosition(f.x, f.bottom).setScale(f.scale * (speaking ? SPEAKER_SCALE : 1));
      if (HOVERING.has(who)) this.flyers.push({ img, baseY: f.bottom });
      if (speaking) img.clearTint().setAlpha(1);
      else img.setTint(DIM).setAlpha(0.85);
    }
  }

  /** Post a chat line to the corner chat. */
  chat(id: LineId): void {
    const { speaker, text } = LINES[id];
    this.chatPanel?.post(chatMessage(speaker, text));
    storyState.chat = [...storyState.chat, chatText(id)];
  }

  get typingDone(): boolean {
    return this.shown >= this.full.length;
  }

  finishTyping(): void {
    this.typingFor = Number.POSITIVE_INFINITY;
    this.update(0);
  }

  hideBox(): void {
    playVoice(null);
    this.box.setVisible(false);
    this.plate.setVisible(false);
    this.plateText.setVisible(false);
    this.body.setVisible(false);
    this.more.setVisible(false);
  }

  /** Advance the typewriter by dt seconds of real time. */
  update(dt: number): void {
    this.typingFor += dt;
    const n = typedChars(this.typingFor, TEXT_CPS[settings().textSpeed], this.full.length);
    if (n !== this.shown) {
      this.shown = n;
      this.body.setText(this.full.slice(0, n));
    }
    this.blink = (this.blink + dt) % 1;
    this.chatPanel?.update(dt);
    // Flyers bob where they hover (no allocation: one sin per flyer per frame).
    this.bobT += dt;
    const bob = bobAt(this.bobT);
    for (let i = 0; i < this.flyers.length; i++) {
      const f = this.flyers[i]!;
      f.img.setY(f.baseY + bob);
    }
    this.more.setVisible(this.body.visible && this.typingDone && this.blink < 0.6);
  }

  snapshot(): ViewSnapshot {
    const speaking = this.speaking ? this.portraits.get(this.speaking) : undefined;
    const onStage = [...this.portraits.keys()];
    const b = this.skipButton;
    return {
      lineId: this.lineId,
      typed: Math.max(0, this.shown),
      chatShown: this.chatPanel ? [...this.chatPanel.posted] : [],
      typingDone: this.typingDone,
      nameplate: this.plateText.visible ? this.plateText.text : null,
      portrait: speaking ? speaking.texture.key : null,
      onStage,
      dimmed: onStage.filter((w) => !speaking || w !== this.speaking),
      figures: Object.fromEntries(
        [...this.portraits].map(([who, img]) => {
          const b = img.getBounds();
          return [who, { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top) }];
        }),
      ),
      click: toPage(this.scene, W / 2, 945),
      skip: b ? { visible: b.visible, ...toPage(this.scene, b.x, b.y) } : { visible: false, x: 0, y: 0 },
    };
  }
}
