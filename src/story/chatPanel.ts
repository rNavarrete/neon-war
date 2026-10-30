// The stream chat in the story scenes' top-right corner, drawn the way live-stream chats are (Twitch,
// YouTube Live, Needy Streamer Overload) and the way the board's LIVE CHAT already looks: a header
// with a red LIVE dot and the honest tiny audience, then one row per message, newest at the bottom,
// each with the sender's round avatar and a coloured name (block residents amber, stream viewers
// cyan) over off-white words. Older rows fade; a new row slides up into place. Rows are pooled and
// redrawn only when a message lands.

import Phaser from 'phaser';
import {
  type AvatarScene,
  BLOCK_AVATARS,
  STREAM_AVATARS,
  preloadAvatars,
  roundAvatar,
} from '../scenes/avatars';
import { CHAT_PLATE_K, CHAT_PLATE_SLICE, CHAT_PLATE_WIDE, streamAvatarFor } from '../scenes/hud/ChatFeedView';
import { COLORS } from '../scenes/hud/layout';
import { panel } from '../scenes/hud/panel';
import { artTexture } from '../scenes/plates';
import { requestFile } from '../game/artManifest';

/**
 * The panel, game pixels: clear of Lux's slot on the left third and of the window. At most 354 px
 * tall so the wide plate's nine-slice never stretches its glass above the file's own size.
 */
export const CHAT_RECT = { x: 1480, y: 24, w: 416, h: 350 } as const;
const PAD = 18;
const HEADER_H = 46;
const AVATAR = 34;
const ROWS = 6;
const ROW_GAP = 10;
const NAME_H = 20;
const TEXT_X = PAD + AVATAR + 12;
const TEXT_W = CHAT_RECT.w - TEXT_X - PAD;
/** Rows older than the newest few sit back. */
const FRESH = 3;
const OLD_ALPHA = 0.55;
const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

/** One message as the story posts it: who sent it, from where, and what it says. */
export interface StoryChatMessage {
  readonly who: string;
  readonly source: 'block' | 'stream';
  readonly text: string;
}

/** "kenji: lux pls" from the script's speaker ("block: kenji" or "stream: rainproxy") and its words. Pure. */
export function chatMessage(speaker: string, text: string): StoryChatMessage {
  const m = /^(block|stream):\s*(.*)$/.exec(speaker);
  return { who: m ? m[2]! : speaker, source: m?.[1] === 'stream' ? 'stream' : 'block', text };
}

/** The avatar key a sender's row shows: a resident's painted face, else a viewer's disc. Pure. */
export function avatarFor(msg: StoryChatMessage): string {
  return BLOCK_AVATARS[msg.who.toLowerCase()] ?? streamAvatarFor(msg.who);
}

/** Queue the plate and the avatars the rows draw. */
export function preloadChat(scene: Phaser.Scene): void {
  preloadAvatars(scene as unknown as AvatarScene, [...Object.values(BLOCK_AVATARS), ...STREAM_AVATARS]);
  if (!scene.textures.exists(artTexture(CHAT_PLATE_WIDE)))
    scene.load.image(artTexture(CHAT_PLATE_WIDE), requestFile(CHAT_PLATE_WIDE));
}

interface Slot {
  avatar: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  text: Phaser.GameObjects.Text;
}

