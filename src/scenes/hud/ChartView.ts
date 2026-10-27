// The demand-versus-capacity chart: the board's main readout. One Graphics redrawn every frame from
// the preallocated ring buffer; labels change only when their rounded numbers do.

import Phaser from 'phaser';
import { panel } from './panel';
import { ChartRing } from './chartRing';
import { chartCeiling } from './format';
import { COLORS, FONT, RIGHT } from './layout';

const WINDOW_SECONDS = 60;
const DASH = 10;
const GAP = 7;
const PLOT = {
  left: RIGHT.chart.x + RIGHT.chart.inset,
  right: RIGHT.chart.x + RIGHT.chart.w - RIGHT.chart.inset,
  top: RIGHT.chart.y + 36,
  bottom: RIGHT.chart.y + RIGHT.chart.h - 40,
};

export class ChartView {
  readonly ring = new ChartRing(WINDOW_SECONDS, 0.25);
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly legend: Phaser.GameObjects.Text;
  private readonly topLabel: Phaser.GameObjects.Text;
  private shownDemand = -1;
  private shownCapacity = -1;
  private shownTop = -1;
  /** The y-axis top used for the last frame. */
  ceiling = 60;
  private now = 0;

  constructor(scene: Phaser.Scene) {
    const c = RIGHT.chart;
    panel(scene, 'hud:chart-window', c.x, c.y, c.w, c.h, { k: 0.4 });
    this.g = scene.add.graphics();
    this.topLabel = scene.add.text(c.x + c.inset, c.y + 12, '', {
      fontFamily: FONT,
      fontSize: '14px',
      color: COLORS.dim,
    });
    this.legend = scene.add.text(c.x + c.inset, c.y + c.h - 30, '', {
      fontFamily: FONT,
      fontSize: '15px',
      color: COLORS.white,
    });
  }

  /** Feed this frame's numbers and redraw. `estimate` and `sizedCapacity` draw as dashed lines. */
  update(
    now: number,
    demand: number,
    capacity: number,
    estimate: number | null,
    sizedCapacity: number | null,
  ): void {
    const ring = this.ring;
    ring.push(now, demand, capacity);
    this.now = now;
    this.ceiling = chartCeiling(Math.max(ring.max(), estimate ?? 0, sizedCapacity ?? 0));
    const { left, right, bottom } = PLOT;
    const h = bottom - PLOT.top;

    const g = this.g;
    g.clear();
    g.lineStyle(1, COLORS.cyan, 0.15);
    for (let i = 1; i <= 4; i++) g.lineBetween(left, bottom - (h * i) / 4, right, bottom - (h * i) / 4);
    g.lineStyle(1, COLORS.cyan, 0.4);
    g.lineBetween(left, bottom, right, bottom);

    this.drawSeries(g, false);
    this.drawSeries(g, true);

    if (estimate !== null) this.dashed(g, left, right, this.yOf(estimate), 0xffffff, 0.85);
    if (sizedCapacity !== null) this.dashed(g, left, right, this.yOf(sizedCapacity), COLORS.magenta, 0.9);

    const d = Math.round(demand);
    const cap = Math.round(capacity);
    if (d !== this.shownDemand || cap !== this.shownCapacity) {
      this.shownDemand = d;
      this.shownCapacity = cap;
      this.legend.setText(`demand ${d}/s   room ${cap}/s`);
    }
    if (this.ceiling !== this.shownTop) {
      this.shownTop = this.ceiling;
      this.topLabel.setText(`REQ/S  ${this.ceiling}`);
    }
  }

  private xOf(t: number): number {
    return PLOT.right - ((this.now - t) / WINDOW_SECONDS) * (PLOT.right - PLOT.left);
  }

  private yOf(v: number): number {
    return PLOT.bottom - (Math.min(v, this.ceiling) / this.ceiling) * (PLOT.bottom - PLOT.top);
  }

  private drawSeries(g: Phaser.GameObjects.Graphics, demand: boolean): void {
    const ring = this.ring;
    if (ring.count === 0) return;
    g.lineStyle(demand ? 3 : 2, demand ? COLORS.amber : COLORS.cyan, 1);
    g.beginPath();
    let started = false;
    for (let i = 0; i < ring.count; i++) {
      const x = this.xOf(ring.timeAt(i));
      if (x < PLOT.left) continue;
      const y = this.yOf(demand ? ring.demandAt(i) : ring.capacityAt(i));
      if (started) g.lineTo(x, y);
      else {
        g.moveTo(x, y);
        started = true;
      }
    }
    g.strokePath();
  }

  private dashed(
    g: Phaser.GameObjects.Graphics,
    x0: number,
    x1: number,
    y: number,
    color: number,
    alpha: number,
  ): void {
    g.lineStyle(2, color, alpha);
    for (let x = x0; x < x1; x += DASH + GAP) g.lineBetween(x, y, Math.min(x + DASH, x1), y);
  }
}
