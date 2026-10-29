import type Phaser from 'phaser';
import type { Rect } from '../live/layout';
import { resolveArt } from '../plates';
import { KIT, type PanelSpec, type Stamp, isBase, maxScale, panelStamps } from './kit';
import { COLORS } from './layout';

/**
 * A painted frame stretched to w x h without distorting its corners: a nine-slice built at 1/k of
 * the size and scaled down by k, so the corners shrink with the rest of the painted HUD instead of
 * showing at full size. The origin is top-left unless `centred`.
 */
export function panel(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { k?: number; slice?: [number, number, number, number]; centred?: boolean } = {},
): Phaser.GameObjects.NineSlice {
  const k = opts.k ?? 0.5;
  const [l, r, t, b] = opts.slice ?? [70, 70, 50, 50];
  const s = scene.add.nineslice(x, y, key, undefined, w / k, h / k, l, r, t, b).setScale(k);
  return opts.centred ? s : s.setOrigin(0);
}

/**
 * The depth the gauges lane's Live views draw at: above the HUD's own objects (depth 0) and the
 * placeholders (depth -10).
 */
export const GAUGES_DEPTH = 1;

// ---- baked panels: the frame language in one object ----------------------------------------------

/** What a view's hook section reports for its baked panel (hud.title.panel, hud.gauge.panel, ...). */
export interface PanelTestState {
  /** The baked texture, or null when the scene could not bake (the code plate draws instead). */
  texture: string | null;
  /** The picked kit files drawn into it, by art key, in draw order. */
  pieces: string[];
  /** Kit keys the panel asked for whose file was not loaded (a code stand-in drew instead). */
  missing: string[];
  /** The largest scale a non-rail piece is drawn at (1 is the file's own size; never above 1). */
  maxScale: number;
  /** The panel's rect, game pixels. */
  rect: { x: number; y: number; w: number; h: number };
}

/** A baked panel: its one display object and what went into it. */
export interface BakedPanel {
  readonly name: string;
  readonly object: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  readonly state: PanelTestState;
}

/** A copy of a panel's state for a hook read (null before the panel is baked). */
export function panelSnapshot(p: BakedPanel | null): PanelTestState | null {
  if (!p) return null;
  const s = p.state;
  return { ...s, pieces: [...s.pieces], missing: [...s.missing], rect: { ...s.rect } };
}

/** Destroy a baked panel's object. Safe to call with null. */
export function releasePanel(p: BakedPanel | null): void {
  p?.object.destroy();
}

/** The texture a panel is baked into. */
export function panelTexture(name: string): string {
  return `live-kit:${name}`;
}

/** The scene calls a bake needs; the optional ones absent on a node test's stub, which falls back. */
interface BakeScene {
  add: {
    graphics(): Phaser.GameObjects.Graphics;
    image?(x: number, y: number, key: string): Phaser.GameObjects.Image;
  };
  make?: { graphics?(config?: object, addToScene?: boolean): Phaser.GameObjects.Graphics };
  textures?: {
    exists?(key: string): boolean;
    addDynamicTexture?(key: string, w?: number, h?: number): Phaser.Textures.DynamicTexture | null;
    get?(key: string): Phaser.Textures.Texture;
  };
}

/** What a view hands bakePanel besides the kit pieces: the plate's fill and its own static drawing. */
export interface BakeOptions {
  /** The plate's fill under everything (none: transparent inside the frame). */
  readonly fill?: { readonly color: number; readonly alpha: number };
  /** The view's own static drawing, in game pixels, between the painted base and the frame. */
  readonly draw?: (g: Phaser.GameObjects.Graphics) => void;
}

/** The name a stamp's part of its file is added to the texture under (once per part). */
function partFrame(s: Stamp): string {
  return `kit:${s.src.x},${s.src.y},${s.src.w},${s.src.h}`;
}

