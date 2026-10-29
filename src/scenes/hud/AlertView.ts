// The alert band (ZONES.alert) as a Live screen view: one alert at a time on the 1040x84 plate, the
// number first in the headline and the cause in the sub-line, the chip counting down at the right,
// RAID only in the hazard-striped well at the right end. It slides in from above over 250 ms when the
// kind or the headline's words change, the stripes scroll and the flicker flashes at 6 Hz; under
// reduce flicker (or the ?test lite flag) nothing moves. It tells the bus when an alert goes up and
// comes down ('alert' / 'alertEnd', one at a time) and mirrors itself as hud.alert.
//
// With nothing up at the start of C1, the band carries the first step instead (startHintOf): once
// the job card closes, "drag a SERVER card onto the grid" until the first server is on the board. A hint is not an alert: it tells the bus
// nothing, plays no sound, never slides or flashes, and any alert takes the band over at once.
//
// The rules are pure in alerts.ts; this file only draws them. It is the only alert band (the HUD
// scene's legacy surge/fall band is gone) and plays the band's sound, the forecast's included; the
// HUD scene lists its container as hud.bounds 'alert'.
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import { run } from '../../game/run';
import { settings } from '../../game/settings';
import { type LineId, line } from '../../strings';
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
  startHintOf,
  stepAlert,
  stripeScroll,
} from './alerts';
import { jobCardDue } from './jobCard';
import { COLORS, FONT, FONT_SANS } from './layout';
import { provideHudSection } from './hook';
import { register as registerLocate } from './locate';
import { KIT, alertEndcap } from './kit';
import {
  type BakedPanel,
  GAUGES_DEPTH,
  type PanelTestState,
  bakePanel,
  panelSnapshot,
  releasePanel,
} from './panel';
import { preloadArt } from '../plates';

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
  /** The baked plate: the alert plate and end cap drawn (m4 panel kit). */
  panel?: PanelTestState | null;
  /** The start-of-C1 hint on the band now (no alert up), or null. */
  hint: LineId | null;
  /** The hint's words as shown ('' with none). */
  hintText: string;
}

declare module './hook' {
  interface HudTestState {
    /** The alert band (gauges-3). */
    alert?: AlertTestState;
  }
}

/** How many entries hud.alert.history keeps. */
export const ALERT_HISTORY = 60;

const ICON = { key: 'hud:icon-warning', file: 'art/hud/icons/warning.webp' } as const;
/** The baked hazard stripe tile (one period wide, the band's height). */
const STRIPES_KEY = 'alert:stripes';

function loadOnce(scene: Phaser.Scene, key: string, file: string): void {
  if (!scene.textures.exists(key)) scene.load.image(key, file);
}

/** The headline's size for an alert, and for a C1 hint (which has no number and runs longer). */
const HEADLINE_PX = 30;
const HINT_PX = 24;

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
  private plate: BakedPanel | null = null;
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
  /** The start-of-C1 hint up now, and the one the headline was last dressed for. */
  private hint: LineId | null = null;
  private shownHint: LineId | null = null;
  /** The tutorial coach's step on the band (bus `coach`), shown in place of the start hint. */
  private coachHint: LineId | null = null;
  /** What the hint reads, one object refilled every frame. */
  private readonly hintInput: {
    now: number;
    cardOpen: boolean;
    parts: readonly { readonly kind: string }[];
  } = { now: 0, cardOpen: true, parts: [] };

  preload(scene: Phaser.Scene): void {
    loadOnce(scene, ICON.key, ICON.file);
    preloadArt(scene as never, [KIT.alertPlate, KIT.alertEndcap]);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.scene = scene;
    this.host = host;
    this.bus = host.bus;
    const L = alertLayout(host.rect);
    this.layout = L;
    const add = scene.add;
    bakeStripes(scene);

    // The plate, baked once: a solid backing, the alert plate nine-sliced at k 0.5 (both painted ends
    // whole, the plain middle stretched) and the hazard end cap at the right end. Without the art the
    // backing and a 2 px amber rim draw instead.
    const plate = bakePanel(
      scene,
      'alert',
      L.plate,
      { alert: { endcap: true } },
      { fill: { color: COLORS.ink, alpha: 1 } },
    );
    this.plate = plate;

    const icon = add.image(L.icon.x, L.icon.y, ICON.key);
    icon.setScale(L.icon.size / Math.max(icon.width, icon.height, 1));

    // The scrolling stripes fill the well up to the end cap; RAID sits over both.
    const w = L.well;
    const cap = alertEndcap(L.plate);
    const sw = Math.max(0, cap.x - w.x);
    this.stripes = add.tileSprite(w.x + sw / 2, w.y + w.h / 2, sw, w.h - 4, STRIPES_KEY);
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
      plate.object,
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
    this.hint = null;
    this.shownHint = null;
    this.coachHint = null;
    if (this.bus)
      this.off.push(
        this.bus.on('coach', (c) => {
          this.coachHint = c.hint;
        }),
      );
    this.off.push(provideHudSection('alert', () => this.snapshot()));
    // The leader line ends under the plate's middle, while an alert is up (game px, made once).
    const under = { x: L.plate.x + L.plate.w / 2, y: L.plate.y + L.plate.h };
    this.off.push(registerLocate('alert', () => (this.visible ? under : null)));
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
        // The band's sound: surge-warning when a forecast or the raid goes up.
        const sound = alertSound(prevKind, st.kind);
        if (sound) this.bus?.emit('sfx', { key: sound });
      } else {
        this.shownAt = null;
      }
    }
    if (changed || st.number !== prevNumber) this.record(frame);

    // With no alert up, the start of C1 says what to do first (no bus, no sound, no slide).
    const hi = this.hintInput;
    hi.now = frame.now;
    hi.cardOpen = st.kind === 'none' && jobCardDue(run());
    hi.parts = frame.parts;
    this.hint = st.kind === 'none' ? (this.coachHint ?? startHintOf(hi)) : null;

    const visible = st.kind !== 'none' || this.hint !== null;
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
    const hint = this.hint;
    if (hint !== this.shownHint) {
      // The headline is dressed for a hint (cyan, smaller, no number) or back for an alert.
      this.shownHint = hint;
      this.shownKind = null;
      this.shownHeadline = '';
      this.headline?.setFontSize(hint ? HINT_PX : HEADLINE_PX);
      // A hint has no sub-line under it, so it sits in the band's middle; an alert's headline on top.
      const L = this.layout;
      if (L)
        this.headline?.setY(hint ? L.plate.y + Math.round((L.plate.h - HINT_PX * 1.25) / 2) : L.headline.y);
      if (hint) this.headline?.setColor(COLORS.cyanText);
    }
    const headline = hint ? line(hint) : st.headline;
    if (headline !== this.shownHeadline) {
      this.shownHeadline = headline;
      this.headline?.setText(headline);
    }
    if (!hint && st.kind !== this.shownKind) {
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

  /** The band's root container (hud.bounds 'alert'); null before create and after shutdown. */
  get container(): Phaser.GameObjects.Container | null {
    return this.root;
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
      panel: panelSnapshot(this.plate),
      hint: this.hint,
      hintText: this.hint ? line(this.hint) : '',
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    this.root?.destroy(true);
    this.root = null;
    releasePanel(this.plate);
    this.plate = null;
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
