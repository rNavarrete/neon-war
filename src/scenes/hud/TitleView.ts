// The title cluster (ZONES.title) and the clock (ZONES.clock) as Live screen views. The title shows
// Lux_Net's face (a square faces-board/deadpan crop behind an amber ring until art3d's roundAvatar
// lands), the LIVE dot (live, waiting for your build, held), WATCHING with the count the chat lane
// last announced on the bus (no number before the first), and the trust and credits chips. The clock
// shows the in-world time and "midnight in m:ss", and draws nothing right of x 1800, where the pause
// button is OverlayScene's. The rules are pure in title.ts; this file only draws them.
//
// Phaser is a type here only (the scene's factories make every object), so the registry and its
// node tests can import this file.

import type Phaser from 'phaser';
import type { Frame } from '../../game/frame';
import { settings } from '../../game/settings';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import { countdownText } from './format';
import { COLORS, FONT } from './layout';
import { GAUGES_DEPTH, provideHudPart } from './panel';
import {
  type LiveDot,
  LIVE_WORDS,
  clockLayout,
  countdownRed,
  creditsRed,
  liveDotAlpha,
  liveState,
  shownCredits,
  shownTrust,
  titleLayout,
  trustRed,
  watchingFrom,
  watchingText,
} from './title';

/** What the hook mirrors as hud.title. */
export interface TitleTestState {
  live: LiveDot;
  /** The last bus audience value, null before the first. */
  watching: number | null;
  /** The right-most game x anything of the title view is drawn at. */
  right: number;
  /** The right-most game x anything of the clock view is drawn at; null while it is not built. */
  clockRight: number | null;
}

declare module './hook' {
  interface HudTestState {
    /** The title cluster (gauges-1). */
    title?: TitleTestState;
  }
}

/** Lux's face until art3d-4's round avatar lands, and the square of it the title shows. */
export const TITLE_FACE = {
  key: 'portrait:lux/faces-board/deadpan',
  file: 'art/chars/lux/faces-board/deadpan.webp',
  crop: { x: 120, y: 20, size: 250 },
} as const;

const ICON_KEYS = { trust: 'hud:icon-trust', credits: 'hud:icon-credits', clock: 'hud:icon-clock' } as const;
const ICON_FILES = {
  trust: 'art/hud/icons/trust.webp',
  credits: 'art/hud/icons/credits.webp',
  clock: 'art/hud/icons/clock.webp',
} as const;

function loadOnce(scene: Phaser.Scene, key: string, file: string): void {
  if (!scene.textures.exists(key)) scene.load.image(key, file);
}

const DOT_COLOR: Readonly<Record<LiveDot, number>> = {
  live: COLORS.magenta,
  waiting: COLORS.hero,
  held: COLORS.unlit,
};

const WORD_COLOR: Readonly<Record<LiveDot, string>> = {
  live: COLORS.magentaText,
  waiting: COLORS.heroText,
  held: COLORS.dim,
};

/** The right edge of a set of drawn objects, in game x (test-only; allocates). */
function rightOf(objects: readonly (Phaser.GameObjects.GameObject | null)[]): number {
  let right = 0;
  for (const o of objects) {
    const b = (o as unknown as { getBounds?: () => { right: number } } | null)?.getBounds?.();
    if (b && b.right > right) right = b.right;
  }
  return right;
}

/** The clock views on the screen now, so the title's hook entry can report their right edge. */
const liveClocks = new Set<ClockView>();

/** The right-most game x any clock view draws at, or null with none on screen (test-only). */
function clockRight(): number | null {
  let right: number | null = null;
  for (const c of liveClocks) right = Math.max(right ?? 0, c.right());
  return right;
}

export class TitleView implements LiveView {
  readonly zone = 'title' as const;
  readonly budget: LiveBudget = { objects: 11, texts: 5 };
  private objects: Phaser.GameObjects.GameObject[] = [];
  private dot: Phaser.GameObjects.Arc | null = null;
  private liveWord: Phaser.GameObjects.Text | null = null;
  private watchingWord: Phaser.GameObjects.Text | null = null;
  private trustText: Phaser.GameObjects.Text | null = null;
  private creditsText: Phaser.GameObjects.Text | null = null;
  private host: LiveHost | null = null;
  private off: (() => void)[] = [];

