import Phaser from 'phaser';
import { bus } from '../game/bus';
import { run } from '../game/run';
import { type Part, type PartKind, wireKey } from '../sim/board';
import { provideTestState } from '../testHook';
import { balancerGiven, placeBalancer } from './board/crew';
import type { BoardTestState } from './board/hook';
import {
  BOARD_AREA,
  LB_SLOT,
  LB_SLOT_ID,
  PAD_SIZE,
  PART_SIZE,
  SERVER_PADS,
  TRAY_AREA,
  WIRE_PICK,
  distToSegment,
  inBox,
  midpoint,
  partAt,
  partBox,
  partCentre,
  slotAt,
  toPage,
  wireEnds,
} from './board/layout';
import { PacketPool, progress, travelSeconds } from './board/packets';
import { LOCKED_KINDS, type TrayCard, lockedReason, trayCards } from './board/tray';
import { type PartLook, loadColour, loadLabel, partLook } from './board/view';
import { SCENES } from './keys';

// Desktop only, 16:9: built at 1920x1080 and scaled to fit the window.
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

const CYAN = 0x2de2e6;
const AMBER = 0xffb02e;
const GREY = 0x6b7385;
const DARK_TINT = 0x3a3f55;
/** How long a refusal reason stays on screen, in ms. */
const REFUSAL_MS = 2000;
/** Pointer travel (game px) before a press on a part counts as a wire drag rather than a click. */
const DRAG_START = 10;
const BUTTON_RADIUS = 28;

const ART: Readonly<Record<string, string>> = {
  room: 'art/bg/bedroom-lit.webp',
  goggles: 'art/hud/goggles-overlay.webp',
  gateway: 'art/board/gateway.webp',
  server: 'art/board/server.webp',
  'server-hot': 'art/board/server-hot.webp',
  'server-dead': 'art/board/server-dead.webp',
  'server-overclocked': 'art/board/server-overclocked.webp',
  'server-overclocked-hot': 'art/board/server-overclocked-hot.webp',
  database: 'art/board/database.webp',
  'database-hot': 'art/board/database-hot.webp',
  balancer: 'art/board/balancer.webp',
  'overclock-kit': 'art/board/overclock-kit.webp',
  'slot-empty': 'art/board/slot-empty.webp',
  'slot-locked': 'art/board/slot-locked.webp',
  'part-card': 'art/hud/part-card.webp',
  'icon-lock': 'art/hud/icons/lock.webp',
  'icon-cut': 'art/hud/icons/cut.webp',
  'icon-bin': 'art/hud/icons/bin.webp',
};

interface PartView {
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  art: string;
  text: string;
  colour: string;
  /** Frame the part was last seen on the board, to sweep views of removed parts. */
  seen: number;
}

interface WireGeom {
  key: string;
  from: string;
  to: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  travel: number;
}

type Drag =
  | { kind: 'card'; id: string }
  | { kind: 'wire'; from: string; x0: number; y0: number; moved: boolean }
  | null;

/**
 * The playable board: Lux's room through her goggles, the parts on it, the wires and packets
 * between them, and the tray. It ticks the run and draws it; every rule lives in src/sim/.
 */
export class BoardScene extends Phaser.Scene {
  ready = false;

  private views = new Map<string, PartView>();
  private frame = 0;
  private pads = new Map<string, Phaser.GameObjects.Image>();
  private lbPad!: Phaser.GameObjects.Image;
  private wiresG!: Phaser.GameObjects.Graphics;
  private previewG!: Phaser.GameObjects.Graphics;
  private wireList: WireGeom[] = [];
  private wireByKey = new Map<string, WireGeom>();
  private lastWires: readonly unknown[] | null = null;
  private lastParts: readonly unknown[] | null = null;
  private pool = new PacketPool();
  private packetSprites: Phaser.GameObjects.Arc[] = [];
  private skipTags: Phaser.GameObjects.Text[] = [];
  private cards: TrayCard[] = [];
  private cardViews = new Map<string, { art: Phaser.GameObjects.Image; lock: Phaser.GameObjects.Image }>();
  private balancerUnlocked = false;
  private ghost!: Phaser.GameObjects.Image;
  private refusalText!: Phaser.GameObjects.Text;
  private refusalUntil = 0;
  private cutBtn!: Phaser.GameObjects.Container;
  private binBtn!: Phaser.GameObjects.Container;
  private drag: Drag = null;
  private selectedPart: string | null = null;
  private selectedWire: string | null = null;
  private pointer = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
  private offBus: (() => void) | null = null;
  private readonly travelOf = (wire: string): number => this.wireByKey.get(wire)?.travel ?? 1;

