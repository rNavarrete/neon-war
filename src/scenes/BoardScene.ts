import Phaser from 'phaser';
import { bus } from '../game/bus';
import { Director } from '../game/director';
import { run } from '../game/run';
import { type Part, type PartKind, wireKey } from '../sim/board';
import { provideTestState } from '../testHook';
import { balancerGiven, placeBalancer } from './board/crew';
import type { BoardTestState } from './board/hook';
import {
  BOARD_AREA,
  INBOUND_LANES,
  LB_SLOT,
  LB_SLOT_ID,
  PAD_SIZE,
  PART_SIZE,
  SERVER_PADS,
  TRAY_AREA,
  WIRE_PICK,
  type Point,
  distToPath,
  inBox,
  partAt,
  partBox,
  partCentre,
  slotAt,
  pathLength,
  pointAlong,
  toPage,
  wirePath,
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
  sky: 'art/bg/skyline.webp',
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
  shadow: Phaser.GameObjects.Ellipse;
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
  /** The trace's corner points, and its length in game pixels. */
  path: Point[];
  length: number;
  /** Halfway along the trace: where the cut button and the test hook put the wire. */
  mid: Point;
  travel: number;
}

/** Packet "wires" for the block's incoming traffic, one per inbound lane. */
const INBOUND = INBOUND_LANES.map((path, i): WireGeom => {
  const length = pathLength(path);
  return {
    key: `inbound${i}`,
    from: 'block',
    to: 'gateway',
    path: [...path],
    length,
    mid: pointAlong(path, length, 0.5, { x: 0, y: 0 }),
    travel: travelSeconds(length),
  };
});
const RED = 0xff4d5e;
/** Each inbound lane's share of the block's demand, scaled up so the incoming stream reads as busy. */
const INBOUND_STAGGER = [1.7, 2.1, 1.9] as const;
/** strokePoints reads only x and y, so a plain point list will do. */
const asVectors = (path: Point[]) => path as unknown as Phaser.Math.Vector2[];
/** Board slab: a dark tiled surface with a raised rim, baked once into a texture. */
const SLAB_RIM = 26;
const TILE = 58;

type Drag =
  | { kind: 'card'; id: string }
  | { kind: 'wire'; from: string; x0: number; y0: number; moved: boolean }
  | null;