/**
 * Draw a panel once: the fill, the painted base (the map's city grid), the view's own static
 * drawing, then the dividers, the frame, the label tab and the four bracket corners, all into one
 * DynamicTexture the size of `rect`, shown by one Image. The texture is the game's, so a restarted
 * HUD reuses it without drawing again. Each picked piece is drawn at its file's size or smaller (the
 * frame's rails stretch along their edge, as a nine-slice does); a piece whose file is not loaded is
 * skipped, and the frame falls back to a 2 px amber rim drawn in code. A scene that cannot bake (a
 * node test's stub) gets the same plate as one Graphics. Call from create, never per frame.
 */
export function bakePanel(
  scene: Phaser.Scene,
  name: string,
  rect: Rect,
  spec: PanelSpec,
  opts: BakeOptions = {},
): BakedPanel {
  const s = scene as unknown as BakeScene;
  const stamps = panelStamps(rect, spec);
  const texture = panelTexture(name);
  const tx = s.textures;
  const loaded = (key: string): string | null => {
    const a = resolveArt(key);
    return !a.fallback && tx?.exists?.(a.texture) ? a.texture : null;
  };
  const pieces: string[] = [];
  const missing: string[] = [];
  for (const st of stamps) {
    const list = loaded(st.key) ? pieces : missing;
    if (!list.includes(st.key)) list.push(st.key);
  }
  // The frame (or the alert plate) not loaded: a 2 px amber rim stands in for it.
  const frameMissing =
    (spec.frame === true && missing.includes(KIT.frame)) ||
    (spec.alert !== undefined && missing.includes(KIT.alertPlate));
  const plate = (g: Phaser.GameObjects.Graphics): void => {
    if (opts.fill) {
      g.fillStyle(opts.fill.color, opts.fill.alpha);
      g.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  };
  const rim = (g: Phaser.GameObjects.Graphics): void => {
    g.lineStyle(2, COLORS.amber, 0.9);
    g.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
  };
  const state: PanelTestState = {
    texture: null,
    pieces,
    missing,
    maxScale: maxScale(stamps.filter((st) => pieces.includes(st.key))),
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
  };

  const make = s.make?.graphics?.bind(s.make);
  const image = s.add.image?.bind(s.add);
  if (tx?.exists && tx.addDynamicTexture && tx.get && make && image) {
    const get = tx.get.bind(tx);
    let ok = tx.exists(texture);
    if (!ok) {
      const dt = tx.addDynamicTexture(texture, Math.round(rect.w), Math.round(rect.h));
      if (dt) {
        const layer = (draw: (g: Phaser.GameObjects.Graphics) => void): void => {
          // Drawn in game pixels, shifted so the rect's corner lands on the texture's.
          const g = make({ x: -rect.x, y: -rect.y }, false);
          draw(g);
          dt.draw(g);
          dt.render();
          g.destroy();
        };
        const stamp = (st: Stamp): void => {
          const key = loaded(st.key);
          if (!key) return;
          const t = get(key);
          const part = partFrame(st);
          if (!t.has(part)) t.add(part, 0, st.src.x, st.src.y, st.src.w, st.src.h);
          // Placed by the box's centre; a stamp's rotation (0 for every kit piece today) turns it there.
          dt.stamp(key, part, st.x + st.w / 2, st.y + st.h / 2, {
            originX: 0.5,
            originY: 0.5,
            scaleX: st.w / st.src.w,
            scaleY: st.h / st.src.h,
            rotation: st.rotation,
          });
        };
        layer(plate);
        for (const st of stamps) if (isBase(st)) stamp(st);
        dt.render();
        layer((g) => {
          opts.draw?.(g);
          if (frameMissing) rim(g);
        });
        for (const st of stamps) if (!isBase(st)) stamp(st);
        dt.render();
        ok = true;
      }
    }
    if (ok) {
      const img = image(rect.x, rect.y, texture).setOrigin(0, 0);
      state.texture = texture;
      return { name, object: img, state };
    }
  }

  // No bake: the plate, the view's drawing and the rim as one Graphics; no picked piece draws.
  const g = s.add.graphics();
  plate(g);
  opts.draw?.(g);
  if (spec.frame || spec.alert) rim(g);
  state.missing = [...pieces, ...missing];
  state.pieces = [];
  state.maxScale = 0;
  return { name, object: g, state };
}
