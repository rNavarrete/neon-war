// The board's section of the test hook (`window.__neonTest.state.board`). Positions are page CSS
// pixels, so browser tests can drive the mouse without hard-coded coordinates.

import type { PartKind } from '../../sim/board';
import type { Rect } from '../live/layout';
import type { GlowState } from '../motion';
import type { PadState, Point } from './layout';
import type { InventoryCounts } from './tray';
import type { BarColour, PartStatus, PartTag } from './view';

export interface BoardTestState {
  /** The feed zone the board draws in (BOARD_AREA), in page CSS pixels. */
  area: Rect;
  /** What sits behind the board: the skyline band above the table (null when hidden) and the goggles overlay (gone). */
  backdrop: { skyline: Rect | null; goggles: boolean };
  /** Seconds since the clock opened, and the test speed multiplier. */
  now: number;
  speed: number;
  paused: boolean;
  credits: number;
  demand: number;
  /** Each slot's pad centre, and `rect` its drop box, in page CSS pixels. */
  slots: (Point & { id: string; part: string | null; locked: boolean; rect: Rect })[];
  /**
   * Every card in the inventory row, at its centre: `count` is how many the player could use now
   * (0 for a drawer mini) and `price` its cost in credits (0 for the crew's gift, null for a mini).
   */
  tray: (Point & { id: string; label: string; locked: boolean; count: number; price: number | null })[];
  /**
   * The inventory zone (TRAY_AREA) in page CSS pixels, the three cards' counts, and (board-12) the
   * frame each main card wears: a picked frame's art key (hud/live/card-frame-idle, -ready,
   * -locked) or 'part-card' while the frames are not picked.
   */
  inventory: { area: Rect; counts: InventoryCounts; frames: Record<string, string> };
  /**
   * board-12: the picked art the board draws. `picked` lists the board's art keys whose picked file
   * is loaded (the rest keep today's code drawing); `table` is 'plate' (the painted table plate)
   * or 'bake' (the code slab), drawn at `tableRect` (page CSS pixels) and `tableScale` (never above
   * 1); `channelPlate` the channel plate's rect or null; `pingMarks` how many ping marks show now;
   * `stamps` the server pads wearing the SKIPPED stamp now.
   */
  art: {
    picked: string[];
    table: 'plate' | 'bake';
    tableRect: Rect;
    tableScale: number;
    channelPlate: Rect | null;
    /**
     * Batch 5: the midnight plate (board/table-plate-midnight), drawn at its own size centred like
     * the day plate, and how far it has cross-faded in (0 before midnight, 1 once in); null while
     * it is not loaded.
     */
    midnightPlate: { rect: Rect; scale: number; alpha: number } | null;
    /** The packets' texture ('art:board/packet-cube' once picked, else the code 'packet') and draw scale. */
    packet: { texture: string; scale: number };
    pingMarks: number;
    stamps: string[];
  };
  parts: (Point & {
    id: string;
    kind: PartKind;
    slot: string | null;
    /** The part's box as drawn (its hit box), in page CSS pixels. */
    rect: Rect;
    status: PartStatus;
    /** Seconds left of a boot or reboot. */
    left: number;
    boosted: boolean;
    /** Req/s arriving, the part's capacity (null = unlimited) and load ÷ capacity. */
    load: number;
    capacity: number | null;
    share: number | null;
    /** The art partLook picks with no board-12 options (today's key, e.g. 'server', 'server-dead'). */
    art: string;
    /**
     * board-12: the texture on the part's sprite now: a picked state art's texture
     * ('art:board/server-dark', 'art:board/server-overclocked-dark', the boot and ping frames) or
     * today's key. Null before the part's sprite is made.
     */
    texture: string | null;
    dark: boolean;
    label: string;
    /** Seconds until an overloaded server cooks; 0 once dead; null when it is not overloaded (board-5). */
    diesIn: number | null;
    /** Seconds until a part dark in a power dip comes back on, or null. */
    darkLeft: number | null;
    /** An online server nothing reaches (no load). */
    unfed: boolean;
    /** The warning triangle is up: a server over 100% or dark; the database only over 200 (D2). */
    warning: boolean;
    /** The load bar's fill, 0..1, and its colour. */
    bar: number;
    barColour: BarColour;
    /** Lit this frame: false only on the dark half of a power flicker's blink; always true under reduce flicker. */
    flickerLit: boolean;
    /** The row's draw scale (1 off the rack). */
    scale: number;
    /** The tags the part wears (the lead's enum), first is the one shown. */
    tags: PartTag[];
    /** Packets on their way into the part right now. */
    packetsIn: number;
    /** The REPLACE button under this part while it is a selected dead box (board-8), else null. */
    replaceButton: Point | null;
    /** board-9: the motion.ts spec playing on the sprite ('placeDrop', 'dieCollapse', 'dipBlackout', 'crewTint') or 'idle'. */
    motion: string;
    /**
     * The pose the sprite rests in for its state (the hook rule: the target, never an in-between
     * value): y offset px from its place, scale and alpha factors. A dead box rests sunk and dim.
     */
    pose: { dy: number; scale: number; alpha: number };
    /** The pose the sprite was drawn in this frame: equal to `pose` once its animation has ended. */
    drawn: { dy: number; scale: number; alpha: number };
  })[];
  /**
   * Every pad (board-5): the balancer's and the six server pads, with their drawn box (page CSS
   * pixels), rack row and scale, the part on it, whether the balancer skips that part now
   * (`skipped`, the sim's flow.skipped), the board-clock second the SKIPPED tag shows until
   * (`skipTagUntil`, sticky 1 s after the skip clears; null before any skip) and whether the pad is
   * drawn grey and dashed with the tag on it now (`dashed`).
   */
  pads: (Point & {
    slot: string;
    w: number;
    h: number;
    row: number | null;
    scale: number;
    part: string | null;
    locked: boolean;
    state: 'empty' | 'taken' | 'dead' | 'locked';
    skipped: boolean;
    skipTagUntil: number | null;
    dashed: boolean;
    pulsing: boolean;
    /** While a card is dragged (board-8): what a drop on this pad would do (layout.padState), else null. */
    legality: PadState | null;
  })[];
  /** The board clock in seconds (the scene's own time): what skipTagUntil and the blinks count on. */
  clock: number;
  /** settings().reduceFlicker as the board read it this frame: nothing blinks while it is true. */
  reduceFlicker: boolean;
  /** Every wire at its midpoint; `speed` is how fast its packets move (0.5 into a part over 100%, board-7). */
  wires: (Point & {
    key: string;
    from: string;
    to: string;
    rate: number;
    skipped: boolean;
    speed: number;
    /** board-11: the pointer is over this wire now (its plate shows). */
    hovered: boolean;
    /** board-11: the board clock (seconds) the wire was first drawn on; a rewind that lays it again counts anew. */
    bornAt: number;
  })[];
  offline: string[];
  /** Wire keys the load balancer skipped, each drawn with a grey "skipped" tag. */
  skipped: string[];
  /**
   * Packet sprites in the pool, how many are on a wire right now, and the cubes tumbling off a
   * waiting port. Board-7: `red` the retry cubes on the board now (going back or re-entering),
   * `returning` those on their way back to the mouth, `born` the retries born at a dropping part so
   * far and `reentered` how many reached the mouth and came in again (a red cube is only ever born
   * at a part: nothing red is spawned at the mouth), `need` the most slots the flow has needed (the
   * pool never passes it), `retryFrom` the parts retries are born at now (the parts dropping) and
   * `sparking` the hot or dark parts throwing sparks (the sparks themselves are decorative, off in
   * ?test lite mode and under reduce flicker; this list is not).
   */
  packets: {
    pool: number;
    active: number;
    tumbled: number;
    red: number;
    returning: number;
    born: number;
    reentered: number;
    need: number;
    retryFrom: string[];
    sparking: string[];
  };
  /**
   * The board's waits (board-6): `first` while C1 holds the clock for the first build, `crew` while
   * the clock waits after the rescue for the boxes behind the balancer to cover `need` (120; they
   * cover `behind` now). The board shows why: the out-port that needs a wire (`port`, page CSS
   * pixels) blinks (`blinking`; `portLit` this frame, always lit under reduce flicker), cubes tumble
   * off it (`tumbled` now), the empty pads pulse (`pulsing`, by slot) and in the crew wait a chip by
   * the balancer reads behind/need (`chip`).
   */
  waiting: {
    first: boolean;
    crew: boolean;
    behind: number;
    need: number;
    port: Point | null;
    portLit: boolean;
    blinking: boolean;
    tumbled: number;
    pulsing: string[];
    chip: string | null;
  };
  /** Each rewind so far: the sim second it happened and the challenge start it went back to. */
  rewinds: { at: number; to: number }[];
  selectedPart: string | null;
  selectedWire: string | null;
  cutButton: Point | null;
  binButton: Point | null;
  /** The refusal reason on screen, or null. */
  refusal: string | null;
  /** What the pointer is dragging: a tray card id, 'wire', or null. */
  dragging: string | null;
  /** The REPLACE button under the selected dead box (board-8), in page CSS pixels, or null. */
  replaceButton: Point | null;
  /**
   * What the drag in hand is over (board-8), always reported, gate or not: for a card the slot id
   * ('s1'..'s6', 'lb') or the part id under it, the pad's legality (`state`) and whether a drop
   * would do something (`legal`); for a wire the part it would land on and connect()'s answer
   * (`legal`, `reason`). Null with nothing in hand.
   */
  dragOver: {
    kind: 'card' | 'wire';
    card: string | null;
    over: string | null;
    overKind: 'pad' | 'part' | null;
    state: PadState | null;
    legal: boolean | null;
    reason: string | null;
  } | null;
  /**
   * The what-if ghost (board-8, contract 'board.ghost'): while a card is over a target, the card,
   * what it is over, whether the drop is legal, its plate ('+60 room · boots 3 s · -80 cr', or '+0 room ·
   * nothing feeds it' when no free feed could wire the box), the wired req/s now and after the drop
   * (ghostCapacity over wiredCapacity) and what it adds, the what-if level and the tick's label
   * ('ROOM +60', only when it adds room), whether the plate is on screen and the card snapped onto
   * the target. Null when nothing is dragged over a target.
   */
  ghost: {
    card: string;
    /** board-11: where the dragged card is drawn, in page CSS pixels (snapped onto the target when legal). */
    x: number;
    y: number;
    over: string;
    legal: boolean;
    state: PadState;
    plate: string | null;
    wired: number;
    capacity: number;
    adds: number;
    whatIf: number | null;
    tick: string | null;
    plateShown: boolean;
    snapped: boolean;
  } | null;
  /**
   * The hover plate (board-8): the part or wire under the pointer, the plate's text on screen (the
   * hovered target, else the selected one), which part id or wire key it is for, and whether it is
   * pinned (it shows the selection).
   */
  hover: {
    part: string | null;
    wire: string | null;
    text: string | null;
    target: string | null;
    pinned: boolean;
  };
  /** The keys the board listens to: Escape, Delete, Backspace (never 1, 2 or 3). */
  keys: string[];
  /** board-11: the last key the board consumed ('Escape', 'Delete' or 'Backspace'), or null. */
  lastKey: string | null;
  /** The part a dragged wire's target ring is drawn on, or null. */
  wireTarget: string | null;
  /**
   * The channel at the feed's left edge (board-4), on the shared 0..400 scale: `level` is
   * min(1, demand / max), `capacityLevel` the wired boxes' req/s / max (the ROOM tick; never the
   * racked total), `forecast` the coming surge's level while its warning is up (else null),
   * `retryShare` the red band's share of the fill, `marks` the five bank labels at the mouth in page
   * CSS pixels (bottom to top), `lanePps` the cubes a second streaming in (all lanes) and `lanes`
   * each lane's share. `whatIf` is the drag ghost's level (board.ghost.whatIf while it shows; else null). `chevrons` is
   * how many chevrons are drawn: none.
   */
  channel: {
    demand: number;
    max: number;
    level: number;
    capacityLevel: number;
    /** The wired boxes' req/s the ROOM tick stands for (Frame.wiredCapacity). */
    wired: number;
    forecast: number | null;
    whatIf: number | null;
    retryShare: number;
    marks: (Point & { label: string; value: number })[];
    lanePps: number;
    lanes: number[];
    chevrons: number;
    /** Page y of the ROOM tick and of the fill's level at the mouth. */
    roomY: number;
    levelY: number;
  };
  /**
   * board-10: the sounds the board asked for itself, oldest first (the last 48): 'server-online'
   * when a boot or reboot completes, 'packet-drop' while a hot or dark part drops (at most one per
   * 0.5 s), 'health-skip' per new skip; `at` is the board clock in seconds. Only keys that exist
   * (isSfxKey). `counts` totals every one asked for since the scene started, by key.
   */
  sfx: {
    log: { key: string; at: number }[];
    counts: Record<string, number>;
    /** Wires the balancer newly skipped since the scene started, counted every frame. */
    skipEdges: number;
  };
  /**
   * board-9: the animations in flight now, by name ('death:<id>', 'flash', 'place:<id>', 'boot:<id>',
   * 'overclock:<id>', 'dip:<id>', 'haze:<id>', 'wire:<key>', 'cut:<key>', 'sparks',
   * 'decommission:<id>', 'float:<id>', 'cable', 'fireworks', 'lightsdown', 'ping'). Never 'flash' or
   * 'sparks' under reduce flicker.
   */
  anims: string[];
  /**
   * The last 128 animations started, oldest first, on the animation clock (board seconds: frozen
   * while paused, slowed by Regroup): `end` null while it plays; `ms` its stated duration in the
   * variant that played (Infinity for a loop, reported as null); `calm` the reduce-flicker variant.
   */
  animLog: {
    name: string;
    kind: string;
    start: number;
    end: number | null;
    ms: number | null;
    calm: boolean;
  }[];
  /** The animation clock now, seconds. */
  animClock: number;
  /** Refund floats on screen now, e.g. '+40'. */
  floats: string[];
  /** The particle pool (smoke, sparks, fireworks, embers): its fixed size, live now, the most live at once. */
  particles: { pool: number; active: number; peak: number; dropped: number };
  /** Board frames synced so far. */
  frame: number;
  /**
   * The board frame on which the board last read the run's Frame (src/game/frame.ts). It reads it
   * once at the top of every sync, so this equals `frame`; every field above comes from that read.
   */
  snapshotFrame: number;
  /** How many times the Frame the board read was a new object (the sim changed under it). */
  snapshotChanges: number;
  /** The Frame the board drew last is frame()'s current one: the board and the HUD share one read. */
  snapshotCurrent: boolean;
  /**
   * art3d-6's glow probe: the live Glow filters (at most 3, red, only on parts over capacity), the
   * live GradientMap filters (at most 1, for 1.5 s at the rescue) and the parts glowing, hottest first.
   */
  glow: GlowState;
}

declare module '../../testHook' {
  interface TestSections {
    board: BoardTestState;
  }
}
