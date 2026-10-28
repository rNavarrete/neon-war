// The alert band (ZONES.alert) as a Live screen view: one alert at a time on the 1040x84 plate, the
// number first in the headline and the cause in the sub-line, the chip counting down at the right,
// RAID only in the hazard-striped well at the right end. It slides in from above over 250 ms when the
// kind or the headline's words change, the stripes scroll and the flicker flashes at 6 Hz; under
// reduce flicker (or the ?test lite flag) nothing moves. It tells the bus when an alert goes up and
// comes down ('alert' / 'alertEnd', one at a time) and mirrors itself as hud.alert.
//
// The rules are pure in alerts.ts; this file only draws them. The HUD scene still draws its own
// surge/fall band underneath until the tech lane drops it; this view sits above it (GAUGES_DEPTH)
// and covers it whenever it shows anything.
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import { settings } from '../../game/settings';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import {
  type AlertKind,
  type AlertLayout,
  type AlertState,
  STRIPE_PERIOD,
  alertLayout,
  alertMotion,
  alertSound,
  emptyAlert,
  slideOffset,
  stepAlert,
  stripeScroll,
} from './alerts';
import { COLORS, FONT, FONT_SANS } from './layout';
import { GAUGES_DEPTH, panel, provideHudPart } from './panel';

/** One entry of hud.alert.history: a kind or number the band showed, and when (sim seconds). */
export interface AlertHistoryEntry {
  kind: AlertKind;
  number: number;
  retry: number;
  at: number;
}

/** What the hook mirrors as hud.alert. */
export interface AlertTestState extends AlertState {
  /** Sim time this alert (kind and words) went up; null with nothing up. */
  shownAt: number | null;
  /** play.retry as the band last read it (the raid's number climbs with it). */
  retry: number;
  /** The plate's y offset from its place now: negative while sliding in, 0 once there. */
  offset: number;
  /** Whether the band is drawn at all. */
  visible: boolean;
  /** What moves on the band (all false under reduce flicker). */
  motion: { slide: boolean; stripes: boolean; flash: boolean };
  /** The last kinds and numbers shown, oldest first (capped). */
  history: AlertHistoryEntry[];
}

declare module './hook' {
  interface HudTestState {
    /** The alert band (gauges-3). */
    alert?: AlertTestState;
  }
}

/**
 * WIRING(tech): the HUD scene's legacy band (HudScene.updateWarnings) still plays surge-warning when a
 * forecast goes up. Set this false when it stops drawing its band, so the sound plays from here alone.
 */
export const HUD_PLAYS_FORECAST_SOUND = true;

/** How many entries hud.alert.history keeps. */
export const ALERT_HISTORY = 60;

const ICON = { key: 'hud:icon-warning', file: 'art/hud/icons/warning.webp' } as const;
const PLATE = { key: 'hud:warning-bar', file: 'art/hud/warning-bar.webp' } as const;
/** The baked hazard stripe tile (one period wide, the band's height). */
const STRIPES_KEY = 'alert:stripes';

function loadOnce(scene: Phaser.Scene, key: string, file: string): void {
  if (!scene.textures.exists(key)) scene.load.image(key, file);
}

/** Headline colours: amber is the hero; red only when the block is dropping (dark). */
const HEADLINE_COLOR: Readonly<Record<AlertKind, string>> = {
  dark: COLORS.redText,
  held: COLORS.heroText,
  flicker: COLORS.heroText,
  refresh: COLORS.heroText,
  raid: COLORS.heroText,
  forecast: COLORS.heroText,
  fall: COLORS.cyanText,
  none: COLORS.heroText,
};

export class AlertView implements LiveView {
  readonly zone = 'alert' as const;
  readonly budget: LiveBudget = { objects: 10, texts: 4 };
  readonly state: AlertState = emptyAlert();
  private root: Phaser.GameObjects.Container | null = null;
  private stripes: Phaser.GameObjects.TileSprite | null = null;
  private headline: Phaser.GameObjects.Text | null = null;
  private sub: Phaser.GameObjects.Text | null = null;
  private chip: Phaser.GameObjects.Text | null = null;
  private tag: Phaser.GameObjects.Text | null = null;
  private layout: AlertLayout | null = null;
  private host: LiveHost | null = null;
  private bus: Bus | null = null;
  private off: (() => void)[] = [];
  private scene: Phaser.Scene | null = null;

