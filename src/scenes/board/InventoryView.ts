// The inventory row on the Live screen: the board's own drawing of the `inventory` zone (nothing
// else draws there). Three cards (server, overclock kit, balancer) with a price chip and a count,
// and a padlocked drawer of the catalog's other parts drawn without their names. BoardScene keeps
// the pointer: it asks cardAt() what a press landed on and runs the drag itself.
//
// Phaser is a type here only; the scene's factories do the drawing. Nothing in update allocates:
// counts and locks are re-set only when they change.

import type Phaser from 'phaser';
import { panel } from '../hud/panel';
import { CARD_FRAME_K, CARD_FRAME_SLICE, cardFrameKey } from './art';
import { type Box, TRAY_AREA, inBox } from './layout';
import { DRAWER, type InventoryCounts, MINI_SIZE, type TrayCard, priceChip } from './tray';

/**
 * The inventory's picked art (board-12), as texture keys: the three card frames by art key and the
 * count badge with its scale. Null where the key is not picked, so the card draws as before.
 */
export interface InventoryArt {
  /** Texture key per card-frame art key (hud/live/card-frame-idle, -ready, -locked), or null. */
  readonly frames: Readonly<Record<string, string>> | null;
  readonly badge: { readonly texture: string; readonly scale: number } | null;
}

const NO_ART: InventoryArt = { frames: null, badge: null };

const CYAN = 0x2de2e6;
const AMBER = 0xffb02e;
const DIM = 0x4a4f63;
const FONT = 'monospace';
/** Over the board and its packets; under the drag ghost, the buttons and the refusal text. */
const DEPTH = 20;

interface CardView {
  readonly card: TrayCard;
  /** Today's frame (the part card), when the frames are not picked. */
  readonly frame: Phaser.GameObjects.Image | null;
  /** The picked frames by art key, one shown at a time (board-12), when they are picked. */
  readonly frames: ReadonlyMap<string, Phaser.GameObjects.NineSlice> | null;
  readonly art: Phaser.GameObjects.Image;
  readonly lock: Phaser.GameObjects.Image;
  readonly count: Phaser.GameObjects.Text | null;
  /** What the count shows now, so it is re-set only on a change. */
  shown: number;
}

