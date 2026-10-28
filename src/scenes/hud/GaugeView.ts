// The COMING /s gauge (ZONES.gauge) as a Live screen view: a fixed 0..400 arc with ticks every 100,
// the cyan ROOM band to the wired capacity with a dashed extension for boxes still booting, the
// amber needle easing toward demand, a red wedge from served to demand while calls drop, the white
// estimate tick (C1) and the magenta sizing x 60 tick (C6), the big number, and the crew's words
// beside it ("room N/s", NO ROOM YET, OVER BY n/s). The rules are pure in gauge.ts; this file draws
// them and mirrors hud.gauge for tests.
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Frame } from '../../game/frame';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import {
  GAUGE_MAX,
  GAUGE_TICKS,
  type GaugeLayout,
  type GaugeState,
  arcPoint,
  emptyGauge,
  emptyGaugeMemo,
  gaugeAngle,
  gaugeLayout,
  stepGauge,
} from './gauge';
import { LABELS } from './labels';
import { COLORS, FONT } from './layout';
import { provideHudSection } from './hook';
import { register as registerLocate } from './locate';
import { GAUGES_DEPTH } from './panel';

/** What the hook mirrors as hud.gauge. */
export interface GaugeTestState {
  /** True once the gauge is drawn (it shows for the whole night). */
  visible: boolean;
  /** The sim's demand, req/s. */
  demand: number;
  served: number;
  /** flow.dropped while over 0.5, else 0. */
  dropped: number;
  /** The ROOM band: the wired capacity, equal to hud.headroom.wiredCapacity. */
  capacity: number;
  /** The dashed extension: req/s the wired boxes still booting will add. */
  booting: number;
  /** The needle's eased value. */
  needle: number;
  max: number;
  estimateMark: number | null;
  sizingMark: number | null;
  /** The mark the gauge leads with: sizing x 60 after the C6 SET, the estimate before. */
  tick: number | null;
  /** The words on screen. */
  title: string;
  readout: string;
  sub: string;
  strip: string | null;
  /** Every tick number printed on the arc. */
  ticks: string[];
}

declare module './hook' {
  interface HudTestState {
    /** The COMING /s gauge (gauges-5). */
    gauge?: GaugeTestState;
  }
}

/** The gauge's alpha while the board is held. */
const HELD_ALPHA = 0.5;
const ESTIMATE_COLOR = 0xffffff;

export class GaugeView implements LiveView {
  readonly zone = 'gauge' as const;
  /** A plate, the moving parts, and title, readout, sub-line, strip, ROOM tag and five numbers. */
  readonly budget: LiveBudget = { objects: 12, texts: 10 };
  readonly made = { objects: 0, texts: 0 };
  readonly state: GaugeState = emptyGauge();
  private readonly memo = emptyGaugeMemo();
  private layout: GaugeLayout = gaugeLayout({ x: 0, y: 0, w: 0, h: 0 });
  private plate: Phaser.GameObjects.Graphics | null = null;
  private dial: Phaser.GameObjects.Graphics | null = null;
  private title: Phaser.GameObjects.Text | null = null;
  private readout: Phaser.GameObjects.Text | null = null;
  private sub: Phaser.GameObjects.Text | null = null;
  private strip: Phaser.GameObjects.Text | null = null;
  private roomTag: Phaser.GameObjects.Text | null = null;
  private numbers: Phaser.GameObjects.Text[] = [];
  private off: (() => void)[] = [];
  private shownDemand = NaN;
  private shownSub = '';
  private shownStrip: string | null = '';
  private shownAlpha = -1;
  private shownRoomX = NaN;
  /** What the moving parts were last drawn from, to redraw only on a change. */
  private drawn = {
    needle: NaN,
    capacity: NaN,
    booting: NaN,
    served: NaN,
    dropped: NaN,
    est: NaN,
    size: NaN,
  };
  /** How many times the moving parts were redrawn (for tests). */
  draws = 0;

