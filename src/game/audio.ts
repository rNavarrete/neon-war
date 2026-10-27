// Which sound plays for what, from docs/AUDIO.md. The bus says what happened; this file turns it
// into a sound key and hands the key to whatever can play it (the overlay scene's SoundManager).
// The mapping is pure so it is unit-tested in node; the director only remembers and forwards.

import { type Bus, type GameEvents, bus } from './bus';

/** The board music loop: one key, both files, and Phaser picks the one the browser can play. */
export const MUSIC_KEY = 'music';
export const MUSIC_FILES: readonly string[] = [
  'audio/music/cell-shaped-chaos.ogg',
  'audio/music/cell-shaped-chaos.mp3',
];

/** Every effect in public/audio/sfx, by its file name without .mp3. */
export const SFX_KEYS = [
  'banner-pop',
  'credits',
  'fireworks',
  'goggles-on',
  'midnight-cheer',
  'place-part',
  'power-dip',
  'rain-loop',
  'regroup-slow',
  'rescue-cable',
  'rewind',
  'server-die',
  'server-hot',
  'surge-warning',
  'triage-blip',
  'triage-panic',
  'tv-countdown',
  'ui-click',
  'ui-hover',
  'wire-connect',
  'wire-cut',
] as const;

export type SfxKey = (typeof SFX_KEYS)[number];

export function sfxPath(key: string): string {
  return `audio/sfx/${key}.mp3`;
}

export function isSfxKey(key: string): key is SfxKey {
  return (SFX_KEYS as readonly string[]).includes(key);
}

/** The effect for something the player did on the board, or null when it makes no sound. */
export function sfxForAction(action: GameEvents['action']): SfxKey | null {
  switch (action.type) {
    case 'place':
      return 'place-part';
    case 'wire':
      return 'wire-connect';
    case 'cut':
      return 'wire-cut';
    case 'decommission':
    case 'overclock':
      return 'credits';
    case 'banner':
      return action.choice === 'pay' ? 'credits' : 'ui-click';
  }
}

/** Failure events and the effect each one plays. */
export const EVENT_SFX = {
  overheat: 'server-hot',
  serverDied: 'server-die',
  powerDip: 'power-dip',
  rescue: 'rescue-cable',
} as const satisfies Partial<Record<keyof GameEvents, SfxKey>>;

/** The board music plays while the board is on screen (running or under the pause menu), not in scenes. */
export function musicWanted(view: { boardOpen: boolean; sceneOpen: boolean }): boolean {
  return view.boardOpen && !view.sceneOpen;
}

/** What actually makes noise. Must never throw, even when the browser has audio locked. */
export interface SfxPlayer {
  play(key: string): void;
}

/** Listens to the bus, remembers the last effect asked for and passes it to the player if one is attached. */
export class AudioDirector {
  /** The last effect key asked for, whether or not it was audible (tests read it). */
  lastSfx: string | null = null;
  private player: SfxPlayer | null = null;

  constructor(events: Bus) {
    events.on('action', (a) => {
      const key = sfxForAction(a);
      if (key) this.play(key);
    });
    events.on('sfx', ({ key }) => this.play(key));
    for (const [event, key] of Object.entries(EVENT_SFX) as [keyof typeof EVENT_SFX, SfxKey][]) {
      events.on(event, () => this.play(key));
    }
  }

  attach(player: SfxPlayer | null): void {
    this.player = player;
  }

  play(key: string): void {
    this.lastSfx = key;
    try {
      this.player?.play(key);
    } catch {
      // Locked or missing audio never stops the game.
    }
  }
}

/** The game's one audio director, listening to the shared bus from the first import. */
export const audio = new AudioDirector(bus);
