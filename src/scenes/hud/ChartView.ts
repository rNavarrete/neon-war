// The scope (ZONES.scope) as a Live screen view: LAST 60 s on a 354 x 145 plot with two absolute
// lines, never a difference graph: the amber line is what is coming, the cyan line the room the
// wired boxes have; where every live box could serve more than the wired ones (a box racked but not
// fed, the C3 lesson) that larger room shows as a dotted cyan line. The white dashed line is the C1
// guess, the magenta dashed line the C6 sizing x 60. Right of the playhead, the last 10 s of the
// plot are the forecast region: dim, with the coming curve drawn ahead, exactly while the sim
// forecasts a rise (forecastAt). One Graphics redrawn every frame from preallocated rings; words
// change only when their rounded numbers do. hud.chart mirrors it for tests.
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Frame } from '../../game/frame';
import { demandAt } from '../../sim/demand';
import { BROWNOUT } from '../../sim/brownout';
import type { LiveBudget, LiveHost, LiveView } from '../live/view';
import {
  ChartRing,
  FORECAST_STEP_SECONDS,
  SCOPE_AHEAD_SECONDS,
  SCOPE_PAST_SECONDS,
  type ScopeForecast,
  type ScopeLayout,
  scopeCeiling,
  scopeForecastInto,
  scopeLayout,
  scopeX,
  scopeY,
} from './chartRing';
import { LABELS } from './labels';
import { COLORS, FONT } from './layout';
import { provideHudSection } from './hook';
import { register as registerLocate } from './locate';
import { KIT } from './kit';
import {
  type BakedPanel,
  GAUGES_DEPTH,
  type PanelTestState,
  bakePanel,
  panelSnapshot,
  releasePanel,
} from './panel';
import { preloadArt } from '../plates';

const DASH = 10;
const GAP = 7;
/** Racked-but-unfed room counts as different from the wired room above half a call a second. */
const RACKED_FROM = 0.5;
const ESTIMATE_COLOR = 0xffffff;
/** The label tab under the title and the bracket corners (kit.ts), sized for the scope's 13 px words. */
const TAB_H = 20;
const SCOPE_CORNERS = 26;

/** The scope's plate as the HUD's bounds check reads it: shown or not, and its display bounds. */
export interface ScopePanel {
  readonly visible: boolean;
  getBounds(): { x: number; y: number; width: number; height: number };
}

/** What the hook mirrors as hud.chart: the legacy fields (hud.spec) plus the scope's own. */
export interface ScopeTestState {
  /** The last values plotted: demand, and the room every live box has (wired or not). */
  demand: number;
  capacity: number;
  /** The y axis's top. */
  ceiling: number;
  /** The white dashed guess: notes.estimate once SET. */
  estimateLine: number | null;
  /** The last wired room plotted: the solid cyan line. */
  wiredCapacity: number;
  /** The magenta dashed line: notes.sizing x 60 once SET. */
  sizingLine: number | null;
  /** The dotted racked line shows now (some live box is not fed). */
  racked: boolean;
  /** The forecast region, while the sim forecasts a rise; null otherwise. */
  forecast: ScopeForecast | null;
  /** Sim time the scope last drew. */
  now: number;
  /** The plot's size in game pixels. */
  plot: { w: number; h: number };
  /** The words on screen. */
  title: string;
  legend: string;
  /** The baked plate: which picked kit pieces it draws, at what largest scale (m4 panel kit). */
  panel?: PanelTestState | null;
}

export class ChartView implements LiveView {
  readonly zone = 'scope' as const;
  /** The painted frame, the plot's Graphics, and title, ceiling, legend, racked note and 'ahead'. */
  readonly budget: LiveBudget = { objects: 7, texts: 5 };
  readonly made = { objects: 0, texts: 0 };
  /** Demand and the room of every live box. */
  readonly ring = new ChartRing(SCOPE_PAST_SECONDS, 0.25);
  /** The wired room, in the ring's demand slot. */
  readonly wired = new ChartRing(SCOPE_PAST_SECONDS, 0.25);
  /** The baked plate (fill, frame kit), the size of the scope zone; null before create. */
  private frame: BakedPanel | null = null;
  private bounds: ScopePanel | null = null;
  private g: Phaser.GameObjects.Graphics | null = null;
  private title: Phaser.GameObjects.Text | null = null;
  private topLabel: Phaser.GameObjects.Text | null = null;
  private legend: Phaser.GameObjects.Text | null = null;
  private rackedNote: Phaser.GameObjects.Text | null = null;
  private ahead: Phaser.GameObjects.Text | null = null;
  private layout: ScopeLayout = scopeLayout({ x: 0, y: 0, w: 0, h: 0 });
  private off: (() => void)[] = [];
  private readonly forecastState: ScopeForecast = { startsAt: 0, demand: 0, peak: 0 };
  private forecast: ScopeForecast | null = null;
  private estimate: number | null = null;
  private sizing: number | null = null;
  private racked = false;
  private shownDemand = -1;
  private shownWired = -1;
  private shownTop = -1;
  private shownRacked: boolean | null = null;
  private shownAhead: boolean | null = null;
  /** The y-axis top used for the last frame. */
  ceiling = 60;
  private now = 0;