  constructor() {
    super(SCENES.board);
  }

  preload(): void {
    for (const [key, file] of Object.entries(ART)) this.load.image(key, file);
    for (const kind of LOCKED_KINDS) this.load.image(`part-${kind}`, `art/parts/${kind}/scrap.webp`);
  }

  create(): void {
    this.ready = false;
    this.views = new Map();
    this.pads = new Map();
    this.wireList = [];
    this.wireByKey = new Map();
    this.lastWires = null;
    this.lastParts = null;
    this.pool = new PacketPool();
    this.packetSprites = [];
    this.skipTags = [];
    this.cardViews = new Map();
    this.drag = null;
    this.selectedPart = null;
    this.selectedWire = null;
    this.refusalUntil = 0;

    this.drawBackdrop();

    // Slot pads: six server slots and the load balancer's slot between the gateway and the servers.
    for (const [id, p] of Object.entries(SERVER_PADS)) {
      const pad = this.add.image(p.x, p.y, 'slot-empty');
      pad.setScale(PAD_SIZE.w / pad.width).setAlpha(0.8);
      this.pads.set(id, pad);
    }
    this.lbPad = this.add.image(LB_SLOT.x, LB_SLOT.y + 10, 'slot-locked');
    this.lbPad.setScale(PAD_SIZE.w / this.lbPad.width);

    this.wiresG = this.add.graphics();
    this.previewG = this.add.graphics();
    // Parts and packets are added lazily; keep them above the wires by depth.
    this.wiresG.setDepth(1);
    this.previewG.setDepth(4);

    // Lux's goggles frame the board; the tray and pointer feedback sit on the lens, above it.
    const lens = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'goggles');
    lens.setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(10);

    this.drawTray();

