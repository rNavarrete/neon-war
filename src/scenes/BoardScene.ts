import Phaser from 'phaser';
import { bus } from '../game/bus';
import { Director } from '../game/director';
import { run } from '../game/run';
import { type Part, wireKey } from '../sim/board';
import { provideTestState } from '../testHook';
import { balancerGiven, placeBalancer } from './board/crew';
import type { BoardTestState } from './board/hook';
import {
  type Box,
  BOARD_AREA,
  CHANNEL,
  INBOUND_LANES,
  LB_SLOT,
  LB_SLOT_ID,
  PAD_SIZE,
  SERVER_PADS,
  TABLE,
  TABLE_FACE,
  WIRE_PICK,
  type Point,
  channelAt,
  distToPath,
  partAt,
  partBox,
  partCentre,
  partSize,
  project,
  slotAt,
  slotBox,
  slotScale,
  pathLength,
  pointAlong,
  toPage,
  wirePath,
} from './board/layout';
import { ZONES, pageRect } from './live/layout';
import { PacketPool, progress, travelSeconds } from './board/packets';
import { InventoryView } from './board/InventoryView';
import {
  type InventoryCounts,
  LOCKED_KINDS,
  type TrayCard,
  inventoryCounts,
  lockedReason,
  trayCards,
} from './board/tray';
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
/** The inbound lanes by key, so the packet loop finds one without allocating a closure. */
const INBOUND_BY_KEY: ReadonlyMap<string, WireGeom> = new Map(INBOUND.map((w) => [w.key, w]));
const RED = 0xff4d5e;
/** Each inbound lane's share of the block's demand, scaled up so the incoming stream reads as busy. */
const INBOUND_STAGGER = [1.7, 2.1, 1.9] as const;
/** strokePoints reads only x and y, so a plain point list will do. */
const asVectors = (path: Point[]) => path as unknown as Phaser.Math.Vector2[];
/** How much the skyline above the table is dimmed, so the board reads first but the city still shows. */
const SKY_DIM = 0.3;
/** Where the skyline's horizon sits in its art (a share of its height), and where it goes on screen. */
const SKY_HORIZON = { art: 0.5, screen: TABLE.far.y - 8 } as const;

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
  private inventory!: InventoryView;
  private counts: InventoryCounts = { server: 0, overclock: 0, balancer: 0 };
  private countedParts: readonly Part[] | null = null;
  private countedGiven = false;
  private countedCredits = NaN;
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
  private sky!: Phaser.GameObjects.Image;
  private readonly travelOf = (wire: string): number =>
    (this.wireByKey.get(wire) ?? INBOUND_BY_KEY.get(wire))?.travel ?? 1;

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
    this.inventory = new InventoryView(this);
    this.countedParts = null;
    this.countedCredits = NaN;
    this.drag = null;
    this.selectedPart = null;
    this.selectedWire = null;
    this.refusalUntil = 0;

    this.drawBackdrop();

    // Slot pads: six server slots, each scaled by its row, and the load balancer's slot between the
    // gateway and the servers.
    for (const [id, p] of Object.entries(SERVER_PADS)) {
      const pad = this.add.image(p.x, p.y, 'slot-empty');
      pad.setScale((PAD_SIZE.w * slotScale(id)) / pad.width).setAlpha(0.8);
      this.pads.set(id, pad);
    }
    this.lbPad = this.add.image(LB_SLOT.x, LB_SLOT.y + 10, 'slot-locked');
    this.lbPad.setScale(PAD_SIZE.w / this.lbPad.width);

    this.wiresG = this.add.graphics();
    this.previewG = this.add.graphics();
    // Parts and packets are added lazily; keep them above the wires by depth.
    this.wiresG.setDepth(1);
    this.previewG.setDepth(4);

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
    // The screen behind every zone is dark; the HUD's panels sit on it.
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05070f, 1).setOrigin(0);

    // The feed: the city's skyline across the top of the zone, its horizon just behind the table's
    // far edge, cropped to the zone and dimmed a little so the board reads first.
    const feed = ZONES.feed;
    const sky = this.add.image(feed.x, 0, 'sky').setOrigin(0);
    const scale = feed.w / sky.width;
    const top = SKY_HORIZON.screen - SKY_HORIZON.art * sky.height * scale;
    sky.setScale(scale).setY(top);
    sky.setCrop(0, (feed.y - top) / scale, sky.width, feed.h / scale);
    this.sky = sky;
    this.add.rectangle(feed.x, feed.y, feed.w, feed.h, 0x05070f, SKY_DIM).setOrigin(0);

    const { left, top: areaTop } = BOARD_AREA;
    const slab = 'board-table';
    if (!this.textures.exists(slab)) this.bakeTable(slab);
    this.add.image(left, areaTop, slab).setOrigin(0);
    this.bakePacket();

    // The channel the block's traffic arrives along: a mouth on the feed's left edge narrowing to
    // the gateway's port, with amber banks.
    const { mouth, port } = CHANNEL;
    const lane = this.add.graphics();
    const walls = [
      { x: mouth.x, y: mouth.top },
      { x: port.x, y: port.top },
      { x: port.x, y: port.bottom },
      { x: mouth.x, y: mouth.bottom },
    ] as Phaser.Math.Vector2[];
    lane.fillStyle(0x03050b, 0.92).fillPoints(walls, true);
    for (const [width, alpha] of [
      [10, 0.08],
      [3, 0.6],
    ] as const) {
      lane
        .lineStyle(width, AMBER, alpha)
        .lineBetween(mouth.x, mouth.top, port.x, port.top)
        .lineBetween(mouth.x, mouth.bottom, port.x, port.bottom);
    }
    this.inboundG = this.add.graphics().setDepth(1);
  }

  /** Draw the table once, in the feed's own coordinates, and keep it as a texture: one image a frame. */
  private bakeTable(key: string): void {
    const g = this.make.graphics({}, false);
    drawTable(g, BOARD_AREA.left, BOARD_AREA.top);
    g.generateTexture(key, BOARD_AREA.right - BOARD_AREA.left, BOARD_AREA.bottom - BOARD_AREA.top);
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

  /** The inventory zone: drawn by InventoryView, its pointer kept here. */
  private drawTray(): void {
    const r = run();
    this.balancerUnlocked = balancerGiven(r);
    this.cards = trayCards(this.balancerUnlocked);
    this.inventory.create(this.cards);
    this.syncCounts(r.session.board.credits, r.session.board.parts, this.balancerUnlocked);
  }

  /**
   * Re-count the cards when what they count from changes: the parts, the gift, or the credits
   * crossing a whole credit (upkeep drips them down every frame). Nothing allocates otherwise.
   */
  private syncCounts(credits: number, parts: readonly Part[], given: boolean): void {
    const whole = Math.floor(credits);
    if (parts === this.countedParts && given === this.countedGiven && whole === this.countedCredits) return;
    this.countedParts = parts;
    this.countedGiven = given;
    this.countedCredits = whole;
    this.counts = inventoryCounts(credits, parts, given);
    this.inventory.setCounts(this.counts);
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
      this.inventory.setLocks(this.cards);
    }
    this.syncCounts(board.credits, board.parts, unlocked);
    this.inventory.setInFlight(this.drag?.kind === 'card' ? this.drag.id : null);

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
      const size = partSize(part);
      const s = slotScale(part.slot);
      const shadow = this.add
        .ellipse(c.x + 8 * s, c.y + size.h / 2 - 6 * s, size.w * 1.05, 26 * s, 0x000000, 0.55)
        .setDepth(1.5);
      // Nearer parts (lower on screen) draw over farther ones.
      const img = this.add.image(c.x, c.y, look.art).setDepth(3 + c.y / 1000);
      const label = this.add
        .text(c.x, c.y - size.h / 2 - 6, '', {
          fontFamily: 'monospace',
          fontSize: `${Math.round(18 * s)}px`,
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
      v.img.setScale(this.artScale(part, v.img));
    }
    return v;
  }

  /** Scale that fits a part's art inside its box on the board (smaller on the rack's far row). */
  private artScale(part: Pick<Part, 'kind' | 'slot'>, img: Phaser.GameObjects.Image): number {
    const size = partSize(part);
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

  /** The channel's chevrons, drifting toward the gateway faster as demand climbs. */
  private drawInbound(demand: number, dt: number): void {
    const g = this.inboundG;
    g.clear();
    const lane = INBOUND_LANES[1];
    const x0 = CHANNEL.mouth.x + 12;
    const x1 = CHANNEL.port.x - 24;
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
      const w = p?.active ? (this.wireByKey.get(p.wire) ?? INBOUND_BY_KEY.get(p.wire)) : undefined;
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

    const card = this.inventory.cardAt(p.x, p.y);
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
    const pageBox = (b: Box) => pageRect({ x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }, rect);
    const offline = r.offline;
    const slots = [
      {
        id: LB_SLOT_ID,
        ...page(LB_SLOT.x, LB_SLOT.y),
        part: null as string | null,
        locked: !this.balancerUnlocked,
        rect: pageBox(slotBox(LB_SLOT_ID)!),
      },
      ...Object.entries(SERVER_PADS).map(([id, pad]) => ({
        id,
        ...page(pad.x, pad.y),
        part: board.parts.find((p) => p.slot === id)?.id ?? null,
        locked: false,
        rect: pageBox(slotBox(id)!),
      })),
    ];
    slots[0].part = board.parts.find((p) => p.kind === 'balancer')?.id ?? null;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const feed = ZONES.feed;
    const skyShown = this.sky.visible && this.sky.alpha > 0;
    return {
      area: pageRect(feed, rect),
      backdrop: {
        // The band between the feed's top and the table's far edge, where only the city shows.
        skyline: skyShown
          ? pageRect({ x: feed.x, y: feed.y, w: feed.w, h: TABLE.far.y - feed.y }, rect)
          : null,
        goggles:
          this.textures.exists('goggles') ||
          this.children.list.some((o) => (o as Phaser.GameObjects.Image).texture?.key === 'goggles'),
      },
      now: round(r.now),
      speed: r.speed,
      paused: r.paused,
      credits: round(board.credits),
      demand: round(r.demand),
      slots,
      tray: this.cards.map((c) => ({
        id: c.id,
        label: c.label,
        locked: c.locked,
        ...page(c.x, c.y),
        count: this.inventory.countOf(c.id),
        price: c.price,
      })),
      inventory: { area: pageRect(ZONES.inventory, rect), counts: { ...this.counts } },
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
            rect: pageBox(partBox(part)!),
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

// ---- the table ---------------------------------------------------------------------------------

/**
 * The table the board stands on, seen tilted away like the mockup: the far edge narrower, the
 * grid's columns leaning in, rows closer together toward the far edge, a lit front face. Drawn
 * through project(u, v) in game space, shifted by (ox, oy) into the baked texture.
 */
function drawTable(g: Phaser.GameObjects.Graphics, ox: number, oy: number): void {
  const at = (u: number, v: number) => {
    const p = project(u, v);
    return { x: p.x - ox, y: p.y - oy };
  };
  const quad = (pts: { x: number; y: number }[]) => pts as Phaser.Math.Vector2[];
  const tl = at(0, 0);
  const tr = at(1, 0);
  const br = at(1, 1);
  const bl = at(0, 1);
  const face = TABLE_FACE;
  // Shadow on the rooftops, the front face, then the top.
  g.fillStyle(0x000000, 0.55).fillPoints(
    quad([
      { x: tl.x + 6, y: tl.y + 8 },
      { x: tr.x + 6, y: tr.y + 8 },
      { x: br.x + 6, y: br.y + face + 6 },
      { x: bl.x + 6, y: bl.y + face + 6 },
    ]),
    true,
  );
  g.fillStyle(0x05080f, 1).fillPoints(
    quad([bl, br, { x: br.x - 4, y: br.y + face }, { x: bl.x + 4, y: bl.y + face }]),
    true,
  );
  g.fillStyle(0x0b1322, 1).fillPoints(quad([tl, tr, br, bl]), true);
  // Rows get deeper toward the viewer; columns lean in toward the far edge.
  const rows = 10;
  const cols = 24;
  const vAt = (k: number) => Math.pow(k, 1.15);
  for (let r = 0; r < rows; r++) {
    const v0 = vAt(r / rows);
    const v1 = vAt((r + 1) / rows);
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2) continue;
      g.fillStyle(0x0f1a2e, 1).fillPoints(
        quad([at(c / cols, v0), at((c + 1) / cols, v0), at((c + 1) / cols, v1), at(c / cols, v1)]),
        true,
      );
    }
  }
  for (let r = 1; r < rows; r++) {
    const v = vAt(r / rows);
    const a = at(0, v);
    const b = at(1, v);
    g.lineStyle(r % 3 ? 1 : 2, CYAN, (r % 3 ? 0.06 : 0.13) + 0.05 * v).lineBetween(a.x, a.y, b.x, b.y);
  }
  for (let c = 1; c < cols; c++) {
    const a = at(c / cols, 0);
    const b = at(c / cols, 1);
    g.lineStyle(c % 4 ? 1 : 2, CYAN, c % 4 ? 0.07 : 0.14).lineBetween(a.x, a.y, b.x, b.y);
  }
  // Lit edges: the far rim dim, the near rim bright, small status lights along the front face.
  g.lineStyle(2, CYAN, 0.4).strokePoints(quad([tl, tr, br, bl]), true);
  g.lineStyle(3, CYAN, 0.85).lineBetween(bl.x, bl.y, br.x, br.y);
  for (let x = bl.x + 40; x < br.x - 40; x += 46) {
    g.fillStyle(Math.round(x) % 92 < 46 ? CYAN : AMBER, 0.75).fillRect(x, bl.y + face / 2 - 2, 14, 4);
  }
  // The channel's mouth is cut through the table's left rim, under the stream coming in.
  const mouth = channelAt(CHANNEL.mouth.x);
  g.fillStyle(0x03050b, 1).fillRect(0, mouth.top - oy, at(0, 0.5).x + 8, mouth.bottom - mouth.top);
}