  /** The plate (the scope zone's bounds, for the restage hook). */
  get panel(): ScopePanel {
    if (!this.bounds) throw new Error('ChartView: panel read before create');
    return this.bounds;
  }

  /** The plate, or null while the view is not built (before create, after shutdown). */
  get builtPanel(): ScopePanel | null {
    return this.bounds;
  }

  preload(scene: Phaser.Scene): void {
    preloadArt(scene as never, [KIT.frame, KIT.corner, KIT.tab]);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    const r = host.rect;
    const L = scopeLayout(r);
    this.layout = L;
    const add = scene.add;
    // The plate, baked once: a dark fill, the frame kit round the zone, the tab under the title.
    const frame = bakePanel(
      scene,
      'scope',
      r,
      { frame: true, corners: SCOPE_CORNERS, tab: { x: L.title.x - 8, y: r.y, h: TAB_H } },
      { fill: { color: COLORS.ink, alpha: 0.92 } },
    );
    this.frame = frame;
    const box = { x: r.x, y: r.y, width: r.w, height: r.h };
    this.bounds = {
      get visible() {
        return frame.object.visible;
      },
      getBounds: () => box,
    };
    this.g = add.graphics();
    const text = (x: number, y: number, s: string, color: string): Phaser.GameObjects.Text =>
      add.text(x, y, s, { fontFamily: FONT, fontSize: '13px', color });
    this.title = text(L.title.x, L.title.y, LABELS.scope.title, COLORS.dim);
    this.topLabel = text(L.top.right, L.top.y, '', COLORS.dim).setOrigin(1, 0);
    this.legend = text(L.legend.x, L.legend.y, '', COLORS.white);
    this.rackedNote = text(L.racked.right, L.racked.y, LABELS.scope.racked, COLORS.cyanText).setOrigin(1, 0);
    this.rackedNote.setVisible(false);
    this.ahead = text(L.plot.right - 4, L.plot.top + 2, LABELS.scope.ahead, COLORS.amberText).setOrigin(1, 0);
    this.ahead.setVisible(false);
    const all = [frame.object, this.g, this.title, this.topLabel, this.legend, this.rackedNote, this.ahead];
    for (const o of all) o.setDepth(GAUGES_DEPTH);
    this.made.objects = all.length;
    this.made.texts = 5;

    this.ring.clear();
    this.wired.clear();
    this.forecast = null;
    this.shownDemand = -1;
    this.shownWired = -1;
    this.shownTop = -1;
    this.shownRacked = null;
    this.shownAhead = null;
    this.off.push(provideHudSection('chart', () => this.snapshot()));
    // The leader line ends at the plot's middle (game px, made once).
    const mid = { x: (L.plot.left + L.plot.right) / 2, y: (L.plot.top + L.plot.bottom) / 2 };
    this.off.push(registerLocate('scope', () => mid));
  }

  update(frame: Frame): void {
    const now = frame.now;
    // A rewind or a new run takes the clock back: both rings start over (push clears each).
    this.ring.push(now, frame.demand, frame.capacity);
    this.wired.push(now, frame.wiredCapacity, 0);
    this.now = now;
    this.estimate = frame.notes.estimate;
    this.sizing = frame.notes.sizing !== null ? frame.notes.sizing * BROWNOUT.server.capacity : null;
    this.forecast = scopeForecastInto(this.forecastState, now);
    this.racked = frame.capacity - frame.wiredCapacity > RACKED_FROM;
    this.ceiling = scopeCeiling(
      Math.max(this.ring.max(), this.estimate ?? 0, this.sizing ?? 0, this.forecast?.peak ?? 0),
    );
    this.draw();
    this.updateWords(frame.demand, frame.wiredCapacity);
  }

