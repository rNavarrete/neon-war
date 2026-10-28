// The inventory row on the Live screen: the board's own drawing of the `inventory` zone (nothing
// else draws there). Three cards (server, overclock kit, balancer) with a price chip and a count,
// and a padlocked drawer of the catalog's other parts drawn without their names. BoardScene keeps
// the pointer: it asks cardAt() what a press landed on and runs the drag itself.
//
// Phaser is a type here only; the scene's factories do the drawing. Nothing in update allocates:
// counts and locks are re-set only when they change.

import type Phaser from 'phaser';
import { type Box, TRAY_AREA, inBox } from './layout';
import { DRAWER, type InventoryCounts, MINI_SIZE, type TrayCard, priceChip } from './tray';

const CYAN = 0x2de2e6;
const AMBER = 0xffb02e;
const DIM = 0x4a4f63;
const FONT = 'monospace';
/** Over the board and its packets; under the drag ghost, the buttons and the refusal text. */
const DEPTH = 20;

interface CardView {
  readonly card: TrayCard;
  readonly frame: Phaser.GameObjects.Image;
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

  constructor(private readonly scene: Phaser.Scene) {}

  /** The cards as laid out now (positions never change; a lock may lift). */
  get cards(): readonly TrayCard[] {
    return this.views.map((v) => v.card);
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
    const frame = add
      .image(c.x, c.y, 'part-card')
      .setDisplaySize(c.w, c.h)
      .setDepth(DEPTH + 1);
    const art = add.image(c.x, c.y - (c.main ? 6 : 0), c.art).setDepth(DEPTH + 2);
    art.setScale(Math.min((c.w * 0.72) / art.width, (c.h * (c.main ? 0.56 : 0.7)) / art.height));
    const lock = add.image(0, 0, 'icon-lock').setDepth(DEPTH + 3);
    lock.setScale((c.main ? 34 : 18) / lock.height);
    lock.setPosition(c.x + c.w / 2 - (c.main ? 20 : 10), c.y - c.h / 2 + (c.main ? 46 : 12));
    this.objects.push(frame, art, lock);
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
    const v: CardView = { card: c, frame, art, lock, count, shown: -1 };
    this.paint(v);
    return v;
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
    v.frame.setAlpha(c.locked ? 0.6 : 1);
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
