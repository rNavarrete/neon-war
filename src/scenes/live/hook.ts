// The Live screen's sections of the read-only test hook: `live` (the zones on the page, the
// placeholders left, the layout version) and `perf` (what is on the display lists, per zone, the
// pools and the frame rate). Mirrors for tests; no view reads them. The builders are pure so they
// are unit-tested in node; the HUD scene feeds them the canvas rect, its views and its display
// lists. The perf numbers are measured by PerfMeter from display-list walks once a second
// (tech-7); the per-zone budgets are in docs/LIVE.md.

import { type CanvasRect, LAYOUT_VERSION, type Rect, ZONES, ZONE_IDS, type ZoneId, pageRect } from './layout';
import type { LiveBudget, LiveView } from './view';
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
  /** Objects on the board scene's and the HUD scene's display lists, containers walked into. */
  objects: { board: number; hud: number };
  /** Text objects on both lists together, and Graphics objects likewise. */
  texts: number;
  graphics: number;
  fps: { avg: number };
  /** The lite flag (reduced effects), true under ?test. */
  lite: boolean;
}

/** One registered view's declared budget and what it has on the display list now. */
export interface ZonePerf {
  budget: LiveBudget;
  actual: { objects: number; texts: number };
}

/** The measured `perf` section (PerfMeter): the counts above, and per zone, pools, filters, frame time. */
export interface PerfSection extends PerfTestState {
  /** Text objects on each scene's list (they add up to `texts`). */
  textsBy: { board: number; hud: number };
  /**
   * What the renderer draws now across both scenes: visible objects inside visible containers, and
   * the texts among them. `objects` and `texts` above count hidden ones too (cards not up, the log).
   */
  drawn: { objects: number; texts: number };
  /** The HUD's objects no registered view made: the host's own pieces (cards, dial, chat column). */
  host: { objects: number; texts: number };
  /** Every registered view by zone: its declared budget and what it has on the list now. */
  zones: Partial<Record<ZoneId, ZonePerf>>;
  /** Each registered pool's size (registerPool), e.g. `packets`: sprites made, in use or not. */
  pools: Record<string, number>;
  /** Live Glow and GradientMap filters on both scenes' objects and cameras. */
  filters: number;
  /** Mean real milliseconds per frame since the sample before. */
  frameMs: number;
  /** Samples taken so far (one a second, the first when the HUD is built). */
  samples: number;
  /** The sim's now when the last sample was taken (a story scene holds the HUD, and the samples). */
  at: number;
}

declare module '../../testHook' {
  interface TestSections {
    live: LiveTestState;
    perf: PerfSection;
  }
}

/** The `live` section for a canvas rect and the HUD's views. */
export function liveTestState(canvas: CanvasRect, views: readonly LiveView[]): LiveTestState {
  const zones = {} as Record<ZoneId, Rect>;
  for (const id of ZONE_IDS) zones[id] = pageRect(ZONES[id], canvas);
  return { layoutVersion: LAYOUT_VERSION, zones, placeholders: placeholderZones(views) };
}

/** A filter controller as Phaser 4 keeps it: the render node it uses and whether it is on. */
export interface FilterLike {
  readonly active: boolean;
  readonly renderNode: string | null;
}

/** Something that can carry filters: a game object or a camera (`filters.internal` / `.external`). */
export interface Filtered {
  readonly filters?: {
    readonly internal: { readonly list: readonly FilterLike[] };
    readonly external: { readonly list: readonly FilterLike[] };
  } | null;
}

/**
 * The least a display object needs to be counted: Phaser game objects carry their kind in `type`;
 * containers and layers hold their children in `list`, off the scene's display list.
 */
export interface CountedObject extends Filtered {
  readonly type: string;
  readonly list?: readonly CountedObject[];
  /** Phaser's visible flag; missing counts as shown. */
  readonly visible?: boolean;
}

/** Objects on a display list by kind: every object, the texts and the graphics. */
export interface DisplayCount {
  objects: number;
  texts: number;
  graphics: number;
}

