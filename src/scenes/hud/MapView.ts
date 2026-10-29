// The CITY GRID map (ZONES.map) as a Live screen view: a base (the painted hud/city-grid plate once
// the owner picks it, a vector street grid until then), Lux's block with its window lights, four
// neighbour blocks that turn into red CUT OFF outlines in the raid, and pooled amber dots walking the
// three streets toward the block at the rate the block sends (before retries). The laundry floor goes
// grey once cut; at midnight every window turns warm and six sparkles fire once.
//
// Lights and outlines are redrawn only when mapState changes (mapDiff); the dots are one Graphics
// refilled each frame from a PacketPool that stops growing at steady demand. Rules and geometry are
// pure in cityMap.ts. Phaser is a type here only, so the registry and node tests can import this.

import type Phaser from 'phaser';
import type { Frame } from '../../game/frame';
import { settings } from '../../game/settings';
import { PacketPool, progress } from '../board/packets';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import { preloadArt, resolveArt } from '../plates';
import {
  FLOORS,
  type MapLayout,
  type MapPoint,
  type MapState,
  REDRAW_LIGHTS,
  REDRAW_OUTLINES,
  STREET_IDS,
  type StreetDots,
  type StreetId,
  WINDOWS_PER_FLOOR,
  copyMapState,
  emptyMapState,
  fillMapState,
  fillStreetDots,
  mapDiff,
  mapLayout,
  noStreetDots,
  pointAlong,
  poolRate,
  raidPulse,
  sparkleAlpha,
  streetSeconds,
  windowLook,
  windowRect,
} from './cityMap';
import { LABELS } from './labels';
import { COLORS, FONT } from './layout';
import { provideHudSection } from './hook';
import { KIT, KIT_FILE } from './kit';
import {
  type BakedPanel,
  GAUGES_DEPTH,
  type PanelTestState,
  bakePanel,
  panelSnapshot,
  releasePanel,
} from './panel';

/** The painted base (docs/ART-REQUESTS.md), drawn at half its 816 x 620 file; a vector grid without it. */
export const CITY_GRID_KEY = KIT.cityGrid;
/**
 * The lit painting (batch 5): the city with every window of Lux's block lit amber, at the same half
 * size. It fades in over the base when the block holds at midnight; without it, only the code
 * windows turn warm.
 */
export const CITY_GRID_LIT_KEY = KIT.cityGridLit;
/** How long the lit painting takes to fade in at a held midnight, in HUD seconds (instant when steady). */
export const LIT_FADE = 1.2;

/** What the hook mirrors as hud.map. */
export interface MapTestState {
  raid: boolean;
  neighboursCut: boolean;
  litFloors: number;
  laundryDark: boolean;
  midnight: boolean;
  /** The dot pool: slots made so far (never shrinks) and dots walking now. */
  dots: { pool: number; active: number };
  /** What the base is drawn from: the picked painting, or the vector grid while it is not loaded. */
  base: 'hud/city-grid' | 'vector';
  /** The CUT OFF words sit on the red tag chip (hud/live/tag-chip), shown with them. */
  chip: boolean;
  /**
   * The lit painting (hud/city-grid-lit) baked as a second plate over the base, or null when it is
   * not loaded; `alpha` is how far it has faded in (0 hidden, 1 at a held midnight).
   */
  lit: { key: 'hud/city-grid-lit'; alpha: number } | null;
  /** The baked plate: which picked kit pieces it draws, at what largest scale (m4 panel kit). */
  panel?: PanelTestState | null;
}

declare module './hook' {
  interface HudTestState {
    /** The CITY GRID map (gauges-7). */
    map?: MapTestState;
  }
}

/** How many times the lights and the outlines were drawn (for tests: only on a mapState change). */
export interface MapDraws {
  lights: number;
  outlines: number;
}

const WINDOW_COLOR = { lit: COLORS.amber, warm: 0xffd27a, grey: COLORS.unlit, off: 0x1a2236 } as const;
const WINDOW_ALPHA = { lit: 0.95, warm: 1, grey: 0.6, off: 0.6 } as const;
const BASE_FILL = 0x070c18;
const BLOCK_FILL = 0x0e1628;
const STREET_COLOR = 0x1b2a44;
const DOT_SIZE = 3;
/** The label tab under CITY GRID, the bracket corners and the CUT OFF chip's height (kit.ts). */
const TAB_H = 26;
const MAP_CORNERS = 30;
const CHIP_H = 26;

export class MapView implements LiveView {
  readonly zone = 'map' as const;
  readonly budget: LiveBudget = { objects: 10, texts: 3 };
  readonly draws: MapDraws = { lights: 0, outlines: 0 };
  /** The map's state as last drawn. */
  readonly state: MapState = emptyMapState();
  readonly pool = new PacketPool();