  /** The last bus audience value, null before the first. */
  watching: number | null = null;
  live: LiveDot = 'held';
  private shownWatching: number | null = -1;
  private shownLive: LiveDot | null = null;
  private shownTrust = NaN;
  private shownCredits = NaN;

  preload(scene: Phaser.Scene): void {
    loadOnce(scene, TITLE_FACE.key, TITLE_FACE.file);
    loadOnce(scene, ICON_KEYS.trust, ICON_FILES.trust);
    loadOnce(scene, ICON_KEYS.credits, ICON_FILES.credits);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.host = host;
    const L = titleLayout(host.rect);
    const add = scene.add;

    const plate = add.graphics();
    plate.fillStyle(COLORS.ink, 0.96);
    plate.fillRect(L.plate.x, L.plate.y, L.plate.w, L.plate.h);
    plate.fillStyle(COLORS.ink, 1);
    plate.fillCircle(L.avatar.x, L.avatar.y, L.avatar.r);
    for (const c of [L.trust, L.credits]) {
      plate.fillStyle(0x0b1224, 0.9);
      plate.fillRoundedRect(c.x, c.y, c.w, c.h, 8);
      plate.lineStyle(1, COLORS.cyan, 0.45);
      plate.strokeRoundedRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1, 8);
    }

    // A square crop of the face, inside the ring (art3d-4's roundAvatar replaces it).
    const face = add.image(L.avatar.x, L.avatar.y, TITLE_FACE.key);
    const cr = TITLE_FACE.crop;
    face.setCrop(cr.x, cr.y, cr.size, cr.size);
    face.setOrigin((cr.x + cr.size / 2) / face.width, (cr.y + cr.size / 2) / face.height);
    face.setScale((L.avatar.r * 1.4) / cr.size);

    const ring = add.graphics();
    ring.lineStyle(3, COLORS.hero, 1);
    ring.strokeCircle(L.avatar.x, L.avatar.y, L.avatar.r);

    const name = add.text(L.name.x, L.name.y, 'Lux_Net', {
      fontFamily: FONT,
      fontSize: '24px',
      color: COLORS.white,
    });
    this.dot = add.circle(L.dot.x, L.dot.y, L.dot.r, DOT_COLOR.held, 1);
    this.liveWord = add
      .text(L.liveWord.x, L.liveWord.y, '', { fontFamily: FONT, fontSize: '15px', color: COLORS.dim })
      .setOrigin(0, 0.5);
    this.watchingWord = add
      .text(L.watching.x, L.watching.y, watchingText(null), {
        fontFamily: FONT,
        fontSize: '15px',
        color: COLORS.dim,
      })
      .setOrigin(0, 0.5);

    const chip = (c: typeof L.trust, key: string): [Phaser.GameObjects.Image, Phaser.GameObjects.Text] => {
      const icon = add.image(c.x + 18, c.y + c.h / 2, key);
      icon.setScale((c.h - 10) / Math.max(icon.width, icon.height));
      const text = add
        .text(c.x + 36, c.y + c.h / 2, '', { fontFamily: FONT, fontSize: '22px', color: COLORS.white })
        .setOrigin(0, 0.5);
      return [icon, text];
    };
    const [trustIcon, trustText] = chip(L.trust, ICON_KEYS.trust);
    const [creditsIcon, creditsText] = chip(L.credits, ICON_KEYS.credits);
    this.trustText = trustText;
    this.creditsText = creditsText;

    this.objects = [
      plate,
      face,
      ring,
      name,
      this.dot,
      this.liveWord,
      this.watchingWord,
      trustIcon,
      trustText,
      creditsIcon,
      creditsText,
    ];
    for (const o of this.objects) (o as unknown as { setDepth(d: number): void }).setDepth(GAUGES_DEPTH);