    this.ghost = this.add.image(0, 0, 'server').setVisible(false).setAlpha(0.75).setDepth(30);
    this.cutBtn = this.makeButton('icon-cut', 0xff4d5e);
    this.binBtn = this.makeButton('icon-bin', 0xff4d5e);
    this.refusalText = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#ff6b7a',
        backgroundColor: '#05070fdd',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5, 1)
      .setDepth(40)
      .setVisible(false);

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);

    this.offBus?.();
    this.offBus = bus.on('refused', ({ reason }) => this.showRefusal(reason));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offBus?.();
      this.offBus = null;
      this.ready = false;
    });

    provideTestState('board', () => this.testState());

    this.syncBoard(0);
    this.ready = true;
    this.scene.launch(SCENES.hud);
  }

  update(): void {
    // The session clock runs in real time, so use the frame's real length rather than Phaser's
    // smoothed delta (which falls back to 1/60 s on slow frames). run().tick caps stalls.
    const seconds = this.game.loop.rawDelta / 1000;
    const r = run();
    r.tick(seconds);
    // Packets move in real time (slowed by Regroup), not test speed, so their density reads the same.
    this.syncBoard(r.paused ? 0 : Math.min(seconds, 0.25) * r.timeScale);
  }

  // ---- drawing -------------------------------------------------------------------------------

  private drawBackdrop(): void {
    const room = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'room');
    room.setScale(Math.max(GAME_WIDTH / room.width, GAME_HEIGHT / room.height));
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05070f, 0.5).setOrigin(0);

    // The AR board: a faint cyan grid laid over the room.
    const g = this.add.graphics();
    const { left, right, top, bottom } = BOARD_AREA;
    g.fillStyle(0x07101c, 0.45).fillRoundedRect(left, top, right - left, bottom - top, 24);
    g.lineStyle(1, CYAN, 0.08);
    for (let x = left + 60; x < right; x += 60) g.lineBetween(x, top + 8, x, bottom - 8);
    for (let y = top + 60; y < bottom; y += 60) g.lineBetween(left + 8, y, right - 8, y);
    g.lineStyle(2, CYAN, 0.35).strokeRoundedRect(left, top, right - left, bottom - top, 24);
  }

  private drawTray(): void {
    const { left, right, top, bottom } = TRAY_AREA;
    const g = this.add.graphics().setDepth(20);
    g.fillStyle(0x05070f, 0.88).fillRoundedRect(left, top, right - left, bottom - top, 18);
    g.lineStyle(2, CYAN, 0.6).strokeRoundedRect(left, top, right - left, bottom - top, 18);
    g.lineStyle(1, CYAN, 0.25).lineBetween(905, top + 14, 905, bottom - 14);

    this.balancerUnlocked = balancerGiven(run());
    this.cards = trayCards(this.balancerUnlocked);
    for (const c of this.cards) {
      const frame = this.add.image(c.x, c.y, 'part-card').setDisplaySize(c.w, c.h).setDepth(21);
      if (c.locked) frame.setAlpha(0.6);
      const art = this.add.image(c.x, c.y - (c.main ? 8 : 0), c.art).setDepth(22);
      art.setScale(Math.min((c.w * 0.72) / art.width, (c.h * (c.main ? 0.62 : 0.7)) / art.height));
      const lock = this.add.image(0, 0, 'icon-lock').setDepth(23);
      lock.setScale((c.main ? 34 : 18) / lock.height);
      lock.setPosition(c.x + c.w / 2 - (c.main ? 18 : 9), c.y + c.h / 2 - (c.main ? 22 : 11));
      this.cardViews.set(c.id, { art, lock });
      this.paintCard(c);
      if (c.main) {
        this.add
          .text(c.x, c.y + c.h / 2 - 4, c.label, {
            fontFamily: 'monospace',
            fontSize: '15px',
            fontStyle: 'bold',
            color: '#2de2e6',
          })
          .setOrigin(0.5, 1)
          .setDepth(23);
      }
    }
  }

  private paintCard(c: TrayCard): void {
    const v = this.cardViews.get(c.id);
    if (!v) return;
    v.lock.setVisible(c.locked);
    if (c.locked) v.art.setTint(0x4a4f63);
    else v.art.clearTint();
  }

  private makeButton(icon: string, ring: number): Phaser.GameObjects.Container {
    const bg = this.add.circle(0, 0, BUTTON_RADIUS, 0x05070f, 0.92).setStrokeStyle(3, ring);
    const img = this.add.image(0, 0, icon);
    img.setScale((BUTTON_RADIUS * 1.4) / Math.max(img.width, img.height));
    return this.add.container(0, 0, [bg, img]).setDepth(35).setVisible(false);
  }

  /** Bring every sprite in line with the run this frame. `dt` is how far packets move (seconds). */
  private syncBoard(dt: number): void {
    const r = run();
    const board = r.session.board;
    this.frame++;

    const unlocked = balancerGiven(r);
    if (unlocked !== this.balancerUnlocked) {
      this.balancerUnlocked = unlocked;
      this.cards = trayCards(unlocked);
      for (const c of this.cards) this.paintCard(c);
    }

    if (board.wires !== this.lastWires || board.parts !== this.lastParts) this.rebuildWires();

    // Parts.
    const offline = r.offline;
    const hasBalancer = board.parts.some((p) => p.kind === 'balancer');
    this.lbPad.setTexture(unlocked || hasBalancer ? 'slot-empty' : 'slot-locked');
    for (const [slot, pad] of this.pads) {
      const empty = !board.parts.some((p) => p.slot === slot);
      const target = this.drag?.kind === 'card' && this.drag.id === 'server' && empty;
      pad.setAlpha(target ? 1 : 0.8);
      if (target) pad.setTint(0x9ffcff);
      else pad.clearTint();
    }
    const pulse = 0.55 + 0.25 * Math.sin(this.time.now / 120);
    for (const part of board.parts) {
      const look = partLook(part, r.flow.load[part.id] ?? 0, offline, r.session.offlineUntil, r.now);
      const v = this.viewFor(part, look);
      if (!v) continue;
      v.seen = this.frame;
      if (look.dark) v.img.setTint(DARK_TINT);
      else v.img.clearTint();
      v.img.setAlpha(look.status === 'booting' || look.status === 'rebooting' ? pulse + 0.2 : 1);
      const text = loadLabel(look);
      if (text !== v.text) {
        v.text = text;
        v.label.setText(text);
      }
      const colour = loadColour(look);
      if (colour !== v.colour) {
        v.colour = colour;
        v.label.setColor(colour);
      }
    }
    for (const [id, v] of this.views) {
      if (v.seen === this.frame) continue;
      v.img.destroy();
      v.label.destroy();
      this.views.delete(id);
    }

    // Selection can outlive what it pointed at (a cut, a decommission, a new run).
    if (this.selectedPart && !board.parts.some((p) => p.id === this.selectedPart && p.slot !== null)) {
      this.selectedPart = null;
    }
    if (this.selectedWire && !this.wireByKey.has(this.selectedWire)) this.selectedWire = null;

    this.drawWires(r.flow.wires, r.flow.skipped);
    this.stepPackets(dt, r.flow.wires);
    this.placeButtons();

    if (this.refusalText.visible && this.time.now > this.refusalUntil) this.refusalText.setVisible(false);
  }

  private viewFor(part: Part, look: PartLook): PartView | null {
    let v = this.views.get(part.id);
    const c = partCentre(part);
    if (!c) return null;
    if (!v) {
      const img = this.add.image(c.x, c.y, look.art).setDepth(3);
      const label = this.add
        .text(c.x, c.y - PART_SIZE[part.kind].h / 2 - 8, '', {
          fontFamily: 'monospace',
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#2de2e6',
          stroke: '#05070f',
          strokeThickness: 5,
        })
        .setOrigin(0.5, 1)
        .setDepth(5);
      v = { img, label, art: '', text: '', colour: '', seen: 0 };
      this.views.set(part.id, v);
    }
    if (v.art !== look.art) {
      v.art = look.art;
      v.img.setTexture(look.art);
      v.img.setScale(this.artScale(part.kind, v.img));
    }
    return v;
  }

  /** Scale that fits a part's art inside its box on the board without upscaling past its size. */
  private artScale(kind: PartKind, img: Phaser.GameObjects.Image): number {
    const size = PART_SIZE[kind];
    return Math.min(size.w / img.width, size.h / img.height);
  }

  private rebuildWires(): void {
    const board = run().session.board;
    this.lastWires = board.wires;
    this.lastParts = board.parts;
    this.wireList = [];
    this.wireByKey = new Map();
    for (const w of board.wires) {
      const a = board.parts.find((p) => p.id === w.from);
      const b = board.parts.find((p) => p.id === w.to);
      const e = a && b ? wireEnds(a, b) : null;
      if (!e) continue;
      const g: WireGeom = {
        key: wireKey(w),
        from: w.from,
        to: w.to,
        ...e,
        travel: travelSeconds(Math.hypot(e.bx - e.ax, e.by - e.ay)),
      };
      this.wireList.push(g);
      this.wireByKey.set(g.key, g);
    }
  }

  private drawWires(rates: Readonly<Record<string, number>>, skipped: readonly string[]): void {
    const g = this.wiresG;
    g.clear();
    let tags = 0;
    for (const w of this.wireList) {
      const isSkipped = skipped.includes(w.key);
      const live = (rates[w.key] ?? 0) > 0;
      const selected = w.key === this.selectedWire;
      const colour = isSkipped ? GREY : selected ? 0xffffff : CYAN;
      // A soft glow under a crisp core.
      g.lineStyle(14, colour, isSkipped ? 0.08 : 0.16).lineBetween(w.ax, w.ay, w.bx, w.by);
      g.lineStyle(4, colour, isSkipped ? 0.6 : live || selected ? 0.95 : 0.5).lineBetween(
        w.ax,
        w.ay,
        w.bx,
        w.by,
      );
      g.fillStyle(colour, 0.9).fillCircle(w.ax, w.ay, 6).fillCircle(w.bx, w.by, 6);
      if (isSkipped) {
        const tag = this.skipTag(tags++);
        tag.setPosition((w.ax + w.bx) / 2, (w.ay + w.by) / 2).setVisible(true);
      }
    }
    for (let i = tags; i < this.skipTags.length; i++) this.skipTags[i].setVisible(false);

    const p = this.previewG;
    p.clear();
    const d = this.drag;
    if (d?.kind === 'wire' && d.moved) {
      const from = run().session.board.parts.find((x) => x.id === d.from);
      const b = from ? partBox(from) : null;
      if (b) {
        p.lineStyle(4, CYAN, 0.6).lineBetween(b.x + b.w / 2 - 6, b.y, this.pointer.x, this.pointer.y);
        p.fillStyle(CYAN, 0.9).fillCircle(this.pointer.x, this.pointer.y, 7);
      }
    }
  }

  private skipTag(i: number): Phaser.GameObjects.Text {
    let t = this.skipTags[i];
    if (!t) {
      t = this.add
        .text(0, 0, 'skipped', {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#c5cad6',
          backgroundColor: '#3b4150',
          padding: { x: 8, y: 3 },
        })
        .setOrigin(0.5)
        .setDepth(6);
      this.skipTags[i] = t;
    }
    return t;
  }

  private stepPackets(dt: number, rates: Readonly<Record<string, number>>): void {
    this.pool.step(dt, rates, this.travelOf);
    const items = this.pool.items;
    while (this.packetSprites.length < items.length) {
      const dot = this.add.circle(0, 0, 6, AMBER, 1).setStrokeStyle(3, 0xffe2a8, 0.5).setDepth(2);
      this.packetSprites.push(dot);
    }
    for (let i = 0; i < this.packetSprites.length; i++) {
      const s = this.packetSprites[i];
      const p = items[i];
      const w = p?.active ? this.wireByKey.get(p.wire) : undefined;
      if (!p || !w) {
        s.setVisible(false);
        continue;
      }
      const k = progress(p);
      s.setPosition(w.ax + (w.bx - w.ax) * k, w.ay + (w.by - w.ay) * k).setVisible(true);
    }
  }

  private placeButtons(): void {
    const w = this.selectedWire ? this.wireByKey.get(this.selectedWire) : undefined;
    if (w) {
      const m = midpoint(w);
      this.cutBtn.setPosition(m.x, m.y - 40).setVisible(true);
    } else {
      this.cutBtn.setVisible(false);
    }
    const part = this.selectedPart
      ? run().session.board.parts.find((p) => p.id === this.selectedPart)
      : undefined;
    const b = part ? partBox(part) : null;
    if (b) this.binBtn.setPosition(b.x + b.w / 2 + 10, b.y - b.h / 2 + 10).setVisible(true);
    else this.binBtn.setVisible(false);
  }

  private showRefusal(reason: string): void {
    const text = reason.charAt(0).toUpperCase() + reason.slice(1);
    const x = Phaser.Math.Clamp(this.pointer.x, 260, GAME_WIDTH - 260);
    const y = Phaser.Math.Clamp(this.pointer.y - 30, 120, GAME_HEIGHT - 20);
    this.refusalText.setText(text).setPosition(x, y).setVisible(true);
    this.refusalUntil = this.time.now + REFUSAL_MS;
  }

  private refuse(reason: string): void {
    bus.emit('refused', { reason });
  }

  // ---- input ---------------------------------------------------------------------------------

  private onDown(p: Phaser.Input.Pointer): void {
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    const r = run();
    const parts = r.session.board.parts;

    if (p.rightButtonDown()) {
      const part = partAt(parts, p.x, p.y);
      if (part) this.decommission(part.id);
      return;
    }
    if (this.cutBtn.visible && Math.hypot(p.x - this.cutBtn.x, p.y - this.cutBtn.y) <= BUTTON_RADIUS + 4) {
      const w = this.selectedWire ? this.wireByKey.get(this.selectedWire) : undefined;
      if (w) r.cut(w.from, w.to);
      this.selectedWire = null;
      return;
    }
    if (this.binBtn.visible && Math.hypot(p.x - this.binBtn.x, p.y - this.binBtn.y) <= BUTTON_RADIUS + 4) {
      if (this.selectedPart) this.decommission(this.selectedPart);
      return;
    }

    const card = this.cards.find((c) => inBox(c, p.x, p.y));
    if (card) {
      this.selectedPart = null;
      this.selectedWire = null;
      if (card.locked) {
        this.refuse(lockedReason(card.id));
        return;
      }
      this.drag = { kind: 'card', id: card.id };
      this.ghost
        .setTexture(card.art)
        .setScale(120 / this.ghost.frame.height)
        .setPosition(p.x, p.y)
        .setVisible(true);
      return;
    }

    const part = partAt(parts, p.x, p.y);
    if (part) {
      this.drag = { kind: 'wire', from: part.id, x0: p.x, y0: p.y, moved: false };
      return;
    }

    let best: WireGeom | null = null;
    let bestD = WIRE_PICK;
    for (const w of this.wireList) {
      const d = distToSegment(p.x, p.y, w.ax, w.ay, w.bx, w.by);
      if (d <= bestD) {
        best = w;
        bestD = d;
      }
    }
    this.selectedWire = best ? best.key : null;
    this.selectedPart = null;
  }

  private onMove(p: Phaser.Input.Pointer): void {
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'card') this.ghost.setPosition(p.x, p.y);
    else if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) > DRAG_START) d.moved = true;
  }

  private onUp(p: Phaser.Input.Pointer): void {
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    const d = this.drag;
    this.drag = null;
    this.ghost.setVisible(false);
    if (!d) return;
    const r = run();
    const parts = r.session.board.parts;

    if (d.kind === 'card') {
      if (d.id === 'server') {
        const slot = slotAt(p.x, p.y);
        if (slot === LB_SLOT_ID) this.refuse('only the load balancer fits that slot');
        else if (slot) r.placeServer(slot);
      } else if (d.id === 'overclock') {
        const target = partAt(parts, p.x, p.y);
        if (target) r.overclock(target.id);
      } else if (d.id === 'balancer') {
        if (slotAt(p.x, p.y) === LB_SLOT_ID) {
          const res = placeBalancer(r);
          if (!res.ok) this.refuse(res.reason);
        }
      }
      return;
    }

    const target = partAt(parts, p.x, p.y);
    if (!d.moved) {
      // A click on a part: select it (placed parts show the bin button).
      const clicked = target?.id === d.from ? target : null;
      this.selectedWire = null;
      this.selectedPart =
        clicked && clicked.slot !== null && this.selectedPart !== clicked.id ? clicked.id : null;
      return;
    }
    if (target && target.id !== d.from) r.connect(d.from, target.id);
  }

  private decommission(id: string): void {
    const res = run().decommission(id);
    if (res.ok) this.selectedPart = null;
  }

  // ---- test hook -----------------------------------------------------------------------------

  private testState(): BoardTestState {
    const r = run();
    const board = r.session.board;
    const rect = this.game.canvas.getBoundingClientRect();
    const page = (x: number, y: number) => toPage({ x, y }, rect, { width: GAME_WIDTH, height: GAME_HEIGHT });
    const offline = r.offline;
    const slots = [
      {
        id: LB_SLOT_ID,
        ...page(LB_SLOT.x, LB_SLOT.y),
        part: null as string | null,
        locked: !this.balancerUnlocked,
      },
      ...Object.entries(SERVER_PADS).map(([id, pad]) => ({
        id,
        ...page(pad.x, pad.y),
        part: board.parts.find((p) => p.slot === id)?.id ?? null,
        locked: false,
      })),
    ];
    slots[0].part = board.parts.find((p) => p.kind === 'balancer')?.id ?? null;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return {
      now: round(r.now),
      speed: r.speed,
      paused: r.paused,
      credits: round(board.credits),
      demand: round(r.demand),
      slots,
      tray: this.cards.map((c) => ({ id: c.id, label: c.label, locked: c.locked, ...page(c.x, c.y) })),
      parts: board.parts.flatMap((part) => {
        const c = partCentre(part);
        if (!c) return [];
        const look = partLook(part, r.flow.load[part.id] ?? 0, offline, r.session.offlineUntil, r.now);
        return [
          {
            id: part.id,
            kind: part.kind,
            slot: part.slot,
            ...page(c.x, c.y),
            status: look.status,
            left: round(look.left),
            boosted: part.boost !== undefined,
            load: round(look.load),
            capacity: look.capacity,
            share: look.share === null ? null : round(look.share),
            art: look.art,
            dark: look.dark,
            label: loadLabel(look),
          },
        ];
      }),
      wires: this.wireList.map((w) => ({
        key: w.key,
        from: w.from,
        to: w.to,
        ...page((w.ax + w.bx) / 2, (w.ay + w.by) / 2),
        rate: round(r.flow.wires[w.key] ?? 0),
        skipped: r.flow.skipped.includes(w.key),
      })),
      offline,
      skipped: [...r.flow.skipped],
      packets: { pool: this.pool.size, active: this.pool.active },
      selectedPart: this.selectedPart,
      selectedWire: this.selectedWire,
      cutButton: this.cutBtn.visible ? page(this.cutBtn.x, this.cutBtn.y) : null,
      binButton: this.binBtn.visible ? page(this.binBtn.x, this.binBtn.y) : null,
      refusal: this.refusalText.visible ? this.refusalText.text : null,
      dragging: this.drag ? (this.drag.kind === 'card' ? this.drag.id : 'wire') : null,
    };
  }
}