  private layout: MapLayout | null = null;
  private host: LiveHost | null = null;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private lights: Phaser.GameObjects.Graphics | null = null;
  private outlines: Phaser.GameObjects.Graphics | null = null;
  private dots: Phaser.GameObjects.Graphics | null = null;
  private sparkles: Phaser.GameObjects.Graphics | null = null;
  private cutOff: Phaser.GameObjects.Text | null = null;
  private chip: Phaser.GameObjects.Image | null = null;
  private plate: BakedPanel | null = null;
  /** The lit painting's plate, faded in over the base at a held midnight; null without the file. */
  private litPlate: BakedPanel | null = null;
  private litShown = -1;
  private base: MapTestState['base'] = 'vector';
  private off: (() => void)[] = [];

  /** This frame's state, refilled every update; compared with `state` to decide what to redraw. */
  private readonly next: MapState = emptyMapState();
  private drawn = false;
  private readonly streetDots: StreetDots = noStreetDots();
  /** The pool's rates by street, refilled every update (keys never change). */
  private readonly rates: Record<StreetId, number> = noStreetDots();
  private readonly streetTime: Record<string, number> = { north: 1, west: 1, district: 1 };
  private readonly travelOf = (street: string): number => this.streetTime[street] ?? 1;
  private readonly at: MapPoint = { x: 0, y: 0 };
  private lastNow = -Infinity;
  private dotsDrawn = 0;
  /** HUD time midnight struck (for the sparkles), or null. */
  private midnightAt: number | null = null;
  private sparkleShown = -1;
  private outlineAlpha = -1;

  preload(scene: Phaser.Scene): void {
    preloadArt(scene as never, [CITY_GRID_KEY, KIT.frame, KIT.corner, KIT.tab, KIT.chip, CITY_GRID_LIT_KEY]);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.host = host;
    const L = mapLayout(host.rect);
    this.layout = L;
    for (const s of L.streets) this.streetTime[s.id] = streetSeconds(s);
    const add = scene.add;

    // The base, baked once with the frame kit: the painting (or the vector grid without it), Lux's
    // block footprint, the frame, the tab under CITY GRID and the bracket corners.
    const art = resolveArt(CITY_GRID_KEY);
    const painted = !art.fallback && (scene.textures?.exists?.(art.texture) ?? false);
    this.base = painted ? CITY_GRID_KEY : 'vector';
    this.plate = bakePanel(
      scene,
      'map',
      L.plate,
      {
        base: painted ? CITY_GRID_KEY : undefined,
        frame: true,
        corners: MAP_CORNERS,
        tab: { x: L.title.x - 8, y: L.title.y - 4, h: TAB_H },
      },
      { fill: { color: BASE_FILL, alpha: 0.96 }, draw: (g) => this.drawBase(g, L, !painted) },
    );
    this.objects.push(this.plate.object);

    // The lit painting, baked once as its own plate with the same frame kit, hidden until a held
    // midnight fades it in over the base (one Image either way, so the fade costs nothing to draw).
    const litArt = resolveArt(CITY_GRID_LIT_KEY);
    const lit = painted && !litArt.fallback && (scene.textures?.exists?.(litArt.texture) ?? false);
    this.litPlate = lit
      ? bakePanel(
          scene,
          'map-lit',
          L.plate,
          {
            base: CITY_GRID_LIT_KEY,
            frame: true,
            corners: MAP_CORNERS,
            tab: { x: L.title.x - 8, y: L.title.y - 4, h: TAB_H },
          },
          { fill: { color: BASE_FILL, alpha: 0.96 }, draw: (g) => this.drawBase(g, L, false, true) },
        )
      : null;
    if (this.litPlate) {
      this.litPlate.object.setAlpha(0).setVisible(false);
      this.objects.push(this.litPlate.object);
    }
    this.litShown = 0;

    this.outlines = add.graphics();
    this.lights = add.graphics();
    this.dots = add.graphics();
    this.sparkles = add.graphics();
    this.sparkles.setVisible(false);
    const title = add.text(L.title.x, L.title.y, LABELS.map.title, {
      fontFamily: FONT,
      fontSize: '16px',
      color: COLORS.cyanText,
    });
    title.setAlpha(0.85);
    const lux = add.text(L.luxLabel.x, L.luxLabel.y, LABELS.map.lux, {
      fontFamily: FONT,
      fontSize: '16px',
      color: COLORS.amberText,
    });
    // The CUT OFF words on the red tag chip (the chip carries the red; the words are white on it).
    const chipArt = resolveArt(KIT.chip);
    if (!chipArt.fallback && scene.textures?.exists?.(chipArt.texture) && typeof add.image === 'function') {
      const f = KIT_FILE[KIT.chip];
      const w = Math.round((f.w * CHIP_H) / f.h);
      this.chip = add
        .image(L.cutOffLabel.x - 20, L.cutOffLabel.y + 8, chipArt.texture)
        .setOrigin(0, 0.5)
        .setDisplaySize(w, CHIP_H)
        .setVisible(false);
      this.objects.push(this.chip);
    }
    this.cutOff = add.text(L.cutOffLabel.x, L.cutOffLabel.y, LABELS.map.cutOff, {
      fontFamily: FONT,
      fontSize: '13px',
      color: this.chip ? COLORS.white : COLORS.redText,
    });
    this.cutOff.setVisible(false);
    this.objects.push(this.outlines, this.lights, this.dots, this.sparkles, title, lux, this.cutOff);
    for (const o of this.objects) (o as unknown as { setDepth(d: number): unknown }).setDepth(GAUGES_DEPTH);

    this.pool.clear();
    copyMapState(this.state, emptyMapState());
    this.drawn = false;
    this.lastNow = -Infinity;
    this.dotsDrawn = 0;
    this.midnightAt = null;
    this.sparkleShown = -1;
    this.outlineAlpha = -1;
    this.off.push(provideHudSection('map', () => this.snapshot()));
  }