/**
 * The playable board: a solid circuit board over the city, seen through Lux's goggles; the parts
 * on it, the traces and packets between them (and the block's traffic streaming in), and the tray. It ticks the run and draws it; every rule lives in src/sim/.
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
  private packetSprites: Phaser.GameObjects.Image[] = [];
  private inboundG!: Phaser.GameObjects.Graphics;
  private packetRates: Record<string, number> = {};
  private hotParts = new Set<string>();
  private readonly at = { x: 0, y: 0 };
  private chevronShift = 0;
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
  private director: Director | null = null;
  private readonly travelOf = (wire: string): number =>
    (this.wireByKey.get(wire) ?? INBOUND.find((w) => w.key === wire))?.travel ?? 1;

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
    this.director?.destroy();
    this.director = new Director();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offBus?.();
      this.offBus = null;
      this.director?.destroy();
      this.director = null;
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
    this.director?.flush(this);
    // Packets move in real time (slowed by Regroup), not test speed, so their density reads the same.
    this.syncBoard(r.paused ? 0 : Math.min(seconds, 0.25) * r.timeScale);
  }

  // ---- drawing -------------------------------------------------------------------------------

  private drawBackdrop(): void {
    // The city behind the board, dimmed so the board reads first.
    const sky = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'sky');
    sky.setScale(Math.max(GAME_WIDTH / sky.width, GAME_HEIGHT / sky.height));
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05070f, 0.55).setOrigin(0);

    const { left, right, top, bottom } = BOARD_AREA;
    const w = right - left;
    const h = bottom - top;
    const slab = `board-slab-${BOARD_STYLE}`;
    if (!this.textures.exists(slab)) this.bakeSlab(slab, w, h);
    this.add.image(left - 12, top - 12, slab).setOrigin(0);
    this.bakePacket();
    if (BOARD_STYLE === 'pcb') this.addSilkscreen();

    // The lane the block's traffic arrives on: a groove cut through the rim into the gateway.
    const lane = this.add.graphics();
    const [top0, , bottom0] = INBOUND_LANES.map((l) => l[0].y);
    const x0 = INBOUND_LANES[1][0].x;
    const x1 = INBOUND_LANES[0][1].x + 10;
    lane.fillStyle(0x03050b, 0.9).fillRect(x0, top0 - 20, x1 - x0, bottom0 - top0 + 40);
    lane
      .lineStyle(3, AMBER, 0.55)
      .lineBetween(x0, top0 - 20, x1, top0 - 20)
      .lineBetween(x0, bottom0 + 20, x1, bottom0 + 20);
    lane
      .lineStyle(10, AMBER, 0.08)
      .lineBetween(x0, top0 - 20, x1, top0 - 20)
      .lineBetween(x0, bottom0 + 20, x1, bottom0 + 20);
    this.inboundG = this.add.graphics().setDepth(1);
  }

  /** Draw the board slab once and keep it as a texture: one image to draw each frame. */
  private bakeSlab(key: string, w: number, h: number): void {
    const pad = 12;
    const g = this.make.graphics({}, false);
    const W = w + pad * 2;
    const H = h + pad * 2 + SLAB_RIM;
    if (BOARD_STYLE === 'tilted') drawTiltedSlab(g, pad, w, h);
    else if (BOARD_STYLE === 'pcb') drawPcbSlab(g, pad, w, h);
    else drawTiledSlab(g, pad, w, h);
    g.generateTexture(key, W, H);
    g.destroy();
  }

  /** The packet: an amber cube with a soft glow, tinted red where traffic is being dropped. */
  private bakePacket(): void {
    if (this.textures.exists('packet')) return;
    const p = this.make.graphics({}, false);
    p.fillStyle(0xffffff, 0.18).fillRoundedRect(0, 0, 26, 26, 8);
    p.fillStyle(0xffffff, 0.35).fillRoundedRect(4, 4, 18, 18, 5);
    p.fillStyle(0xffffff, 1).fillRoundedRect(7, 7, 12, 12, 3);
    p.generateTexture('packet', 26, 26);
    p.destroy();
  }

  /** The PCB style's white silkscreen labels, printed on the board under the parts. */
  private addSilkscreen(): void {
    const ink = { fontFamily: 'monospace', fontSize: '15px', color: '#cfe8dc' };
    const labels: [number, number, string][] = [
      [BOARD_AREA.left + 56, BOARD_AREA.top + 18, 'HALATION BLOCK-NET  REV 0'],
      [BOARD_AREA.right - 210, BOARD_AREA.bottom - 40, 'LUX T.  NYE BUILD'],
      [GATEWAY_LABEL.x, GATEWAY_LABEL.y, 'J1 GATEWAY'],
      [LB_SLOT.x - 30, LB_SLOT.y + 70, 'U2 LB'],
      [DB_LABEL.x, DB_LABEL.y, 'U9 DB'],
    ];
    for (const [x, y, t] of labels) this.add.text(x, y, t, ink).setAlpha(0.45);
    for (const [id, pad] of Object.entries(SERVER_PADS)) {
      this.add
        .text(pad.x - 58, pad.y + 30, `U${2 + Number(id.slice(1))} ${id.toUpperCase()}`, ink)
        .setAlpha(0.45);
    }
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
    this.hotParts.clear();
    for (const part of board.parts) {
      const look = partLook(part, r.flow.load[part.id] ?? 0, offline, r.session.offlineUntil, r.now);
      // Traffic is being dropped here: the packets heading in turn red.
      if (look.dark || (look.share !== null && look.share > 1)) this.hotParts.add(part.id);
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
      v.shadow.destroy();
      v.label.destroy();
      this.views.delete(id);
    }

    // Selection can outlive what it pointed at (a cut, a decommission, a new run).
    if (this.selectedPart && !board.parts.some((p) => p.id === this.selectedPart && p.slot !== null)) {
      this.selectedPart = null;
    }
    if (this.selectedWire && !this.wireByKey.has(this.selectedWire)) this.selectedWire = null;

    this.drawWires(r.flow.wires, r.flow.skipped);
    this.drawInbound(r.demand, dt);
    this.stepPackets(dt, r.flow.wires, r.demand);
    this.placeButtons();

    if (this.refusalText.visible && this.time.now > this.refusalUntil) this.refusalText.setVisible(false);
  }

  private viewFor(part: Part, look: PartLook): PartView | null {
    let v = this.views.get(part.id);
    const c = partCentre(part);
    if (!c) return null;
    if (!v) {
      const size = PART_SIZE[part.kind];
      const shadow = this.add
        .ellipse(c.x + 8, c.y + size.h / 2 - 6, size.w * 1.05, 26, 0x000000, 0.55)
        .setDepth(1.5);
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
      v = { img, shadow, label, art: '', text: '', colour: '', seen: 0 };
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
      const path = a && b ? wirePath(a, b) : null;
      if (!path) continue;
      const length = pathLength(path);
      const g: WireGeom = {
        key: wireKey(w),
        from: w.from,
        to: w.to,
        path,
        length,
        mid: pointAlong(path, length, 0.5, { x: 0, y: 0 }),
        travel: travelSeconds(length),
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
      // A trace: a wide soft glow, a dark groove, then a bright core.
      g.lineStyle(18, colour, isSkipped ? 0.05 : live ? 0.16 : 0.08).strokePoints(asVectors(w.path));
      g.lineStyle(8, 0x03050b, 0.9).strokePoints(asVectors(w.path));
      g.lineStyle(3, colour, isSkipped ? 0.5 : live || selected ? 0.95 : 0.45).strokePoints(
        asVectors(w.path),
      );
      const a = w.path[0];
      const b = w.path[w.path.length - 1];
      g.fillStyle(colour, 0.95)
        .fillRect(a.x - 6, a.y - 6, 12, 12)
        .fillRect(b.x - 6, b.y - 6, 12, 12);
      if (isSkipped) {
        const tag = this.skipTag(tags++);
        tag.setPosition(w.mid.x, w.mid.y).setVisible(true);
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

  /** The incoming lane's chevrons, drifting toward the gateway faster as demand climbs. */
  private drawInbound(demand: number, dt: number): void {
    const g = this.inboundG;
    g.clear();
    const lane = INBOUND_LANES[1];
    const x0 = lane[0].x + 40;
    const x1 = lane[1].x - 60;
    const y = lane[0].y;
    const speed = 30 + Math.min(demand, 300) * 0.6;
    this.chevronShift = (this.chevronShift + dt * speed) % 34;
    g.lineStyle(4, AMBER, 0.55);
    for (let x = x0 + this.chevronShift; x < x1; x += 34) {
      g.lineBetween(x, y - 10, x + 10, y).lineBetween(x + 10, y, x, y + 10);
    }
  }

  private stepPackets(dt: number, rates: Readonly<Record<string, number>>, demand: number): void {
    // Every wire on the board, plus the inbound lanes sharing the block's demand.
    const all = this.packetRates;
    for (const key in all) delete all[key];
    for (const key in rates) all[key] = rates[key];
    // The incoming crowd: denser than a wire, and the lanes a little out of step so it never marches.
    for (let i = 0; i < INBOUND.length; i++)
      all[INBOUND[i].key] = (demand * INBOUND_STAGGER[i]) / INBOUND.length;
    this.pool.step(dt, all, this.travelOf);
    const items = this.pool.items;
    while (this.packetSprites.length < items.length) {
      this.packetSprites.push(this.add.image(0, 0, 'packet').setDepth(2));
    }
    for (let i = 0; i < this.packetSprites.length; i++) {
      const s = this.packetSprites[i];
      const p = items[i];
      const w = p?.active ? (this.wireByKey.get(p.wire) ?? INBOUND.find((x) => x.key === p.wire)) : undefined;
      if (!p || !w) {
        s.setVisible(false);
        continue;
      }
      pointAlong(w.path, w.length, progress(p), this.at);
      s.setPosition(this.at.x, this.at.y).setVisible(true);
      s.setTint(this.hotParts.has(w.to) ? RED : AMBER);
    }
  }

  private placeButtons(): void {
    const w = this.selectedWire ? this.wireByKey.get(this.selectedWire) : undefined;
    if (w) {
      this.cutBtn.setPosition(w.mid.x, w.mid.y - 40).setVisible(true);
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
      const d = distToPath(p.x, p.y, w.path);
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
        ...page(w.mid.x, w.mid.y),
        rate: round(r.flow.wires[w.key] ?? 0),
        skipped: r.flow.skipped.includes(w.key),
      })),
      offline,
      skipped: [...r.flow.skipped],
      packets: { pool: this.pool.size, active: this.pool.active },
      rewinds: r.play.rewinds.map((w) => ({ at: round(w.at), to: w.to })),
      selectedPart: this.selectedPart,
      selectedWire: this.selectedWire,
      cutButton: this.cutBtn.visible ? page(this.cutBtn.x, this.cutBtn.y) : null,
      binButton: this.binBtn.visible ? page(this.binBtn.x, this.binBtn.y) : null,
      refusal: this.refusalText.visible ? this.refusalText.text : null,
      dragging: this.drag ? (this.drag.kind === 'card' ? this.drag.id : 'wire') : null,
    };
  }
}

