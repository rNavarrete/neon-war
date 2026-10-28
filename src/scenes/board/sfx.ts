// The board's own sound hooks (board-10): a chime when a boot or reboot completes ('server-online'),
// a dry crackle while a hot or dark part drops requests ('packet-drop', at most one per 0.5 s) and a
// soft blip when the balancer newly skips a box ('health-skip', once per new skip). The keys are the
// audio lane's (LIVE_SFX_KEYS in src/game/mixer.ts); the board asks for one only when isSfxKey says
// the key exists, and the mixer stays silent until its file has landed.
//
// Everything else the board sounds like is unchanged and not here: place-part, wire-connect,
// wire-cut, credits (bus 'action') and server-hot, server-die, power-dip, rescue-cable (the sim's
// events) are mapped by the AudioDirector in src/game/audio.ts.
//
// Pure: no Phaser, no clock. Time comes in as a parameter (board seconds, real time).

import { isSfxKey } from '../../game/audio';

export const BOARD_SFX = {
  online: 'server-online',
  drop: 'packet-drop',
  skip: 'health-skip',
} as const;

export type BoardSfxKey = (typeof BOARD_SFX)[keyof typeof BOARD_SFX];

/** The packet-drop crackle plays at most once per this many seconds. */
export const DROP_GAP_SECONDS = 0.5;

/** How many sounds the log keeps (oldest dropped first). */
export const SFX_LOG = 48;

/** Decides which board sounds to ask for, and when; remembers what it asked for (the test hook). */
export class BoardSfx {
  /** What the board asked for, oldest first: the key and the board second. */
  readonly log: { key: BoardSfxKey; at: number }[] = [];
  /** How many times each key was asked for, since the scene started (the log keeps only the last ones). */
  readonly counts: Partial<Record<BoardSfxKey, number>> = {};
  private lastDrop = -Infinity;

  /** `has` says whether a key exists (isSfxKey); a key it refuses is never asked for. */
  constructor(private readonly has: (key: string) => boolean = isSfxKey) {}

  /** A boot or reboot completed at `at`: the chime, if its key exists. */
  online(at: number): BoardSfxKey | null {
    return this.ask(BOARD_SFX.online, at);
  }

  /** Something drops requests at a hot or dark part this frame: the crackle, at most once per 0.5 s. */
  drop(dropping: boolean, at: number): BoardSfxKey | null {
    if (!dropping || at - this.lastDrop < DROP_GAP_SECONDS) return null;
    const key = this.ask(BOARD_SFX.drop, at);
    if (key !== null) this.lastDrop = at;
    return key;
  }

  /** The balancer newly skipped a box (an occurrence 'skipped'): the blip, once for that skip. */
  skip(at: number): BoardSfxKey | null {
    return this.ask(BOARD_SFX.skip, at);
  }

  /** Forget the rate limit (a scene restart). The log stays. */
  reset(): void {
    this.lastDrop = -Infinity;
  }

  private ask(key: BoardSfxKey, at: number): BoardSfxKey | null {
    if (!this.has(key)) return null;
    this.counts[key] = (this.counts[key] ?? 0) + 1;
    this.log.push({ key, at });
    if (this.log.length > SFX_LOG) this.log.shift();
    return key;
  }
}
