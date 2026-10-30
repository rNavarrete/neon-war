// The stream chat in the story scenes' top-right corner, drawn the way live-stream chats are (Twitch,
// YouTube Live, Needy Streamer Overload) and the way the board's LIVE CHAT already looks: a header
// with a red LIVE dot and the honest tiny audience, then one row per message, newest at the bottom,
// each with the sender's round avatar and a coloured name (block residents amber, stream viewers
// cyan) over off-white words. Older rows fade; a new row slides up into place. Rows are pooled and
// redrawn only when a message lands.
//
// Messages roll in live (Rolando, 30 Oct 2026: "we have to make sure that we see comments roll in,
// in real time"): the script's chat lines queue and land one at a time, 0.8 to 2 s apart, without
// holding the dialogue; and while the scene is up the block and the viewers keep talking, a filler
// line every 3 to 6 s from the scene's pool (the net flickering in the cold open, gone in the rescue).

import Phaser from 'phaser';
import {
  type AvatarScene,
  BLOCK_AVATARS,
  STREAM_AVATARS,
  preloadAvatars,
  roundAvatar,
} from '../scenes/avatars';
import { streamAvatarFor } from '../scenes/hud/ChatFeedView';
import { handleFor, seededRandom } from '../scenes/hud/chat';
import { LINES, type LineId } from '../strings';
import { COLORS } from '../scenes/hud/layout';

/**
 * The panel, game pixels: clear of Lux's slot on the left third and of the window, and well above the
 * text box (Rolando, 30 Oct 2026: "extend it a bit more vertically"). Too tall for the wide plate's
 * nine-slice without stretching its glass, so the glass is drawn in code in the plate's colours.
 */
export const CHAT_RECT = { x: 1480, y: 24, w: 416, h: 540 } as const;
const PAD = 18;
const HEADER_H = 46;
const AVATAR = 34;
const ROWS = 10;
const ROW_GAP = 10;
const NAME_H = 20;
const TEXT_X = PAD + AVATAR + 12;
const TEXT_W = CHAT_RECT.w - TEXT_X - PAD;
/** Rows older than the newest few sit back. */
const FRESH = 4;
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

/** Seconds between the script's queued chat lines landing: min and spread. */
export const ARRIVAL = { min: 0.8, spread: 1.2 } as const;
/** Seconds between filler lines while the scene is up: min and spread. */
export const FILLER = { min: 3, spread: 3 } as const;

/** Every line id with this prefix, in script order. Pure. */
const pool = (prefix: string): LineId[] =>
  (Object.keys(LINES) as LineId[]).filter((id) => id.startsWith(prefix));

/**
 * The filler a scene's chat keeps up between script lines: the block grumbling and the viewers
 * noticing lag while the net flickers (the cold open), or both panicking with it down (the rescue).
 */
export function fillerFor(scriptId: string): LineId[] {
  return scriptId === 'C5'
    ? [...pool('fill.block.down.'), ...pool('fill.stream.down.')]
    : [...pool('fill.block.slow.'), ...pool('fill.stream.slow.')];
}

/**
 * A filler line as a chat message: block filler carries its resident ("mrs okafor: Lift's stuck
 * again."); stream filler is posted under the viewer handle the board's chat gives that line. Pure.
 */
export function fillerMessage(id: LineId): StoryChatMessage {
  const { speaker, text } = LINES[id];
  if (speaker === 'stream') return { who: handleFor(id), source: 'stream', text };
  const m = /^([^:]+):\s*(.*)$/.exec(text);
  return m ? { who: m[1]!, source: 'block', text: m[2]! } : { who: 'block', source: 'block', text };
}

/** Queue the avatars the rows draw. */
export function preloadChat(scene: Phaser.Scene): void {
  preloadAvatars(scene as unknown as AvatarScene, [...Object.values(BLOCK_AVATARS), ...STREAM_AVATARS]);
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
  private readonly queue: StoryChatMessage[] = [];
  private readonly rand = seededRandom(20261030);
  private arriveIn = 0;
  private fillIn = 0;
  private fillNext = 0;
  private live = false;
  /** Every message drawn so far, in order ("who: text"), for the test hook. */
  readonly posted: string[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly filler: readonly LineId[],
    title: string,
    watching: number,
    depth: number,
  ) {
    const r = CHAT_RECT;
    const add = scene.add;
    const objects: Phaser.GameObjects.GameObject[] = [];
    // Dark live-stream glass with a thin rim and a lighter header band (no painted plate: see CHAT_RECT).
    const glass = add.graphics();
    glass.fillStyle(COLORS.ink, 0.78).fillRoundedRect(0, 0, r.w, r.h, 10);
    glass.fillStyle(0x1a2238, 0.9).fillRoundedRect(4, 4, r.w - 8, HEADER_H, { tl: 8, tr: 8, bl: 0, br: 0 });
    glass.lineStyle(1, COLORS.magenta, 0.35).lineBetween(PAD, HEADER_H + 4, r.w - PAD, HEADER_H + 4);
    glass.lineStyle(2, COLORS.cyan, 0.55).strokeRoundedRect(0, 0, r.w, r.h, 10);
    objects.push(glass);

    const headY = 4 + HEADER_H / 2;
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

  /** Queue a script line: it lands after the ones already waiting, one at a time. */
  post(msg: StoryChatMessage): void {
    if (this.queue.length === 0 && this.arriveIn <= 0) this.arriveIn = 0.15;
    this.queue.push(msg);
  }

  /**
   * Called each frame with real seconds: blinks the LIVE dot, lands the next queued line when its
   * gap is up, and once the chat has started keeps the filler coming between script lines.
   */
  update(dt: number): void {
    this.blink = (this.blink + dt) % 1.6;
    this.dot.setAlpha(this.blink < 1.1 ? 1 : 0.25);
    if (this.queue.length > 0) {
      this.arriveIn -= dt;
      if (this.arriveIn <= 0) {
        this.land(this.queue.shift()!);
        this.arriveIn = ARRIVAL.min + this.rand() * ARRIVAL.spread;
        this.live = true;
        this.fillIn = FILLER.min + this.rand() * FILLER.spread;
      }
      return;
    }
    if (!this.live || this.filler.length === 0) return;
    this.fillIn -= dt;
    if (this.fillIn <= 0) {
      this.land(fillerMessage(this.filler[this.fillNext % this.filler.length]!));
      this.fillNext++;
      this.fillIn = FILLER.min + this.rand() * FILLER.spread;
    }
  }

  /** Draw a message now: it slides in at the bottom and the rows above it move up. */
  private land(msg: StoryChatMessage): void {
    this.shown.push(msg);
    if (this.shown.length > ROWS) this.shown.shift();
    this.posted.push(`${msg.who}: ${msg.text}`);
    this.blink = 0;
    this.layout();
  }

  private layout(): void {
    const scene = this.scene as unknown as AvatarScene;
    const bottom = CHAT_RECT.h - PAD - 6;
    const top = HEADER_H + 14;
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
