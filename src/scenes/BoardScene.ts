import Phaser from 'phaser';
import { type GameEvents, bus, dragVerdict } from '../game/bus';
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
  CHANNEL,
  INBOUND_LANES,
  TABLE,
  TABLE_FACE,
  WIRE_PICK,
  type Point,
  channelAt,
  distToPath,
  dropAnchor,
  footprintQuad,
  outPort,
  partAt,
  partBox,
  partCentre,
  partScale,
  partSize,
  previewCells,
  project,
  pathLength,
  pointAlong,
  standBox,
  toPage,
  wirePath,
  inPort,
  returnPath,
  type PadState,
  padState,
  targetState,
} from './board/layout';
import {
  BOARD_CELLS,
  FIXED_ANCHOR,
  FOOTPRINT,
  GRID,
  RACKS,
  SERVER_SPOTS,
  anchorOf,
  fits,
  footprintCells,
  occupancy,
  parseCell,
  partCells,
  roomFor,
} from '../sim/grid';
import { dipPhase } from '../sim/failures';
import { blockCentre, blockQuad, cellQuad, cellSize, nodeAt } from './board/cells';
import { register as registerLocate } from './hud/locate';
import { registerPool } from './live/hook';
import { ZONES, pageRect } from './live/layout';
import {
  HOT_SPEED,
  PACKETS_PER_REQUEST,
  PacketPool,
  RETURN_PREFIX,
  SPARK_LIFE,
  SparkPool,
  dropsInto,
  fillPacketRates,
  progress,
  retryBirthsInto,
  sparkRate,
  travelSeconds,
  wireSpeed,
} from './board/packets';
import { flagsFrom } from './live/flags';
import { BROWNOUT, BROWNOUT_RULES } from '../sim/brownout';
import { type GhostInfo, ghostInfo } from './board/ghost';
import { PlateCache, REPLACE_LABEL } from './board/plate';
import { BoardSnapshot } from './board/snapshot';
import { type InventoryArt, InventoryView } from './board/InventoryView';
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
import { TumblePool, type WaitState, crewChip, emptyWait, padPulseAlpha, waitInto } from './board/waits';
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
import { type Occurrence, detectOccurrences } from '../game/occurrences';
import { GlowProbe, MOTION, MotionPlayer } from './motion';
import {
  type AnimEntry,
  AnimBook,
  CABLE_DROP_PX,
  DEATH_FLASH_MS,
  FIREWORK_SIZE,
  EMBER_SIZE,
  ParticlePool,
  bootFrame,
  burstsDue,
  cableFrame,
  cutFade,
  deathFrame,
  deathSmoke,
  drawOn,
  floatFrame,
  hazeFrame,
  heldPadGlow,
  kitFrame,
  lightsDown,
  pingFrame,
} from './board/anim';
import type { PartStatus } from './board/view';
import { isSfxKey } from '../game/audio';
import { BoardSfx } from './board/sfx';
import { addLabel } from './board/bake';
import { artRequest } from '../game/artManifest';
import { preloadArt, resolveArt } from './plates';
import {
  BOARD_ART_KEYS,
  CARD_FRAME,
  CHANNEL_PLATE_KEY,
  PACKET_CUBE_KEY,
  TABLE_MIDNIGHT_KEY,
  midnightPlateAlpha,
  packetScale,
  COUNT_BADGE_KEY,
  PING_ICON_KEY,
  type PlatePlace,
  SKIPPED_ICON_KEY,
  TABLE_PLATE_KEY,
  badgeScale,
  channelPlatePlace,
  markScale,
  tablePlatePlace,
} from './board/art';

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
  'part-card': 'art/hud/part-card.webp',
  'icon-lock': 'art/hud/icons/lock.webp',
  'icon-cut': 'art/hud/icons/cut.webp',
  'icon-bin': 'art/hud/icons/bin.webp',
  // The crew's cable lowering the balancer on resume after the rescue (board-9).
  'board-cable': 'art/board/crew-cable.webp',
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
  chip: Phaser.GameObjects.Text | null;
  chipKey: number;
  /** The warning triangle at the part's top corner. */
  warn: Phaser.GameObjects.Graphics;
  /** A server's SKIPPED marks on its footprint; null for other kinds. */
  skip: SkipMark | null;
  /** The anchor cell the view was made for: a part id back on other cells (after a rewind) gets a new view. */
  slot: string | null;
  /** Lit this frame (false only on the dark half of a power flicker's 6 Hz blink). */
  lit: boolean;
  /** board-9: the shared motion spec playing on the sprite (place, death, dip), and the haze over it while hot. */
  player: MotionPlayer;
  haze: Phaser.GameObjects.Image | null;
  /** The status last frame, to see a boot complete. */
  status: PartStatus | null;
  /** Where the sprite stands at rest and its art's fit scale; the animation offsets from them. */
  baseX: number;
  baseY: number;
  baseScale: number;
  /** What the animation drew this frame, relative to rest: y offset px, scale and alpha factors. */
  dy: number;
  dscale: number;
  dalpha: number;
}

/** What the board draws on a server's footprint while the balancer skips it: the dashed grey outline and the sticky SKIPPED tag. */
interface SkipMark {
  dash: Phaser.GameObjects.Graphics;
  /** board-12: the picked SKIPPED stamp on the footprint, shown with the tag; null when not picked. */
  stamp: Phaser.GameObjects.Image | null;
  /** The SKIPPED tag, baked once (board-11: fixed words are images, not live texts). */
  chip: Phaser.GameObjects.Image;
  /** Board-clock second the SKIPPED tag shows until (skipTagUntil); -Infinity before any skip. */
  skipUntil: number;
  /** The balancer skips this box this frame (the sim's flow.skipped). */
  skipped: boolean;
}

const BAR_COLOURS: Readonly<Record<BarColour, number>> = {
  cyan: 0x2de2e6,
  amber: 0xffb02e,
  red: 0xff4d5e,
  grey: 0x6b7385,
};
const BAR_INDEX: Readonly<Record<BarColour, number>> = { cyan: 1, amber: 2, red: 3, grey: 4 };
/** The cells under a dragged card light green where the part fits and red where it does not; amber when only the credits fall short. */
const FIT_GREEN = 0x3dff8a;
const FIT_RED = 0xff4d5e;
/** How many ping marks the board keeps (one per box the balancer checks). */
const PING_MARKS = 24;
/** The card prices padState checks the credits against. */
const PRICES = { server: BROWNOUT.server.cost, overclock: BROWNOUT.overclock.cost } as const;
/** The keys the board listens to (board-8); 1, 2 and 3 are the deck's and never taken here. */
const BOARD_KEYS: readonly string[] = ['Escape', 'Delete', 'Backspace'];
/** The REPLACE button's box, centred under a dead box. */
const REPLACE_SIZE = { w: 132, h: 36 } as const;

