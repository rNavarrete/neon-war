import Phaser from 'phaser';
import { bus } from '../game/bus';
import { Director } from '../game/director';
import { run } from '../game/run';
import { type Part, wireKey } from '../sim/board';
import { provideTestState } from '../testHook';
import { type Frame, frame } from '../game/frame';
import { balancerGiven, balancerGivenIn, placeBalancer } from './board/crew';
import type { BoardTestState } from './board/hook';
import {
  type Box,
  BOARD_AREA,
  RACK_ROWS,
  SERVER_GRID,
  padBox,
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
import { PacketPool, fillPacketRates, progress, travelSeconds } from './board/packets';
import { BoardSnapshot } from './board/snapshot';
import { InventoryView } from './board/InventoryView';
import {
  type InventoryCounts,
  LOCKED_KINDS,
  type TrayCard,
  inventoryCounts,
  lockedReason,
  trayCards,
} from './board/tray';
import {
  type BarColour,
  LabelCache,
  type MutablePartLook,
  type PartTrouble,
  artFor,
  emptyLook,
  flickerLit,
  loadLabel,
  partLook,
  partLookInto,
  partTags,
  skipTagUntil,
  tagChip,
  tagChipKey,
} from './board/view';
import { dashedOutline } from './live/view';
import {
  type ChannelState,
  bankMarkPoints,
  channelInto,
  emptyChannel,
  fillInboundRates,
  lanePps,
  levelY,
} from './board/channel';
import { LABELS } from './hud/labels';
import { settings } from '../game/settings';
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
  /** The part's look, refilled in place every frame. */
  look: MutablePartLook;
  /** The readout's text and colour, rebuilt only when what they show changes. */
  readout: LabelCache;
  /** Frame the part was last seen on the board, to sweep views of removed parts. */
  seen: number;
  /** The load bar (board-5), redrawn only when its fill or colour changes; null for the gateway. */
  bar: Phaser.GameObjects.Graphics | null;
  barKey: number;
  /** The tag chip (DIES IN n s, UNFED) on the part, re-set only when tagChipKey changes. */
  chip: Phaser.GameObjects.Text;
  chipKey: number;
  /** The warning triangle at the part's top corner. */
  warn: Phaser.GameObjects.Graphics;
  /** Lit this frame (false only on the dark half of a power flicker's 6 Hz blink). */
  lit: boolean;
}

/** A server pad and what the board draws on it: the dashed grey outline and the sticky SKIPPED tag. */
interface PadView {
  slot: string;
  pad: Phaser.GameObjects.Image;
  dash: Phaser.GameObjects.Graphics;
  chip: Phaser.GameObjects.Text;
  /** Board-clock second the SKIPPED tag shows until (skipTagUntil); -Infinity before any skip. */
  skipUntil: number;
  /** The balancer skips the box on this pad this frame (the sim's flow.skipped). */
  skipped: boolean;
}

