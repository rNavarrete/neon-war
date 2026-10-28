// What a view on the Live screen is: one lane's drawing of one zone, hosted by the HUD scene. The
// host creates every registered view (src/scenes/live/registry.ts), hands each its zone's rect, the
// bus and the flags, calls update once a frame with the shared Frame, the HUD clock and this frame's
// occurrences, and shuts them down with the scene. Views draw only inside their rect (docs/LIVE.md)
// and never read window.__neonTest: the hook mirrors them for tests, not the other way round.
//
// PlaceholderView stands in for every zone no lane has built yet: a dashed rect with the zone's
// name, under everything the HUD draws today. Phaser is a type here only, so the view's counting
// and geometry are unit-tested in node against a stub scene.

import type Phaser from 'phaser';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import type { Occurrence } from '../../game/occurrences';
import { COLORS, FONT } from '../hud/layout';
import type { LiveFlags } from './flags';
import type { Rect, ZoneId } from './layout';

/** The HUD clock: real seconds times the test speed, stopped while the board is held; `dt` is this frame's step. */
export interface LiveClock {
  readonly now: number;
  readonly dt: number;
}

/** How many display objects (and how many of them texts) a view may keep, for the perf budget. */
export interface LiveBudget {
  objects: number;
  texts: number;
}

/** What the HUD scene gives a view at create: the scene, the bus, the zone's rect and the flags. */
export interface LiveHost {
  readonly scene: Phaser.Scene;
  readonly bus: Bus;
  /** The view's zone, in game pixels; the only geometry it draws from. */
  readonly rect: Rect;
  /** The Live flags, read live (a getter on the host). */
  readonly flags: LiveFlags;
}

export interface LiveView {
  readonly zone: ZoneId;
  readonly budget: LiveBudget;
  /** Queue the view's art; called in the scene's preload. */
  preload?(scene: Phaser.Scene): void;
  /** Build the view's objects; called once in the scene's create. */
  create(scene: Phaser.Scene, host: LiveHost): void;
  /** Bring the view in line with this frame of the run. Called every frame; nothing here may allocate. */
  update(frame: Frame, clock: LiveClock, occurrences: readonly Occurrence[]): void;
  /** Destroy what create made; called when the scene shuts down. */
  shutdown(): void;
}

/** Below every object the HUD draws today (they sit at the default depth 0). */
export const PLACEHOLDER_DEPTH = -10;

/** The dash and gap of a placeholder's outline, in game pixels. */
export const PLACEHOLDER_DASH = { dash: 8, gap: 6 } as const;

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * The dashes of a rect's outline, clockwise from its top-left corner, each a full `dash` long
 * except the last on each edge, which is cut to the corner. Pure; computed once at create.
 */
export function dashedOutline(r: Rect, dash: number, gap: number): Segment[] {
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  const out: Segment[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const ux = Math.sign(b.x - a.x);
    const uy = Math.sign(b.y - a.y);
    for (let s = 0; s < len; s += dash + gap) {
      const e = Math.min(len, s + dash);
      out.push({ x1: a.x + ux * s, y1: a.y + uy * s, x2: a.x + ux * e, y2: a.y + uy * e });
    }
  }
  return out;
}

/** The objects a view has made, to count against its budget. */
export interface MadeCount {
  objects: number;
  texts: number;
}

/** Whether what a view made fits its declared budget. */
export function withinBudget(view: { budget: LiveBudget; made: MadeCount }): boolean {
  return view.made.objects <= view.budget.objects && view.made.texts <= view.budget.texts;
}

/** The scene calls a placeholder needs, so a node test can hand it a stub. */
type PlaceholderScene = {
  add: {
    graphics(): Phaser.GameObjects.Graphics;
    text(
      x: number,
      y: number,
      text: string,
      style: Phaser.Types.GameObjects.Text.TextStyle,
    ): Phaser.GameObjects.Text;
  };
};

/**
 * A zone no lane has drawn yet: its outline dashed in dim cyan and its name in small text, top-left.
 * Not interactive, under every existing HUD object, and the same in lite and in play (there is no
 * effect to drop). Two objects, one of them a text.
 */
export class PlaceholderView implements LiveView {
  readonly budget: LiveBudget = { objects: 2, texts: 1 };
  readonly made: MadeCount = { objects: 0, texts: 0 };
  private outline: Phaser.GameObjects.Graphics | null = null;
  private label: Phaser.GameObjects.Text | null = null;

  constructor(readonly zone: ZoneId) {}

  create(scene: Phaser.Scene, host: LiveHost): void {
    const r = host.rect;
    const add = (scene as PlaceholderScene).add;
    const g = add.graphics();
    g.setDepth(PLACEHOLDER_DEPTH);
    g.lineStyle(1, COLORS.cyan, 0.45);
    g.beginPath();
    // Half a pixel in, so the one-pixel line sits on whole pixels and stays crisp.
    for (const s of dashedOutline(
      { x: r.x + 0.5, y: r.y + 0.5, w: r.w - 1, h: r.h - 1 },
      PLACEHOLDER_DASH.dash,
      PLACEHOLDER_DASH.gap,
    )) {
      g.moveTo(s.x1, s.y1);
      g.lineTo(s.x2, s.y2);
    }
    g.strokePath();
    this.outline = g;
    this.made.objects++;

    const label = add.text(r.x + 8, r.y + 6, this.zone.toUpperCase(), {
      fontFamily: FONT,
      fontSize: '14px',
      color: COLORS.dim,
    });
    label.setDepth(PLACEHOLDER_DEPTH);
    label.setAlpha(0.8);
    this.label = label;
    this.made.objects++;
    this.made.texts++;
  }

  update(): void {
    // Nothing moves on a placeholder.
  }

  shutdown(): void {
    this.outline?.destroy();
    this.label?.destroy();
    this.outline = null;
    this.label = null;
    this.made.objects = 0;
    this.made.texts = 0;
  }
}
