// The title cluster (ZONES.title) and the clock (ZONES.clock) as Live screen views. The title shows
// Lux_Net's round avatar (roundAvatar, src/scenes/avatars.ts, behind an amber ring), the LIVE dot
// (live, waiting for your build, held), WATCHING with the count the chat lane last announced on the
// bus (no number before the first), and the trust and credits chips. The dot reads held while a story
// scene or the pause menu is up: those pause the HUD scene, so the view hears the scene's pause and
// resume events rather than waiting on an update that does not come. The clock
// shows the in-world time and "midnight in m:ss", and draws nothing right of x 1800, where the pause
// button is OverlayScene's. The rules are pure in title.ts; this file only draws them.
//
// Phaser is a type here only (the scene's factories make every object), so the registry and its
// node tests can import this file.

import type Phaser from 'phaser';
import type { Frame } from '../../game/frame';
import { settings } from '../../game/settings';
import { type AvatarScene, TITLE_AVATAR, preloadAvatars, roundAvatar } from '../avatars';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import { countdownText } from './format';
import { COLORS, FONT } from './layout';
import { provideHudSection } from './hook';
import { register as registerLocate } from './locate';
import { KIT, livePill } from './kit';
import {
  type BakedPanel,
  GAUGES_DEPTH,
  type PanelTestState,
  bakePanel,
  panelSnapshot,
  releasePanel,
} from './panel';
import { preloadArt, resolveArt } from '../plates';
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
  /** The round avatar's baked texture ('avatar:<key>@<size>'), null while not built. */
  avatar?: string | null;
  /** True while the HUD scene is paused under a story scene or the pause menu (the dot reads held). */
  scenePaused?: boolean;
  /** The LIVE pill (hud/live/live-pill) shows under the word: exactly while the dot reads live. */
  pill?: boolean;
  /** The baked plate: which picked kit pieces it draws, at what largest scale (m4 panel kit). */
  panel?: PanelTestState | null;
}

declare module './hook' {
  interface HudTestState {
    /** The title cluster (gauges-1). */
    title?: TitleTestState;
  }
}

/** The Phaser scene events the title listens to (Phaser.Scenes.Events.PAUSE and RESUME). */
const SCENE_PAUSE = 'pause';
const SCENE_RESUME = 'resume';

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

/** The LIVE word sits on the amber pill while live, so it is dark there. */
const ON_PILL = '#1a0f02';

