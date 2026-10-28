// The HUD's section of the read-only test hook (window.__neonTest.state.hud). Positions are page
// CSS pixels, ready for page.mouse.click.

import type { LineId } from '../../strings';
import type { DialMode } from './dial';

export interface PagePoint {
  x: number;
  y: number;
}

export interface HudTestState {
  /** True once the HUD has built its panels. */
  ready: boolean;
  /** Sim seconds since the clock opened, and whether the board is held still. */
  now: number;
  paused: boolean;
  /** The in-world clock and the "midnight in m:ss" countdown as shown. */
  clock: string;
  countdown: string;
  jobCard: { open: boolean; x: number; y: number };
  dial: {
    visible: boolean;
    mode: DialMode;
    value: number;
    locked: boolean;
    minus: PagePoint;
    plus: PagePoint;
    set: PagePoint;
  };
  notes: { estimate: number | null; sizing: number | null };
  /** The last values plotted on the chart, and the sim's right now. */
  chart: { demand: number; capacity: number; ceiling: number; estimateLine: number | null };
  /** `block` is what the block sends before retries (the laundry cut sheds from it). */
  sim: { demand: number; block: number; capacity: number; trust: number; credits: number };
  /** Trust and credits as shown on screen. */
  shown: { trust: number; credits: number };
  /** The surge warning on screen; `shownAt` is the sim time it first appeared. */
  surge: {
    demand: number;
    startsAt: number;
    inSeconds: number;
    line: LineId;
    shownAt: number | null;
  } | null;
  dip: { partId: string; lit: boolean; flashing: boolean } | null;
  /**
   * Where the power-dip mark sits while a dip warning shows, in page CSS pixels to a tenth: on the
   * part (dipMarkAt in src/scenes/hud/warnings.ts, the point board.parts[] reports for it), or the
   * centre of CARDS.dipFallback when the board can't place it. Null while no dip warning shows.
   */
  dipMark: PagePoint | null;
  banner: { open: boolean; choice: string | null; pay: PagePoint; ignore: PagePoint; bin: PagePoint };
  laundry: { available: boolean; cut: boolean; button: PagePoint };
  regroup: { visible: boolean; active: boolean; spent: boolean; button: PagePoint };
  /** The C6 sizing prompt: whether it shows, and its centre (CARDS.sizingPrompt) in page CSS pixels. */
  sizingPrompt: { open: boolean; x: number; y: number };
  bark: { current: LineId | null; text: string | null; history: LineId[] };
  chat: { block: string[]; stream: string[] };
  timeScale: number;
  /**
   * Where each restaged HUD piece is drawn now (its display bounds in page CSS pixels), the zone or
   * card it belongs in (src/scenes/hud/layout.ts Home), and whether it shows. Empty until built.
   */
  bounds: HudBounds[];
}

export interface HudBounds {
  id: string;
  home: string;
  visible: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

declare module '../../testHook' {
  interface TestSections {
    hud: HudTestState;
  }
}
