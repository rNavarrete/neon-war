// The HUD's section of the read-only test hook (window.__neonTest.state.hud). Positions are page
// CSS pixels, ready for page.mouse.click.
//
// The section is one public snapshot: HudScene provides `hud` once, as its own snapshot with every
// sub-section a view file adds through provideHudSection laid over it (hudSection). A view adds
// `hud.<name>` without editing HudScene.ts or src/testHook.ts: it declares the key on HudTestState
// by module augmentation and calls provideHudSection from its create. Test mirror only: no view
// reads it back. Pure: no Phaser.

import type { LineId } from '../../strings';

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
  /** The last values plotted on the chart, and the sim's right now. */
  chart: { demand: number; capacity: number; ceiling: number };
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
  bark: { current: LineId | null; text: string | null; history: LineId[] };
  /**
   * The trigger table as the host loop ran it: every id fired this run, in order, each also sent on
   * the bus as `cue`; and whether the chat is silent (dark at midnight, until the rewind).
   */
  cues: { fired: LineId[]; silenced: boolean };
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

// ---- sub-sections provided by view files ----

/** The sub-sections view files have provided, by key; read each time the hook is read. */
const sections = new Map<string, () => unknown>();

/**
 * Add (or replace) `hud.<name>` in the test hook, read from `read` each time the hook is read. The
 * returned function takes it out again, unless another provider has replaced it since (call it from
 * the view's shutdown). A section with the name of one of HudScene's own keys replaces that key.
 */
export function provideHudSection<K extends keyof HudTestState>(
  name: K,
  read: () => HudTestState[K],
): () => void {
  sections.set(name, read);
  return () => {
    if (sections.get(name) === read) sections.delete(name);
  };
}

/**
 * The `hud` section as the hook publishes it: `base` (HudScene's own snapshot, built fresh for this
 * read) with every provided sub-section laid over it. Writes into `base` and returns it.
 */
export function hudSection(base: HudTestState): HudTestState {
  const out = base as unknown as Record<string, unknown>;
  for (const [name, read] of sections) out[name] = read();
  return base;
}

/** The names provided right now, in the order they were first provided (tests). */
export function hudSectionNames(): string[] {
  return [...sections.keys()];
}