// ---- board slab styles (test-only `?board=` picks one to compare; tiled is the default) ----------

type BoardStyle = 'tiled' | 'tilted' | 'pcb';
const BOARD_STYLE: BoardStyle = (() => {
  const v = new URLSearchParams(window.location.search).get('board');
  return v === 'tilted' || v === 'pcb' ? v : 'tiled';
})();
const GATEWAY_LABEL = { x: 548, y: 618 };
const DB_LABEL = { x: 1405, y: 590 };

/** Corner brackets just inside a rectangle's corners. */
function brackets(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: number,
) {
  g.lineStyle(5, colour, 0.95);
  const arm = 46;
  for (const [cx, cy, sx, sy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]) {
    g.lineBetween(cx + sx * 4, cy + sy * 14, cx + sx * 4, cy + sy * arm);
    g.lineBetween(cx + sx * 14, cy + sy * 4, cx + sx * arm, cy + sy * 4);
  }
}

/** A flat slab of dark tiles with a fine grid, a raised rim and cross marks. */
function drawTiledSlab(g: Phaser.GameObjects.Graphics, pad: number, w: number, h: number): void {
  g.fillStyle(0x000000, 0.55).fillRoundedRect(pad + 10, pad + 18, w, h + SLAB_RIM, 22);
  g.fillStyle(0x070b16, 1).fillRoundedRect(pad, pad + SLAB_RIM, w, h, 22);
  g.lineStyle(2, CYAN, 0.25).strokeRoundedRect(pad, pad + SLAB_RIM, w, h, 22);
  g.fillStyle(0x0c1526, 1).fillRoundedRect(pad, pad, w, h, 22);
  for (let ty = 0; ty * TILE < h; ty++) {
    for (let tx = 0; tx * TILE < w; tx++) {
      if ((tx + ty) % 2) continue;
      g.fillStyle(0x101b30, 1).fillRect(
        pad + tx * TILE + 2,
        pad + ty * TILE + 2,
        Math.min(TILE, w - tx * TILE) - 4,
        Math.min(TILE, h - ty * TILE) - 4,
      );
    }
  }
  for (let i = 1; i * TILE < w; i++) {
    const x = pad + i * TILE;
    g.lineStyle(i % 4 ? 1 : 2, CYAN, i % 4 ? 0.07 : 0.14).lineBetween(x, pad + 6, x, pad + h - 6);
  }
  for (let i = 1; i * TILE < h; i++) {
    const y = pad + i * TILE;
    g.lineStyle(i % 4 ? 1 : 2, CYAN, i % 4 ? 0.07 : 0.14).lineBetween(pad + 6, y, pad + w - 6, y);
  }
  g.lineStyle(2, CYAN, 0.4);
  for (let i = 4; i * TILE < w; i += 4) {
    for (let j = 4; j * TILE < h; j += 4) {
      const x = pad + i * TILE;
      const y = pad + j * TILE;
      g.lineBetween(x - 7, y, x + 7, y).lineBetween(x, y - 7, x, y + 7);
    }
  }
  g.lineStyle(3, CYAN, 0.6).strokeRoundedRect(pad, pad, w, h, 22);
  g.lineStyle(1, 0xffffff, 0.07).strokeRoundedRect(pad + 8, pad + 8, w - 16, h - 16, 16);
  brackets(g, pad, pad, w, h, CYAN);
}