  /** Real time (ms, the game loop's) the current slide started. */
  private slideFrom = -Infinity;
  private shownAt: number | null = null;
  private retry = 0;
  private offset = 0;
  private visible = false;
  private steady = false;
  private readonly history: AlertHistoryEntry[] = [];
  /** What the texts last showed, to set them only on a change. */
  private shownHeadline = '';
  private shownSub = '';
  private shownChip = '';
  private shownTag: string | null = null;
  private shownKind: AlertKind | null = null;
  private shownStripes = false;
  private shownLit = true;

  preload(scene: Phaser.Scene): void {
    loadOnce(scene, ICON.key, ICON.file);
    loadOnce(scene, PLATE.key, PLATE.file);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.scene = scene;
    this.host = host;
    this.bus = host.bus;
    const L = alertLayout(host.rect);
    this.layout = L;
    const add = scene.add;
    bakeStripes(scene);

    // A solid backing first, so the HUD's own band underneath never shows through the plate's art.
    const back = add.graphics();
    back.fillStyle(COLORS.ink, 1);
    back.fillRect(L.plate.x, L.plate.y, L.plate.w, L.plate.h);
    const plate = panel(scene, PLATE.key, L.plate.x, L.plate.y, L.plate.w, L.plate.h, {
      k: 0.85,
      slice: [90, 90, 40, 40],
    });
    back.lineStyle(2, COLORS.amber, 0.9);
    back.strokeRect(L.plate.x + 1, L.plate.y + 1, L.plate.w - 2, L.plate.h - 2);

    const icon = add.image(L.icon.x, L.icon.y, ICON.key);
    icon.setScale(L.icon.size / Math.max(icon.width, icon.height, 1));

    const w = L.well;
    this.stripes = add.tileSprite(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h - 4, STRIPES_KEY);
    this.stripes.setAlpha(0.55);
    this.tag = add
      .text(w.x + w.w / 2, w.y + w.h / 2, '', {
        fontFamily: FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: COLORS.white,
        backgroundColor: 'rgba(5,7,15,0.85)',
        padding: { x: 8, y: 2 },
      })
      .setOrigin(0.5);

    this.headline = add.text(L.headline.x, L.headline.y, '', {
      fontFamily: FONT,
      fontSize: '30px',
      fontStyle: 'bold',
      color: COLORS.heroText,
    });
    this.sub = add.text(L.sub.x, L.sub.y, '', {
      fontFamily: FONT_SANS,
      fontSize: '17px',
      color: COLORS.white,
      wordWrap: { width: L.sub.w },
      maxLines: 1,
    });
    this.chip = add
      .text(L.chip.right, L.chip.y, '', {
        fontFamily: FONT,
        fontSize: '24px',
        color: COLORS.heroText,
      })
      .setOrigin(1, 0.5);

    this.root = add.container(0, 0, [
      back,
      plate,
      icon,
      this.stripes,
      this.tag,
      this.headline,
      this.sub,
      this.chip,
    ]);
    this.root.setDepth(GAUGES_DEPTH);
    this.root.setVisible(false);

    Object.assign(this.state, emptyAlert());
    this.slideFrom = -Infinity;
    this.shownAt = null;
    this.offset = 0;
    this.visible = false;
    this.history.length = 0;
    this.shownHeadline = '';
    this.shownSub = '';
    this.shownChip = '';
    this.shownTag = null;
    this.shownKind = null;
    this.shownStripes = false;
    this.shownLit = true;
    this.off.push(provideHudPart(scene, 'alert', () => this.snapshot()));
  }