  /** Bring the map in line with this frame. Allocates nothing. */
  update(frame: Frame, clock: LiveClock): void {
    const L = this.layout;
    if (!L || !this.lights || !this.outlines || !this.dots) return;

    // A rewind (now went backwards) or a new run: the dots start over.
    if (frame.now < this.lastNow) {
      this.pool.clear();
      this.midnightAt = null;
    }
    this.lastNow = frame.now;

    // ---- lights and outlines: only on a change ----
    fillMapState(this.next, frame);
    const bits = this.drawn ? mapDiff(this.state, this.next) : mapDiff(null, this.next);
    if (this.next.midnight && !this.state.midnight) this.midnightAt = clock.now;
    if (!this.next.midnight) this.midnightAt = null;
    copyMapState(this.state, this.next);
    this.drawn = true;
    if (bits & REDRAW_LIGHTS) this.drawLights();
    if (bits & REDRAW_OUTLINES) this.drawOutlines();

    const steady = this.steady();
    const alpha = this.state.raid ? raidPulse(clock.now, steady) : 1;
    if (alpha !== this.outlineAlpha) {
      this.outlineAlpha = alpha;
      this.outlines.setAlpha(alpha);
      this.cutOff?.setAlpha(alpha);
      this.chip?.setAlpha(alpha);
    }

    // ---- dots: the block's calls (before retries), slowed by Regroup, frozen while held ----
    fillStreetDots(this.streetDots, frame.now, frame.blockDemand);
    for (let i = 0; i < STREET_IDS.length; i++) {
      const id = STREET_IDS[i];
      this.rates[id] = poolRate(this.streetDots[id]);
    }
    const dt = clock.dt * frame.timeScale;
    if (dt > 0) this.pool.step(dt, this.rates, this.travelOf);
    this.drawDots(L);

    // ---- the lit painting fades in at a held midnight ----
    this.updateLit(clock.now, steady);

    // ---- six sparkles, once, at midnight (not with reduced flicker) ----
    this.updateSparkles(clock.now, steady);
  }

  /** Fade the lit painting in over the base while the block holds at midnight; hide it otherwise. */
  private updateLit(now: number, steady: boolean): void {
    const p = this.litPlate;
    if (!p) return;
    const s = this.state;
    const held = s.midnight && s.litFloors > 0;
    const a = !held
      ? 0
      : steady || this.midnightAt === null
        ? 1
        : Math.min(1, Math.max(0, (now - this.midnightAt) / LIT_FADE));
    if (a === this.litShown) return;
    this.litShown = a;
    p.object.setAlpha(a).setVisible(a > 0);
  }

  private steady(): boolean {
    return (this.host?.flags.lite ?? false) || settings().reduceFlicker;
  }