/** Count a display list by kind, walking into containers. */
export function countDisplayList(list: readonly CountedObject[]): DisplayCount {
  const out: DisplayCount = { objects: 0, texts: 0, graphics: 0 };
  const walk = (objs: readonly CountedObject[]): void => {
    for (const o of objs) {
      out.objects++;
      if (o.type === 'Text') out.texts++;
      else if (o.type === 'Graphics') out.graphics++;
      if (o.list) walk(o.list);
    }
  };
  walk(list);
  return out;
}

/** The `perf` counts from both scenes' display lists, the frame rate and the flags. */
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

// ---- the perf meter (tech-7) ----

/** The filters the perf hook counts (art3d-6's probe): Glow and GradientMap. */
export const COUNTED_FILTERS: readonly string[] = ['FilterGlow', 'FilterGradientMap'];

/** Live counted filters on one object or camera. */
export function countFilters(o: Filtered): number {
  const f = o.filters;
  if (!f) return 0;
  let n = 0;
  for (const c of f.internal.list)
    if (c.active && c.renderNode && COUNTED_FILTERS.includes(c.renderNode)) n++;
  for (const c of f.external.list)
    if (c.active && c.renderNode && COUNTED_FILTERS.includes(c.renderNode)) n++;
  return n;
}

/** How often the meter walks the lists, in real milliseconds. */
export const PERF_SAMPLE_MS = 1000;

const pools = new Map<string, () => number>();

/**
 * Report a pool's size to the perf hook under `name` (the board's packet sprites as `packets`).
 * Returns the remover, for the scene's shutdown. Read once a second by the meter, never by a view.
 */
export function registerPool(name: string, size: () => number): () => void {
  pools.set(name, size);
  return () => {
    if (pools.get(name) === size) pools.delete(name);
  };
}

/** A registered view as the meter sees it. */
export interface MeteredView {
  readonly zone: ZoneId;
  readonly budget: LiveBudget;
}

/** What one sample walks: both scenes' display lists and cameras, and which view made each HUD object. */
export interface PerfInput {
  /** The sim's now. */
  readonly now: number;
  readonly board: readonly CountedObject[];
  readonly hud: readonly CountedObject[];
  readonly cameras: readonly Filtered[];
  readonly views: readonly MeteredView[];
  /** The zone whose view made a HUD object, or undefined for the host's own (children inherit). */
  readonly ownerOf: (o: CountedObject) => ZoneId | undefined;
}

/** Running totals of one walk, one object reused. */
interface Tally {
  objects: number;
  texts: number;
  graphics: number;
  filters: number;
  drawnObjects: number;
  drawnTexts: number;
}

/**
 * The perf instrument. The HUD scene hands it each frame's real milliseconds (`frame`) and, once
 * a second (when `frame` returns true), a `sample` of both display lists. The section it fills is
 * one object, reused; the walk allocates nothing per object.
 */
export class PerfMeter {
  readonly state: PerfSection;
  private frames = 0;
  private ms = 0;
  private ownerOf: PerfInput['ownerOf'] = () => undefined;
  private owner: ZoneId | undefined = undefined;
  private attribute = false;
  private shown = true;
  private readonly tally: Tally = {
    objects: 0,
    texts: 0,
    graphics: 0,
    filters: 0,
    drawnObjects: 0,
    drawnTexts: 0,
  };

  constructor(lite: boolean) {
    this.state = {
      objects: { board: 0, hud: 0 },
      texts: 0,
      graphics: 0,
      fps: { avg: 0 },
      lite,
      textsBy: { board: 0, hud: 0 },
      drawn: { objects: 0, texts: 0 },
      host: { objects: 0, texts: 0 },
      zones: {},
      pools: {},
      filters: 0,
      frameMs: 0,
      samples: 0,
      at: 0,
    };
  }

  /** One frame of `deltaMs` real milliseconds; true when a sample is due. */
  frame(deltaMs: number): boolean {
    if (deltaMs > 0) {
      this.frames++;
      this.ms += deltaMs;
    }
    return this.ms >= PERF_SAMPLE_MS;
  }