const WORD_COLOR: Readonly<Record<LiveDot, string>> = {
  live: ON_PILL,
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

/** The right-most game x anything of the clock view is drawn at, by the pause button's rule. */
const CLOCK_MAX_RIGHT = 1796;

/** The title's bracket corners (kit.ts). */
const TITLE_CORNERS = 22;

/**
 * Shrinks a text so its right edge stays at or left of maxRight. Glyph widths depend on which
 * monospace font the machine has, so a word that fits here can overflow elsewhere; this keeps the
 * zone rule true on every machine. Runs only when the text changes (no per-frame cost).
 */
function fitRight(text: Phaser.GameObjects.Text, maxRight: number): void {
  text.setScale(1);
  const room = maxRight - text.x;
  if (text.width > room && text.width > 0) text.setScale(room / text.width);
}

export class TitleView implements LiveView {
  readonly zone = 'title' as const;
  readonly budget: LiveBudget = { objects: 11, texts: 5 };
  private objects: Phaser.GameObjects.GameObject[] = [];
  private dot: Phaser.GameObjects.Arc | null = null;
  private plate: BakedPanel | null = null;
  private pill: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics | null = null;
  private liveWord: Phaser.GameObjects.Text | null = null;
  private watchingWord: Phaser.GameObjects.Text | null = null;
  private trustText: Phaser.GameObjects.Text | null = null;
  private creditsText: Phaser.GameObjects.Text | null = null;
  private host: LiveHost | null = null;
  private off: (() => void)[] = [];
  /** Right limits for the texts: the zone's edge and each chip's inner edge. */
  private maxRight = 0;
  private trustRight = 0;
  private creditsRight = 0;

  /** The last bus audience value, null before the first. */
  watching: number | null = null;
  live: LiveDot = 'held';
  private shownWatching: number | null = -1;
  private shownLive: LiveDot | null = null;
  private shownTrust = NaN;
  private shownCredits = NaN;
  /** The HUD scene is paused (a story scene or the pause menu over the board). */
  private scenePaused = false;
  private avatarTexture: string | null = null;

  preload(scene: Phaser.Scene): void {
    preloadAvatars(scene as unknown as AvatarScene, [TITLE_AVATAR]);
    preloadArt(scene as never, [KIT.frame, KIT.corner, KIT.pill]);
    loadOnce(scene, ICON_KEYS.trust, ICON_FILES.trust);
    loadOnce(scene, ICON_KEYS.credits, ICON_FILES.credits);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.host = host;
    const L = titleLayout(host.rect);
    const add = scene.add;
    this.maxRight = host.rect.x + host.rect.w - 6;
    this.trustRight = L.trust.x + L.trust.w - 6;
    this.creditsRight = L.credits.x + L.credits.w - 6;

    // The plate, baked once with the frame kit: the fill, the avatar's backing and amber ring, the
    // chips' wells, the frame and the bracket corners.
    const plate = bakePanel(
      scene,
      'title',
      L.plate,
      { frame: true, corners: TITLE_CORNERS },
      {
        fill: { color: COLORS.ink, alpha: 0.96 },
        draw: (g) => {
          g.fillStyle(COLORS.ink, 1);
          g.fillCircle(L.avatar.x, L.avatar.y, L.avatar.r);
          // The ring sits just outside the face, so the face drawn over the plate leaves it whole.
          g.lineStyle(3, COLORS.hero, 1);
          g.strokeCircle(L.avatar.x, L.avatar.y, L.avatar.r + 1.5);
          for (const c of [L.trust, L.credits]) {
            g.fillStyle(0x0b1224, 0.9);
            g.fillRoundedRect(c.x, c.y, c.w, c.h, 8);
            g.lineStyle(1, COLORS.cyan, 0.45);
            g.strokeRoundedRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1, 8);
          }
        },
      },
    );
    this.plate = plate;

    // Lux_Net's round avatar, baked once at the size it is shown (the ring's diameter).
    const size = 2 * L.avatar.r;
    const a = roundAvatar(scene as unknown as AvatarScene, TITLE_AVATAR, size);
    this.avatarTexture = a.texture;
    const face = add.image(L.avatar.x, L.avatar.y, a.texture);
    face.setDisplaySize(size, size);
    face.setTint(a.tint);
    face.setAlpha(a.alpha);

    // The LIVE pill under the dot and the word, shown only while live.
    const P = livePill(L.dot.x - L.dot.r - 2, L.dot.y - 14);
    const pillArt = resolveArt(KIT.pill);
    // A scene that can hand out the file's frames draws the picked pill; a bare stub gets the code pill.
    const tx = scene.textures as Partial<Phaser.Textures.TextureManager> | undefined;
    if (!pillArt.fallback && typeof tx?.get === 'function' && tx.exists?.(pillArt.texture)) {
      this.pill = add.image(P.x, P.y, pillArt.texture).setOrigin(0, 0).setDisplaySize(P.w, P.h);
    } else {
      const g = add.graphics();
      g.fillStyle(COLORS.hero, 0.9);
      g.fillRoundedRect(P.x, P.y, P.w, P.h, P.h / 2);
      this.pill = g;
    }
    this.pill.setVisible(false);

    const name = add.text(L.name.x, L.name.y, 'Lux_Net', {
      fontFamily: FONT,
      fontSize: '24px',
      color: COLORS.white,
    });
    fitRight(name, L.dot.x - L.dot.r - 4);
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
      plate.object,
      face,
      this.pill,
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
    this.scenePaused = false;
    this.off.push(
      host.bus.on('audience', (e) => {
        this.watching = watchingFrom(e);
      }),
    );
    // A story scene or the pause menu pauses the HUD scene, so no update runs while it is up: show
    // held at once, and let the next update after the resume say what the dot is again.
    const events = (scene as { events?: Phaser.Events.EventEmitter }).events;
    if (events) {
      const onPause = (): void => {
        this.scenePaused = true;
        this.showLive('held', 0);
      };
      const onResume = (): void => {
        this.scenePaused = false;
        this.shownLive = null;
      };
      events.on(SCENE_PAUSE, onPause);
      events.on(SCENE_RESUME, onResume);
      this.off.push(() => {
        events.off(SCENE_PAUSE, onPause);
        events.off(SCENE_RESUME, onResume);
      });
    }
    this.off.push(provideHudSection('title', () => this.snapshot()));
    // The leader line ends at the credits chip's middle (game px, made once).
    const chipAt = { x: L.credits.x + L.credits.w / 2, y: L.credits.y + L.credits.h / 2 };
    this.off.push(registerLocate('credits', () => chipAt));
  }

  update(frame: Frame, clock: LiveClock): void {
    if (!this.dot) return;
    this.showLive(this.scenePaused ? 'held' : liveState(frame), clock.now);

    if (this.watching !== this.shownWatching) {
      this.shownWatching = this.watching;
      this.watchingWord?.setText(watchingText(this.watching));
      this.watchingWord?.setColor(this.watching === null ? COLORS.dim : COLORS.white);
      if (this.watchingWord) fitRight(this.watchingWord, this.maxRight);
    }

    const trust = shownTrust(frame.trust);
    if (trust !== this.shownTrust) {
      this.shownTrust = trust;
      this.trustText?.setText(String(trust)).setColor(trustRed(trust) ? COLORS.redText : COLORS.white);
      if (this.trustText) fitRight(this.trustText, this.trustRight);
    }
    const credits = shownCredits(frame.credits);
    if (credits !== this.shownCredits) {
      this.shownCredits = credits;
      this.creditsText
        ?.setText(String(credits))
        .setColor(creditsRed(credits) ? COLORS.redText : COLORS.white);
      if (this.creditsText) fitRight(this.creditsText, this.creditsRight);
    }
  }

  /** Draw the LIVE dot and its word for `live` (the word only on a change) at HUD time `now`. */
  private showLive(live: LiveDot, now: number): void {
    if (!this.dot) return;
    this.live = live;
    if (live !== this.shownLive) {
      this.shownLive = live;
      this.dot.setFillStyle(DOT_COLOR[live], 1);
      this.pill?.setVisible(live === 'live');
      this.liveWord?.setText(LIVE_WORDS[live]).setColor(WORD_COLOR[live]);
      if (this.liveWord) fitRight(this.liveWord, this.maxRight);
    }
    const steady = settings().reduceFlicker || (this.host?.flags.lite ?? false);
    this.dot.setAlpha(liveDotAlpha(live, now, steady));
  }

  /** hud.title, built only when the hook is read. */
  snapshot(): TitleTestState {
    return {
      live: this.live,
      watching: this.watching,
      right: rightOf(this.objects),
      clockRight: clockRight(),
      avatar: this.avatarTexture,
      scenePaused: this.scenePaused,
      pill: this.pill?.visible ?? false,
      panel: panelSnapshot(this.plate),
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    const plate = this.plate?.object;
    for (const o of this.objects) if (o !== plate) o.destroy();
    releasePanel(this.plate);
    this.plate = null;
    this.pill = null;
    this.objects = [];
    this.dot = null;
    this.liveWord = null;
    this.watchingWord = null;
    this.trustText = null;
    this.creditsText = null;
    this.host = null;
    this.avatarTexture = null;
    this.scenePaused = false;
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
      fitRight(this.clockText, CLOCK_MAX_RIGHT);
      fitRight(this.countdown, CLOCK_MAX_RIGHT);
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