  private drawBase(g: Phaser.GameObjects.Graphics, L: MapLayout, vector: boolean, lit = false): void {
    if (vector) {
      for (const b of L.blocks) {
        g.fillStyle(BLOCK_FILL, 1);
        g.fillRect(b.x, b.y, b.w, b.h);
        g.lineStyle(1, COLORS.cyan, 0.12);
        g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      }
      for (const s of L.streets) {
        g.lineStyle(9, STREET_COLOR, 0.9);
        g.beginPath();
        g.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) g.lineTo(s.points[i].x, s.points[i].y);
        g.strokePath();
      }
      for (const n of L.neighbours) {
        g.fillStyle(BLOCK_FILL, 1);
        g.fillRect(n.x, n.y, n.w, n.h);
      }
    }
    // Lux's block: a dark footprint behind its windows (the painted roof shows through), outlined
    // amber. Over the lit painting only the outline, so its lit windows show.
    const b = L.lux;
    if (!lit) {
      g.fillStyle(0x0a0f1c, vector ? 1 : 0.55);
      g.fillRect(b.x, b.y, b.w, b.h);
    }
    g.lineStyle(2, COLORS.amber, 0.9);
    g.strokeRect(b.x, b.y, b.w, b.h);
  }

  private drawLights(): void {
    const g = this.lights;
    const L = this.layout;
    if (!g || !L) return;
    this.draws.lights++;
    g.clear();
    const at = this.at;
    for (let floor = 1; floor <= FLOORS; floor++) {
      const look = windowLook(this.state, floor);
      g.fillStyle(WINDOW_COLOR[look], WINDOW_ALPHA[look]);
      for (let col = 0; col < WINDOWS_PER_FLOOR; col++) {
        windowRect(L, col, floor, at);
        g.fillRect(at.x, at.y, L.windows.w, L.windows.h);
      }
    }
  }

  private drawOutlines(): void {
    const g = this.outlines;
    const L = this.layout;
    if (!g || !L) return;
    this.draws.outlines++;
    g.clear();
    const s = this.state;
    for (const n of L.neighbours) {
      if (s.raid) g.lineStyle(3, COLORS.red, 0.95);
      else if (s.neighboursCut) g.lineStyle(2, COLORS.red, 0.5);
      else g.lineStyle(1, COLORS.cyan, 0.25);
      g.strokeRect(n.x, n.y, n.w, n.h);
    }
    this.cutOff?.setVisible(s.neighboursCut);
    this.chip?.setVisible(s.neighboursCut);
  }

  private drawDots(L: MapLayout): void {
    const g = this.dots;
    if (!g) return;
    const items = this.pool.items;
    if (this.dotsDrawn === 0 && this.pool.active === 0) return;
    g.clear();
    g.fillStyle(COLORS.amber, 0.95);
    let n = 0;
    const at = this.at;
    const half = DOT_SIZE / 2;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;
      const s = this.streetOf(L, p.wire);
      if (!s) continue;
      pointAlong(s, progress(p), at);
      g.fillRect(at.x - half, at.y - half, DOT_SIZE, DOT_SIZE);
      n++;
    }
    this.dotsDrawn = n;
  }

  private streetOf(L: MapLayout, id: string): MapLayout['streets'][number] | null {
    const streets = L.streets;
    for (let i = 0; i < streets.length; i++) if (streets[i].id === id) return streets[i];
    return null;
  }

  private updateSparkles(now: number, steady: boolean): void {
    const g = this.sparkles;
    const L = this.layout;
    if (!g || !L) return;
    const a = this.midnightAt === null || steady ? 0 : sparkleAlpha(now - this.midnightAt);
    if (a === this.sparkleShown) return;
    if (this.sparkleShown <= 0 && a > 0) {
      g.clear();
      g.lineStyle(2, 0xffe2a8, 1);
      for (const s of L.sparkles) {
        g.lineBetween(s.x - 5, s.y, s.x + 5, s.y);
        g.lineBetween(s.x, s.y - 5, s.x, s.y + 5);
      }
    }
    this.sparkleShown = a;
    g.setVisible(a > 0);
    g.setAlpha(a);
  }

  /** hud.map, built only when the hook is read. */
  snapshot(): MapTestState {
    const s = this.state;
    return {
      raid: s.raid,
      neighboursCut: s.neighboursCut,
      litFloors: s.litFloors,
      laundryDark: s.laundryDark,
      midnight: s.midnight,
      dots: { pool: this.pool.size, active: this.pool.active },
      base: this.base,
      chip: this.chip?.visible ?? false,
      lit: this.litPlate ? { key: CITY_GRID_LIT_KEY, alpha: Math.max(0, this.litShown) } : null,
      panel: panelSnapshot(this.plate),
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    const plate = this.plate?.object;
    const litPlate = this.litPlate?.object;
    for (const o of this.objects) if (o !== plate && o !== litPlate) o.destroy();
    releasePanel(this.plate);
    releasePanel(this.litPlate);
    this.plate = null;
    this.litPlate = null;
    this.chip = null;
    this.objects = [];
    this.lights = null;
    this.outlines = null;
    this.dots = null;
    this.sparkles = null;
    this.cutOff = null;
    this.layout = null;
    this.host = null;
    this.pool.clear();
  }
}
