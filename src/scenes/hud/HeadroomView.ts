// The headroom line under the gauge's big number, in real terms ("HEADROOM 25% · 90 of 120",
// "HEADROOM · OVER +130 req/s", "HEADROOM · NO SERVER"), green while there is room, amber when it is
// short and red over. It was a 30-segment bar in the deck until Rolando folded it into the gauge
// (30 Oct 2026: the bar, the chart and the gauge measured the same thing).
// The rules are pure in headroom.ts; this file draws the words and plays the red sound (at most once
// per 10 s, and only once the mixer knows the key). GaugeView makes it and mirrors hud.headroom.
//
// Phaser is a type here only, so GaugeView and the registry stay importable in node tests.

import type Phaser from 'phaser';
import { isSfxKey } from '../../game/audio';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import {
  type HeadroomColour,
  type HeadroomState,
  emptyHeadroom,
  headroomLabel,
  redSoundDue,
  stepHeadroom,
} from './headroom';
import { COLORS, FONT } from './layout';
import { GAUGES_DEPTH } from './panel';

/** What the hook mirrors as hud.headroom. */
export interface HeadroomTestState {
  /** round((1 - demand / wiredCapacity) x 100); null with nothing wired. */
  pct: number | null;
  /** demand / wiredCapacity; null with nothing wired. */
  load: number | null;
  /** Req/s every live server could serve, wired or not. */
  capacity: number;
  /** Req/s the wired, online servers can serve: what the line measures. */
  wiredCapacity: number;
  demand: number;
  state: HeadroomColour;
  /** Sim time the line turned red, while it stays red; null otherwise. */
  redSince: number | null;
  /** Thirtieths of room left (the old bar's segments), 0..30. */
  lit: number;
  /** The words on the line now. */
  label: string;
  /** The right edge of the words, in game x. */
  right: number;
}

/** The words' colours: green while there is room, the amber hero colour when it is short, red over. */
const LABEL_COLORS: Readonly<Record<HeadroomColour, string>> = {
  green: '#7cf0b0',
  amber: COLORS.amberText,
  red: COLORS.redText,
};

/** The sound the line plays on going red (added with the Live mixer keys; silent until then). */
export const RED_SOUND = 'headroom-red';

/** The line's alpha while the board is held. */
const HELD_ALPHA = 0.5;

export class HeadroomView {
  /** Objects and texts this view makes. */
  static readonly budget = { objects: 1, texts: 1 };
  readonly state: HeadroomState = emptyHeadroom();
  private label: Phaser.GameObjects.Text | null = null;
  private bus: Bus | null = null;
  private shownState: HeadroomColour | null = null;
  private shownDemand = NaN;
  private shownWired = NaN;
  private shownPct = -Infinity;
  private shownAlpha = -1;
  /** HUD time the red sound last played, or null. */
  private soundAt: number | null = null;

  /** Make the words with their top centre at `at`. */
  create(scene: Phaser.Scene, at: { x: number; y: number }, bus: Bus): Phaser.GameObjects.Text {
    this.bus = bus;
    this.label = scene.add
      .text(at.x, at.y, '', { fontFamily: FONT, fontSize: '18px', color: LABEL_COLORS.green })
      .setOrigin(0.5, 0)
      .setDepth(GAUGES_DEPTH);
    this.shownState = null;
    this.shownDemand = NaN;
    this.shownWired = NaN;
    this.shownPct = -Infinity;
    this.shownAlpha = -1;
    this.soundAt = null;
    Object.assign(this.state, emptyHeadroom());
    return this.label;
  }

  /** Bring the line in line with this frame; `t` is the HUD clock. Allocates nothing on a quiet frame. */
  update(frame: Frame, t: number): void {
    if (!this.label) return;
    const turnedRed = stepHeadroom(this.state, frame, frame.now);
    if (turnedRed && redSoundDue(t, this.soundAt)) {
      this.soundAt = t;
      if (isSfxKey(RED_SOUND)) this.bus?.emit('sfx', { key: RED_SOUND });
    }

    const st = this.state;
    if (st.state !== this.shownState) {
      this.shownState = st.state;
      this.label.setColor(LABEL_COLORS[st.state]);
    }
    const demand = Math.round(st.demand);
    const wired = Math.round(st.wiredCapacity);
    const pct = st.pct ?? NaN;
    if (demand !== this.shownDemand || wired !== this.shownWired || !Object.is(pct, this.shownPct)) {
      this.shownDemand = demand;
      this.shownWired = wired;
      this.shownPct = pct;
      this.label.setText(headroomLabel(st.demand, st.wiredCapacity));
    }

    const alpha = frame.paused ? HELD_ALPHA : 1;
    if (alpha !== this.shownAlpha) {
      this.shownAlpha = alpha;
      this.label.setAlpha(alpha);
    }
  }

  /** hud.headroom, built only when the hook is read. */
  snapshot(): HeadroomTestState {
    const s = this.state;
    const l = this.label;
    return {
      pct: s.pct,
      load: s.load,
      capacity: s.capacity,
      wiredCapacity: s.wiredCapacity,
      demand: s.demand,
      state: s.state,
      redSince: s.redSince,
      lit: s.lit,
      label: l?.text ?? '',
      right: l && typeof l.x === 'number' ? Math.round(l.x + (l.width || 0) / 2) : 0,
    };
  }

  shutdown(): void {
    this.label?.destroy();
    this.label = null;
    this.bus = null;
  }
}