export class InventoryView {
  private views: CardView[] = [];
  private objects: Phaser.GameObjects.GameObject[] = [];
  private inFlight: string | null = null;
  private dimmed = new Set<string>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly art: InventoryArt = NO_ART,
  ) {}

  /** The cards as laid out now (positions never change; a lock may lift). */
  get cards(): readonly TrayCard[] {
    return this.views.map((v) => v.card);
  }

  /** The frame each card wears now, by card id: the picked frame's art key, or 'part-card'. */
  frameOf(id: string): string {
    for (const v of this.views) {
      if (v.card.id !== id) continue;
      if (!v.frames) return 'part-card';
      let shown = 'part-card';
      v.frames.forEach((f, key) => {
        if (f.visible) shown = key;
      });
      return shown;
    }
    return 'part-card';
  }

  /** What each card's count shows, by id (0 for a drawer mini). */
  countOf(id: string): number {
    for (const v of this.views) if (v.card.id === id) return Math.max(0, v.shown);
    return 0;
  }

  create(cards: readonly TrayCard[]): void {
    const add = this.scene.add;
    const { left, right, top, bottom } = TRAY_AREA;
    const g = add.graphics().setDepth(DEPTH);
    g.fillStyle(0x05070f, 0.9).fillRoundedRect(left, top, right - left, bottom - top, 12);
    g.lineStyle(2, CYAN, 0.5).strokeRoundedRect(left + 1, top + 1, right - left - 2, bottom - top - 2, 12);
    // The drawer: a recessed box behind the locked minis, set apart from the three cards.
    const pad = 6;
    const drawerTop = DRAWER.rows[0] - MINI_SIZE.h / 2 - pad;
    const drawerBottom = DRAWER.rows[1] + MINI_SIZE.h / 2 + pad;
    g.fillStyle(0x03050b, 0.95).fillRoundedRect(
      DRAWER.left - pad,
      drawerTop,
      DRAWER.right - DRAWER.left + pad * 2,
      drawerBottom - drawerTop,
      8,
    );
    g.lineStyle(1, CYAN, 0.25).strokeRoundedRect(
      DRAWER.left - pad,
      drawerTop,
      DRAWER.right - DRAWER.left + pad * 2,
      drawerBottom - drawerTop,
      8,
    );
    this.objects.push(g);
    for (const c of cards) this.views.push(this.makeCard(c));
  }

  private makeCard(c: TrayCard): CardView {
    const add = this.scene.add;
    const frames = this.art.frames ? this.makeFrames(c, this.art.frames) : null;
    const frame = frames
      ? null
      : add
          .image(c.x, c.y, 'part-card')
          .setDisplaySize(c.w, c.h)
          .setDepth(DEPTH + 1);
    const art = add.image(c.x, c.y - (c.main ? 6 : 0), c.art).setDepth(DEPTH + 2);
    art.setScale(Math.min((c.w * 0.72) / art.width, (c.h * (c.main ? 0.56 : 0.7)) / art.height));
    const lock = add.image(0, 0, 'icon-lock').setDepth(DEPTH + 3);
    lock.setScale((c.main ? 34 : 18) / lock.height);
    lock.setPosition(c.x + c.w / 2 - (c.main ? 20 : 10), c.y - c.h / 2 + (c.main ? 46 : 12));
    if (frame) this.objects.push(frame);
    if (frames) frames.forEach((f) => this.objects.push(f));
    this.objects.push(art, lock);
    let count: Phaser.GameObjects.Text | null = null;
    if (c.main) {
      const name = add
        .text(c.x, c.y + c.h / 2 - 6, c.name ?? '', {
          fontFamily: FONT,
          fontSize: '14px',
          fontStyle: 'bold',
          color: '#2de2e6',
        })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH + 3);
      const chip = this.priceChip(c);
      const badge = this.art.badge;
      if (badge) {
        // The count badge behind the count, at its file's shape, never larger than the file.
        const b = add
          .image(c.x + c.w / 2 - 14, c.y + c.h / 2 - 36, badge.texture)
          .setScale(badge.scale)
          .setDepth(DEPTH + 2.5);
        this.objects.push(b);
      }
      count = add
        .text(c.x + c.w / 2 - 8, c.y + c.h / 2 - 24, '0', {
          fontFamily: FONT,
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#05070f',
          strokeThickness: 4,
        })
        .setOrigin(1, 1)
        .setDepth(DEPTH + 3);
      this.objects.push(name, ...chip, count);
    }
    // -1 until the first setCounts, so the first count always lands.
    const v: CardView = { card: c, frame, frames, art, lock, count, shown: -1 };
    this.paint(v);
    return v;
  }

  /**
   * The picked card frames, nine-sliced at k 0.5 to the card's size: a main card gets all three
   * (one shows at a time), a drawer mini only the locked one. Made once; paint() swaps visibility.
   */
  private makeFrames(
    c: TrayCard,
    textures: Readonly<Record<string, string>>,
  ): Map<string, Phaser.GameObjects.NineSlice> {
    const out = new Map<string, Phaser.GameObjects.NineSlice>();
    const keys = c.main ? Object.keys(textures) : [cardFrameKey(true, 0)];
    const sl = CARD_FRAME_SLICE;
    for (const key of keys) {
      const tex = textures[key];
      if (!tex) continue;
      const f = panel(this.scene, tex, c.x, c.y, c.w, c.h, {
        k: CARD_FRAME_K,
        slice: [sl, sl, sl, sl],
        centred: true,
      })
        .setDepth(DEPTH + 1)
        .setVisible(false);
      out.set(key, f);
    }
    return out;
  }

  /** The price chip, top-left of a main card: amber credits, or GIFT for the crew's balancer. */
  private priceChip(c: TrayCard): Phaser.GameObjects.GameObject[] {
    const add = this.scene.add;
    const label = add
      .text(c.x - c.w / 2 + 12, c.y - c.h / 2 + 10, priceChip(c.price ?? 0), {
        fontFamily: FONT,
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#05070f',
      })
      .setDepth(DEPTH + 4);
    const bg = add.graphics().setDepth(DEPTH + 3);
    bg.fillStyle(AMBER, 0.95).fillRoundedRect(
      label.x - 6,
      label.y - 3,
      label.width + 12,
      label.height + 6,
      6,
    );
    return [bg, label];
  }

  /** Lift or set each card's padlock from a fresh trayCards() (the balancer unlocks when given). */
  setLocks(cards: readonly TrayCard[]): void {
    for (const c of cards) {
      for (let i = 0; i < this.views.length; i++) {
        const v = this.views[i];
        if (v.card.id !== c.id || v.card.locked === c.locked) continue;
        this.views[i] = { ...v, card: c };
        this.paint(this.views[i]);
      }
    }
  }

  /** Show how many of each card the player could use now; a 0 greys the card (it stays draggable). */
  setCounts(counts: InventoryCounts): void {
    for (const v of this.views) {
      if (!v.count) continue;
      const n = counts[v.card.id as keyof InventoryCounts] ?? 0;
      if (n === v.shown) continue;
      v.shown = n;
      v.count.setText(String(n));
      if (n === 0) this.dimmed.add(v.card.id);
      else this.dimmed.delete(v.card.id);
      this.paint(v);
    }
  }

  /** Dim the card being dragged, or none. */
  setInFlight(id: string | null): void {
    if (id === this.inFlight) return;
    const was = this.inFlight;
    this.inFlight = id;
    for (const v of this.views) if (v.card.id === was || v.card.id === id) this.paint(v);
  }

  /** The card under a point, if any. */
  cardAt(x: number, y: number): TrayCard | null {
    for (const v of this.views) if (inBox(v.card as Box, x, y)) return v.card;
    return null;
  }

  private paint(v: CardView): void {
    const c = v.card;
    v.lock.setVisible(c.locked);
    const grey = c.locked || this.dimmed.has(c.id);
    if (grey) v.art.setTint(DIM);
    else v.art.clearTint();
    if (v.frame) v.frame.setAlpha(c.locked ? 0.6 : 1);
    if (v.frames) {
      const want = cardFrameKey(c.locked, c.main ? v.shown : 0);
      v.frames.forEach((f, key) => f.setVisible(key === want));
    }
    const flying = c.id === this.inFlight;
    v.art.setAlpha(flying ? 0.35 : 1);
    if (v.count) v.count.setColor(v.shown > 0 ? '#ffffff' : '#8a93a6');
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.views = [];
    this.dimmed.clear();
    this.inFlight = null;
  }
}