    this.watching = null;
    this.shownWatching = -1;
    this.shownLive = null;
    this.shownTrust = NaN;
    this.shownCredits = NaN;
    this.off.push(
      host.bus.on('audience', (e) => {
        this.watching = watchingFrom(e);
      }),
    );
    this.off.push(provideHudPart(scene, 'title', () => this.snapshot()));
  }

  update(frame: Frame, clock: LiveClock): void {
    if (!this.dot) return;
    const live = liveState(frame);
    this.live = live;
    if (live !== this.shownLive) {
      this.shownLive = live;
      this.dot.setFillStyle(DOT_COLOR[live], 1);
      this.liveWord?.setText(LIVE_WORDS[live]).setColor(WORD_COLOR[live]);
    }
    const steady = settings().reduceFlicker || (this.host?.flags.lite ?? false);
    this.dot.setAlpha(liveDotAlpha(live, clock.now, steady));

    if (this.watching !== this.shownWatching) {
      this.shownWatching = this.watching;
      this.watchingWord?.setText(watchingText(this.watching));
      this.watchingWord?.setColor(this.watching === null ? COLORS.dim : COLORS.white);
    }

    const trust = shownTrust(frame.trust);
    if (trust !== this.shownTrust) {
      this.shownTrust = trust;
      this.trustText?.setText(String(trust)).setColor(trustRed(trust) ? COLORS.redText : COLORS.white);
    }
    const credits = shownCredits(frame.credits);
    if (credits !== this.shownCredits) {
      this.shownCredits = credits;
      this.creditsText
        ?.setText(String(credits))
        .setColor(creditsRed(credits) ? COLORS.redText : COLORS.white);
    }
  }

  /** hud.title, built only when the hook is read. */
  snapshot(): TitleTestState {
    return {
      live: this.live,
      watching: this.watching,
      right: rightOf(this.objects),
      clockRight: clockRight(),
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.dot = null;
    this.liveWord = null;
    this.watchingWord = null;
    this.trustText = null;
    this.creditsText = null;
    this.host = null;
  }
}

export class ClockView implements LiveView {
  readonly zone = 'clock' as const;
  readonly budget: LiveBudget = { objects: 4, texts: 2 };
  private objects: Phaser.GameObjects.GameObject[] = [];
  private clockText: Phaser.GameObjects.Text | null = null;
  private countdown: Phaser.GameObjects.Text | null = null;
  private shownSecond = -1;
  private shownRed: boolean | null = null;

  preload(scene: Phaser.Scene): void {
    loadOnce(scene, ICON_KEYS.clock, ICON_FILES.clock);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    const L = clockLayout(host.rect);
    const add = scene.add;
    const plate = add.graphics();
    plate.fillStyle(COLORS.ink, 0.96);
    plate.fillRect(L.plate.x, L.plate.y, L.plate.w, L.plate.h);
    this.clockText = add.text(L.clock.x, L.clock.y, '', {
      fontFamily: FONT,
      fontSize: '40px',
      color: COLORS.cyanText,
    });
    this.countdown = add.text(L.countdown.x, L.countdown.y, '', {
      fontFamily: FONT,
      fontSize: '20px',
      color: COLORS.heroText,
    });
    const icon = add.image(L.icon.x, L.icon.y, ICON_KEYS.clock);
    icon.setScale(L.icon.size / Math.max(icon.width, icon.height));
    icon.setAlpha(0.85);
    this.objects = [plate, this.clockText, this.countdown, icon];
    for (const o of this.objects) (o as unknown as { setDepth(d: number): void }).setDepth(GAUGES_DEPTH);
    this.shownSecond = -1;
    this.shownRed = null;
    liveClocks.add(this);
  }

  update(frame: Frame): void {
    if (!this.clockText || !this.countdown) return;
    const second = Math.floor(frame.now);
    if (second !== this.shownSecond) {
      this.shownSecond = second;
      this.clockText.setText(frame.clock);
      this.countdown.setText(`midnight in ${countdownText(frame.now)}`);
    }
    const red = countdownRed(frame.now);
    if (red !== this.shownRed) {
      this.shownRed = red;
      this.countdown.setColor(red ? COLORS.redText : COLORS.heroText);
    }
  }

  /** The right-most game x the clock view draws at (test-only; allocates). */
  right(): number {
    return rightOf(this.objects);
  }

  shutdown(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.clockText = null;
    this.countdown = null;
    liveClocks.delete(this);
  }
}