const BAR_COLOURS: Readonly<Record<BarColour, number>> = {
  cyan: 0x2de2e6,
  amber: 0xffb02e,
  red: 0xff4d5e,
  grey: 0x6b7385,
};
const BAR_INDEX: Readonly<Record<BarColour, number>> = { cyan: 1, amber: 2, red: 3, grey: 4 };
/** Alpha of a part on the dark half of a flicker blink. */
const FLICKER_DIM = 0.35;

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
/** The inbound lanes' packet keys, in lane order. */
const INBOUND_KEYS: readonly string[] = INBOUND.map((w) => w.key);
const RED = 0xff4d5e;
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
  /** The one Frame read per board frame, and the board's frame count. */
  private snap = new BoardSnapshot();
  private pads = new Map<string, Phaser.GameObjects.Image>();
  /** The server pads in a plain list, so the per-frame loop needs no Map iterator. */
  private padList: PadView[] = [];
  /** What tells dark from dead this frame: the Frame's lists and the sim's overload seconds. */
  private readonly trouble: { -readonly [K in keyof PartTrouble]: PartTrouble[K] } = {
    dead: [],
    dark: [],
    dips: [],
    overload: {},
  };
  /** The board clock in seconds (the scene's own time): sticky tags and blinks run on it. */
  private clock = 0;
  /** settings().reduceFlicker as read this frame. */
  private reduceFlicker = false;
  /** Each wire's drawn state (live, skipped, selected) last time the traces were drawn. */
  private wireState: number[] = [];
  private wiresDirty = true;
  private previewShown = false;
  private lbPad!: Phaser.GameObjects.Image;
  private wiresG!: Phaser.GameObjects.Graphics;
  private previewG!: Phaser.GameObjects.Graphics;
  private wireList: WireGeom[] = [];
  private wireByKey = new Map<string, WireGeom>();
  private lastWires: readonly unknown[] | null = null;
  private lastParts: readonly unknown[] | null = null;
  private pool = new PacketPool();
  private packetSprites: Phaser.GameObjects.Image[] = [];
  /** The channel this frame (board-4), refilled in place, and what its graphics last drew. */
  private chan: ChannelState = emptyChannel();
  private fillG!: Phaser.GameObjects.Graphics;
  private roomG!: Phaser.GameObjects.Graphics;
  private roomText!: Phaser.GameObjects.Text;
  private forecastG!: Phaser.GameObjects.Graphics;
  private drawnLevel = NaN;
  private drawnRetry = NaN;
  private drawnRoom = NaN;
  private drawnForecast: number | null | undefined = undefined;
  /** The four corners of a channel band, reused for every fill. */
  private readonly band = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  private packetRates: Record<string, number> = {};
  private hotParts = new Set<string>();
  private readonly at = { x: 0, y: 0 };
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
  /** Created once with the scene: the pool calls it per wire per frame without a new closure. */
  private readonly travelOf = (wire: string): number =>
    (this.wireByKey.get(wire) ?? INBOUND_BY_KEY.get(wire))?.travel ?? 1;
  /** Bound once: drops the sprites of a part no longer on the board (Map.forEach, no iterator). */
  private readonly sweepView = (v: PartView, id: string): void => {
    if (v.seen === this.snap.count) return;
    v.img.destroy();
    v.shadow.destroy();
    v.label.destroy();
    v.bar?.destroy();
    v.chip.destroy();
    v.warn.destroy();
    this.views.delete(id);
  };

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
    this.snap.reset();
    this.pads = new Map();
    this.padList = [];
    this.wireState = [];
    this.wiresDirty = true;
    this.previewShown = false;
    this.wireList = [];
    this.wireByKey = new Map();
    this.lastWires = null;
    this.lastParts = null;
    this.pool = new PacketPool();
    this.packetSprites = [];
    this.skipTags = [];
    this.chan = emptyChannel();
    this.drawnLevel = NaN;
    this.drawnRetry = NaN;
    this.drawnRoom = NaN;
    this.drawnForecast = undefined;
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
      this.padList.push(this.makePad(id, pad));
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
    this.syncBoard(seconds);
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
    this.drawBank();
  }

  /**
   * The channel's instruments (board-4): the amber fill and its red retry band, the cyan ROOM tick
   * at the wired boxes' req/s, the dashed forecast level, and the five bank marks at the mouth on
   * the shared 0..400 scale. The marks are drawn once; the rest redraw only when their level moves.
   */
  private drawBank(): void {
    const { mouth } = CHANNEL;
    this.fillG = this.add.graphics().setDepth(0.5);
    this.forecastG = this.add.graphics().setDepth(0.6);
    this.roomG = this.add.graphics().setDepth(0.7);
    const ticks = this.add.graphics().setDepth(0.8);
    ticks.lineStyle(2, AMBER, 0.8);
    for (const m of bankMarkPoints()) {
      ticks.lineBetween(mouth.x, m.y, mouth.x + 4, m.y);
      this.add
        .text(m.x, m.y, m.label, {
          fontFamily: 'monospace',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#ffb02e',
          stroke: '#05070f',
          strokeThickness: 3,
        })
        .setOrigin(0, 0.5)
        .setDepth(0.8);
    }
    this.roomText = this.add
      .text(0, 0, LABELS.gauge.room, {
        fontFamily: 'monospace',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#2de2e6',
        stroke: '#05070f',
        strokeThickness: 3,
      })
      .setOrigin(1, 1)
      .setDepth(0.8)
      .setVisible(false);
  }

  /** Bring the channel's drawing in line with this frame's state; steady frames draw nothing. */
  private drawChannel(c: ChannelState): void {
    const { mouth, port } = CHANNEL;
    const level = Math.round(c.level * 1000) / 1000;
    const retry = Math.round(c.retryShare * 1000) / 1000;
    if (level !== this.drawnLevel || retry !== this.drawnRetry) {
      this.drawnLevel = level;
      this.drawnRetry = retry;
      const g = this.fillG;
      g.clear();
      if (level > 0) {
        // The amber fill from the floor to the level, then the red retry band on its top.
        const split = level * (1 - retry);
        this.fillBand(g, 0, split, AMBER, 0.32);
        if (retry > 0) this.fillBand(g, split, level, RED, 0.55);
        g.lineStyle(2, AMBER, 0.9).lineBetween(
          mouth.x,
          levelY(level, mouth.x),
          port.x,
          levelY(level, port.x),
        );
      }
    }
    const room = Math.round(c.capacityLevel * 1000) / 1000;
    if (room !== this.drawnRoom) {
      this.drawnRoom = room;
      const g = this.roomG;
      g.clear();
      if (room > 0) {
        const y0 = levelY(room, mouth.x);
        const y1 = levelY(room, port.x);
        g.lineStyle(6, CYAN, 0.25).lineBetween(mouth.x, y0, port.x, y1);
        g.lineStyle(2, CYAN, 1).lineBetween(mouth.x, y0, port.x, y1);
        this.roomText.setPosition(port.x - 4, y1 - 2).setVisible(true);
      } else {
        this.roomText.setVisible(false);
      }
    }
    if (c.forecast !== this.drawnForecast) {
      this.drawnForecast = c.forecast;
      const g = this.forecastG;
      g.clear();
      if (c.forecast !== null) {
        g.lineStyle(2, AMBER, 1);
        // Dashes along the level from the mouth to the port.
        const steps = 10;
        for (let i = 0; i < steps; i += 2) {
          const xa = mouth.x + ((port.x - mouth.x) * i) / steps;
          const xb = mouth.x + ((port.x - mouth.x) * (i + 1)) / steps;
          g.lineBetween(xa, levelY(c.forecast, xa), xb, levelY(c.forecast, xb));
        }
      }
    }
    // The forecast pulses at 1 Hz; steady under reduce flicker.
    if (c.forecast !== null) {
      this.forecastG.setAlpha(
        settings().reduceFlicker ? 0.9 : 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * (this.time.now / 1000))),
      );
    }
  }

  /** Fill the channel between two levels (0..1) with one colour. */
  private fillBand(
    g: Phaser.GameObjects.Graphics,
    from: number,
    to: number,
    colour: number,
    alpha: number,
  ): void {
    const { mouth, port } = CHANNEL;
    const q = this.band;
    q[0].x = mouth.x;
    q[0].y = levelY(to, mouth.x);
    q[1].x = port.x;
    q[1].y = levelY(to, port.x);
    q[2].x = port.x;
    q[2].y = levelY(from, port.x);
    q[3].x = mouth.x;
    q[3].y = levelY(from, mouth.x);
    g.fillStyle(colour, alpha).fillPoints(asVectors(q), true);
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

  /**
   * Bring every sprite in line with the run this frame. `seconds` is the frame's real length.
   * Everything below reads the one Frame taken here (frame() memoises per sim change), never
   * run().flow or run().offline, and the steady path allocates nothing: looks, labels, rates and
   * pads are reused, and the loops take no closures.
   */
  private syncBoard(seconds: number): void {
    const f = this.snap.next(run());
    const count = this.snap.count;
    const parts = f.parts;
    const flow = f.flow;
    // Packets move in real time (slowed by Regroup), not test speed, so their density reads the same.
    const dt = f.paused ? 0 : Math.min(seconds, 0.25) * f.timeScale;

    const unlocked = balancerGivenIn(f.rescued, parts);
    if (unlocked !== this.balancerUnlocked) {
      this.balancerUnlocked = unlocked;
      this.cards = trayCards(unlocked);
      this.inventory.setLocks(this.cards);
    }
    this.syncCounts(f.credits, parts, unlocked);
    const d = this.drag;
    this.inventory.setInFlight(d?.kind === 'card' ? d.id : null);

    if (f.wires !== this.lastWires || parts !== this.lastParts) this.rebuildWires(f);

    // Parts. `unlocked` is already true once a balancer is racked.
    this.lbPad.setTexture(unlocked ? 'slot-empty' : 'slot-locked');
    const placingServer = d?.kind === 'card' && d.id === 'server';
    const t = this.time.now / 1000;
    this.clock = t;
    const reduce = settings().reduceFlicker;
    this.reduceFlicker = reduce;
    const trouble = this.trouble;
    trouble.dead = f.dead;
    trouble.dark = f.dark;
    trouble.dips = f.dips;
    trouble.overload = this.snap.overload;
    for (let i = 0; i < this.padList.length; i++) {
      const pv = this.padList[i];
      const pad = pv.pad;
      const onPad = partInSlot(parts, pv.slot);
      const target = placingServer && onPad === null;
      pad.setAlpha(target ? 1 : 0.8);
      if (target) pad.setTint(0x9ffcff);
      else pad.clearTint();
      // The balancer skips the box on this pad: grey dashed pad, SKIPPED sticky for 1 s after.
      pv.skipped = onPad !== null && this.isSkipped(flow.skipped, onPad.id);
      pv.skipUntil = onPad === null ? -Infinity : skipTagUntil(pv.skipUntil, pv.skipped, t);
      const shown = t < pv.skipUntil;
      pv.dash.setVisible(shown);
      pv.chip.setVisible(shown);
    }
    const pulse = reduce ? 0.55 : 0.55 + 0.25 * Math.sin(this.time.now / 120);
    this.hotParts.clear();
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const v = this.viewFor(part);
      if (!v) continue;
      const look = partLookInto(
        v.look,
        part,
        flow.load[part.id] ?? 0,
        f.offline,
        f.offlineUntil,
        f.now,
        trouble,
      );
      // Traffic is being dropped here: the packets heading in turn red.
      if (look.dark || (look.share !== null && look.share > 1)) this.hotParts.add(part.id);
      v.seen = count;
      if (v.art !== look.art) {
        v.art = look.art;
        v.img.setTexture(look.art);
        v.img.setScale(this.artScale(part, v.img));
      }
      if (look.dark) v.img.setTint(DARK_TINT);
      else v.img.clearTint();
      v.lit = flickerLit(f.flickering.includes(part.id), t, reduce);
      const base = look.status === 'booting' || look.status === 'rebooting' ? pulse + 0.2 : 1;
      v.img.setAlpha(v.lit ? base : FLICKER_DIM);
      if (v.readout.update(look)) v.label.setText(v.readout.text).setColor(v.readout.colour);
      this.drawPartState(part, v);
    }
    this.views.forEach(this.sweepView);

    // Selection can outlive what it pointed at (a cut, a decommission, a new run).
    if (this.selectedPart) {
      const sel = partById(parts, this.selectedPart);
      if (!sel || sel.slot === null) this.selectedPart = null;
    }
    if (this.selectedWire && !this.wireByKey.has(this.selectedWire)) this.selectedWire = null;

    this.drawWires(flow.wires, flow.skipped);
    this.drawPreview(parts);
    this.drawChannel(channelInto(this.chan, f));
    this.stepPackets(dt, flow.wires, f.demand);
    this.placeButtons(parts);

    if (this.refusalText.visible && this.time.now > this.refusalUntil) this.refusalText.setVisible(false);
  }

  /** The part's load bar, tag chip and warning triangle, re-set only when what they show changes. */
  private drawPartState(part: Part, v: PartView): void {
    const look = v.look;
    const bar = v.bar;
    if (bar) {
      const key = BAR_INDEX[look.barColour] * 1000 + Math.round(look.bar * 100);
      if (key !== v.barKey) {
        v.barKey = key;
        const c = partCentre(part);
        if (c) {
          const size = partSize(part);
          const w = size.w * 0.8;
          const h = 6 * slotScale(part.slot);
          const x = c.x - w / 2;
          const y = c.y + size.h / 2 + 3;
          bar.clear();
          bar.fillStyle(0x05070f, 0.85).fillRect(x - 2, y - 2, w + 4, h + 4);
          bar.fillStyle(0x1b2233, 1).fillRect(x, y, w, h);
          if (look.bar > 0) bar.fillStyle(BAR_COLOURS[look.barColour], 1).fillRect(x, y, w * look.bar, h);
        }
      }
    }
    const chipKey = tagChipKey(look);
    if (chipKey !== v.chipKey) {
      v.chipKey = chipKey;
      const text = tagChip(look);
      if (text === null) {
        v.chip.setVisible(false);
      } else {
        v.chip
          .setText(text)
          .setBackgroundColor(look.diesIn !== null ? '#c8283a' : '#3b4150')
          .setColor(look.diesIn !== null ? '#ffffff' : '#c5cad6')
          .setVisible(true);
      }
    }
    v.warn.setVisible(look.warning && v.lit);
  }

  /** Whether the balancer skipped a wire into `id` this frame (plain loops: no closure, no string built). */
  private isSkipped(skipped: readonly string[], id: string): boolean {
    if (skipped.length === 0) return false;
    const list = this.wireList;
    for (let i = 0; i < list.length; i++) if (list[i].to === id && skipped.includes(list[i].key)) return true;
    return false;
  }

  /** A server pad's view: its image, the dashed grey outline and the SKIPPED tag, both hidden. */
  private makePad(slot: string, pad: Phaser.GameObjects.Image): PadView {
    const b = padBox(slot)!;
    const s = slotScale(slot);
    const dash = this.add.graphics().setDepth(1.4).setVisible(false);
    dash.lineStyle(2, GREY, 0.95);
    dash.beginPath();
    for (const seg of dashedOutline({ x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }, 8, 6)) {
      dash.moveTo(seg.x1, seg.y1);
      dash.lineTo(seg.x2, seg.y2);
    }
    dash.strokePath();
    const chip = this.add
      .text(b.x, b.y + b.h / 2, LABELS.partTags.skipped, {
        fontFamily: 'monospace',
        fontSize: `${Math.round(14 * s)}px`,
        fontStyle: 'bold',
        color: '#c5cad6',
        backgroundColor: '#3b4150',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(6)
      .setVisible(false);
    return { slot, pad, dash, chip, skipUntil: -Infinity, skipped: false };
  }

  /** The part's sprites, made the first time it is seen (a part never moves once placed). */
  private viewFor(part: Part): PartView | null {
    const known = this.views.get(part.id);
    if (known) return known;
    const c = partCentre(part);
    if (!c) return null;
    const size = partSize(part);
    const s = slotScale(part.slot);
    const shadow = this.add
      .ellipse(c.x + 8 * s, c.y + size.h / 2 - 6 * s, size.w * 1.05, 26 * s, 0x000000, 0.55)
      .setDepth(1.5);
    // Nearer parts (lower on screen) draw over farther ones. The sync sets the right art next.
    const img = this.add.image(c.x, c.y, artFor(part, false)).setDepth(3 + c.y / 1000);
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
    // The load bar under the part (parts with a limit), the tag chip near its top, the triangle.
    const bar = part.kind === 'gateway' ? null : this.add.graphics().setDepth(5);
    const chip = this.add
      .text(c.x, c.y - size.h / 2 + 16 * s, '', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(15 * s)}px`,
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#3b4150',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(6)
      .setVisible(false);
    const warn = this.add.graphics().setDepth(6).setVisible(false);
    const tx = c.x + size.w / 2 - 4;
    const ty = c.y - size.h / 2 + 2;
    const r = 13 * s;
    warn
      .fillStyle(0x05070f, 0.9)
      .fillTriangle(tx, ty - r - 3, tx - r - 3, ty + r * 0.8 + 2, tx + r + 3, ty + r * 0.8 + 2);
    warn.fillStyle(RED, 1).fillTriangle(tx, ty - r, tx - r, ty + r * 0.8, tx + r, ty + r * 0.8);
    warn
      .fillStyle(0xffffff, 1)
      .fillRect(tx - 1.5, ty - r * 0.45, 3, r * 0.7)
      .fillRect(tx - 1.5, ty + r * 0.4, 3, 3);
    const v: PartView = {
      img,
      shadow,
      label,
      art: '',
      look: emptyLook(),
      readout: new LabelCache(),
      seen: 0,
      bar,
      barKey: -1,
      chip,
      chipKey: -1,
      warn,
      lit: true,
    };
    this.views.set(part.id, v);
    return v;
  }

  /** Scale that fits a part's art inside its box on the board (smaller on the rack's far row). */
  private artScale(part: Pick<Part, 'kind' | 'slot'>, img: Phaser.GameObjects.Image): number {
    const size = partSize(part);
    return Math.min(size.w / img.width, size.h / img.height);
  }

  /** Lay the traces out again: only when the wires or parts change, never on a steady frame. */
  private rebuildWires(f: Frame): void {
    this.lastWires = f.wires;
    this.lastParts = f.parts;
    this.wireList = [];
    this.wireByKey = new Map();
    this.wiresDirty = true;
    for (const w of f.wires) {
      const a = partById(f.parts, w.from);
      const b = partById(f.parts, w.to);
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

  /**
   * Redraw the traces only when one changes how it looks (live, skipped or selected) or the wires
   * were laid out again; on a steady frame the graphics keep last frame's drawing.
   */
  private drawWires(rates: Readonly<Record<string, number>>, skipped: readonly string[]): void {
    const list = this.wireList;
    const state = this.wireState;
    let dirty = this.wiresDirty || state.length !== list.length;
    for (let i = 0; i < list.length; i++) {
      const key = list[i].key;
      const s =
        (skipped.includes(key) ? 1 : 0) |
        ((rates[key] ?? 0) > 0 ? 2 : 0) |
        (key === this.selectedWire ? 4 : 0);
      if (state[i] !== s) {
        state[i] = s;
        dirty = true;
      }
    }
    state.length = list.length;
    if (!dirty) return;
    this.wiresDirty = false;
    const g = this.wiresG;
    g.clear();
    let tags = 0;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const isSkipped = (state[i] & 1) !== 0;
      const live = (state[i] & 2) !== 0;
      const selected = (state[i] & 4) !== 0;
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
  }

  /** The wire being dragged out of a part, following the pointer; cleared once when the drag ends. */
  private drawPreview(parts: readonly Part[]): void {
    const p = this.previewG;
    const d = this.drag;
    const from = d?.kind === 'wire' && d.moved ? partById(parts, d.from) : null;
    const c = from ? partCentre(from) : null;
    if (!from || !c) {
      if (this.previewShown) p.clear();
      this.previewShown = false;
      return;
    }
    p.clear();
    this.previewShown = true;
    const w = partSize(from).w;
    p.lineStyle(4, CYAN, 0.6).lineBetween(c.x + w / 2 - 6, c.y, this.pointer.x, this.pointer.y);
    p.fillStyle(CYAN, 0.9).fillCircle(this.pointer.x, this.pointer.y, 7);
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

  private stepPackets(dt: number, rates: Readonly<Record<string, number>>, demand: number): void {
    // Every wire on the board, plus the inbound lanes sharing the block's demand, refilled in place.
    const all = fillInboundRates(
      fillPacketRates(this.packetRates, rates, demand, INBOUND_KEYS),
      demand,
      INBOUND_KEYS,
    );
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

  private placeButtons(parts: readonly Part[]): void {
    const w = this.selectedWire ? this.wireByKey.get(this.selectedWire) : undefined;
    if (w) {
      this.cutBtn.setPosition(w.mid.x, w.mid.y - 40).setVisible(true);
    } else {
      this.cutBtn.setVisible(false);
    }
    const part = this.selectedPart ? partById(parts, this.selectedPart) : null;
    const c = part ? partCentre(part) : null;
    if (part && c) {
      const size = partSize(part);
      this.binBtn.setPosition(c.x + size.w / 2 + 10, c.y - size.h / 2 + 10).setVisible(true);
    } else {
      this.binBtn.setVisible(false);
    }
  }

  /** Packets on their way into `id` right now (the test hook only). */
  private packetsInto(id: string): number {
    let n = 0;
    for (const p of this.pool.items) {
      if (!p.active) continue;
      const w = this.wireByKey.get(p.wire);
      if (w && w.to === id) n++;
    }
    return n;
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
    const f = this.snap.current ?? frame(run());
    const board = { parts: f.parts, credits: f.credits };
    const rect = this.game.canvas.getBoundingClientRect();
    const page = (x: number, y: number) => toPage({ x, y }, rect, { width: GAME_WIDTH, height: GAME_HEIGHT });
    const pageBox = (b: Box) => pageRect({ x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }, rect);
    const offline = [...f.offline];
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
      now: round(f.now),
      speed: f.speed,
      paused: f.paused,
      credits: round(board.credits),
      demand: round(f.demand),
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
        const look = partLook(part, f.flow.load[part.id] ?? 0, offline, f.offlineUntil, f.now, this.trouble);
        const pad = part.slot ? this.padList.find((p) => p.slot === part.slot) : undefined;
        const view = this.views.get(part.id);
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
            diesIn: look.diesIn === null ? null : round(look.diesIn),
            darkLeft: look.darkLeft === null ? null : round(look.darkLeft),
            unfed: look.unfed,
            warning: look.warning,
            bar: round(look.bar),
            barColour: look.barColour,
            flickerLit: view?.lit ?? true,
            scale: slotScale(part.slot),
            tags: partTags(look, pad !== undefined && this.clock < pad.skipUntil),
            packetsIn: this.packetsInto(part.id),
          },
        ];
      }),
      pads: [
        {
          slot: LB_SLOT_ID,
          ...page(LB_SLOT.x, LB_SLOT.y),
          w: round((PAD_SIZE.w * rect.width) / GAME_WIDTH),
          h: round((PAD_SIZE.h * rect.height) / GAME_HEIGHT),
          row: null,
          scale: 1,
          part: board.parts.find((p) => p.kind === 'balancer')?.id ?? null,
          locked: !this.balancerUnlocked,
          state: !this.balancerUnlocked
            ? ('locked' as const)
            : board.parts.some((p) => p.kind === 'balancer')
              ? ('taken' as const)
              : ('empty' as const),
          skipped: false,
          skipTagUntil: null,
          dashed: false,
          pulsing: false,
        },
        ...this.padList.map((pv) => {
          const b = padBox(pv.slot)!;
          const on = board.parts.find((p) => p.slot === pv.slot);
          const g = SERVER_GRID[pv.slot];
          const pr = pageBox(b);
          return {
            slot: pv.slot,
            ...page(b.x, b.y),
            w: pr.w,
            h: pr.h,
            row: g.row,
            scale: RACK_ROWS[g.row].scale,
            part: on?.id ?? null,
            locked: false,
            state: !on ? ('empty' as const) : f.dead.includes(on.id) ? ('dead' as const) : ('taken' as const),
            skipped: pv.skipped,
            skipTagUntil: Number.isFinite(pv.skipUntil) ? round(pv.skipUntil) : null,
            dashed: this.clock < pv.skipUntil,
            pulsing: false,
          };
        }),
      ],
      clock: round(this.clock),
      reduceFlicker: this.reduceFlicker,
      wires: this.wireList.map((w) => ({
        key: w.key,
        from: w.from,
        to: w.to,
        ...page(w.mid.x, w.mid.y),
        rate: round(f.flow.wires[w.key] ?? 0),
        skipped: f.flow.skipped.includes(w.key),
      })),
      offline,
      channel: {
        demand: round(this.chan.demand),
        max: this.chan.max,
        level: round(this.chan.level),
        capacityLevel: round(this.chan.capacityLevel),
        wired: round(f.wiredCapacity),
        forecast: this.chan.forecast === null ? null : round(this.chan.forecast),
        whatIf: null,
        retryShare: round(this.chan.retryShare),
        marks: bankMarkPoints().map((m) => ({ label: m.label, value: m.value, ...page(m.x, m.y) })),
        lanePps: round(this.chan.lanePps),
        lanes: INBOUND_KEYS.map((_, i) => round(lanePps(this.chan.demand, i, INBOUND_KEYS.length))),
        chevrons: 0,
        roomY: page(CHANNEL.mouth.x, levelY(this.chan.capacityLevel, CHANNEL.mouth.x)).y,
        levelY: page(CHANNEL.mouth.x, levelY(this.chan.level, CHANNEL.mouth.x)).y,
      },
      skipped: [...f.flow.skipped],
      packets: { pool: this.pool.size, active: this.pool.active },
      rewinds: f.rewinds.map((w) => ({ at: round(w.at), to: w.to })),
      selectedPart: this.selectedPart,
      selectedWire: this.selectedWire,
      cutButton: this.cutBtn.visible ? page(this.cutBtn.x, this.cutBtn.y) : null,
      binButton: this.binBtn.visible ? page(this.binBtn.x, this.binBtn.y) : null,
      refusal: this.refusalText.visible ? this.refusalText.text : null,
      dragging: this.drag ? (this.drag.kind === 'card' ? this.drag.id : 'wire') : null,
      frame: this.snap.count,
      snapshotFrame: this.snap.readAt,
      snapshotChanges: this.snap.changes,
      snapshotCurrent: this.snap.current !== null && this.snap.current === frame(run()),
    };
  }
}

/** The part with this id, found with a plain loop (no closure) since the board asks every frame. */
function partById(parts: readonly Part[], id: string): Part | null {
  for (let i = 0; i < parts.length; i++) if (parts[i].id === id) return parts[i];
  return null;
}

/** The part standing in this slot, or null when the slot is empty. */
function partInSlot(parts: readonly Part[], slot: string): Part | null {
  for (let i = 0; i < parts.length; i++) if (parts[i].slot === slot) return parts[i];
  return null;
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