  private draw(): void {
    const g = this.g;
    if (!g) return;
    const L = this.layout;
    const { left, right, top, bottom } = L.plot;
    const h = bottom - top;
    g.clear();

    // The forecast region: dim right of the playhead while a rise is coming, the curve drawn ahead.
    if (this.forecast) {
      g.fillStyle(COLORS.amber, 0.16);
      g.fillRect(L.playhead, top, right - L.playhead, h);
      g.lineStyle(2, COLORS.amber, 0.5);
      g.beginPath();
      for (let t = 0; t <= SCOPE_AHEAD_SECONDS + 1e-9; t += FORECAST_STEP_SECONDS) {
        const x = scopeX(L, this.now + t, this.now);
        const y = scopeY(L, demandAt(this.now + t), this.ceiling);
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }

    g.lineStyle(1, COLORS.cyan, 0.15);
    for (let i = 1; i <= 4; i++) g.lineBetween(left, bottom - (h * i) / 4, right, bottom - (h * i) / 4);
    g.lineStyle(1, COLORS.cyan, 0.4);
    g.lineBetween(left, bottom, right, bottom);
    g.lineStyle(1, COLORS.cyan, 0.3);
    g.lineBetween(L.playhead, top, L.playhead, bottom);

    this.drawRacked(g);
    this.drawLine(g, this.wired, COLORS.cyan, 2);
    this.drawLine(g, this.ring, COLORS.amber, 3);

    if (this.estimate !== null) this.dashed(g, scopeY(L, this.estimate, this.ceiling), ESTIMATE_COLOR, 0.85);
    if (this.sizing !== null) this.dashed(g, scopeY(L, this.sizing, this.ceiling), COLORS.magenta, 0.9);
  }

  /** One absolute series (demand from `ring`, or the wired room from `wired`), oldest first. */
  private drawLine(g: Phaser.GameObjects.Graphics, ring: ChartRing, color: number, width: number): void {
    if (ring.count === 0) return;
    const L = this.layout;
    g.lineStyle(width, color, 1);
    g.beginPath();
    let started = false;
    for (let i = 0; i < ring.count; i++) {
      const x = scopeX(L, ring.timeAt(i), this.now);
      if (x < L.plot.left) continue;
      const y = scopeY(L, ring.demandAt(i), this.ceiling);
      if (started) g.lineTo(x, y);
      else {
        g.moveTo(x, y);
        started = true;
      }
    }
    g.strokePath();
  }

  /** The room of every live box as dots, only where it is more than the wired room. */
  private drawRacked(g: Phaser.GameObjects.Graphics): void {
    const ring = this.ring;
    const wired = this.wired;
    if (ring.count === 0 || ring.count !== wired.count) return;
    const L = this.layout;
    g.fillStyle(COLORS.cyan, 0.8);
    for (let i = 0; i < ring.count; i += 3) {
      const all = ring.capacityAt(i);
      if (all - wired.demandAt(i) <= RACKED_FROM) continue;
      const x = scopeX(L, ring.timeAt(i), this.now);
      if (x < L.plot.left) continue;
      g.fillRect(x - 1, scopeY(L, all, this.ceiling) - 1, 2, 2);
    }
  }

  private dashed(g: Phaser.GameObjects.Graphics, y: number, color: number, alpha: number): void {
    const { left, right } = this.layout.plot;
    g.lineStyle(2, color, alpha);
    for (let x = left; x < right; x += DASH + GAP) g.lineBetween(x, y, Math.min(x + DASH, right), y);
  }

  private updateWords(demand: number, wired: number): void {
    if (!this.legend || !this.topLabel || !this.rackedNote || !this.ahead) return;
    const d = Math.round(demand);
    const w = Math.round(wired);
    if (d !== this.shownDemand || w !== this.shownWired) {
      this.shownDemand = d;
      this.shownWired = w;
      this.legend.setText(`${LABELS.scope.coming} ${d}/s   ${LABELS.scope.room} ${w}/s`);
    }
    if (this.ceiling !== this.shownTop) {
      this.shownTop = this.ceiling;
      this.topLabel.setText(`${this.ceiling}/s`);
    }
    if (this.racked !== this.shownRacked) {
      this.shownRacked = this.racked;
      this.rackedNote.setVisible(this.racked);
    }
    const ahead = this.forecast !== null;
    if (ahead !== this.shownAhead) {
      this.shownAhead = ahead;
      this.ahead.setVisible(ahead);
    }
  }

  /** hud.chart, built only when the hook is read. */
  snapshot(): ScopeTestState {
    const p = this.layout.plot;
    const f = this.forecast;
    return {
      demand: this.ring.lastDemand,
      capacity: this.ring.lastCapacity,
      ceiling: this.ceiling,
      estimateLine: this.estimate,
      wiredCapacity: this.wired.lastDemand,
      sizingLine: this.sizing,
      racked: this.racked,
      forecast: f ? { startsAt: f.startsAt, demand: f.demand, peak: f.peak } : null,
      now: this.now,
      plot: { w: p.right - p.left, h: p.bottom - p.top },
      title: this.title?.text ?? '',
      legend: this.legend?.text ?? '',
      panel: panelSnapshot(this.frame),
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    releasePanel(this.frame);
    for (const o of [this.g, this.title, this.topLabel, this.legend, this.rackedNote, this.ahead])
      o?.destroy();
    this.frame = null;
    this.bounds = null;
    this.g = null;
    this.title = null;
    this.topLabel = null;
    this.legend = null;
    this.rackedNote = null;
    this.ahead = null;
    this.made.objects = 0;
    this.made.texts = 0;
  }
}

/** The scope view among the registry's views (the HUD scene's hud.chart and restage read it). */
export function scopeViewOf(views: readonly LiveView[]): ChartView {
  for (const v of views) if (v instanceof ChartView) return v;
  throw new Error('the registry has no scope view');
}