/** A tray card id as the bus names it, or null for anything else. */
function trayIdOf(id: string): 'server' | 'overclock' | 'balancer' | null {
  return id === 'server' || id === 'overclock' || id === 'balancer' ? id : null;
}
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
/** The day plate's tint under the midnight plate, once it has faded in: the ends of the table go cold. */
const MIDNIGHT_DAY_TINT = 0x4a5468;
/** strokePoints reads only x and y, so a plain point list will do. */
const asVectors = (path: readonly Point[]) => path as unknown as Phaser.Math.Vector2[];
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
  /** The grid's static drawing: the rack bands, their labels and the fixed parts' bays, drawn once. */
  private rackG!: Phaser.GameObjects.Graphics;
  /** The midnight dip's shade over the rack that loses power, and the rack and phase it shows. */
  private dipG!: Phaser.GameObjects.Graphics;
  private dipRack: string | null = null;
  private dipShown: 'flicker' | 'dark' | null = null;
  /** The cells under a dragged card (green fits, red does not, amber short of credits) and what they show. */
  private cellsG!: Phaser.GameObjects.Graphics;
  private cellsCard: string | null = null;
  private cellsAt: string | null = null;
  private cellsState: PadState | null = null;
  private cellsParts: readonly Part[] | null = null;
  /** What the drag preview shows now, for the hook: the footprint's cells and the ones blocked. */
  private preview: {
    card: string;
    anchor: string;
    cells: string[];
    bad: string[];
    colour: 'green' | 'red' | 'amber';
  } | null = null;
  /** The suggested spot pulsing while the board waits for a build, its anchor, and whether it shows. */
  private suggestG!: Phaser.GameObjects.Graphics;
  private suggestAt: string | null = null;
  private suggestParts: readonly Part[] | null = null;
  private suggestOn = false;
  /** The held servers' footprints glowing amber at midnight, and the parts they were drawn for. */
  private heldG!: Phaser.GameObjects.Graphics;
  private heldParts: readonly Part[] | null = null;
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
  /** board-12: the board's art keys whose picked file is loaded, and each one's texture key. */
  private picked = new Set<string>();
  private artTex = new Map<string, string>();
  /** What picks a part's state art this frame (partLookInto's `art`), refilled in place. */
  private readonly artOpts: { t: number; calm: boolean; pinging: boolean; picked: ReadonlySet<string> } = {
    t: 0,
    calm: false,
    pinging: false,
    picked: new Set<string>(),
  };
  /** board-12: what the table is (the painted plate or the code bake) and where it is drawn. */
  private table: { art: 'plate' | 'bake'; place: PlatePlace } = {
    art: 'bake',
    place: { x: 0, y: 0, w: 0, h: 0, scale: 1 },
  };
  /** board-12: where the channel plate is drawn, or null while it is not picked. */
  private channelPlate: PlatePlace | null = null;
  /** The day plate's image (null with the code slab), darkened under the midnight plate as it comes in. */
  private dayPlate: Phaser.GameObjects.Image | null = null;
  /** Batch 5: the midnight plate at its own size, centred like the day plate; null while not loaded. */
  private midnightPlate: { img: Phaser.GameObjects.Image; place: PlatePlace } | null = null;
  /** The anim clock midnight struck at (null before it, or after a rewind past it), and the alpha shown. */
  private midnightStruck: number | null = null;
  private midnightShown = 0;
  /** The packets' texture: the painted cube (batch 5) at packetScaleNow, or the code 'packet' at 1. */
  private packetTex = 'packet';
  private packetScaleNow = 1;
  /** board-12: the ping marks over the boxes the balancer checks, one per server pad, made once. */
  private pingIcons: Phaser.GameObjects.Image[] = [];
  /** The board's waits this frame (board-6), refilled in place. */
  private wait: WaitState = emptyWait();
  /** art3d-6: the red Glow on at most three over-capacity parts and the rescue's GradientMap. */
  private readonly glowProbe = new GlowProbe();
  private portG!: Phaser.GameObjects.Graphics;
  private crewText!: Phaser.GameObjects.Text;
  private crewShown = '';
  private tumbles = new TumblePool();
  private tumbleSprites: Phaser.GameObjects.Image[] = [];
  /** Each wire's drawn state (live, skipped, selected) last time the traces were drawn. */
  private wireState: number[] = [];
  private wiresDirty = true;
  private previewShown = false;
  private wiresG!: Phaser.GameObjects.Graphics;
  private previewG!: Phaser.GameObjects.Graphics;
  private wireList: WireGeom[] = [];
  private wireByKey = new Map<string, WireGeom>();
  private lastWires: readonly unknown[] | null = null;
  private lastParts: readonly unknown[] | null = null;
  private pool = new PacketPool();
  private packetSprites: Phaser.GameObjects.Image[] = [];
  /** Each part's return path (board-7), keyed RETURN_PREFIX + id, rebuilt with the wires. */
  private backByKey = new Map<string, WireGeom>();
  /** RETURN_PREFIX + id for every part seen, built once per id so the frame loop builds no string. */
  private backKeys = new Map<string, string>();
  /** Req/s each part drops this frame, and the retry cubes a second born there, refilled in place. */
  private drops: Record<string, number> = {};
  private births: Record<string, number> = {};
  /** Parts over 100% this frame: packets crawl into them at half speed. */
  private slowParts = new Set<string>();
  /** Sparks off the in-ports of parts that drop (decorative: off in lite mode and under reduce flicker). */
  private sparks = new SparkPool();
  private sparkSprites: Phaser.GameObjects.Image[] = [];
  private sparkOwed: Record<string, number> = {};
  /** ?test lite mode: decorative particles off, no hook value changed. */
  private lite = false;
  /** The packet step's options, made once: each wire's speed, and the lanes a retry re-enters on. */
  private readonly stepOpts = {
    speedOf: (wire: string): number => {
      const w = this.wireByKey.get(wire);
      return w && this.slowParts.has(w.to) ? HOT_SPEED : 1;
    },
    reenter: INBOUND_KEYS,
  };
  /** The channel this frame (board-4), refilled in place, and what its graphics last drew. */
  private chan: ChannelState = emptyChannel();
  private fillG!: Phaser.GameObjects.Graphics;
  private roomG!: Phaser.GameObjects.Graphics;
  private roomText!: Phaser.GameObjects.Image;
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
  private skipTags: Phaser.GameObjects.Image[] = [];
  private cards: TrayCard[] = [];
  private inventory!: InventoryView;
  private counts: InventoryCounts = { server: 0, overclock: 0, balancer: 0 };
  private countedParts: readonly Part[] | null = null;
  private countedGiven = false;
  private countedCredits = NaN;
  private balancerUnlocked = false;
  private ghost!: Phaser.GameObjects.Image;
  /** board-8: what the card in hand is over (free cells by anchor, or a part), and what a dragged wire would land on. */
  private over: { id: string | null; slot: string | null; kind: 'cell' | 'part' | null } = {
    id: null,
    slot: null,
    kind: null,
  };
  private wireTo: { id: string | null; ok: boolean; reason: string | null } = {
    id: null,
    ok: false,
    reason: null,
  };
  /** The legality of the spot the card in hand is over, and what it was read from. */
  private overLegality: PadState | null = null;
  private legalOver: string | null = null;
  private legalFrame: Frame | null = null;
  private legalCard: string | null = null;
  private readonly padBoard: { parts: readonly Part[]; credits: number; dead: readonly string[] } = {
    parts: [],
    credits: 0,
    dead: [],
  };
  /** The what-if ghost (null while hidden or with no target), what it was computed from, and its drawing. */
  private ghostInfo: GhostInfo | null = null;
  private ghostFrame: Frame | null = null;
  private ghostDirty = true;
  private ghostShownFor: string | null = null;
  private ghostPlateShown: string | null = null;
  private ghostPlateAt: string | null = null;
  private ghostOutline!: Phaser.GameObjects.Graphics;
  private ghostText!: Phaser.GameObjects.Text;
  private whatIfG!: Phaser.GameObjects.Graphics;
  private whatIfText!: Phaser.GameObjects.Text;
  private drawnWhatIf: number | null | undefined = undefined;
  private drawnTick: string | null | undefined = undefined;
  /** The hover plate: what the pointer is over, the plate's text cache and its pooled Text and frame. */
  private hover: { part: string | null; wire: string | null } = { part: null, wire: null };
  private plates = new PlateCache();
  private plate!: Phaser.GameObjects.Text;
  private plateG!: Phaser.GameObjects.Graphics;
  private plateFor: string | null = null;
  private platePinned = false;
  private replaceBtn!: Phaser.GameObjects.Container;
  private targetRing: string | null = null;
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
  /** board-9: the animations in flight, their clock (board time: frozen while paused, slowed by Regroup) and the particles. */
  private animBook = new AnimBook();
  private animClock = 0;
  private particles = new ParticlePool();
  private particleSprites: Phaser.GameObjects.Image[] = [];
  /** One graphics for every drawn animation (draw-on, cut fade, rings, flash, pings), cleared only while one plays. */
  private animG!: Phaser.GameObjects.Graphics;
  private animDrawn = false;
  private shade!: Phaser.GameObjects.Rectangle;
  private cableImg!: Phaser.GameObjects.Image;
  private kitImg!: Phaser.GameObjects.Image;
  private liftImg!: Phaser.GameObjects.Image;
  private liftPlayer = new MotionPlayer();
  private floatText!: Phaser.GameObjects.Text;
  private floatAt = { x: 0, y: 0 };
  private liftAt = { x: 0, y: 0, scale: 1 };
  private burstCount = 0;
  private kitFrom = { x: 0, y: 0 };
  private kitTo = { x: 0, y: 0 };
  /** The frame before this one, the edges between them (reused list) and the rewinds seen so far. */
  private prevFrame: Frame | null = null;
  private occ: Occurrence[] = [];
  private rewindsSeen = 0;
  /** The wires as laid out before the last rebuild, so a cut wire's trace can fade where it was. */
  private oldWires = new Map<string, WireGeom>();
  private cutGeoms = new Map<string, WireGeom>();
  private deathOf: string | null = null;
  private fireworksAt = -1;
  /** Reused frames for the timelines. */
  private readonly df = { flash: 0, shakeX: 0 };
  private readonly rf = { alpha: 0, scale: 1 };
  private readonly ff = { along: 0, scale: 1, alpha: 1 };
  private readonly hf = { alpha: 0, dy: 0, scaleY: 1 };
  private readonly flf = { dy: 0, alpha: 1 };
  private readonly cf = { lower: 0, dy: -CABLE_DROP_PX, sway: 0, landed: false };
  private readonly pf = { along: 0, alpha: 0, radius: 0 };
  private offAction: (() => void) | null = null;
  /** board-11: the board clock each wire was first laid on, and the last key the board consumed. */
  private wireBorn = new Map<string, number>();
  private lastKey: string | null = null;
  /** board-10: the board's own sounds (boot chime, drop crackle, skip blip), only for keys that exist. */
  private sounds = new BoardSfx(isSfxKey);
  /** Wires the balancer newly skipped, counted every frame (the hook's `sfx.skipEdges`). */
  private skipEdges = 0;
  private lastSkipped: readonly string[] = [];
  /** Created once with the scene: the pool calls it per wire per frame without a new closure. */
  private readonly travelOf = (wire: string): number => this.geomOf(wire)?.travel ?? 1;
  /** Bound once: drops the sprites of a part no longer on the board (Map.forEach, no iterator). */
  private readonly sweepView = (v: PartView, id: string): void => {
    if (v.seen === this.snap.count) return;
    v.img.destroy();
    v.shadow.destroy();
    v.label.destroy();
    v.bar?.destroy();
    v.chip?.destroy();
    v.warn.destroy();
    v.haze?.destroy();
    destroySkip(v.skip);
    this.views.delete(id);
  };

  constructor() {
    super(SCENES.board);
  }

  preload(): void {
    for (const [key, file] of Object.entries(ART)) this.load.image(key, file);
    // board-12: the picked Live-screen art, through the art manifest (src/scenes/plates.ts).
    preloadArt(this, BOARD_ART_KEYS);
    for (const kind of LOCKED_KINDS) this.load.image(`part-${kind}`, `art/parts/${kind}/scrap.webp`);
  }

  create(): void {
    this.ready = false;
    // board-12: which picked art is in, before anything that draws it (the inventory, the backdrop).
    this.resolveBoardArt();
    this.views = new Map();
    this.snap.reset();
    this.dipRack = null;
    this.dipShown = null;
    this.cellsCard = null;
    this.cellsAt = null;
    this.cellsState = null;
    this.cellsParts = null;
    this.preview = null;
    this.suggestAt = null;
    this.suggestParts = null;
    this.suggestOn = false;
    this.heldParts = null;
    this.wireState = [];
    this.wiresDirty = true;
    this.previewShown = false;
    this.wireList = [];
    this.wireByKey = new Map();
    this.lastWires = null;
    this.lastParts = null;
    this.pool = new PacketPool();
    this.backByKey = new Map();
    this.drops = {};
    this.births = {};
    this.slowParts.clear();
    this.sparks = new SparkPool();
    this.sparkSprites = [];
    this.sparkOwed = {};
    this.lite = flagsFrom(window.location.search).lite;
    this.wait = emptyWait();
    this.crewShown = '';
    this.tumbles = new TumblePool();
    this.tumbleSprites = [];
    this.packetSprites = [];
    this.skipTags = [];
    this.chan = emptyChannel();
    this.drawnLevel = NaN;
    this.drawnRetry = NaN;
    this.drawnRoom = NaN;
    this.drawnForecast = undefined;
    this.inventory = new InventoryView(this, this.inventoryArt());
    this.countedParts = null;
    this.countedCredits = NaN;
    this.drag = null;
    this.selectedPart = null;
    this.selectedWire = null;
    this.refusalUntil = 0;
    this.over = { id: null, slot: null, kind: null };
    this.wireTo = { id: null, ok: false, reason: null };
    this.overLegality = null;
    this.legalOver = null;
    this.legalFrame = null;
    this.legalCard = null;
    this.ghostInfo = null;
    this.ghostFrame = null;
    this.ghostDirty = true;
    this.ghostShownFor = null;
    this.ghostPlateShown = null;
    this.ghostPlateAt = null;
    this.drawnWhatIf = undefined;
    this.drawnTick = undefined;
    this.hover = { part: null, wire: null };
    this.plates = new PlateCache();
    this.plateFor = null;
    this.platePinned = false;
    this.targetRing = null;
    this.animBook = new AnimBook();
    this.animClock = 0;
    this.particles = new ParticlePool();
    this.particleSprites = [];
    this.animDrawn = false;
    this.liftPlayer = new MotionPlayer();
    this.prevFrame = null;
    this.occ = [];
    this.rewindsSeen = run().play.rewinds.length;
    this.oldWires = new Map();
    this.cutGeoms = new Map();
    this.deathOf = null;
    this.fireworksAt = -1;
    this.sounds = new BoardSfx(isSfxKey);
    this.wireBorn = new Map();
    this.lastKey = null;

    this.drawBackdrop();

    // The table's grid: every painted square is a cell a part can stand on. The rack bands and the
    // fixed parts' bays are drawn once; the cells under a dragged card and the suggested spot on top.
    this.drawGrid();

    this.wiresG = this.add.graphics();
    this.previewG = this.add.graphics();
    // Parts and packets are added lazily; keep them above the wires by depth.
    this.wiresG.setDepth(1);
    this.previewG.setDepth(4);

    this.drawTray();

    this.drawWaits();
    for (let i = 0; i < this.sparks.items.length; i++) {
      this.sparkSprites.push(this.add.image(0, 0, 'packet').setDepth(2.6).setScale(0.3).setVisible(false));
    }

    this.makeAnimObjects();
    this.makePingIcons();

    this.ghost = this.add.image(0, 0, 'server').setVisible(false).setAlpha(0.75).setDepth(30);
    this.ghostOutline = this.add.graphics().setDepth(29);
    const small = { fontFamily: 'monospace', fontStyle: 'bold', stroke: '#05070f' } as const;
    this.ghostText = this.add
      .text(0, 0, '', {
        ...small,
        fontSize: '20px',
        color: '#2de2e6',
        backgroundColor: '#05070fee',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5, 1)
      .setDepth(31)
      .setVisible(false);
    this.whatIfG = this.add.graphics().setDepth(0.75);
    this.whatIfText = this.add
      .text(0, 0, '', { ...small, fontSize: '13px', color: '#2de2e6', strokeThickness: 3 })
      .setOrigin(1, 1)
      .setDepth(0.8)
      .setVisible(false);
    this.plateG = this.add.graphics().setDepth(37);
    this.plate = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffe2b0',
        backgroundColor: '#05070fee',
        padding: { x: 10, y: 6 },
        lineSpacing: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(38)
      .setVisible(false);
    this.replaceBtn = this.makeReplaceButton();
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
    // Esc cancels a drag or clears the selection; Delete or Backspace cuts the selected wire.
    const kb = this.input.keyboard;
    kb?.on('keydown-ESC', this.onEscape, this);
    kb?.on('keydown-DELETE', this.onDelete, this);
    kb?.on('keydown-BACKSPACE', this.onDelete, this);

    this.offBus?.();
    this.offBus = bus.on('refused', ({ reason }) => this.showRefusal(reason));
    this.offAction?.();
    this.offAction = bus.on('action', (a) => this.onAction(a));
    this.director?.destroy();
    this.director = new Director();
    // Where the comms band's leader line may point on the board (game px, made once): the
    // inventory's SERVER card and the channel's mouth.
    const serverCard = trayCards(false).find((c) => c.id === 'server');
    const cardAt = serverCard ? { x: serverCard.x, y: serverCard.y } : null;
    const mouthAt = { x: CHANNEL.mouth.x, y: (CHANNEL.mouth.top + CHANNEL.mouth.bottom) / 2 };
    const offLocate = [registerLocate('inventory', () => cardAt), registerLocate('channel', () => mouthAt)];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of offLocate) off();
      kb?.off('keydown-ESC', this.onEscape, this);
      kb?.off('keydown-DELETE', this.onDelete, this);
      kb?.off('keydown-BACKSPACE', this.onDelete, this);
      this.offBus?.();
      this.offBus = null;
      this.offAction?.();
      this.offAction = null;
      this.director?.destroy();
      this.director = null;
      this.glowProbe.clear();
      this.ready = false;
    });

    provideTestState('board', () => this.testState());
    registerPool('packets', () => this.packetSprites.length);
    registerPool('boardParticles', () => this.particleSprites.length);

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
    const plate = this.artTex.get(TABLE_PLATE_KEY);
    const plateCut = artRequest(TABLE_PLATE_KEY)?.cut;
    if (plate !== undefined && plateCut) {
      // board-12: the painted plate, never larger than its file (tablePlatePlace), centred under
      // the rack with its foot on the feed's floor. The pads stay drawn in code on top of it.
      const p = tablePlatePlace(plateCut);
      this.dayPlate = this.add.image(p.x, p.y, plate).setOrigin(0).setScale(p.scale);
      this.table = { art: 'plate', place: p };
    } else {
      const slab = 'board-table';
      if (!this.textures.exists(slab)) this.bakeTable(slab);
      this.add.image(left, areaTop, slab).setOrigin(0);
      this.table = {
        art: 'bake',
        place: { x: left, y: areaTop, w: BOARD_AREA.right - left, h: BOARD_AREA.bottom - areaTop, scale: 1 },
      };
      this.dayPlate = null;
    }
    // Batch 5: the midnight plate over the day plate, at its own size and centred the same way
    // (tablePlatePlace never draws it above its file), hidden until midnight fades it in.
    const night = this.artTex.get(TABLE_MIDNIGHT_KEY);
    const nightCut = artRequest(TABLE_MIDNIGHT_KEY)?.cut;
    this.midnightPlate = null;
    if (night !== undefined && nightCut && this.dayPlate) {
      const p = tablePlatePlace(nightCut);
      const img = this.add
        .image(p.x, p.y, night)
        .setOrigin(0)
        .setScale(p.scale)
        .setAlpha(0)
        .setVisible(false);
      this.midnightPlate = { img, place: p };
    }
    this.midnightStruck = null;
    this.midnightShown = 0;
    this.bakePacket();
    // Batch 5: the painted packet cube, inside its 24 x 18 box, never above its file's size.
    const cube = this.artTex.get(PACKET_CUBE_KEY);
    const cubeCut = artRequest(PACKET_CUBE_KEY)?.cut;
    this.packetTex = cube !== undefined && cubeCut ? cube : 'packet';
    this.packetScaleNow = cube !== undefined && cubeCut ? packetScale(cubeCut) : 1;

    // board-12: the channel plate under the channel's walls and instruments, when it is picked.
    const trough = this.artTex.get(CHANNEL_PLATE_KEY);
    const troughCut = artRequest(CHANNEL_PLATE_KEY)?.cut;
    this.channelPlate = null;
    if (trough !== undefined && troughCut) {
      const p = channelPlatePlace(troughCut);
      this.add.image(p.x, p.y, trough).setOrigin(0).setScale(p.scale);
      this.channelPlate = p;
    }

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
    // Over the channel plate the walls' fill is thinner, so the plate shows through it.
    lane.fillStyle(0x03050b, this.channelPlate ? 0.45 : 0.92).fillPoints(walls, true);
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
      addLabel(this, m.x, m.y, `bank:${m.label}`, m.label, {
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
    this.roomText = addLabel(this, 0, 0, 'room', LABELS.gauge.room, {
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

  /**
   * board-12: which of the board's art keys draw their picked file. A key counts only when
   * resolveArt names its picked file (not a fallback) and that texture loaded; any other key keeps
   * today's code drawing, so nothing is drawn from a stand-in.
   */
  private resolveBoardArt(): void {
    this.picked = new Set();
    this.artTex = new Map();
    for (const key of BOARD_ART_KEYS) {
      const r = resolveArt(key);
      if (r.fallback || !this.textures.exists(r.texture)) continue;
      this.picked.add(key);
      this.artTex.set(key, r.texture);
    }
    this.artOpts.picked = this.picked;
  }

  /** The texture an art key draws: a picked key's file, else the key itself (the board's own textures). */
  private textureOf(art: string): string {
    return this.artTex.get(art) ?? art;
  }

  /** The inventory's picked frames and count badge, or null for each that is not picked. */
  private inventoryArt(): InventoryArt {
    const keys = Object.values(CARD_FRAME);
    const frames = keys.every((k) => this.artTex.has(k))
      ? Object.fromEntries(keys.map((k) => [k, this.artTex.get(k)!]))
      : null;
    const badgeTex = this.artTex.get(COUNT_BADGE_KEY);
    const badgeCut = artRequest(COUNT_BADGE_KEY)?.cut;
    const badge =
      badgeTex !== undefined && badgeCut ? { texture: badgeTex, scale: badgeScale(badgeCut) } : null;
    return { frames, badge };
  }

  /** The ping marks, one per box the balancer may check, 44 px and never above the file's size; hidden until a ping. */
  private makePingIcons(): void {
    this.pingIcons = [];
    const tex = this.artTex.get(PING_ICON_KEY);
    const cut = artRequest(PING_ICON_KEY)?.cut;
    if (tex === undefined || !cut) return;
    const scale = markScale(cut, 44);
    for (let i = 0; i < PING_MARKS; i++)
      this.pingIcons.push(this.add.image(0, 0, tex).setScale(scale).setDepth(6.5).setVisible(false));
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

  /** The REPLACE button under a selected dead box (board-8). */
  private makeReplaceButton(): Phaser.GameObjects.Container {
    const bg = this.add
      .rectangle(0, 0, REPLACE_SIZE.w, REPLACE_SIZE.h, 0x05070f, 0.94)
      .setStrokeStyle(3, CYAN);
    const label = addLabel(this, 0, 0, 'replace', REPLACE_LABEL, {
      fontFamily: 'monospace',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#2de2e6',
    }).setOrigin(0.5);
    return this.add.container(0, 0, [bg, label]).setDepth(35).setVisible(false);
  }

  /** Whether (x, y) is on the REPLACE button. */
  private replaceHit(x: number, y: number): boolean {
    const b = this.replaceBtn;
    return Math.abs(x - b.x) <= REPLACE_SIZE.w / 2 && Math.abs(y - b.y) <= REPLACE_SIZE.h / 2;
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
    const occ = this.edges(f);

    // Parts.
    const cardInHand = d?.kind === 'card' ? d.id : null;
    if (cardInHand !== null) this.updateLegality(f, cardInHand);
    const t = this.time.now / 1000;
    this.clock = t;
    const reduce = settings().reduceFlicker;
    this.reduceFlicker = reduce;
    const trouble = this.trouble;
    trouble.dead = f.dead;
    trouble.dark = f.dark;
    trouble.dips = f.dips;
    trouble.overload = this.snap.overload;
    const wait = waitInto(this.wait, f, t, reduce);
    // While the board waits for a build, one good spot pulses: room for a box here (any free spot works).
    this.drawSuggestion(wait.port !== null && cardInHand === null, parts, t, reduce);
    this.drawCells(f);
    this.drawRackDip(f);
    const pulse = reduce ? 0.55 : 0.55 + 0.25 * Math.sin(this.time.now / 120);
    const artOpts = this.artOpts;
    artOpts.t = t;
    artOpts.calm = reduce;
    artOpts.pinging = this.balancerFeeds(f);
    this.hotParts.clear();
    this.slowParts.clear();
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
        artOpts,
      );
      // Traffic is being dropped here: the packets heading in turn red.
      if (look.dark || (look.share !== null && look.share > 1)) this.hotParts.add(part.id);
      // Over 100%: the packets heading in crawl at half speed (board-7).
      if (!look.dark && wireSpeed(look.share) < 1) this.slowParts.add(part.id);
      v.seen = count;
      if (v.art !== look.art) {
        v.art = look.art;
        v.img.setTexture(this.textureOf(look.art));
        v.baseScale = this.artScale(part, v.img);
        v.img.setScale(v.baseScale);
      }
      // board-12: picked state art is already unlit or lamp-lit; only today's art is darkened in code.
      const painted = this.artTex.has(look.art);
      if (look.dark && !painted) v.img.setTint(DARK_TINT);
      else v.img.clearTint();
      v.lit = flickerLit(f.flickering.includes(part.id), t, reduce);
      const base = !painted && (look.status === 'booting' || look.status === 'rebooting') ? pulse + 0.2 : 1;
      v.img.setAlpha(v.lit ? base : FLICKER_DIM);
      if (v.readout.update(look)) v.label.setText(v.readout.text).setColor(v.readout.colour);
      this.drawPartState(part, v);
      // The balancer skips this box: grey dashed footprint, SKIPPED sticky for 1 s after.
      const sk = v.skip;
      if (sk) {
        sk.skipped = this.isSkipped(flow.skipped, part.id);
        sk.skipUntil = skipTagUntil(sk.skipUntil, sk.skipped, t);
        const shown = t < sk.skipUntil;
        sk.dash.setVisible(shown);
        sk.chip.setVisible(shown);
        sk.stamp?.setVisible(shown);
      }
    }
    this.views.forEach(this.sweepView);
    this.glowProbe.step(this.views, t, reduce, this.cameras.main, f.rescued, f.paused);

    // Selection can outlive what it pointed at (a cut, a decommission, a new run).
    if (this.selectedPart) {
      const sel = partById(parts, this.selectedPart);
      if (!sel || sel.slot === null) this.selectedPart = null;
    }
    if (this.selectedWire && !this.wireByKey.has(this.selectedWire)) this.selectedWire = null;

    // Animations freeze with the board, except on a failure: the death plays out before the rewind.
    this.stepAnims(f, occ, f.paused && f.failure === null ? 0 : Math.min(seconds, 0.25), reduce);
    this.drawWires(flow.wires, flow.skipped);
    for (let i = 0; i < flow.skipped.length; i++)
      if (!this.lastSkipped.includes(flow.skipped[i])) this.skipEdges++;
    this.lastSkipped = flow.skipped;
    this.drawPreview(parts);
    this.drawChannel(channelInto(this.chan, f));
    this.stepPackets(dt, f);
    this.stepSparks(dt, parts);
    if (!f.paused) this.playSounds(occ, parts);
    this.drawWait(wait, f.paused ? 0 : Math.min(seconds, 0.25));
    this.updateGhost(f);
    this.updatePlate(parts, f);
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
          const h = 6 * partScale(part);
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
        v.chip?.setVisible(false);
      } else {
        // Made the first time the part wears a tag (board-11: a part that never does costs no text).
        v.chip ??= this.makeChip(part);
        v.chip
          .setText(text)
          .setBackgroundColor(look.diesIn !== null ? '#c8283a' : '#3b4150')
          .setColor(look.diesIn !== null ? '#ffffff' : '#c5cad6')
          .setVisible(true);
      }
    }
    v.warn.setVisible(look.warning && v.lit);
  }

  /** The waits' port blink, the crew chip and the pool of tumbling cubes, made once. */
  private drawWaits(): void {
    this.portG = this.add.graphics().setDepth(6).setVisible(false);
    this.portG.fillStyle(AMBER, 0.25).fillCircle(0, 0, 20);
    this.portG.lineStyle(3, AMBER, 1).strokeCircle(0, 0, 13);
    this.portG.fillStyle(AMBER, 1).fillCircle(0, 0, 6);
    this.crewText = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#2de2e6',
        backgroundColor: '#05070fdd',
        padding: { x: 8, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(6)
      .setVisible(false);
    for (let i = 0; i < this.tumbles.items.length; i++) {
      this.tumbleSprites.push(this.add.image(0, 0, 'packet').setDepth(2.5).setTint(GREY).setVisible(false));
    }
  }

  /**
   * The waits (board-6): the out-port that needs a wire blinks (lit steady under reduce flicker),
   * the cubes with nowhere to go tumble off it, and in the crew wait a chip says what the boxes
   * behind the balancer cover of the 120 they must. `dt` is real seconds (0 while held by a card).
   */
  private drawWait(w: WaitState, dt: number): void {
    const port = w.port;
    if (port) this.portG.setPosition(port.x, port.y);
    this.portG.setVisible(w.portLit);
    if (w.crew) {
      if (port) this.crewText.setPosition(port.x, port.y + 46);
      const text = crewChip(w.behind, w.need);
      if (text !== this.crewShown) {
        this.crewShown = text;
        this.crewText.setText(text);
      }
    }
    this.crewText.setVisible(w.crew);
    // Cubes reach the waiting port at the channel's rate; with nowhere to go they tumble off.
    this.tumbles.step(dt, port ? Math.min(12, this.chan.lanePps) : 0, port);
    const items = this.tumbles.items;
    for (let i = 0; i < items.length; i++) {
      const s = this.tumbleSprites[i];
      const p = items[i];
      if (!p.active) {
        s.setVisible(false);
        continue;
      }
      const angle = this.tumbles.at(p, this.at);
      s.setPosition(this.at.x, this.at.y)
        .setRotation(angle)
        .setScale(0.7)
        .setAlpha(1 - p.age / 0.9)
        .setVisible(true);
    }
  }

  // ---- the grid ----------------------------------------------------------------------------------
  // Every painted square of the table is a cell a part can stand on (src/sim/grid.ts). The board
  // draws the rack bands and the fixed parts' bays once; while a card is dragged, the cells its
  // footprint would cover light green (it fits) or red (blocked); while the board waits for a
  // build, one good spot pulses; at midnight the rack that loses power goes dark.

  /** The grid's layers, and its static drawing: the rack bands with their labels, the fixed parts' bays. */
  private drawGrid(): void {
    const g = (this.rackG = this.add.graphics().setDepth(0.6));
    for (let k = 0; k < RACKS.length; k++) {
      const r = RACKS[k];
      const q = blockQuad(r.from, 0, r.to - r.from + 1, GRID.rows);
      // Every other rack a faint wash, so the four power feeds read as bands.
      if (k % 2 === 1) g.fillStyle(CYAN, 0.04).fillPoints(asVectors(q), true);
      if (k > 0) g.lineStyle(2, CYAN, 0.3).lineBetween(q[0].x, q[0].y, q[3].x, q[3].y);
      addLabel(this, (q[0].x + q[1].x) / 2, q[0].y - 3, `rack-${r.id}`, `${LABELS.board.rack} ${r.id}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#7fe9ff',
        stroke: '#05070f',
        strokeThickness: 3,
      })
        .setOrigin(0.5, 1)
        .setAlpha(0.75)
        .setDepth(0.62);
    }
    // The fixed parts' bays: grey dashed outlines, nothing else stands there.
    g.lineStyle(2, GREY, 0.7);
    for (const kind of FIXED_KINDS) {
      const anchor = FIXED_ANCHOR[kind];
      const q = anchor ? footprintQuad(kind, anchor) : null;
      if (q) for (let k = 0; k < 4; k++) dashedLine(g, q[k], q[(k + 1) % 4], 6, 5);
    }
    this.dipG = this.add.graphics().setDepth(0.64).setVisible(false);
    this.suggestG = this.add.graphics().setDepth(0.66).setVisible(false);
    this.heldG = this.add.graphics().setDepth(0.68).setVisible(false);
    this.cellsG = this.add.graphics().setDepth(0.7).setVisible(false);
  }

  /**
   * The suggested spot: the first good server spot (SERVER_SPOTS) still free, its footprint
   * outlined and pulsing while `on` (the board waits for a build and no card is in hand). Redrawn
   * only when the parts change; the pulse is the layer's alpha.
   */
  private drawSuggestion(on: boolean, parts: readonly Part[], t: number, reduce: boolean): void {
    if (parts !== this.suggestParts) {
      this.suggestParts = parts;
      let at: string | null = null;
      for (let i = 0; i < SERVER_SPOTS.length && at === null; i++)
        if (fits(BOARD_CELLS, parts, 'server', SERVER_SPOTS[i]).ok) at = SERVER_SPOTS[i];
      if (at !== this.suggestAt) {
        this.suggestAt = at;
        const g = this.suggestG;
        g.clear();
        const q = at !== null ? footprintQuad('server', at) : null;
        if (q) {
          g.fillStyle(CYAN, 0.18).fillPoints(asVectors(q), true);
          g.lineStyle(3, CYAN, 0.95);
          for (let k = 0; k < 4; k++) dashedLine(g, q[k], q[(k + 1) % 4], 10, 6);
        }
      }
    }
    const shown = on && this.suggestAt !== null;
    this.suggestOn = shown;
    this.suggestG.setVisible(shown);
    if (shown) this.suggestG.setAlpha(padPulseAlpha(t, reduce));
  }

  /**
   * The footprint under the card in hand: each cell green where the part fits, red where it is
   * blocked (off the playable cells or under a part), amber all over when only the credits fall
   * short. Over a part (the kit on a server, a server card on a dead box) the part's footprint
   * lights instead. Redrawn only when the card, the spot, its state or the parts change.
   */
  private drawCells(f: Frame): void {
    const d = this.drag;
    const card = d?.kind === 'card' ? d.id : null;
    const at = card !== null ? this.over.slot : null;
    const state = at !== null ? this.overState() : null;
    if (
      card === this.cellsCard &&
      at === this.cellsAt &&
      state === this.cellsState &&
      f.parts === this.cellsParts
    )
      return;
    this.cellsCard = card;
    this.cellsAt = at;
    this.cellsState = state;
    this.cellsParts = f.parts;
    const g = this.cellsG;
    g.clear();
    if (card === null || at === null || state === null) {
      this.preview = null;
      g.setVisible(false);
      return;
    }
    const on = this.over.kind === 'part' ? partWithAnchor(f.parts, at) : null;
    const kind = on ? on.kind : card === 'balancer' ? 'balancer' : 'server';
    const cells = on ? partCells(on) : previewCells(kind, at, f.parts).cells;
    const bad = on ? [] : previewCells(kind, at, f.parts).bad;
    const ok = dropLegalOf(card, state);
    const colour = state === 'poor' ? 'amber' : ok ? 'green' : 'red';
    for (const id of cells) {
      const q = cellQuad(id);
      if (!q) continue;
      const red = colour === 'red' && (bad.length === 0 || bad.includes(id));
      const c = colour === 'amber' ? AMBER : red ? FIT_RED : FIT_GREEN;
      g.fillStyle(c, 0.32).fillPoints(asVectors(q), true);
      g.lineStyle(2, c, 0.95).strokePoints(asVectors(q), true);
    }
    this.preview = {
      card,
      anchor: at,
      cells,
      bad: colour === 'red' && bad.length === 0 ? cells : bad,
      colour,
    };
    g.setVisible(true);
  }

  /** The midnight dip's rack: an amber outline while it flickers, a dark shade while it is out. */
  private drawRackDip(f: Frame): void {
    let rack: string | null = null;
    let phase: 'flicker' | 'dark' | null = null;
    for (let i = 0; i < f.dips.length; i++) {
      const d = f.dips[i];
      const p = d.rack ? dipPhase(d, f.now) : null;
      if (p !== null) {
        rack = d.rack ?? null;
        phase = p;
      }
    }
    if (rack === this.dipRack && phase === this.dipShown) return;
    this.dipRack = rack;
    this.dipShown = phase;
    const g = this.dipG;
    g.clear();
    let r: (typeof RACKS)[number] | null = null;
    for (let i = 0; i < RACKS.length; i++) if (RACKS[i].id === rack) r = RACKS[i];
    if (r === null || phase === null) {
      g.setVisible(false);
      return;
    }
    const q = blockQuad(r.from, 0, r.to - r.from + 1, GRID.rows);
    if (phase === 'dark') g.fillStyle(0x000000, 0.45).fillPoints(asVectors(q), true);
    g.lineStyle(3, phase === 'dark' ? RED : AMBER, 0.85).strokePoints(asVectors(q), true);
    g.setVisible(true);
  }

  /** The held servers' footprints glow amber as midnight strikes (`glow` 0..1; 0 hides them). */
  private drawHeld(parts: readonly Part[], glow: number): void {
    if (glow <= 0) {
      if (this.heldG.visible) this.heldG.setVisible(false);
      return;
    }
    if (parts !== this.heldParts) {
      this.heldParts = parts;
      const g = this.heldG;
      g.clear();
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.kind !== 'server' || p.slot === null) continue;
        const q = footprintQuad(p.kind, p.slot);
        if (q)
          g.fillStyle(AMBER, 0.45)
            .fillPoints(asVectors(q), true)
            .lineStyle(2, AMBER, 1)
            .strokePoints(asVectors(q), true);
      }
    }
    this.heldG.setAlpha(glow).setVisible(true);
  }

  /** Whether the balancer skipped a wire into `id` this frame (plain loops: no closure, no string built). */
  private isSkipped(skipped: readonly string[], id: string): boolean {
    if (skipped.length === 0) return false;
    const list = this.wireList;
    for (let i = 0; i < list.length; i++) if (list[i].to === id && skipped.includes(list[i].key)) return true;
    return false;
  }

  /** A server's SKIPPED marks on its footprint: the dashed grey outline, the tag and the stamp, all hidden. */
  private makeSkip(part: Part): SkipMark | null {
    const q = part.slot !== null ? footprintQuad(part.kind, part.slot) : null;
    if (!q) return null;
    const s = partScale(part);
    const dash = this.add.graphics().setDepth(1.4).setVisible(false);
    dash.lineStyle(2, GREY, 0.95);
    for (let k = 0; k < 4; k++) dashedLine(dash, q[k], q[(k + 1) % 4], 8, 6);
    const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
    const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    const near = (q[2].y + q[3].y) / 2;
    const size = Math.max(10, Math.round(14 * s));
    const chip = addLabel(this, cx, near + 2, `skipped:${size}`, LABELS.partTags.skipped, {
      fontFamily: 'monospace',
      fontSize: `${size}px`,
      fontStyle: 'bold',
      color: '#c5cad6',
      backgroundColor: '#3b4150',
      padding: { x: 6, y: 2 },
    })
      .setOrigin(0.5)
      .setDepth(6)
      .setVisible(false);
    // board-12: the picked SKIPPED stamp on the footprint's middle, 64 px at full size.
    const stampTex = this.artTex.get(SKIPPED_ICON_KEY);
    const stampCut = artRequest(SKIPPED_ICON_KEY)?.cut;
    const stamp =
      stampTex !== undefined && stampCut
        ? this.add
            .image(cx, cy, stampTex)
            .setScale(markScale(stampCut, 64 * s))
            .setDepth(5.9)
            .setVisible(false)
        : null;
    return { dash, stamp, chip, skipUntil: -Infinity, skipped: false };
  }

  /** The part's sprites, made the first time it is seen (a part never moves once placed). */
  private viewFor(part: Part): PartView | null {
    const known = this.views.get(part.id);
    if (known && known.slot === part.slot) return known;
    if (known) {
      // The same id on other cells (a rewind put a different box under it): make its view anew.
      known.seen = -1;
      this.sweepView(known, part.id);
    }
    const c = partCentre(part);
    if (!c) return null;
    const size = partSize(part);
    const s = partScale(part);
    const shadow = this.add
      .ellipse(c.x + 8 * s, c.y + size.h / 2 - 6 * s, size.w * 1.05, 26 * s, 0x000000, 0.55)
      .setDepth(1.5);
    // Nearer parts (their foot lower on screen) draw over farther ones. The sync sets the right art next.
    const img = this.add.image(c.x, c.y, artFor(part, false)).setDepth(3 + (c.y + size.h / 2) / 1000);
    const label = this.add
      .text(c.x, c.y - size.h / 2 - 6, '', {
        fontFamily: 'monospace',
        fontSize: `${Math.max(12, Math.round(18 * s))}px`,
        fontStyle: 'bold',
        color: '#2de2e6',
        stroke: '#05070f',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setDepth(5);
    // The load bar under the part (parts with a limit), the tag chip near its top, the triangle.
    const bar = part.kind === 'gateway' ? null : this.add.graphics().setDepth(5);
    const chip = null;
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
      skip: part.kind === 'server' ? this.makeSkip(part) : null,
      slot: part.slot,
      lit: true,
      player: new MotionPlayer(),
      haze: null,
      status: null,
      baseX: c.x,
      baseY: c.y,
      baseScale: 1,
      dy: 0,
      dscale: 1,
      dalpha: 1,
    };
    this.views.set(part.id, v);
    return v;
  }

  /** A part's tag chip (DIES IN n s, UNFED), at its top. */
  private makeChip(part: Part): Phaser.GameObjects.Text {
    const c = partCentre(part) ?? { x: 0, y: 0 };
    const size = partSize(part);
    const s = partScale(part);
    return this.add
      .text(c.x, c.y - size.h / 2 + 16 * s, '', {
        fontFamily: 'monospace',
        fontSize: `${Math.max(11, Math.round(15 * s))}px`,
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#3b4150',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(6);
  }

  /** Scale that fits a part's art inside its box on the board (smaller toward the far edge), never above its file's size. */
  private artScale(part: Pick<Part, 'kind' | 'slot'>, img: Phaser.GameObjects.Image): number {
    const size = partSize(part);
    return Math.min(1, size.w / img.width, size.h / img.height);
  }

  /** Lay the traces out again: only when the wires or parts change, never on a steady frame. */
  private rebuildWires(f: Frame): void {
    this.lastWires = f.wires;
    this.lastParts = f.parts;
    this.oldWires = this.wireByKey;
    this.wireList = [];
    this.wireByKey = new Map();
    this.wiresDirty = true;
    for (const w of f.wires) {
      const a = partById(f.parts, w.from);
      const b = partById(f.parts, w.to);
      const path = a && b ? wirePath(a, b, f.parts) : null;
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
      if (!this.wireBorn.has(g.key)) this.wireBorn.set(g.key, this.clock);
    }
    // A wire that is gone forgets when it was born, so laying it again counts anew.
    for (const key of [...this.wireBorn.keys()]) if (!this.wireByKey.has(key)) this.wireBorn.delete(key);
    // Each part's return path, the way its retries go back to the mouth (board-7).
    this.backByKey = new Map();
    for (const part of f.parts) {
      const path = returnPath(part);
      if (!path) continue;
      const key = this.backKey(part.id);
      const length = pathLength(path);
      this.backByKey.set(key, {
        key,
        from: part.id,
        to: 'mouth',
        path,
        length,
        mid: pointAlong(path, length, 0.5, { x: 0, y: 0 }),
        travel: travelSeconds(length),
      });
    }
  }

  /** RETURN_PREFIX + id, built the first time a part is seen. */
  private backKey(id: string): string {
    let k = this.backKeys.get(id);
    if (k === undefined) {
      k = RETURN_PREFIX + id;
      this.backKeys.set(id, k);
    }
    return k;
  }

  /** A packet key's geometry: a wire, an inbound lane or a return path. */
  private geomOf(key: string): WireGeom | undefined {
    return this.wireByKey.get(key) ?? INBOUND_BY_KEY.get(key) ?? this.backByKey.get(key);
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
        (key === this.selectedWire ? 4 : 0) |
        (this.animBook.playing('wire', key) !== undefined ? 8 : 0);
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
      // A new trace is drawing on (board-9): the animation draws it until it is whole.
      if ((state[i] & 8) !== 0) continue;
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
    const out = outPort(from) ?? c;
    p.lineStyle(4, CYAN, 0.6).lineBetween(out.x, out.y, this.pointer.x, this.pointer.y);
    p.fillStyle(CYAN, 0.9).fillCircle(this.pointer.x, this.pointer.y, 7);
    // The part it would land on rings cyan when connect() takes it, red when it refuses (board-8).
    const to = this.wireTo.id !== null ? partById(parts, this.wireTo.id) : null;
    const tc = to ? partCentre(to) : null;
    this.targetRing = to ? to.id : null;
    if (to && tc) {
      const size = partSize(to);
      p.lineStyle(4, this.wireTo.ok ? CYAN : RED, 0.95).strokeCircle(
        tc.x,
        tc.y,
        Math.max(size.w, size.h) / 2 + 8,
      );
    }
  }

  private skipTag(i: number): Phaser.GameObjects.Image {
    let t = this.skipTags[i];
    if (!t) {
      t = addLabel(this, 0, 0, 'wire-skipped', 'skipped', {
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

  /**
   * The packets (board-7): every wire's req/s and the inbound lanes as before, the lanes carrying
   * only the fresh share of what comes in, and the retries born at each dropping part on its return
   * path (they re-enter on the lanes once back at the mouth). Rates are refilled in place.
   */
  private stepPackets(dt: number, f: Frame): void {
    const demand = f.demand;
    const all = fillInboundRates(
      fillPacketRates(this.packetRates, f.flow.wires, demand, INBOUND_KEYS),
      demand,
      INBOUND_KEYS,
    );
    const share = this.chan.retryShare;
    if (share > 0) for (let i = 0; i < INBOUND_KEYS.length; i++) all[INBOUND_KEYS[i]] *= 1 - share;
    dropsInto(this.drops, f.parts, f.wires, f.flow.load, f.offline, BROWNOUT_RULES);
    retryBirthsInto(this.births, this.drops, share, this.chan.lanePps);
    for (const id in this.births) {
      const key = this.backKey(id);
      if (this.backByKey.has(key)) all[key] = this.births[id] / PACKETS_PER_REQUEST;
    }
    this.pool.step(dt, all, this.travelOf, this.stepOpts);
    const items = this.pool.items;
    while (this.packetSprites.length < items.length) {
      this.packetSprites.push(this.add.image(0, 0, this.packetTex).setScale(this.packetScaleNow).setDepth(2));
    }
    for (let i = 0; i < this.packetSprites.length; i++) {
      const s = this.packetSprites[i];
      const p = items[i];
      const w = p?.active ? this.geomOf(p.wire) : undefined;
      if (!p || !w) {
        s.setVisible(false);
        continue;
      }
      pointAlong(w.path, w.length, progress(p), this.at);
      s.setPosition(this.at.x, this.at.y).setVisible(true);
      const red = p.red || this.hotParts.has(w.to);
      if (this.packetTex === 'packet') s.setTint(red ? RED : AMBER);
      // The painted cube is cyan as cut; where traffic drops it is filled red (a multiply would go black).
      else if (red) s.setTintMode(Phaser.TintModes.FILL).setTint(RED);
      else s.setTintMode(Phaser.TintModes.MULTIPLY).clearTint();
    }
  }

  /**
   * Sparks off the in-port of every hot or dark part that drops, at sparkRate of what it drops
   * (board-7). Decorative: nothing is thrown in ?test lite mode or under reduce flicker.
   */
  private stepSparks(dt: number, parts: readonly Part[]): void {
    const off = this.lite || this.reduceFlicker;
    if (!off) {
      for (let i = 0; i < parts.length; i++) {
        const id = parts[i].id;
        const drop = this.drops[id] ?? 0;
        if (!(drop > 0) || !this.hotParts.has(id)) {
          this.sparkOwed[id] = 0;
          continue;
        }
        let owed = (this.sparkOwed[id] ?? 0) + sparkRate(drop) * dt;
        const n = Math.floor(owed);
        owed -= n;
        this.sparkOwed[id] = owed;
        if (n > 0) {
          const port = inPort(parts[i]);
          if (port) this.sparks.emit(port.x, port.y, n);
        }
      }
    }
    this.sparks.step(dt);
    const items = this.sparks.items;
    for (let i = 0; i < items.length; i++) {
      const sp = items[i];
      const img = this.sparkSprites[i];
      if (!img) continue;
      if (off || !sp.active) {
        img.setVisible(false);
        continue;
      }
      img
        .setPosition(sp.x, sp.y)
        .setAlpha(1 - sp.age / SPARK_LIFE)
        .setTint(sp.age < SPARK_LIFE / 3 ? 0xfff1c4 : AMBER)
        .setVisible(true);
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
    // A dead box selected: REPLACE under it puts a fresh one in its slot (board-8).
    const dead = part !== null && c !== null && part.kind === 'server' && this.trouble.dead.includes(part.id);
    if (dead) {
      const size = partSize(part);
      this.replaceBtn.setPosition(c.x, c.y + size.h / 2 + 34).setVisible(true);
    } else {
      this.replaceBtn.setVisible(false);
    }
  }

  /** Packets on their way into `id` right now (the test hook only). */
  private packetsInto(id: string): number {
    let n = 0;
    for (const p of this.pool.items) {
      if (!p.active) continue;
      if (p.returning) continue;
      const w = this.wireByKey.get(p.wire);
      if (w && w.to === id) n++;
    }
    return n;
  }

  /**
   * board-10: the crackle while a hot or dark part drops requests (at most once per 0.5 s) and the
   * blip for each new skip. The boot chime is asked for where the boot ring starts.
   */
  private playSounds(occ: readonly Occurrence[], parts: readonly Part[]): void {
    for (let i = 0; i < occ.length; i++)
      if (occ[i].kind === 'skipped') this.askSound(this.sounds.skip(this.clock));
    let dropping = false;
    for (let i = 0; i < parts.length && !dropping; i++) {
      const id = parts[i].id;
      dropping = (this.drops[id] ?? 0) > 0 && this.hotParts.has(id);
    }
    this.askSound(this.sounds.drop(dropping, this.clock));
  }

  /** Ask for a board sound the BoardSfx let through (its key exists). */
  private askSound(key: string | null): void {
    if (key !== null) bus.emit('sfx', { key });
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

  // ---- board-8: legality, the what-if ghost, plates, REPLACE -----------------------------------

  /**
   * The legality of the spot the card in hand is over (padState on its anchor), recomputed only
   * when the card, the spot or the Frame changes; nothing allocates on a steady frame.
   */
  private updateLegality(f: Frame, card: string): void {
    const at = this.over.slot;
    if (f === this.legalFrame && card === this.legalCard && at === this.legalOver) return;
    this.legalFrame = f;
    this.legalCard = card;
    this.legalOver = at;
    const board = this.padBoard;
    board.parts = f.parts;
    board.credits = f.credits;
    board.dead = f.dead;
    this.overLegality = at === null ? null : padState(at, board, card, PRICES);
    this.ghostDirty = true;
  }

  /** The legality of the spot (an anchor cell, or a part's) the card is over, or null over nothing. */
  private overState(): PadState | null {
    const o = this.over;
    if (o.id === null) return null;
    if (o.slot === null) return 'wrong';
    const d = this.drag;
    if (d?.kind === 'card') this.updateLegality(this.snap.current ?? frame(run()), d.id);
    return this.overLegality;
  }

  /**
   * The what-if ghost while a card is dragged (board-8): the pad's state, the ghost's numbers
   * (ghostInfo over wiredCapacity, recomputed only when the target or the Frame changes), the
   * dragged card snapping onto a legal target with a dashed outline and its plate, and the what-if
   * tick on the channel.
   */
  private updateGhost(f: Frame): void {
    const d = this.drag;
    const card = d?.kind === 'card' ? d.id : null;
    if (card === null || this.over.id === null) {
      this.ghostInfo = null;
    } else if (this.ghostDirty || f !== this.ghostFrame) {
      this.ghostDirty = false;
      this.ghostFrame = f;
      const state = this.overState() ?? 'wrong';
      this.ghostInfo = ghostInfo(
        f,
        BROWNOUT_RULES,
        f.offline,
        card,
        this.over.id,
        this.over.slot,
        state,
        true,
      );
    }
    const g = this.ghostInfo;
    // Snap the card in hand onto a legal spot while the ghost may show: the server stands on its footprint.
    const snap = g !== null && g.legal && card !== null && this.over.slot !== null;
    const key = snap ? this.over.slot : null;
    if (key !== this.ghostShownFor) {
      this.ghostShownFor = key;
      const og = this.ghostOutline;
      og.clear();
      if (key !== null) {
        const box = this.targetBox(key);
        const q = this.targetQuad(key);
        if (q) {
          og.lineStyle(2, CYAN, 0.95);
          for (let k = 0; k < 4; k++) dashedLine(og, q[k], q[(k + 1) % 4], 8, 6);
        }
        if (card === 'server' && box) {
          this.ghost
            .setPosition(box.x, box.y)
            .setScale(Math.min(1, box.w / this.ghost.width, box.h / this.ghost.height));
        } else if (box) {
          this.ghost.setPosition(box.x, box.y - box.h * 0.2);
        }
      } else if (card !== null) {
        this.ghost.setScale(120 / this.ghost.frame.height);
        this.ghost.setPosition(this.pointer.x, this.pointer.y - this.ghost.displayHeight / 2 - 8);
      }
    }
    // The plate beside the ghost: what the drop adds, or that nothing feeds it (also over a spot the
    // credits fall short for, where only the drop is refused).
    const at = g !== null && g.plate !== null && this.over.slot !== null;
    const plate = at ? g.plate : null;
    const plateAt = at ? this.over.slot : null;
    if (plate !== this.ghostPlateShown || plateAt !== this.ghostPlateAt) {
      this.ghostPlateShown = plate;
      this.ghostPlateAt = plateAt;
      const box = plateAt !== null ? this.targetBox(plateAt) : null;
      if (plate === null || box === null) this.ghostText.setVisible(false);
      else {
        this.ghostText
          .setText(plate)
          .setPosition(
            Phaser.Math.Clamp(box.x, BOARD_AREA.left + 180, BOARD_AREA.right - 180),
            box.y - box.h / 2 - 8,
          )
          .setColor(g!.adds > 0 ? '#2de2e6' : '#c5cad6')
          .setVisible(true);
      }
    }
    this.drawWhatIf(at ? g.whatIf : null, at ? g.tick : null);
  }

  /** The box the card in hand lands in at `anchor`: the part standing there, or a new server on its footprint. */
  private targetBox(anchor: string): Box | null {
    const on = this.over.kind === 'part' ? partWithAnchor(run().session.board.parts, anchor) : null;
    return on ? partBox(on) : standBox('server', anchor);
  }

  /** The cells' outline the card in hand lands on at `anchor`: the part's footprint, or a server's. */
  private targetQuad(anchor: string): [Point, Point, Point, Point] | null {
    const on = this.over.kind === 'part' ? partWithAnchor(run().session.board.parts, anchor) : null;
    return on && on.slot !== null ? footprintQuad(on.kind, on.slot) : footprintQuad('server', anchor);
  }

  /** The what-if tick on the channel at the ghost's level, labelled "ROOM +60"; drawn only on a change. */
  private drawWhatIf(level: number | null, tick: string | null): void {
    const rounded = level === null ? null : Math.round(level * 1000) / 1000;
    if (rounded === this.drawnWhatIf && tick === this.drawnTick) return;
    this.drawnWhatIf = rounded;
    this.drawnTick = tick;
    const g = this.whatIfG;
    g.clear();
    if (rounded === null) {
      this.whatIfText.setVisible(false);
      return;
    }
    const { mouth, port } = CHANNEL;
    const steps = 12;
    g.lineStyle(3, CYAN, 0.9);
    for (let i = 0; i < steps; i += 2) {
      const xa = mouth.x + ((port.x - mouth.x) * i) / steps;
      const xb = mouth.x + ((port.x - mouth.x) * (i + 1)) / steps;
      g.lineBetween(xa, levelY(rounded, xa), xb, levelY(rounded, xb));
    }
    if (tick === null) this.whatIfText.setVisible(false);
    else
      this.whatIfText
        .setText(tick)
        .setPosition(port.x - 4, levelY(rounded, port.x) - 16)
        .setVisible(true);
  }

  /**
   * The hover plate (board-8): the part or wire under the pointer, else the selected one (pinned),
   * in the script's words (plate.ts over labels.ts). Its text is re-set only when what it shows
   * changes; nothing shows during a drag.
   */
  private updatePlate(parts: readonly Part[], f: Frame): void {
    const dragging = this.drag !== null && (this.drag.kind === 'card' || this.drag.moved);
    let partId: string | null = null;
    let wireKeyShown: string | null = null;
    let pinned = false;
    if (!dragging) {
      if (this.hover.part !== null && partById(parts, this.hover.part)) partId = this.hover.part;
      else if (this.hover.wire !== null && this.wireByKey.has(this.hover.wire))
        wireKeyShown = this.hover.wire;
      else if (this.selectedPart !== null) {
        partId = this.selectedPart;
        pinned = true;
      } else if (this.selectedWire !== null && this.wireByKey.has(this.selectedWire)) {
        wireKeyShown = this.selectedWire;
        pinned = true;
      }
      if (!pinned)
        pinned =
          (partId !== null && partId === this.selectedPart) ||
          (wireKeyShown !== null && wireKeyShown === this.selectedWire);
    }
    this.platePinned = pinned;
    const plate = this.plate;
    if (partId === null && wireKeyShown === null) {
      if (this.plateFor !== null) {
        this.plateFor = null;
        this.plates.reset();
        plate.setVisible(false);
        this.plateG.clear();
      }
      return;
    }
    let changed: boolean;
    let x: number;
    let y: number;
    if (partId !== null) {
      const part = partById(parts, partId)!;
      const v = this.views.get(partId);
      const c = partCentre(part);
      if (!v || !c) return;
      changed = this.plates.part(partId, part, v.look, this.skippedNow(part));
      const size = partSize(part);
      x = c.x;
      y = c.y - size.h / 2 - 30;
    } else {
      const w = this.wireByKey.get(wireKeyShown!)!;
      const a = partById(parts, w.from);
      const b = partById(parts, w.to);
      if (!a || !b) return;
      changed = this.plates.wire(w.key, a, b, f.flow.wires[w.key] ?? 0);
      x = w.mid.x;
      y = w.mid.y - 76;
    }
    const target = partId ?? wireKeyShown;
    if (changed || target !== this.plateFor) {
      this.plateFor = target;
      plate.setText(this.plates.text);
      const left = BOARD_AREA.left + 8 + plate.width / 2;
      const right = BOARD_AREA.right - 8 - plate.width / 2;
      const px = Phaser.Math.Clamp(x, left, right);
      const py = Math.max(BOARD_AREA.top + 8 + plate.height, y);
      plate.setPosition(px, py).setVisible(true);
      const g = this.plateG;
      g.clear();
      g.lineStyle(2, AMBER, 0.9).strokeRect(
        px - plate.width / 2,
        py - plate.height,
        plate.width,
        plate.height,
      );
    }
  }

  /** Whether the SKIPPED tag is on `part`'s footprint now. */
  private skippedNow(part: Part): boolean {
    const sk = this.views.get(part.id)?.skip;
    return sk !== undefined && sk !== null && this.clock < sk.skipUntil;
  }

  // ---- input ---------------------------------------------------------------------------------

  /**
   * Tell the other lanes what the pointer drags and what it is over (bus 'drag'), with the pad's
   * verdict (dragVerdict): the card's padState where it is, null over nothing, on a wire and at
   * the end.
   */
  private emitDrag(): void {
    const d = this.drag;
    if (!d) {
      bus.emit('drag', { kind: null, card: null, over: null, ...dragVerdict(null) });
      return;
    }
    if (d.kind === 'card') {
      // The legality is cached per Frame and card, so this is free unless the card just changed.
      if (this.over.id !== null) this.updateLegality(frame(run()), d.id);
      const state = this.overState();
      bus.emit('drag', {
        kind: 'card',
        card: trayIdOf(d.id),
        over: this.over.kind,
        ...dragVerdict(state),
      });
      return;
    }
    bus.emit('drag', {
      kind: 'wire',
      card: null,
      over: this.wireTo.id === null ? null : 'part',
      ...dragVerdict(null),
    });
  }

  /** End the drag in hand, with or without a drop, and say so once on the bus. */
  private endDrag(): void {
    const had = this.drag !== null && (this.drag.kind === 'card' || this.drag.moved);
    this.drag = null;
    this.ghost.setVisible(false);
    this.over.id = null;
    this.over.slot = null;
    this.over.kind = null;
    this.wireTo.id = null;
    this.wireTo.ok = false;
    this.wireTo.reason = null;
    this.ghostDirty = true;
    if (had) this.emitDrag();
  }

  /**
   * What a card dragged to (x, y) is over: a part (the kit on any part, a server card on a dead
   * box: `slot` is the part's anchor) or the cells its footprint would cover there, centred under
   * the pointer and snapped to the grid (`slot` is the footprint's anchor cell). Off the grid, nothing.
   */
  private updateOver(x: number, y: number, card: string, parts: readonly Part[]): void {
    let id: string | null = null;
    let slot: string | null = null;
    let kind: 'cell' | 'part' | null = null;
    const part = partAt(parts, x, y);
    const anchor = dropAnchor(card === 'balancer' ? 'balancer' : 'server', x, y);
    const onPart =
      part !== null &&
      (card === 'overclock' || (card === 'server' && part.kind === 'server' && this.snapDead(part.id)));
    if (onPart) {
      slot = anchorOf(part) ?? null;
      id = slot ?? part.id;
      kind = 'part';
    } else if (anchor !== null) {
      id = anchor;
      slot = anchor;
      kind = 'cell';
    } else if (part) {
      id = part.id;
      slot = anchorOf(part);
      kind = 'part';
    }
    if (id === this.over.id && kind === this.over.kind) return;
    this.over.id = id;
    this.over.slot = slot;
    this.over.kind = kind;
    this.ghostDirty = true;
    this.emitDrag();
  }

  /** Whether `id` is a dead box on the board the sync last read. */
  private snapDead(id: string): boolean {
    const f = this.snap.current;
    return f !== null && f !== undefined && f.dead.includes(id);
  }

  /** The part a wire dragged to (x, y) would land on, and whether connect() would take it. */
  private updateWireTo(x: number, y: number, from: string): void {
    const r = run();
    const target = partAt(r.session.board.parts, x, y);
    const id = target && target.id !== from ? target.id : null;
    if (id === this.wireTo.id) return;
    this.wireTo.id = id;
    if (id === null) {
      this.wireTo.ok = false;
      this.wireTo.reason = null;
    } else {
      const t = targetState(r.session.board, BROWNOUT_RULES, from, id);
      this.wireTo.ok = t.ok;
      this.wireTo.reason = t.reason;
    }
    this.emitDrag();
  }

  /** Whether a press at (x, y) lands on a round button that is showing. */
  private onButton(btn: Phaser.GameObjects.Container, x: number, y: number): boolean {
    return btn.visible && Math.hypot(x - btn.x, y - btn.y) <= BUTTON_RADIUS + 4;
  }

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
    if (this.onButton(this.cutBtn, p.x, p.y)) {
      const w = this.selectedWire ? this.wireByKey.get(this.selectedWire) : undefined;
      if (w) r.cut(w.from, w.to);
      this.selectedWire = null;
      return;
    }
    if (this.onButton(this.binBtn, p.x, p.y)) {
      if (this.selectedPart) this.decommission(this.selectedPart);
      return;
    }
    if (this.replaceBtn.visible && this.replaceHit(p.x, p.y)) {
      // REPLACE on a dead box: a fresh one in its slot, on the same wires.
      if (this.selectedPart && r.replaceServer(this.selectedPart).ok) this.selectedPart = null;
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
      this.over.id = null;
      this.over.slot = null;
      this.over.kind = null;
      this.ghostDirty = true;
      this.ghostShownFor = null;
      this.ghost
        .setTexture(card.art)
        .setScale(120 / this.ghost.frame.height)
        .setPosition(p.x, p.y)
        .setVisible(true);
      this.emitDrag();
      return;
    }

    const part = partAt(parts, p.x, p.y);
    if (part) {
      this.drag = { kind: 'wire', from: part.id, x0: p.x, y0: p.y, moved: false };
      this.wireTo.id = null;
      return;
    }

    this.selectedWire = this.wireNear(p.x, p.y);
    this.selectedPart = null;
  }

  /** The wire within WIRE_PICK of (x, y), nearest first, or null. */
  private wireNear(x: number, y: number): string | null {
    let best: WireGeom | null = null;
    let bestD = WIRE_PICK;
    for (const w of this.wireList) {
      const d = distToPath(x, y, w.path);
      if (d <= bestD) {
        best = w;
        bestD = d;
      }
    }
    return best ? best.key : null;
  }

  private onMove(p: Phaser.Input.Pointer): void {
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    const d = this.drag;
    if (!d) {
      // Hover: the part under the pointer, else a wire within reach.
      const part = partAt(run().session.board.parts, p.x, p.y);
      this.hover.part = part ? part.id : null;
      this.hover.wire = part ? null : this.wireNear(p.x, p.y);
      return;
    }
    this.hover.part = null;
    this.hover.wire = null;
    if (d.kind === 'card') {
      // Unsnapped, the card rides just above the pointer so the cells under it (green or red) stay in view.
      if (this.ghostShownFor === null) this.ghost.setPosition(p.x, p.y - this.ghost.displayHeight / 2 - 8);
      this.updateOver(p.x, p.y, d.id, run().session.board.parts);
      return;
    }
    if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) > DRAG_START) {
      d.moved = true;
      this.emitDrag();
    }
    if (d.moved) this.updateWireTo(p.x, p.y, d.from);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    const d = this.drag;
    this.endDrag();
    if (!d) return;
    const r = run();
    const parts = r.session.board.parts;

    if (d.kind === 'card') {
      if (d.id === 'server') {
        // A dead box under the pointer is replaced on its cells; otherwise the server snaps to the
        // footprint under the pointer (the green cells), and the run says why if it does not fit.
        const on = partAt(parts, p.x, p.y);
        const anchor = dropAnchor('server', p.x, p.y);
        if (on !== null && on.kind === 'server' && r.dead.includes(on.id)) r.replaceServer(on.id);
        else if (anchor !== null) r.placeServer(anchor);
      } else if (d.id === 'overclock') {
        const target = partAt(parts, p.x, p.y);
        if (target) r.overclock(target.id);
      } else if (d.id === 'balancer') {
        // The crew rack their splitter themselves: a drop on the table says so.
        if (dropAnchor('balancer', p.x, p.y) !== null) {
          const res = placeBalancer(r);
          if (!res.ok) this.refuse(res.reason);
        }
      }
      return;
    }

    const target = partAt(parts, p.x, p.y);
    if (!d.moved) {
      // A click on a part: select it (placed parts show the bin button, a dead one REPLACE too).
      const clicked = target?.id === d.from ? target : null;
      this.selectedWire = null;
      this.selectedPart =
        clicked && clicked.slot !== null && this.selectedPart !== clicked.id ? clicked.id : null;
      return;
    }
    if (target && target.id !== d.from) r.connect(d.from, target.id);
  }

  /**
   * Esc (board-8): cancels the drag in hand, else clears the selection; when it did either, the
   * key stops here so the pause menu does not open too. Keys 1, 2 and 3 are never listened to.
   */
  private onEscape(event: KeyboardEvent): void {
    let used = false;
    if (this.drag !== null) {
      this.endDrag();
      used = true;
    } else if (this.selectedPart !== null || this.selectedWire !== null) {
      this.selectedPart = null;
      this.selectedWire = null;
      used = true;
    }
    if (used) {
      this.lastKey = 'Escape';
      event.stopPropagation();
    }
  }

  /** Delete or Backspace (board-8): cuts the selected wire. A selected part is not removed by key. */
  private onDelete(event?: KeyboardEvent): void {
    const w = this.selectedWire ? this.wireByKey.get(this.selectedWire) : undefined;
    if (!w) return;
    this.lastKey = event?.key === 'Backspace' ? 'Backspace' : 'Delete';
    run().cut(w.from, w.to);
    this.selectedWire = null;
  }

  private decommission(id: string): void {
    const res = run().decommission(id);
    if (res.ok) this.selectedPart = null;
  }

  // ---- board-9: animations ----------------------------------------------------------------------
  // Looks only: everything here reads the Frame the sync took and the bus, draws, and changes no sim
  // state. Timelines come from board/anim.ts, the sprite specs from motion.ts; under reduce flicker
  // the calm variants play and nothing flashes or throws sparks. In ?test lite mode no decorative
  // particle is thrown; every hook value stays the same.

  /** The animation sprites, made once: the drawing layer, the shade, the cable, the kit, the lift, the float, the particles. */
  private makeAnimObjects(): void {
    this.bakeHaze();
    this.animG = this.add.graphics().setDepth(4.5);
    const feed = ZONES.feed;
    this.shade = this.add
      .rectangle(feed.x, feed.y, feed.w, feed.h, 0x000000, 1)
      .setOrigin(0)
      .setDepth(20)
      .setAlpha(0)
      .setVisible(false);
    this.cableImg = this.add
      .image(feed.x + feed.w / 2, feed.y, 'board-cable')
      .setOrigin(0.5, 1)
      .setDepth(2.9);
    this.cableImg.setScale(CABLE_SCALE).setVisible(false);
    this.kitImg = this.add.image(0, 0, 'overclock-kit').setDepth(32).setVisible(false);
    this.liftImg = this.add.image(0, 0, 'server').setDepth(7).setVisible(false);
    this.floatText = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#ffb02e',
        stroke: '#05070f',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setDepth(36)
      .setVisible(false);
    for (let i = 0; i < this.particles.items.length; i++) {
      this.particleSprites.push(this.add.image(0, 0, 'packet').setDepth(8).setVisible(false));
    }
  }

  /** The heat haze: a soft warm glow baked once into a texture. */
  private bakeHaze(): void {
    if (this.textures.exists('board-haze')) return;
    const g = this.make.graphics({}, false);
    for (let i = 8; i >= 1; i--) g.fillStyle(0xff7a3a, 0.05).fillEllipse(48, 40, 12 * i, 10 * i);
    g.generateTexture('board-haze', 96, 80);
    g.destroy();
  }

  /** The edges between the last frame and this one (reused list); a rewind clears every animation instead. */
  private edges(f: Frame): readonly Occurrence[] {
    const prev = this.prevFrame;
    this.prevFrame = f;
    if (prev === null || prev === f) {
      this.occ.length = 0;
      return this.occ;
    }
    detectOccurrences(prev, f, this.occ);
    if (f.rewinds.length !== this.rewindsSeen) {
      this.rewindsSeen = f.rewinds.length;
      this.resetAnims();
      this.occ.length = 0;
    }
    return this.occ;
  }

  /** Stop every animation and hide its sprites (a rewind puts the board back as it was). */
  private resetAnims(): void {
    this.animBook.clear(this.animClock);
    this.particles.clear();
    this.liftPlayer.stop();
    this.cutGeoms.clear();
    this.views.forEach(stopPlayer);
    // Scene-side timers go with the rewind too: no SKIPPED tag stays stuck on a pad from before it.
    this.views.forEach(clearSkip);
  }

  /**
   * One frame of the animations: start what this frame's edges and the parts' states call for, end
   * what is done, then draw. `rawDt` is the frame's real seconds (0 while the board is held, but not
   * while it stands frozen on a failure); animations run on board time, slowed with the packets
   * while Regroup runs.
   */
  private stepAnims(f: Frame, occ: readonly Occurrence[], rawDt: number, calm: boolean): void {
    const dt = rawDt * (f.timeScale > 0 ? f.timeScale : 0);
    this.animClock += dt;
    const now = this.animClock;
    const book = this.animBook;
    for (let i = 0; i < occ.length; i++) this.startFor(occ[i], f, calm, now);
    const parts = f.parts;
    for (let i = 0; i < parts.length; i++) {
      const id = parts[i].id;
      const v = this.views.get(id);
      if (!v) continue;
      const st = v.look.status;
      if ((v.status === 'booting' || v.status === 'rebooting') && st === 'online') {
        book.start('boot', id, calm, now);
        this.askSound(this.sounds.online(this.clock));
      }
      v.status = st;
      book.keep('haze', id, st === 'online' && v.look.share !== null && v.look.share > 1, calm, now);
    }
    book.keep('ping', null, this.balancerFeeds(f), calm, now);
    book.step(now);
    this.drawSprites(f, rawDt, now);
    this.drawLayer(f, now, calm);
    this.drawExtras(f, rawDt, now, calm);
    this.particles.step(dt);
    this.drawParticles();
  }

  /** Start what one edge calls for. */
  private startFor(o: Occurrence, f: Frame, calm: boolean, now: number): void {
    const book = this.animBook;
    const id = o.id ?? null;
    const v = id !== null ? this.views.get(id) : undefined;
    switch (o.kind) {
      case 'placed': {
        const part = id !== null ? partById(f.parts, id) : null;
        if (!part || !v) return;
        if (part.kind === 'balancer') {
          // The crew's balancer comes down on the cable inside the crew-build wait.
          book.start('cable', null, calm, now);
          v.player.play(MOTION.crewTint);
        } else {
          book.start('place', id, calm, now);
          v.player.play(MOTION.placeDrop);
        }
        return;
      }
      case 'died': {
        if (!v || id === null) return;
        book.start('death', id, calm, now);
        v.player.play(MOTION.dieCollapse);
        if (!calm) book.start('flash', null, calm, now, DEATH_FLASH_MS);
        if (!this.lite) this.particles.emit('smoke', v.baseX, v.baseY - 20, deathSmoke(calm));
        return;
      }
      case 'dark': {
        if (id === null) {
          book.start('lightsdown', null, calm, now);
          return;
        }
        if (!v || f.dead.includes(id)) return;
        book.start('dip', id, calm, now);
        v.player.play(MOTION.dipBlackout);
        return;
      }
      case 'held': {
        book.start('fireworks', null, calm, now);
        if (!calm) book.start('flash', null, calm, now);
        this.fireworksAt = -1;
        return;
      }
      case 'wired': {
        if (id !== null && this.wireByKey.has(id)) book.start('wire', id, calm, now);
        return;
      }
      case 'cut': {
        const g = id !== null ? (this.oldWires.get(id) ?? this.wireByKey.get(id)) : undefined;
        if (!g || id === null) return;
        this.cutGeoms.set(id, g);
        book.start('cut', id, calm, now);
        if (calm) return;
        book.start('sparks', null, calm, now);
        if (this.lite) return;
        const a = g.path[0];
        const b = g.path[g.path.length - 1];
        this.particles.emit('spark', a.x, a.y, 6);
        this.particles.emit('spark', b.x, b.y, 6);
        return;
      }
      default:
        return;
    }
  }

  /** What the player did, from the bus: a decommission lifts the part away with its refund; a kit flies on. */
  private onAction(a: GameEvents['action']): void {
    const calm = settings().reduceFlicker;
    const now = this.animClock;
    if (a.type === 'decommission') {
      const v = this.views.get(a.id);
      if (!v) return;
      this.liftImg
        .setTexture(this.textureOf(v.art))
        .setPosition(v.baseX, v.baseY)
        .setScale(v.baseScale)
        .setAlpha(1)
        .setVisible(true);
      this.liftAt.x = v.baseX;
      this.liftAt.y = v.baseY;
      this.liftAt.scale = v.baseScale;
      this.liftPlayer.play(MOTION.cardLift);
      this.animBook.start('decommission', a.id, calm, now);
      const refund = Math.round(a.refund);
      if (refund > 0) {
        this.floatText.setText(`+${refund}`);
        this.floatAt.x = v.baseX;
        this.floatAt.y = v.baseY - v.img.displayHeight / 2;
        this.animBook.start('float', a.id, calm, now);
      }
      return;
    }
    if (a.type === 'overclock') {
      const v = this.views.get(a.id);
      const card = this.cards.find((c) => c.id === 'overclock');
      if (!v || !card) return;
      this.kitFrom.x = card.x;
      this.kitFrom.y = card.y;
      this.kitTo.x = v.baseX;
      this.kitTo.y = v.baseY;
      this.animBook.start('overclock', a.id, calm, now);
    }
  }

  /** Whether a balancer has a wire to a box: its health checks ping down them. */
  private balancerFeeds(f: Frame): boolean {
    const wires = f.wires;
    for (let i = 0; i < wires.length; i++) {
      const from = partById(f.parts, wires[i].from);
      if (from !== null && from.kind === 'balancer' && wires[i].to !== 'database') return true;
    }
    return false;
  }

  /** Each part sprite: the motion spec playing on it, else the pose its state rests in; the haze over a hot one. */
  private drawSprites(f: Frame, rawDt: number, now: number): void {
    const parts = f.parts;
    const cable = this.animBook.playing('cable', null);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const v = this.views.get(part.id);
      if (!v) continue;
      const s = v.player.step(rawDt, f.timeScale, this.reduceFlicker);
      let dy = 0;
      let sc = 1;
      let al = 1;
      let light = 1;
      let mix = 0;
      if (v.player.spec !== null) {
        dy = s.y;
        sc = s.scale;
        al = s.alpha;
        light = s.light;
        mix = s.mix;
      } else if (f.dead.includes(part.id)) {
        // A dead box rests where its collapse left it.
        const rest = MOTION.dieCollapse.rest;
        dy = rest.y ?? 0;
        sc = rest.scale ?? 1;
        al = rest.alpha ?? 1;
      }
      let dx = 0;
      const death = this.animBook.playing('death', part.id);
      if (death) dx = deathFrame(now - death.start, death.calm, this.df).shakeX;
      if (cable && part.kind === 'balancer') {
        cableFrame(now - cable.start, cable.calm, this.cf);
        dy += this.cf.dy;
        dx += this.cf.sway;
      }
      v.img.setPosition(v.baseX + dx, v.baseY + dy).setScale(v.baseScale * sc);
      if (al !== 1) v.img.setAlpha(v.img.alpha * al);
      if (light < 1) v.img.setTint(lerpColour(0xffffff, DARK_TINT, 1 - light));
      else if (mix > 0) v.img.setTint(lerpColour(0xffffff, CYAN, mix * 0.6));
      v.dy = dy;
      v.dscale = sc;
      v.dalpha = al;
      // Heat haze over a box over 100%.
      const haze = this.animBook.playing('haze', part.id);
      if (haze) {
        if (!v.haze) v.haze = this.add.image(v.baseX, v.baseY, 'board-haze').setDepth(5.5);
        hazeFrame(now - haze.start, haze.calm, this.hf);
        const h = v.img.displayHeight;
        v.haze
          .setPosition(v.baseX, v.baseY - h * 0.45 + this.hf.dy)
          .setScale((v.img.displayWidth * 1.3) / 96, ((h * 0.6) / 80) * this.hf.scaleY)
          .setAlpha(this.hf.alpha)
          .setVisible(true);
      } else if (v.haze?.visible) v.haze.setVisible(false);
    }
    // The held servers' footprints glow (flash in full, a slow warm glow when calm).
    const held = this.animBook.playing('fireworks', null);
    this.drawHeld(parts, held ? heldPadGlow(now - held.start, held.calm) : 0);
  }

  /** The drawn layer: traces drawing on, cut traces fading, boot rings, the death flash, the pings. Cleared only while one plays. */
  private drawLayer(f: Frame, now: number, calm: boolean): void {
    const live = this.animBook.live;
    const g = this.animG;
    let any = false;
    for (let i = 0; i < live.length; i++) {
      const k = live[i].kind;
      if (k === 'wire' || k === 'cut' || k === 'boot' || k === 'ping' || (k === 'death' && !live[i].calm)) {
        any = true;
        break;
      }
    }
    if (!any) {
      if (this.animDrawn) g.clear();
      if (this.animDrawn) this.hidePingIcons(0);
      this.animDrawn = false;
      if (this.cutGeoms.size > 0) this.cutGeoms.clear();
      return;
    }
    g.clear();
    this.animDrawn = true;
    let pinged = false;
    for (let i = 0; i < live.length; i++) {
      const e = live[i];
      const t = now - e.start;
      if (e.kind === 'wire' && e.id !== null) {
        const w = this.wireByKey.get(e.id);
        if (w) this.strokePartial(g, w, drawOn(t), 1);
      } else if (e.kind === 'cut' && e.id !== null) {
        const w = this.cutGeoms.get(e.id);
        if (w) this.strokePartial(g, w, 1, cutFade(t));
      } else if (e.kind === 'boot' && e.id !== null) {
        const v = this.views.get(e.id);
        if (!v) continue;
        bootFrame(t, e.calm, this.rf);
        const r = (Math.max(v.img.displayWidth, v.img.displayHeight) / 2 + 6) * this.rf.scale;
        g.lineStyle(4, CYAN, this.rf.alpha).strokeCircle(v.baseX, v.baseY, r);
      } else if (e.kind === 'death' && e.id !== null && !e.calm) {
        const v = this.views.get(e.id);
        if (!v) continue;
        deathFrame(t, false, this.df);
        if (this.df.flash > 0) {
          const w = v.img.displayWidth;
          const h = v.img.displayHeight;
          g.fillStyle(0xffffff, this.df.flash * 0.85).fillRect(v.img.x - w / 2, v.img.y - h / 2, w, h);
        }
      } else if (e.kind === 'ping') {
        pingFrame(t, calm, this.pf);
        let icons = 0;
        for (let j = 0; j < this.wireList.length; j++) {
          const w = this.wireList[j];
          const from = partById(f.parts, w.from);
          if (from === null || from.kind !== 'balancer') continue;
          pointAlong(w.path, w.length, this.pf.along, this.at);
          g.lineStyle(2, CYAN, this.pf.alpha).strokeCircle(this.at.x, this.at.y, this.pf.radius);
          // board-12: the ping mark at the top-right corner of the box being checked (its readout sits above it).
          const to = this.views.get(w.to);
          if (to && icons < this.pingIcons.length && partById(f.parts, w.to)?.kind === 'server') {
            this.pingIcons[icons++]
              .setPosition(to.baseX + to.img.displayWidth / 2 + 6, to.baseY - to.img.displayHeight / 2 + 14)
              .setAlpha(this.pf.alpha)
              .setVisible(true);
          }
        }
        this.hidePingIcons(icons);
        pinged = true;
      }
    }
    if (!pinged) this.hidePingIcons(0);
  }

  /** Hide the ping marks from index `from` on (no-op for those already hidden). */
  private hidePingIcons(from: number): void {
    for (let i = from; i < this.pingIcons.length; i++)
      if (this.pingIcons[i].visible) this.pingIcons[i].setVisible(false);
  }

  /** Stroke the first `share` of a trace (glow, groove, core) at `alpha`, segment by segment (no allocation). */
  private strokePartial(g: Phaser.GameObjects.Graphics, w: WireGeom, share: number, alpha: number): void {
    if (share <= 0 || alpha <= 0) return;
    const target = w.length * Math.min(1, share);
    for (let pass = 0; pass < 3; pass++) {
      if (pass === 0) g.lineStyle(18, CYAN, 0.16 * alpha);
      else if (pass === 1) g.lineStyle(8, 0x03050b, 0.9 * alpha);
      else g.lineStyle(3, CYAN, 0.95 * alpha);
      let done = 0;
      for (let i = 1; i < w.path.length && done < target; i++) {
        const a = w.path[i - 1];
        const b = w.path[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        const k = seg > 0 ? Math.min(1, (target - done) / seg) : 1;
        g.lineBetween(a.x, a.y, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
        done += seg;
      }
    }
  }

  /** The cable, the kit in flight, the lifted part, the refund float, the lights going down, the fireworks. */
  private drawExtras(f: Frame, rawDt: number, now: number, calm: boolean): void {
    const book = this.animBook;
    // The cable: its end at the balancer's top as it comes down, cropped to the feed.
    const cable = book.playing('cable', null);
    const lb = cable ? partOfKind(f.parts, 'balancer') : null;
    const lbView = lb ? this.views.get(lb.id) : undefined;
    if (cable && lbView) {
      const end = lbView.img.y - lbView.img.displayHeight / 2 + 6;
      const shown = Math.max(0, end - ZONES.feed.y);
      const h = this.cableImg.height;
      const cropH = Math.min(h, shown / CABLE_SCALE);
      this.cableImg
        .setPosition(lbView.img.x, end)
        .setCrop(0, h - cropH, this.cableImg.width, cropH)
        .setVisible(shown > 0);
    } else if (this.cableImg.visible) this.cableImg.setVisible(false);

    const kit = this.firstOf('overclock');
    if (kit) {
      kitFrame(now - kit.start, this.ff);
      const p = this.ff.along;
      this.kitImg
        .setPosition(
          this.kitFrom.x + (this.kitTo.x - this.kitFrom.x) * p,
          this.kitFrom.y + (this.kitTo.y - this.kitFrom.y) * p,
        )
        .setScale((KIT_SIZE / this.kitImg.height) * this.ff.scale)
        .setAlpha(this.ff.alpha)
        .setVisible(true);
    } else if (this.kitImg.visible) this.kitImg.setVisible(false);

    if (this.liftPlayer.spec !== null) {
      const s = this.liftPlayer.step(rawDt, f.timeScale, calm);
      if (this.liftPlayer.spec !== null) {
        this.liftImg
          .setPosition(this.liftAt.x, this.liftAt.y + s.y)
          .setScale(this.liftAt.scale * s.scale)
          .setAlpha(s.alpha);
      } else this.liftImg.setVisible(false);
    } else if (this.liftImg.visible) this.liftImg.setVisible(false);

    const float = this.firstOf('float');
    if (float) {
      floatFrame(now - float.start, this.flf);
      this.floatText
        .setPosition(this.floatAt.x, this.floatAt.y + this.flf.dy)
        .setAlpha(this.flf.alpha)
        .setVisible(true);
    } else if (this.floatText.visible) this.floatText.setVisible(false);

    // The block went dark at midnight: the lights go down over the feed and stay down.
    const down = book.playing('lightsdown', null);
    const dark = f.midnight !== null && !f.midnight.held;
    if (down) this.shade.setAlpha(lightsDown(now - down.start)).setVisible(true);
    else if (dark) this.shade.setAlpha(lightsDown(Infinity)).setVisible(true);
    else if (this.shade.visible) this.shade.setVisible(false);

    // Batch 5: the midnight plate fades in over the day plate once the clock strikes midnight (at
    // once when calm), and the day plate darkens under it: the midnight plate is narrower, so the
    // day plate stays as the table's ends (the gateway and the database stand just past its ends). A
    // rewind past midnight brings the day plate back.
    const mp = this.midnightPlate;
    if (mp) {
      if (f.midnight === null) this.midnightStruck = null;
      else if (this.midnightStruck === null) this.midnightStruck = now;
      const a = midnightPlateAlpha(this.midnightStruck === null ? null : now - this.midnightStruck, calm);
      if (a !== this.midnightShown) {
        this.midnightShown = a;
        mp.img.setAlpha(a).setVisible(a > 0);
        if (a > 0) this.dayPlate?.setTint(lerpColour(0xffffff, MIDNIGHT_DAY_TINT, a));
        else this.dayPlate?.clearTint();
      }
    }

    // Midnight held: fireworks burst over the feed (embers rise off the pads when calm).
    const fw = book.playing('fireworks', null);
    if (fw) {
      const t = now - fw.start;
      const n = burstsDue(this.fireworksAt, t, fw.calm);
      this.fireworksAt = t;
      if (!this.lite) for (let i = 0; i < n; i++) this.burst(fw.calm);
    }
  }

  /** The first live animation of `kind`, whatever its id. */
  private firstOf(kind: 'overclock' | 'float'): AnimEntry | undefined {
    const live = this.animBook.live;
    for (let i = 0; i < live.length; i++) if (live[i].kind === kind) return live[i];
    return undefined;
  }

  /** One firework burst over the feed, or a soft rise of embers off a pad when calm. */
  private burst(calm: boolean): void {
    const n = this.burstCount++;
    if (calm) {
      const at = SPOT_CENTRES[n % SPOT_CENTRES.length];
      this.particles.emit('ember', at.x, at.y, EMBER_SIZE);
      return;
    }
    const feed = ZONES.feed;
    const x = feed.x + feed.w * (0.3 + 0.45 * ((n * 0.618) % 1));
    const y = feed.y + 70 + 50 * (n % 3);
    this.particles.emit('firework', x, y, FIREWORK_SIZE);
  }

  /** Draw the particle pool: grey smoke, white-hot sparks, coloured fireworks, amber embers. */
  private drawParticles(): void {
    const items = this.particles.items;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const img = this.particleSprites[i];
      if (!img) continue;
      if (!p.active) {
        if (img.visible) img.setVisible(false);
        continue;
      }
      const k = p.kind;
      img
        .setPosition(p.x, p.y)
        .setAlpha(this.particles.alphaOf(p))
        .setScale(k === 'smoke' ? 0.9 + p.age * 1.4 : k === 'spark' ? 0.3 : k === 'firework' ? 0.45 : 0.4)
        .setTint(
          k === 'smoke' ? 0x7a8094 : k === 'spark' ? 0xfff1c4 : k === 'ember' ? AMBER : FIREWORK_TINTS[i % 3],
        )
        .setVisible(true);
    }
  }

  // ---- end board-9 -------------------------------------------------------------------------------

  // ---- test hook -----------------------------------------------------------------------------

  private testState(): BoardTestState {
    const f = this.snap.current ?? frame(run());
    const board = { parts: f.parts, credits: f.credits };
    const rect = this.game.canvas.getBoundingClientRect();
    const page = (x: number, y: number) => toPage({ x, y }, rect, { width: GAME_WIDTH, height: GAME_HEIGHT });
    const pageBox = (b: Box) => pageRect({ x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }, rect);
    const offline = [...f.offline];
    const footBox = (kind: Part['kind'], anchor: string) => {
      const q = footprintQuad(kind, anchor)!;
      const xs = q.map((p) => p.x);
      const ys = q.map((p) => p.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      return pageRect({ x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }, rect);
    };
    const slots = SERVER_SPOTS.map((id) => {
      const c = parseCell(id)!;
      const centre = blockCentre(c.col, c.row, FOOTPRINT.server.w, FOOTPRINT.server.h);
      return {
        id,
        ...page(centre.x, centre.y),
        part: board.parts.find((p) => p.slot === id)?.id ?? null,
        locked: false,
        rect: footBox('server', id),
      };
    });
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
      inventory: {
        area: pageRect(ZONES.inventory, rect),
        counts: { ...this.counts },
        frames: Object.fromEntries(
          this.cards.filter((c) => c.main).map((c) => [c.id, this.inventory.frameOf(c.id)]),
        ),
      },
      art: {
        picked: [...this.picked],
        table: this.table.art,
        tableRect: pageRect(this.table.place, rect),
        tableScale: round(this.table.place.scale),
        channelPlate: this.channelPlate ? pageRect(this.channelPlate, rect) : null,
        midnightPlate: this.midnightPlate
          ? {
              rect: pageRect(this.midnightPlate.place, rect),
              scale: round(this.midnightPlate.place.scale),
              alpha: round(this.midnightShown),
            }
          : null,
        packet: { texture: this.packetTex, scale: round(this.packetScaleNow) },
        pingMarks: this.pingIcons.filter((i) => i.visible).length,
        stamps: board.parts
          .filter((p) => p.slot !== null && this.views.get(p.id)?.skip?.stamp?.visible === true)
          .map((p) => p.slot as string),
      },
      parts: board.parts.flatMap((part) => {
        const c = partCentre(part);
        if (!c) return [];
        const look = partLook(part, f.flow.load[part.id] ?? 0, offline, f.offlineUntil, f.now, this.trouble);
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
            texture: view?.img.texture.key ?? null,
            dark: look.dark,
            label: loadLabel(look),
            diesIn: look.diesIn === null ? null : round(look.diesIn),
            darkLeft: look.darkLeft === null ? null : round(look.darkLeft),
            unfed: look.unfed,
            warning: look.warning,
            bar: round(look.bar),
            barColour: look.barColour,
            flickerLit: view?.lit ?? true,
            scale: round(partScale(part)),
            tags: partTags(look, this.skippedNow(part)),
            packetsIn: this.packetsInto(part.id),
            replaceButton:
              this.replaceBtn.visible && this.selectedPart === part.id
                ? page(this.replaceBtn.x, this.replaceBtn.y)
                : null,
            motion: view?.player.motion ?? 'idle',
            pose: f.dead.includes(part.id)
              ? {
                  dy: MOTION.dieCollapse.rest.y ?? 0,
                  scale: MOTION.dieCollapse.rest.scale ?? 1,
                  alpha: MOTION.dieCollapse.rest.alpha ?? 1,
                }
              : { dy: 0, scale: 1, alpha: 1 },
            drawn: {
              dy: round(view?.dy ?? 0),
              scale: round(view?.dscale ?? 1),
              alpha: round(view?.dalpha ?? 1),
            },
          },
        ];
      }),
      grid: {
        cols: GRID.cols,
        rows: GRID.rows,
        cell: (() => {
          const c = cellSize(GRID.rows >> 1);
          return {
            w: round((c.w * rect.width) / GAME_WIDTH),
            h: round((c.h * rect.height) / GAME_HEIGHT),
          };
        })(),
        nodes: Array.from({ length: GRID.rows + 1 }, (_, j) =>
          Array.from({ length: GRID.cols + 1 }, (_, i) => {
            const n = nodeAt(i, j);
            const q = page(n.x, n.y);
            return { x: round(q.x), y: round(q.y) };
          }),
        ),
        occupied: [...occupancy(board.parts).keys()],
        reserved: FIXED_KINDS.flatMap((k) => (FIXED_ANCHOR[k] ? footprintCells(k, FIXED_ANCHOR[k]!) : [])),
        footprints: board.parts.flatMap((part) => {
          const anchor = anchorOf(part);
          if (anchor === null || parseCell(anchor) === null) return [];
          const sk = this.views.get(part.id)?.skip ?? null;
          const c = parseCell(anchor)!;
          const { w, h } = FOOTPRINT[part.kind];
          const centre = blockCentre(c.col, c.row, w, h);
          return [
            {
              part: part.id,
              kind: part.kind,
              anchor,
              cells: partCells(part),
              ...page(centre.x, centre.y),
              rect: footBox(part.kind, anchor),
              skipped: sk?.skipped ?? false,
              skipTagUntil: sk && Number.isFinite(sk.skipUntil) ? round(sk.skipUntil) : null,
              dashed: sk !== null && this.clock < sk.skipUntil,
            },
          ];
        }),
        racks: RACKS.map((r) => ({
          id: r.id,
          from: r.from,
          to: r.to,
          dip: this.dipRack === r.id ? this.dipShown : null,
        })),
        suggested: this.suggestAt,
        room: roomFor(BOARD_CELLS, board.parts, 'server'),
        preview: this.preview
          ? { ...this.preview, cells: [...this.preview.cells], bad: [...this.preview.bad] }
          : null,
      },
      clock: round(this.clock),
      reduceFlicker: this.reduceFlicker,
      wires: this.wireList.map((w) => ({
        key: w.key,
        from: w.from,
        to: w.to,
        ...page(w.mid.x, w.mid.y),
        rate: round(f.flow.wires[w.key] ?? 0),
        skipped: f.flow.skipped.includes(w.key),
        speed: this.stepOpts.speedOf(w.key),
        hovered: this.hover.wire === w.key,
        bornAt: round(this.wireBorn.get(w.key) ?? 0),
      })),
      offline,
      channel: {
        demand: round(this.chan.demand),
        max: this.chan.max,
        level: round(this.chan.level),
        capacityLevel: round(this.chan.capacityLevel),
        wired: round(f.wiredCapacity),
        forecast: this.chan.forecast === null ? null : round(this.chan.forecast),
        whatIf: this.drawnWhatIf ?? null,
        retryShare: round(this.chan.retryShare),
        marks: bankMarkPoints().map((m) => ({ label: m.label, value: m.value, ...page(m.x, m.y) })),
        lanePps: round(this.chan.lanePps),
        lanes: INBOUND_KEYS.map((_, i) => round(lanePps(this.chan.demand, i, INBOUND_KEYS.length))),
        chevrons: 0,
        roomY: page(CHANNEL.mouth.x, levelY(this.chan.capacityLevel, CHANNEL.mouth.x)).y,
        levelY: page(CHANNEL.mouth.x, levelY(this.chan.level, CHANNEL.mouth.x)).y,
      },
      skipped: [...f.flow.skipped],
      packets: {
        pool: this.pool.size,
        active: this.pool.active,
        tumbled: this.tumbles.active,
        red: this.pool.red,
        returning: this.pool.returning,
        born: this.pool.born,
        reentered: this.pool.reentered,
        need: this.pool.need,
        retryFrom: Object.keys(this.births).filter((id) => this.births[id] > 0),
        sparking: f.parts
          .filter((p) => (this.drops[p.id] ?? 0) > 0 && this.hotParts.has(p.id))
          .map((p) => p.id),
      },
      waiting: {
        first: this.wait.first,
        crew: this.wait.crew,
        behind: round(this.wait.behind),
        need: this.wait.need,
        port: this.wait.port ? page(this.wait.port.x, this.wait.port.y) : null,
        portLit: this.wait.portLit,
        blinking: this.wait.blinking,
        tumbled: this.tumbles.active,
        pulsing: this.suggestOn && this.suggestAt !== null ? [this.suggestAt] : [],
        chip: this.crewText.visible ? this.crewText.text : null,
      },
      rewinds: f.rewinds.map((w) => ({ at: round(w.at), to: w.to })),
      selectedPart: this.selectedPart,
      selectedWire: this.selectedWire,
      cutButton: this.cutBtn.visible ? page(this.cutBtn.x, this.cutBtn.y) : null,
      binButton: this.binBtn.visible ? page(this.binBtn.x, this.binBtn.y) : null,
      refusal: this.refusalText.visible ? this.refusalText.text : null,
      dragging: this.drag ? (this.drag.kind === 'card' ? this.drag.id : 'wire') : null,
      replaceButton: this.replaceBtn.visible ? page(this.replaceBtn.x, this.replaceBtn.y) : null,
      dragOver:
        this.drag?.kind === 'card'
          ? {
              kind: 'card' as const,
              card: this.drag.id,
              over: this.over.id,
              overKind: this.over.kind,
              state: this.overState(),
              legal: this.over.id === null ? null : dropLegalOf(this.drag.id, this.overState()),
              reason: null,
            }
          : this.drag?.kind === 'wire' && this.drag.moved
            ? {
                kind: 'wire' as const,
                card: null,
                over: this.wireTo.id,
                overKind: this.wireTo.id === null ? null : ('part' as const),
                state: null,
                legal: this.wireTo.id === null ? null : this.wireTo.ok,
                reason: this.wireTo.reason,
              }
            : null,
      ghost: this.ghostInfo
        ? {
            card: this.ghostInfo.card,
            over: this.ghostInfo.over,
            legal: this.ghostInfo.legal,
            state: this.ghostInfo.state,
            plate: this.ghostInfo.plate,
            wired: round(this.ghostInfo.wired),
            capacity: round(this.ghostInfo.capacity),
            adds: round(this.ghostInfo.adds),
            whatIf: this.ghostInfo.whatIf === null ? null : round(this.ghostInfo.whatIf),
            tick: this.ghostInfo.tick,
            plateShown: this.ghostText.visible,
            snapped: this.ghostShownFor !== null,
            ...page(this.ghost.x, this.ghost.y),
          }
        : null,
      hover: {
        part: this.hover.part,
        wire: this.hover.wire,
        text: this.plate.visible ? this.plate.text : null,
        target: this.plate.visible ? this.plateFor : null,
        pinned: this.plate.visible && this.platePinned,
      },
      keys: [...BOARD_KEYS],
      lastKey: this.lastKey,
      wireTarget: this.targetRing,
      sfx: {
        log: this.sounds.log.map((e) => ({ key: e.key, at: round(e.at) })),
        counts: { ...this.sounds.counts },
        skipEdges: this.skipEdges,
      },
      anims: this.animBook.names(),
      animLog: this.animBook.log.map((e) => ({
        name: e.name,
        kind: e.kind,
        start: round(e.start),
        end: e.end === null ? null : round(e.end),
        ms: Number.isFinite(e.ms) ? e.ms : null,
        calm: e.calm,
      })),
      animClock: round(this.animClock),
      floats: this.floatText.visible ? [this.floatText.text] : [],
      particles: {
        pool: this.particleSprites.length,
        active: this.particles.active,
        peak: this.particles.peak,
        dropped: this.particles.dropped,
      },
      frame: this.snap.count,
      snapshotFrame: this.snap.readAt,
      snapshotChanges: this.snap.changes,
      snapshotCurrent: this.snap.current !== null && this.snap.current === frame(run()),
      glow: { ...this.glowProbe.state, parts: [...this.glowProbe.state.parts] },
    };
  }
}

/** Whether a drop in this state does something (layout.dropLegal), or null with no state. */
function dropLegalOf(card: string, state: PadState | null): boolean | null {
  if (state === null) return null;
  return state === 'legal' || (card === 'server' && state === 'dead');
}

/** The crew cable's draw scale (its art at the size the manifest shows it). */
const CABLE_SCALE = 0.55;
/** The overclock kit's height in flight, px. */
const KIT_SIZE = 90;
const FIREWORK_TINTS: readonly number[] = [0xffb02e, 0x2de2e6, 0xff5ec8];

/** A colour `k` (0..1) of the way from `a` to `b`, channel by channel. */
function lerpColour(a: number, b: number, k: number): number {
  const t = k <= 0 ? 0 : k >= 1 ? 1 : k;
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Stop a part view's motion (a rewind). */
function stopPlayer(v: PartView): void {
  v.player.stop();
}

/** The first part of a kind, or null. */
function partOfKind(parts: readonly Part[], kind: Part['kind']): Part | null {
  for (let i = 0; i < parts.length; i++) if (parts[i].kind === kind) return parts[i];
  return null;
}

/** The part with this id, found with a plain loop (no closure) since the board asks every frame. */
function partById(parts: readonly Part[], id: string): Part | null {
  for (let i = 0; i < parts.length; i++) if (parts[i].id === id) return parts[i];
  return null;
}

/** The part whose footprint is anchored at `anchor` (a fixed part by its bay), or null. */
function partWithAnchor(parts: readonly Part[], anchor: string): Part | null {
  for (let i = 0; i < parts.length; i++) if (anchorOf(parts[i]) === anchor) return parts[i];
  return null;
}

/** Destroy a server's SKIPPED marks with its view. */
function destroySkip(sk: SkipMark | null): void {
  if (!sk) return;
  sk.dash.destroy();
  sk.chip.destroy();
  sk.stamp?.destroy();
}

/** Forget a part view's SKIPPED tag (a rewind). */
function clearSkip(v: PartView): void {
  if (v.skip) v.skip.skipUntil = -Infinity;
}

/** The fixed parts, whose bays the grid outlines. */
const FIXED_KINDS = ['gateway', 'database'] as const;

/** The centres of the good server spots, where the calm embers rise at midnight. */
const SPOT_CENTRES: readonly Point[] = SERVER_SPOTS.map((id) => {
  const c = parseCell(id)!;
  return blockCentre(c.col, c.row, FOOTPRINT.server.w, FOOTPRINT.server.h);
});

/** A dashed straight line from `a` to `b`: `dash` px drawn, `gap` px skipped. */
function dashedLine(g: Phaser.GameObjects.Graphics, a: Point, b: Point, dash: number, gap: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= 0) return;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.lineBetween(a.x + ux * d, a.y + uy * d, a.x + ux * e, a.y + uy * e);
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