export class StoryChat {
  private readonly slots: Slot[] = [];
  private readonly shown: StoryChatMessage[] = [];
  private readonly root: Phaser.GameObjects.Container;
  private readonly dot: Phaser.GameObjects.Arc;
  private blink = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    title: string,
    watching: number,
    depth: number,
  ) {
    const r = CHAT_RECT;
    const add = scene.add;
    const objects: Phaser.GameObjects.GameObject[] = [];
    if (scene.textures.exists(artTexture(CHAT_PLATE_WIDE)))
      objects.push(
        panel(scene, artTexture(CHAT_PLATE_WIDE), 0, 0, r.w, r.h, {
          k: CHAT_PLATE_K,
          slice: [...CHAT_PLATE_SLICE],
        }),
      );
    else
      objects.push(
        add.rectangle(0, 0, r.w, r.h, COLORS.ink, 0.8).setOrigin(0).setStrokeStyle(2, COLORS.amber),
      );

    const headY = 14 + HEADER_H / 2 - 6;
    this.dot = add.circle(PAD + 6, headY, 6, COLORS.red);
    const live = add
      .text(PAD + 18, headY, 'LIVE', {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: COLORS.redText,
      })
      .setOrigin(0, 0.5);
    const head = add
      .text(PAD + 66, headY, title, { fontFamily: FONT, fontSize: '16px', color: COLORS.magentaText })
      .setOrigin(0, 0.5);
    head.setLetterSpacing(2);
    const eye = add
      .text(r.w - PAD, headY, `${watching} watching`, {
        fontFamily: FONT,
        fontSize: '14px',
        color: COLORS.dim,
      })
      .setOrigin(1, 0.5);
    objects.push(this.dot, live, head, eye);

    for (let i = 0; i < ROWS; i++) {
      const avatar = add.image(0, 0, '__WHITE').setVisible(false);
      const name = add.text(0, 0, '', {
        fontFamily: FONT,
        fontSize: '15px',
        fontStyle: 'bold',
        color: COLORS.amberText,
      });
      const text = add.text(0, 0, '', {
        fontFamily: FONT,
        fontSize: '16px',
        color: COLORS.white,
        wordWrap: { width: TEXT_W },
        lineSpacing: 2,
      });
      objects.push(avatar, name, text);
      this.slots.push({ avatar, name, text });
    }
    this.root = add.container(r.x, r.y, objects).setDepth(depth);
  }

  /** Post a message: it slides in at the bottom and the rows above it move up. */
  post(msg: StoryChatMessage): void {
    this.shown.push(msg);
    if (this.shown.length > ROWS) this.shown.shift();
    this.layout();
  }

  /** Blink the LIVE dot (called each frame with real seconds; no allocation). */
  update(dt: number): void {
    this.blink = (this.blink + dt) % 1.6;
    this.dot.setAlpha(this.blink < 1.1 ? 1 : 0.25);
  }

  private layout(): void {
    const scene = this.scene as unknown as AvatarScene;
    const bottom = CHAT_RECT.h - PAD - 6;
    const top = 14 + HEADER_H;
    let y = bottom;
    // Newest first, stacked upward until the body is full.
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const msg = this.shown[this.shown.length - 1 - i];
      if (!msg) {
        s.avatar.setVisible(false);
        s.name.setVisible(false);
        s.text.setVisible(false);
        continue;
      }
      s.text.setText(msg.text);
      const h = Math.max(AVATAR, NAME_H + s.text.height);
      const rowTop = y - h;
      if (rowTop < top) {
        s.avatar.setVisible(false);
        s.name.setVisible(false);
        s.text.setVisible(false);
        continue;
      }
      const alpha = i < FRESH ? 1 : OLD_ALPHA;
      const av = roundAvatar(scene, avatarFor(msg), AVATAR);
      s.avatar
        .setTexture(av.texture)
        .setPosition(PAD + AVATAR / 2, rowTop + AVATAR / 2)
        .setVisible(true)
        .setAlpha(alpha);
      s.name
        .setText(msg.who)
        .setColor(msg.source === 'stream' ? COLORS.cyanText : COLORS.amberText)
        .setPosition(TEXT_X, rowTop)
        .setVisible(true)
        .setAlpha(alpha);
      s.text
        .setPosition(TEXT_X, rowTop + NAME_H)
        .setVisible(true)
        .setAlpha(alpha);
      if (i === 0) {
        // The new row slides up 14 px and fades in.
        for (const o of [s.avatar, s.name, s.text]) {
          this.scene.tweens.killTweensOf(o);
          const to = o.y;
          o.setY(to + 14).setAlpha(0);
          this.scene.tweens.add({ targets: o, y: to, alpha: 1, duration: 220, ease: 'Cubic.Out' });
        }
      }
      y = rowTop - ROW_GAP;
    }
  }
}
