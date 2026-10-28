// The Live screen's sections of the read-only test hook: `live` (the zones on the page, the
// placeholders left, the layout version) and `perf` (what is on the display lists and the frame
// rate). Mirrors for tests; no view reads them. The builders are pure so they are unit-tested in
// node; the HUD scene feeds them the canvas rect and its views.

import { type CanvasRect, LAYOUT_VERSION, type Rect, ZONES, ZONE_IDS, type ZoneId, pageRect } from './layout';
import type { LiveView } from './view';
import { placeholderZones } from './registry';

export interface LiveTestState {
  /** src/scenes/live/layout.ts LAYOUT_VERSION, so a spec can tell a moved zone from a regression. */
  layoutVersion: number;
  /** Every zone's rect in page CSS pixels: pageRect(ZONES[zone], canvas). */
  zones: Record<ZoneId, Rect>;
  /** The registry zones still drawn by a PlaceholderView, in registry order. */
  placeholders: ZoneId[];
}

export interface PerfTestState {
  /** Objects on the board scene's and the HUD scene's display lists. */
  objects: { board: number; hud: number };
  /** Text objects on both lists together, and Graphics objects likewise. */
  texts: number;
  graphics: number;
  fps: { avg: number };
  /** The lite flag (reduced effects), true under ?test. */
  lite: boolean;
}

declare module '../../testHook' {
  interface TestSections {
    live: LiveTestState;
    perf: PerfTestState;
  }
}

/** The `live` section for a canvas rect and the HUD's views. */
export function liveTestState(canvas: CanvasRect, views: readonly LiveView[]): LiveTestState {
  const zones = {} as Record<ZoneId, Rect>;
  for (const id of ZONE_IDS) zones[id] = pageRect(ZONES[id], canvas);
  return { layoutVersion: LAYOUT_VERSION, zones, placeholders: placeholderZones(views) };
}

/** The least a display object needs to be counted: Phaser game objects carry their kind in `type`. */
export interface CountedObject {
  readonly type: string;
}

/** Objects on a display list by kind: every object, the texts and the graphics. */
export interface DisplayCount {
  objects: number;
  texts: number;
  graphics: number;
}

export function countDisplayList(list: readonly CountedObject[]): DisplayCount {
  let texts = 0;
  let graphics = 0;
  for (const o of list) {
    if (o.type === 'Text') texts++;
    else if (o.type === 'Graphics') graphics++;
  }
  return { objects: list.length, texts, graphics };
}

/** The `perf` section from both scenes' display lists, the frame rate and the flags. */
export function perfTestState(
  board: readonly CountedObject[],
  hud: readonly CountedObject[],
  fpsAvg: number,
  lite: boolean,
): PerfTestState {
  const b = countDisplayList(board);
  const h = countDisplayList(hud);
  return {
    objects: { board: b.objects, hud: h.objects },
    texts: b.texts + h.texts,
    graphics: b.graphics + h.graphics,
    fps: { avg: Number.isFinite(fpsAvg) ? Math.round(fpsAvg * 10) / 10 : 0 },
    lite,
  };
}
