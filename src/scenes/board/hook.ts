// The board's section of the test hook (`window.__neonTest.state.board`). Positions are page CSS
// pixels, so browser tests can drive the mouse without hard-coded coordinates.

import type { PartKind } from '../../sim/board';
import type { Rect } from '../live/layout';
import type { Point } from './layout';
import type { InventoryCounts } from './tray';
import type { PartStatus } from './view';

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
  /** The inventory zone (TRAY_AREA) in page CSS pixels, and the three cards' counts. */
  inventory: { area: Rect; counts: InventoryCounts };
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
    art: string;
    dark: boolean;
    label: string;
  })[];
  wires: (Point & { key: string; from: string; to: string; rate: number; skipped: boolean })[];
  offline: string[];
  /** Wire keys the load balancer skipped, each drawn with a grey "skipped" tag. */
  skipped: string[];
  /** Packet sprites in the pool, and how many are on a wire right now. */
  packets: { pool: number; active: number };
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
}

declare module '../../testHook' {
  interface TestSections {
    board: BoardTestState;
  }
}