/**
 * A table tilted away from the viewer, like the mockup: the far edge narrower, the grid lines
 * converging, a deep lit front edge. Parts stay where the flat layout puts them.
 */
function drawTiltedSlab(g: Phaser.GameObjects.Graphics, pad: number, w: number, h: number): void {
  const inset = 70;
  const tl = { x: pad + inset, y: pad };
  const tr = { x: pad + w - inset, y: pad };
  const br = { x: pad + w, y: pad + h };
  const bl = { x: pad, y: pad + h };
  const face = SLAB_RIM;
  // Shadow, front face, top.
  g.fillStyle(0x000000, 0.6).fillPoints(
    [
      { x: tl.x + 12, y: tl.y + 20 },
      { x: tr.x + 12, y: tr.y + 20 },
      { x: br.x + 12, y: br.y + face + 10 },
      { x: bl.x + 12, y: bl.y + face + 10 },
    ] as Phaser.Math.Vector2[],
    true,
  );
  g.fillStyle(0x05080f, 1).fillPoints(
    [bl, br, { x: br.x - 6, y: br.y + face }, { x: bl.x + 6, y: bl.y + face }] as Phaser.Math.Vector2[],
    true,
  );
  g.fillStyle(0x0b1322, 1).fillPoints([tl, tr, br, bl] as Phaser.Math.Vector2[], true);
  // Rows get taller toward the viewer; columns converge toward the far edge.
  const rows = 12;
  const cols = 20;
  const yAt = (k: number) => pad + h * Math.pow(k, 1.25);
  const xAt = (k: number, y: number) => {
    const t = (y - pad) / h;
    const left = tl.x + (bl.x - tl.x) * t;
    const right = tr.x + (br.x - tr.x) * t;
    return left + (right - left) * k;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2) continue;
      const y0 = yAt(r / rows);
      const y1 = yAt((r + 1) / rows);
      g.fillStyle(0x0f1a2e, 1).fillPoints(
        [
          { x: xAt(c / cols, y0), y: y0 },
          { x: xAt((c + 1) / cols, y0), y: y0 },
          { x: xAt((c + 1) / cols, y1), y: y1 },
          { x: xAt(c / cols, y1), y: y1 },
        ] as Phaser.Math.Vector2[],
        true,
      );
    }
  }
  for (let r = 1; r < rows; r++) {
    const y = yAt(r / rows);
    g.lineStyle(r % 3 ? 1 : 2, CYAN, (r % 3 ? 0.07 : 0.15) + 0.06 * (r / rows)).lineBetween(
      xAt(0, y),
      y,
      xAt(1, y),
      y,
    );
  }
  for (let c = 1; c < cols; c++) {
    g.lineStyle(c % 4 ? 1 : 2, CYAN, c % 4 ? 0.08 : 0.16).lineBetween(
      xAt(c / cols, pad),
      pad,
      xAt(c / cols, pad + h),
      pad + h,
    );
  }
  // Lit edges: the far rim dim, the near rim bright, small status lights along the front face.
  g.lineStyle(3, CYAN, 0.45).strokePoints([tl, tr, br, bl] as Phaser.Math.Vector2[], true);
  g.lineStyle(4, CYAN, 0.9).lineBetween(bl.x, bl.y, br.x, br.y);
  for (let x = bl.x + 40; x < br.x - 40; x += 46)
    g.fillStyle(x % 92 < 46 ? CYAN : AMBER, 0.8).fillRect(x, bl.y + 10, 14, 4);
}

