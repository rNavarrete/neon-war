// The room-left bar in the deck: a pulse icon, 30 segments of room left draining from the right as
// load grows (green, amber, all red when over), a marker where 30% is left, and the words above them
// in the crew's terms ("ROOM LEFT 25% · 90 of 120", "ROOM LEFT · OVER +130/s", "ROOM LEFT · NO BOX").
// It draws only this frame's value: one bar, one series, nothing kept from earlier frames.
// The rules are pure in headroom.ts; this file draws them and plays the red sound (at most once per
// 10 s, and only once the mixer knows the key).
//
// Phaser is a type here only, so DeckView and the registry stay importable in node tests.

import type Phaser from 'phaser';
import { isSfxKey } from '../../game/audio';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import type { Rect } from '../live/layout';
import {
  type HeadroomColour,
  type HeadroomState,
  emptyHeadroom,
  headroomLabel,
  headroomLayout,
  overBy,
  redSoundDue,
  stepHeadroom,
} from './headroom';
import { COLORS, FONT } from './layout';
import { KIT } from './kit';
import {
  type BakedPanel,
  GAUGES_DEPTH,
  type PanelTestState,
  bakePanel,
  panelSnapshot,
  releasePanel,
} from './panel';

/** The bar's colours: green while there is room, the amber hero colour when it is short, red over. */
export const BAR_COLORS: Readonly<Record<HeadroomColour, number>> = {
  green: 0x3ddc84,
  amber: COLORS.amber,
  red: COLORS.red,
};
const LABEL_COLORS: Readonly<Record<HeadroomColour, string>> = {
  green: '#7cf0b0',
  amber: COLORS.amberText,
  red: COLORS.redText,
};

/** The sound the bar plays on going red (added with the Live mixer keys; silent until then). */
export const RED_SOUND = 'headroom-red';

/** The bar's alpha while the board is held. */
const HELD_ALPHA = 0.5;

/** The kit pieces the bar's plate draws (DeckView preloads them). */
export const HEADROOM_KIT = [KIT.frame, KIT.corner, KIT.divider] as const;
const HEADROOM_CORNERS = 24;

export class HeadroomView {
  /** Objects and texts this view makes. */
  static readonly budget = { objects: 3, texts: 1 };
  readonly state: HeadroomState = emptyHeadroom();
  private plate: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics | null = null;
  private baked: BakedPanel | null = null;
  private segments: Phaser.GameObjects.Graphics | null = null;
  private label: Phaser.GameObjects.Text | null = null;
  private layout = headroomLayout({ x: 0, y: 0, w: 0, h: 0 });
  private bus: Bus | null = null;
  /** What the segments and the words last showed, to redraw only on a change. */
  private drawnLit = -1;
  private drawnState: HeadroomColour | null = null;
  private drawnWired = -1;
  private shownDemand = NaN;
  private shownWired = NaN;
  private shownPct = -Infinity;
  private shownAlpha = -1;
  /** HUD time the red sound last played, or null. */
  private soundAt: number | null = null;
  /** How many times the segments were redrawn (for tests: only on a change). */
  draws = 0;