  create(scene: Phaser.Scene, host: LiveHost): void {
    const L = gaugeLayout(host.rect);
    this.layout = L;
    const add = scene.add;
    Object.assign(this.state, emptyGauge());
    Object.assign(this.memo, emptyGaugeMemo());

    const plate = add.graphics();
    plate.fillStyle(COLORS.ink, 0.92);
    plate.fillRect(L.plate.x, L.plate.y, L.plate.w, L.plate.h);
    plate.lineStyle(1, COLORS.cyan, 0.35);
    plate.strokeRect(L.plate.x + 0.5, L.plate.y + 0.5, L.plate.w - 1, L.plate.h - 1);
    // The empty track and the tick marks every 100.
    plate.lineStyle(L.outer - L.inner, COLORS.unlit, 0.35);
    plate.beginPath();
    plate.arc(L.centre.x, L.centre.y, (L.outer + L.inner) / 2, gaugeAngle(0), gaugeAngle(GAUGE_MAX), false);
    plate.strokePath();
    plate.lineStyle(2, 0xe8f1ff, 0.6);
    for (const v of GAUGE_TICKS) {
      const a = arcPoint(L, v, L.outer + 4);
      const b = arcPoint(L, v, L.inner - 6);
      plate.lineBetween(a.x, a.y, b.x, b.y);
    }
    // The right column's divider.
    plate.lineStyle(1, COLORS.cyan, 0.25);
    plate.lineBetween(L.readout.x - 14, L.plate.y + 16, L.readout.x - 14, L.plate.y + L.plate.h - 16);
    this.plate = plate;

    this.dial = add.graphics();

    const text = (x: number, y: number, s: string, size: number, color: string): Phaser.GameObjects.Text =>
      add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color });
    this.title = text(L.title.x, L.title.y, LABELS.gauge.title, 15, COLORS.dim);
    this.readout = text(L.readout.x, L.readout.y, '', 40, COLORS.amberText);
    this.sub = text(L.sub.x, L.sub.y, '', 16, COLORS.cyanText);
    this.strip = text(L.strip.x, L.strip.y, '', 15, COLORS.amberText);
    this.roomTag = text(L.centre.x, L.centre.y, LABELS.gauge.room, 11, COLORS.cyanText);
    this.roomTag.setOrigin(0.5, 0.5);
    this.numbers = GAUGE_TICKS.map((v) => {
      const p = arcPoint(L, v, L.numbers);
      return text(p.x, p.y, String(v), 12, COLORS.dim).setOrigin(0.5, 0.5);
    });

    const all = [
      plate,
      this.dial,
      this.title,
      this.readout,
      this.sub,
      this.strip,
      this.roomTag,
      ...this.numbers,
    ];
    for (const o of all) o.setDepth(GAUGES_DEPTH);
    this.made.objects = all.length;
    this.made.texts = all.length - 2;

    this.shownDemand = NaN;
    this.shownSub = '';
    this.shownStrip = '';
    this.shownAlpha = -1;
    this.shownRoomX = NaN;
    this.drawn = { needle: NaN, capacity: NaN, booting: NaN, served: NaN, dropped: NaN, est: NaN, size: NaN };
    this.off.push(provideHudSection('gauge', () => this.snapshot()));
    // The leader line ends at the needle's hub (game px; one point, made once).
    const hub = { x: L.centre.x, y: L.centre.y };
    this.off.push(registerLocate('gauge', () => hub));
  }

  update(frame: Frame, clock: LiveClock): void {
    if (!this.dial || !this.readout || !this.sub || !this.strip || !this.plate || !this.roomTag) return;
    const st = stepGauge(this.state, this.memo, frame, clock.dt);

    const d = this.drawn;
    if (
      st.needle !== d.needle ||
      st.capacity !== d.capacity ||
      st.booting !== d.booting ||
      st.served !== d.served ||
      st.dropped !== d.dropped ||
      !Object.is(st.estimateMark ?? NaN, d.est) ||
      !Object.is(st.sizingMark ?? NaN, d.size)
    ) {
      d.needle = st.needle;
      d.capacity = st.capacity;
      d.booting = st.booting;
      d.served = st.served;
      d.dropped = st.dropped;
      d.est = st.estimateMark ?? NaN;
      d.size = st.sizingMark ?? NaN;
      this.drawDial();
    }

    const demand = Math.round(st.demand);
    if (demand !== this.shownDemand) {
      this.shownDemand = demand;
      this.readout.setText(`${demand}/s`);
    }
    if (st.sub !== this.shownSub) {
      this.shownSub = st.sub;
      this.sub.setText(st.sub);
      this.sub.setColor(st.dropped > 0 ? COLORS.redText : COLORS.cyanText);
    }
    if (st.strip !== this.shownStrip) {
      this.shownStrip = st.strip;
      this.strip.setText(st.strip ?? '');
      this.strip.setColor(st.strip === LABELS.gauge.noRoom ? COLORS.amberText : COLORS.redText);
    }
    // The ROOM tag rides inside the band's end; hidden with nothing wired.
    const roomX = st.capacity > 0 ? Math.round(st.capacity) : -1;
    if (roomX !== this.shownRoomX) {
      this.shownRoomX = roomX;
      this.roomTag.setVisible(roomX > 0);
      if (roomX > 0) {
        const L = this.layout;
        const p = arcPoint(L, Math.min(st.capacity, GAUGE_MAX), L.inner - 34);
        this.roomTag.setPosition(p.x, p.y);
      }
    }

    const alpha = frame.paused ? HELD_ALPHA : 1;
    if (alpha !== this.shownAlpha) {
      this.shownAlpha = alpha;
      this.dial.setAlpha(alpha);
      this.readout.setAlpha(alpha);
    }
  }

  private drawDial(): void {
    const g = this.dial;
    if (!g) return;
    this.draws++;
    const L = this.layout;
    const st = this.state;
    const mid = (L.outer + L.inner) / 2;
    const width = L.outer - L.inner;
    g.clear();
    // The ROOM band, 0 to the wired capacity.
    if (st.capacity > 0) {
      g.lineStyle(width, COLORS.cyan, 0.85);
      g.beginPath();
      g.arc(L.centre.x, L.centre.y, mid, gaugeAngle(0), gaugeAngle(st.capacity), false);
      g.strokePath();
    }
    // The dashed extension for boxes still booting.
    if (st.booting > 0) {
      const from = st.capacity;
      const to = Math.min(GAUGE_MAX, st.capacity + st.booting);
      g.lineStyle(width - 6, COLORS.cyan, 0.45);
      const step = 6;
      for (let v = from; v < to; v += step * 2) {
        g.beginPath();
        g.arc(L.centre.x, L.centre.y, mid, gaugeAngle(v), gaugeAngle(Math.min(v + step, to)), false);
        g.strokePath();
      }
    }
    // The red wedge, served to demand, while calls drop.
    if (st.dropped > 0 && st.demand > st.served) {
      g.fillStyle(COLORS.red, 0.45);
      g.slice(L.centre.x, L.centre.y, L.outer, gaugeAngle(st.served), gaugeAngle(st.demand), false);
      g.fillPath();
    }
    // The estimate (white) and sizing (magenta) ticks across the band.
    if (st.estimateMark !== null) this.mark(g, st.estimateMark, ESTIMATE_COLOR);
    if (st.sizingMark !== null) this.mark(g, st.sizingMark, COLORS.magenta);
    // The needle and its hub.
    const tip = arcPoint(L, st.needle, L.needle);
    g.lineStyle(4, COLORS.amber, 1);
    g.lineBetween(L.centre.x, L.centre.y, tip.x, tip.y);
    g.fillStyle(COLORS.amber, 1);
    g.fillCircle(L.centre.x, L.centre.y, 7);
  }

  private mark(g: Phaser.GameObjects.Graphics, v: number, color: number): void {
    const L = this.layout;
    const a = arcPoint(L, v, L.outer + 8);
    const b = arcPoint(L, v, L.inner - 8);
    g.lineStyle(3, color, 0.95);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }

  /** hud.gauge, built only when the hook is read. */
  snapshot(): GaugeTestState {
    const s = this.state;
    return {
      visible: this.dial !== null,
      demand: s.demand,
      served: s.served,
      dropped: s.dropped,
      capacity: s.capacity,
      booting: s.booting,
      needle: s.needle,
      max: s.max,
      estimateMark: s.estimateMark,
      sizingMark: s.sizingMark,
      tick: s.tick,
      title: this.title?.text ?? '',
      readout: this.readout?.text ?? '',
      sub: this.sub?.text ?? '',
      strip: this.strip?.text ? this.strip.text : null,
      ticks: this.numbers.map((t) => t.text),
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    for (const o of [
      this.plate,
      this.dial,
      this.title,
      this.readout,
      this.sub,
      this.strip,
      this.roomTag,
      ...this.numbers,
    ])
      o?.destroy();
    this.plate = null;
    this.dial = null;
    this.title = null;
    this.readout = null;
    this.sub = null;
    this.strip = null;
    this.roomTag = null;
    this.numbers = [];
    this.made.objects = 0;
    this.made.texts = 0;
  }
}