/** A circuit board: dark green fibreglass, faint copper routing, vias, mounting holes and gold edge fingers. */
function drawPcbSlab(g: Phaser.GameObjects.Graphics, pad: number, w: number, h: number): void {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle(0x000000, 0.55).fillRoundedRect(pad + 10, pad + 18, w, h + SLAB_RIM, 14);
  g.fillStyle(0x06120c, 1).fillRoundedRect(pad, pad + 10, w, h, 14);
  g.fillStyle(0x0b2117, 1).fillRoundedRect(pad, pad, w, h, 14);
  // Fibreglass weave.
  for (let i = 0; i < 1600; i++) {
    g.fillStyle(0x12301f, 0.6).fillRect(pad + rand() * w, pad + rand() * h, 2, 2);
  }
  // Background copper: thin traces with 45-degree jogs and vias, under everything the player builds.
  for (let i = 0; i < 46; i++) {
    let x = pad + 30 + rand() * (w - 60);
    let y = pad + 30 + rand() * (h - 60);
    g.lineStyle(2, 0xb87333, 0.22);
    for (let s = 0; s < 3; s++) {
      const len = 40 + rand() * 160;
      const dir = Math.floor(rand() * 4);
      const nx = Math.max(
        pad + 20,
        Math.min(pad + w - 20, x + (dir === 0 ? len : dir === 1 ? -len : len * 0.4)),
      );
      const ny = Math.max(
        pad + 20,
        Math.min(pad + h - 20, y + (dir === 2 ? len : dir === 3 ? -len : len * 0.4)),
      );
      g.lineBetween(x, y, nx, ny);
      x = nx;
      y = ny;
    }
    g.fillStyle(0x0b2117, 1).fillCircle(x, y, 5);
    g.lineStyle(2, 0xd4a35a, 0.45).strokeCircle(x, y, 5);
  }
  // Mounting holes, a lit outline and gold edge fingers along the bottom.
  for (const [x, y] of [
    [pad + 26, pad + 26],
    [pad + w - 26, pad + 26],
    [pad + 26, pad + h - 26],
    [pad + w - 26, pad + h - 26],
  ]) {
    g.fillStyle(0x020604, 1).fillCircle(x, y, 10);
    g.lineStyle(4, 0xd4a35a, 0.8).strokeCircle(x, y, 13);
  }
  g.lineStyle(3, 0x3ddc84, 0.55).strokeRoundedRect(pad, pad, w, h, 14);
  for (let x = pad + w * 0.3; x < pad + w * 0.7; x += 18)
    g.fillStyle(0xd4a35a, 0.9).fillRect(x, pad + h - 4, 11, 22);
}
