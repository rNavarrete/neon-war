// The board's section of the test hook (`window.__neonTest.state.board`). Positions are page CSS
// pixels, so browser tests can drive the mouse without hard-coded coordinates.

import type { PartKind } from '../../sim/board';
import type { Point } from './layout';
import type { PartStatus } from './view';

export interface BoardTestState {
  /** Seconds since the clock opened, and the test speed multiplier. */
  now: number;
  speed: number;
  paused: boolean;
  credits: number;
  demand: number;
  slots: (Point & { id: string; part: string | null; locked: boolean })[];
  tray: (Point & { id: string; label: string; locked: boolean })[];
  parts: (Point & {
    id: string;
    kind: PartKind;
    slot: string | null;
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
}

declare module '../../testHook' {
  interface TestSections {
    board: BoardTestState;
  }
}
