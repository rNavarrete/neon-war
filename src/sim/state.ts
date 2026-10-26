// Game rules live in src/sim/ as pure TypeScript with no Phaser imports, so they can be
// unit-tested in node. Rendering reads this state and never changes the rules.

export type Phase = 'briefing' | 'observe' | 'diagnose' | 'act' | 'verify';

export interface SimState {
  /** Seconds since the session started. */
  readonly time: number;
  readonly phase: Phase;
}

export function initialState(): SimState {
  return { time: 0, phase: 'briefing' };
}