  update(frame: Frame, clock: LiveClock): void {
    const root = this.root;
    if (!root || !this.layout) return;
    this.steady = settings().reduceFlicker || (this.host?.flags.lite ?? false);
    const motion = alertMotion(this.steady);
    const st = this.state;
    const prevKind = st.kind;
    const prevNumber = st.number;
    const changed = stepAlert(st, frame, settings().reduceFlicker);
    this.retry = frame.retry;
    const realMs = this.scene?.game.loop.time ?? 0;

    if (changed) {
      if (prevKind !== 'none') this.bus?.emit('alertEnd', { kind: prevKind });
      if (st.kind !== 'none') {
        this.shownAt = frame.now;
        // Slide in only on a running board: a held board shows the band in place at once.
        this.slideFrom = frame.paused ? -Infinity : realMs;
        this.bus?.emit('alert', { kind: st.kind, line: st.line, text: st.headline, at: clock.now });
        // The HUD scene still plays the forecast's sound with its own band; this band adds the raid's.
        const sound = alertSound(prevKind, st.kind);
        if (sound && (st.kind !== 'forecast' || !HUD_PLAYS_FORECAST_SOUND))
          this.bus?.emit('sfx', { key: sound });
      } else {
        this.shownAt = null;
      }
    }
    if (changed || st.number !== prevNumber) this.record(frame);

    const visible = st.kind !== 'none';
    if (visible !== this.visible) {
      this.visible = visible;
      root.setVisible(visible);
    }
    if (!visible) return;

    const offset = slideOffset((realMs - this.slideFrom) / 1000, this.layout.plate, motion);
    if (offset !== this.offset) {
      this.offset = offset;
      root.y = offset;
    }
    if (st.stripes && this.stripes) this.stripes.tilePositionX = -stripeScroll(clock.now, motion);
    this.draw();
  }

  /** Set the texts and colours that changed since the last frame. */
  private draw(): void {
    const st = this.state;
    if (st.headline !== this.shownHeadline) {
      this.shownHeadline = st.headline;
      this.headline?.setText(st.headline);
    }
    if (st.kind !== this.shownKind) {
      this.shownKind = st.kind;
      this.headline?.setColor(HEADLINE_COLOR[st.kind]);
    }
    if (st.sub !== this.shownSub) {
      this.shownSub = st.sub;
      this.sub?.setText(st.sub);
    }
    if (st.chip !== this.shownChip) {
      this.shownChip = st.chip;
      this.chip?.setText(st.chip);
    }
    if (st.tag !== this.shownTag) {
      this.shownTag = st.tag;
      this.tag?.setText(st.tag ?? '').setVisible(st.tag !== null);
    }
    if (st.stripes !== this.shownStripes) {
      this.shownStripes = st.stripes;
      this.stripes?.setVisible(st.stripes);
    }
    if (st.lit !== this.shownLit) {
      this.shownLit = st.lit;
      // The flicker flashes its sub-line (POWER FLICKER); steady, it stays lit.
      this.sub?.setAlpha(st.lit ? 1 : 0.15);
    }
  }

  /** Add the band's kind and number to the history (on a change only). */
  private record(frame: Frame): void {
    const st = this.state;
    this.history.push({ kind: st.kind, number: st.number, retry: frame.retry, at: frame.now });
    if (this.history.length > ALERT_HISTORY) this.history.shift();
  }

  /** hud.alert, built only when the hook is read. */
  snapshot(): AlertTestState {
    const m = alertMotion(this.steady);
    return {
      ...this.state,
      shownAt: this.shownAt,
      retry: this.retry,
      offset: this.offset,
      visible: this.visible,
      motion: { slide: m.slide, stripes: m.stripes, flash: m.flash },
      history: this.history.map((h) => ({ ...h })),
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    this.root?.destroy(true);
    this.root = null;
    this.stripes = null;
    this.headline = null;
    this.sub = null;
    this.chip = null;
    this.tag = null;
    this.layout = null;
    this.host = null;
    this.bus = null;
    this.scene = null;
  }
}

/** Bake the hazard stripe tile once: amber bands at 45 degrees, one period wide, seamless across. */
function bakeStripes(scene: Phaser.Scene): void {
  if (scene.textures.exists(STRIPES_KEY)) return;
  const h = 84;
  const g = scene.make.graphics({}, false);
  g.lineStyle(STRIPE_PERIOD / 2, COLORS.amber, 1);
  for (let x = -h; x <= STRIPE_PERIOD + h; x += STRIPE_PERIOD) g.lineBetween(x, h, x + h, 0);
  g.generateTexture(STRIPES_KEY, STRIPE_PERIOD, h);
  g.destroy();
}
