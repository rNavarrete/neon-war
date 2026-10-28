// One typed event bus between the game's parts, so the board, HUD, sound and story never import
// each other. The board emits what the player did; sound and barks listen.

import type { BannerChoice } from '../sim/economy';
import type { RescueCause } from '../sim/failures';
import type { Failure, Midnight } from '../sim/play';
import type { LineId } from '../strings';
import type { Occurrence } from './occurrences';

/** The tag a comms band line carries (src/scenes/hud/lineMeta.ts says which line gets which). */
export type LineTag = 'HINT' | 'WARNING' | 'CREW' | 'LUX' | 'HOUSE';

/** The two chats on the Live screen. */
export type ChatName = 'block' | 'stream';

export interface GameEvents {
  /** Something the player did on the board that worked. */
  action:
    | { type: 'place'; id: string }
    | { type: 'wire'; from: string; to: string }
    | { type: 'cut'; from: string; to: string }
    | { type: 'decommission'; id: string; refund: number }
    | { type: 'overclock'; id: string }
    | { type: 'banner'; choice: BannerChoice }
    | { type: 'laundryCut' };
  /** The player tried something the rules refused, with the reason to show. */
  refused: { reason: string };
  /** Play one sound effect by its key (the file name in public/audio/sfx without .mp3). */
  sfx: { key: string; loop?: boolean };
  /** Stop a looping sound effect started with `sfx` and `loop` (e.g. rain-loop when a room scene ends). */
  sfxStop: { key: string };
  /** A server went over 100% load and started to overheat (ENG-503 emits it). */
  overheat: { id: string };
  /** A server died from overheating (ENG-503 emits it). */
  serverDied: { id: string };
  /** A power dip's warning ended and the part went dark (ENG-503 emits it). */
  powerDip: { id: string };
  /** The crew's cable drops at the rescue (ENG-503 / the story layer emits it). */
  rescue: Record<string, never>;
  /** The sim brought the crew in (trust under 30 or 45 s into the surge): the rescue scene plays. */
  crewArrived: { by: RescueCause };
  /** The board froze on a failure; the rewind screen plays, then the run rewinds. */
  failure: Failure;
  /** The stroke of twelve: whether the block held. */
  midnight: Midnight;
  /** The clock reached 00:01:00: the debrief plays. */
  sessionEnd: Record<string, never>;
  /** An edge between two frames of the sim (src/game/occurrences.ts), emitted by the HUD once each. */
  occurrence: Occurrence;

  // ---- the Live screen (docs/LIVE.md): one event per lane boundary ----

  /**
   * What the pointer drags on the board, on drag start, every hover change and drag end (the board
   * emits it). `kind` null means the drag ended; `card` names a tray card; `over` what it is above.
   */
  drag: {
    kind: 'card' | 'wire' | null;
    card: 'server' | 'overclock' | 'balancer' | null;
    over: 'pad' | 'part' | null;
  };
  /** A comms band line started (the comms lane emits it); `since` is the HUD clock it started at. */
  line: { id: LineId; speaker: string; tag: LineTag; since: number };
  /** The band line ended (its dwell ran out or a warning pre-empted it). */
  lineEnd: { id: LineId };
  /** A chat line was posted, scripted (by id) or filler (id null); `at` is the HUD clock. */
  chatLine: { chat: ChatName; id: LineId | null; who: string; text: string; at: number };
  /**
   * An alert went up on the band, one at a time (the gauges lane emits it; src/scenes/hud/alerts.ts
   * narrows `kind`). `line` is the script line it shows, if one; `at` the HUD clock.
   */
  alert: { kind: string; line: LineId | null; text: string; at: number };
  /** The alert of that kind came down. */
  alertEnd: { kind: string };
  /** A view asks the mixer for a line's voice clip. */
  voice: { id: LineId };
  /** The mixer started playing the clip, and how long it runs. */
  voiceStart: { id: LineId; seconds: number };
  /** Something asked the mixer to stop the clip early. */
  voiceStop: { id: LineId };
  /** The clip finished (or was stopped). */
  voiceEnd: { id: LineId };
  /** One sample of the frame budget: the frame rate and what is on the display lists; `at` is the HUD clock. */
  perfSample: { at: number; fps: number; objects: number; texts: number; graphics: number };
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