  /** Walk the lists into `state`; the frame rate and frame time cover the frames since the last sample. */
  sample(input: PerfInput): PerfSection {
    const st = this.state;
    if (this.frames > 0) {
      st.fps.avg = Math.round((this.frames * 10000) / this.ms) / 10;
      st.frameMs = Math.round((this.ms / this.frames) * 100) / 100;
    }
    this.frames = 0;
    this.ms = 0;

    for (const v of input.views) {
      const z = (st.zones[v.zone] ??= { budget: { objects: 0, texts: 0 }, actual: { objects: 0, texts: 0 } });
      z.budget.objects = v.budget.objects;
      z.budget.texts = v.budget.texts;
      z.actual.objects = 0;
      z.actual.texts = 0;
    }
    st.host.objects = 0;
    st.host.texts = 0;

    this.ownerOf = input.ownerOf;
    const t = this.tally;
    this.walk(input.board, false);
    st.objects.board = t.objects;
    st.textsBy.board = t.texts;
    let graphics = t.graphics;
    let filters = t.filters;
    const drawnObjects = t.drawnObjects;
    const drawnTexts = t.drawnTexts;
    this.walk(input.hud, true);
    st.objects.hud = t.objects;
    st.textsBy.hud = t.texts;
    graphics += t.graphics;
    filters += t.filters;
    st.drawn.objects = drawnObjects + t.drawnObjects;
    st.drawn.texts = drawnTexts + t.drawnTexts;
    for (const c of input.cameras) filters += countFilters(c);
    this.ownerOf = () => undefined;

    st.texts = st.textsBy.board + st.textsBy.hud;
    st.graphics = graphics;
    st.filters = filters;

    for (const key of Object.keys(st.pools)) if (!pools.has(key)) delete st.pools[key];
    for (const [name, size] of pools) {
      let n: number;
      try {
        n = size();
      } catch {
        n = 0;
      }
      st.pools[name] = Number.isFinite(n) ? n : 0;
    }
    st.samples++;
    st.at = input.now;
    return st;
  }

  private walk(list: readonly CountedObject[], attribute: boolean): void {
    const t = this.tally;
    t.objects = 0;
    t.texts = 0;
    t.graphics = 0;
    t.filters = 0;
    t.drawnObjects = 0;
    t.drawnTexts = 0;
    this.attribute = attribute;
    for (let i = 0; i < list.length; i++) {
      this.owner = attribute ? this.ownerOf(list[i]) : undefined;
      this.shown = true;
      this.visit(list[i]);
    }
  }

  private visit(o: CountedObject): void {
    const t = this.tally;
    t.objects++;
    const text = o.type === 'Text' ? 1 : 0;
    t.texts += text;
    if (o.type === 'Graphics') t.graphics++;
    t.filters += countFilters(o);
    const outerShown = this.shown;
    this.shown = outerShown && o.visible !== false;
    if (this.shown) {
      t.drawnObjects++;
      t.drawnTexts += text;
    }
    if (this.attribute) {
      const z = this.owner !== undefined ? this.state.zones[this.owner] : undefined;
      const into = z ? z.actual : this.state.host;
      into.objects++;
      into.texts += text;
    }
    const children = o.list;
    if (children) {
      const outer = this.owner;
      for (let i = 0; i < children.length; i++) {
        if (this.attribute) this.owner = this.ownerOf(children[i]) ?? outer;
        this.visit(children[i]);
      }
      this.owner = outer;
    }
    this.shown = outerShown;
  }
}

/** The zones whose view has more on the list than its declared budget, in sample order. */
export function overBudget(section: Pick<PerfSection, 'zones'>): ZoneId[] {
  const out: ZoneId[] = [];
  for (const [zone, z] of Object.entries(section.zones) as [ZoneId, ZonePerf | undefined][]) {
    if (z && (z.actual.objects > z.budget.objects || z.actual.texts > z.budget.texts)) out.push(zone);
  }
  return out;
}