  create(scene: Phaser.Scene, rect: Rect, bus: Bus): void {
    this.bus = bus;
    const L = headroomLayout(rect);
    this.layout = L;
    const add = scene.add;

    // The plate, baked once with the frame kit: the fill, the pulse icon, the 30%-left marker, a
    // divider between the icon and the bar, the frame and the bracket corners.
    const i = L.icon;
    const s = L.segments;
    const baked = bakePanel(
      scene,
      'headroom',
      L.plate,
      {
        frame: true,
        corners: HEADROOM_CORNERS,
        dividers: [{ x: i.x + i.w + 40, y: L.plate.y + 18, h: L.plate.h - 36 }],
      },
      {
        fill: { color: COLORS.ink, alpha: 0.96 },
        draw: (plate) => {
          // The pulse icon: a flat line with one beat in it.
          const mid = i.y + i.h / 2;
          plate.lineStyle(2, COLORS.cyan, 0.9);
          plate.beginPath();
          plate.moveTo(i.x, mid);
          plate.lineTo(i.x + i.w * 0.35, mid);
          plate.lineTo(i.x + i.w * 0.45, i.y);
          plate.lineTo(i.x + i.w * 0.58, i.y + i.h);
          plate.lineTo(i.x + i.w * 0.68, mid);
          plate.lineTo(i.x + i.w, mid);
          plate.strokePath();
          // Where 30% is left: after the ninth segment.
          const mx = s.x + L.marker * s.pitch - (s.pitch - s.w) / 2;
          plate.lineStyle(2, 0xe8f1ff, 0.55);
          plate.lineBetween(mx, s.y - 6, mx, s.y + s.h + 6);
        },
      },
    );
    this.baked = baked;
    const plate = baked.object;
    this.plate = plate;

    this.segments = add.graphics();
    this.label = add.text(L.label.x, L.label.y, '', {
      fontFamily: FONT,
      fontSize: '18px',
      color: LABEL_COLORS.green,
    });
    for (const o of [plate, this.segments, this.label]) o.setDepth(GAUGES_DEPTH);

    this.drawnLit = -1;
    this.drawnState = null;
    this.drawnWired = -1;
    this.shownDemand = NaN;
    this.shownWired = NaN;
    this.shownPct = -Infinity;
    this.shownAlpha = -1;
    this.soundAt = null;
    const fresh = emptyHeadroom();
    Object.assign(this.state, fresh);
  }

  /** Bring the bar in line with this frame; `t` is the HUD clock. Allocates nothing on a quiet frame. */
  update(frame: Frame, t: number): void {
    if (!this.segments || !this.label || !this.plate) return;
    const turnedRed = stepHeadroom(this.state, frame, frame.now);
    if (turnedRed && redSoundDue(t, this.soundAt)) {
      this.soundAt = t;
      if (isSfxKey(RED_SOUND)) this.bus?.emit('sfx', { key: RED_SOUND });
    }

    const st = this.state;
    const wiredDrawn = st.wiredCapacity > 0 ? 1 : 0;
    if (st.lit !== this.drawnLit || st.state !== this.drawnState || wiredDrawn !== this.drawnWired) {
      this.drawnLit = st.lit;
      this.drawnState = st.state;
      this.drawnWired = wiredDrawn;
      this.drawSegments();
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
      this.plate.setAlpha(alpha);
      this.segments.setAlpha(alpha);
      this.label.setAlpha(alpha);
    }
  }

  private drawSegments(): void {
    const g = this.segments;
    if (!g) return;
    this.draws++;
    const st = this.state;
    const s = this.layout.segments;
    const over = st.wiredCapacity > 0 && overBy(st.demand, st.wiredCapacity) > 0;
    g.clear();
    for (let k = 0; k < s.count; k++) {
      const x = s.x + k * s.pitch;
      if (over) g.fillStyle(BAR_COLORS.red, 0.95);
      else if (k < st.lit) g.fillStyle(BAR_COLORS[st.state], 0.95);
      else g.fillStyle(COLORS.unlit, 0.35);
      g.fillRect(x, s.y, s.w, s.h);
    }
  }

  /** The bar's baked plate, for hud.headroom.panel. */
  get panel(): PanelTestState | null {
    return panelSnapshot(this.baked);
  }

  /** The words on the bar now. */
  get labelText(): string {
    return this.label?.text ?? '';
  }

  /** The right edge of the bar's plate, in game x. */
  get right(): number {
    return this.layout.plate.x + this.layout.plate.w;
  }

  shutdown(): void {
    releasePanel(this.baked);
    this.baked = null;
    this.segments?.destroy();
    this.label?.destroy();
    this.plate = null;
    this.segments = null;
    this.label = null;
    this.bus = null;
  }
}
