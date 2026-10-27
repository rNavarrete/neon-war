// One typed event bus between the game's parts, so the board, HUD, sound and story never import
// each other. The board emits what the player did; sound and barks listen.

import type { BannerChoice } from '../sim/economy';

export interface GameEvents {
  /** Something the player did on the board that worked. */
  action:
    | { type: 'place'; id: string }
    | { type: 'wire'; from: string; to: string }
    | { type: 'cut'; from: string; to: string }
    | { type: 'decommission'; id: string; refund: number }
    | { type: 'overclock'; id: string }
    | { type: 'banner'; choice: BannerChoice };
  /** The player tried something the rules refused, with the reason to show. */
  refused: { reason: string };
  /** Play one sound effect by its key (the file name in public/audio/sfx without .mp3). */
  sfx: { key: string; loop?: boolean };
  /** Stop a looping sound effect started with `sfx` and `loop` (e.g. rain-loop when a room scene ends). */
  sfxStop: { key: string };
}

type Handler<T> = (payload: T) => void;

export class Bus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    for (const fn of this.handlers.get(event) ?? []) (fn as Handler<GameEvents[K]>)(payload);
  }
}

export const bus = new Bus();
