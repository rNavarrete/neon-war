// When the board's barks and scripted chat lines fire (docs/SCRIPT.md "When" column): the one
// trigger table of the Live screen. Each cue is a condition on a plain view of the run, the
// CueView, which cueViewOf builds from the Frame (src/game/frame.ts), this frame's occurrences
// (src/game/occurrences.ts) and the few things only the HUD knows (the job card and the
// banner). A predicate reads the CueView only; holds (`holdFor`) and delays (`after`) run on the HUD
// clock. The director fires each cue once, in table order; a rewind clears the cues of the
// challenges it goes back over. Pure: state in, new state and cues out, with the same objects
// returned when nothing changed so the per-frame call doesn't allocate.
//
// The host loop sends each fired id out as bus `cue`: barks to the comms band, chat ids to the chat.

import type { Frame } from '../../game/frame';
import type { Occurrence } from '../../game/occurrences';
import { capacityOf } from '../../sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../../sim/brownout';
import type { BannerChoice } from '../../sim/economy';
import { LINES, type LineId } from '../../strings';
import { SURGE_WARNING_LEAD } from './warnings';

const C = BROWNOUT.challenges;

/** What the cues read about the run at one moment; the HUD builds it each frame (see cueViewOf). */
export interface CueView {
  /** Sim seconds since the clock opened. */
  now: number;
  /**
   * Seconds the HUD has run (it keeps counting while C1's clock waits for the first build), for
   * "N s later" delays; defaults to `now`.
   */
  clock?: number;
  demand: number;
  capacity: number;
  /** Requests per second dropped right now. */
  dropped: number;
  /** Servers on the board. */
  servers: number;
  /** A live server is getting no traffic (racked but not fed). */
  idleServer: boolean;
  /** A live server is at full load while requests drop. */
  overloaded: boolean;
  /** Some server has the overclock kit fitted. */
  overclocked: boolean;
  /** The job card has been clicked away. */
  cardClosed: boolean;
  bannerShown: boolean;
  banner: BannerChoice | null;
  laundryCut: boolean;
  /** Decommissions made since midnight. */
  decommissionsAfterMidnight: number;
  /** Any request dropped since the C6 forecast. */
  droppedInC6: boolean;

  // ---- read from the Frame by cueViewOf; each is optional and reads as its default when missing ----

  /** The crew have broken in (default false). */
  rescued?: boolean;
  /** The HUD clock when the board came back after the rescue scene; null before (default null). */
  rescueClock?: number | null;
  /** A server dark in a power dip right now, or null (default null). */
  darkPart?: string | null;
  /** The server carrying the overclock kit, or null (default null). */
  overclockedId?: string | null;
  /** Online servers wired behind the balancer and on to the database (default 0). */
  liveBehindLb?: number;
  /** Servers wired behind the balancer that are still booting or rebooting (default 0). */
  bootingBehindLb?: number;
  /** Servers on the board once the crew are in; 0 before the rescue (default 0). */
  serversAfterRescue?: number;
  /** The database's load over what it can take, 0 to 1 and past 1 when it chokes (default 0). */
  databaseShare?: number;
  /** How far retries have pushed demand up, 0 to 0.5 (default 0). */
  retry?: number;
  /** Servers that died from overheating and wait to be replaced (default 0). */
  deadServers?: number;
  /** Midnight's verdict: null before it strikes, true held, false the block went dark (default null). */
  midnightHeld?: boolean | null;
  /** Rewinds made this run (default 0); a rise makes the director clear what it rewound over. */
  rewinds?: number;
  /** Where the newest rewind went back to, in sim seconds (default 0). */
  rewoundTo?: number;
  /** A server on the board has no wire into it (default false). */
  unwiredServer?: boolean;
  /** Credits in hand (default 0). */
  credits?: number;
  /** A viewer has covered the move that would help (a `help` tip came in; default false). */
  helpTip?: boolean;
  /** A viewer has tipped for the lights coming back (a `recovered` tip; default false). */
  recoveredTip?: boolean;
  /** Placed parts the player has moved this run (default 0). */
  moves?: number;
}

/** What only the HUD knows, handed to cueViewOf each frame. */
export interface CueHost {
  /** The job card has been clicked away. */
  readonly cardClosed: boolean;
  /** The Solace banner has slid in. */
  readonly bannerShown: boolean;
  /** Decommissions made since midnight. */
  readonly decommissionsAfterMidnight: number;
  /** Placed parts the player has moved this run (default 0). */
  readonly moves?: number;
}

export interface Cue {
  readonly id: LineId;
  readonly when: (v: CueView, fired: Readonly<Record<string, number>>) => boolean;
  /** Seconds the condition must hold before the cue fires (on the HUD clock). */
  readonly holdFor?: number;
  /** The ids the condition waits on (an `after()` delay or a fired check): the cue's declared chain. */
  readonly follows?: readonly LineId[];
}

export interface DirectorState {
  /** When each cue fired, on the HUD clock (see `at`). */
  readonly fired: Readonly<Record<string, number>>;
  /** When each held condition became true (HUD clock), while it stays true. */
  readonly since: Readonly<Record<string, number>>;
  /** Rewinds already handled (default 0). */
  readonly rewinds?: number;
}

export const NEW_DIRECTOR: DirectorState = { fired: {}, since: {} };

const NO_CUES: readonly LineId[] = [];

const after = (fired: Readonly<Record<string, number>>, id: LineId, secs: number, now: number): boolean =>
  fired[id] !== undefined && now >= fired[id] + secs;

/** The time delays and holds are measured on. */
const at = (v: CueView): number => v.clock ?? v.now;

const between = (now: number, from: number, to: number): boolean => now >= from && now < to;

const MIDNIGHT = BROWNOUT.clock.midnight;
/** The midnight forecast is up: from its lead before C6 until midnight (once the job card is away). */
const midnightForecast = (v: CueView): boolean =>
  v.cardClosed && between(v.now, C.c6 - BROWNOUT.demand.forecastLeadSeconds, MIDNIGHT);

/** The crew are in. */
const rescued = (v: CueView): boolean => v.rescued ?? false;
/** The board is back after the rescue scene. */
const boardBack = (v: CueView): boolean => rescued(v) && (v.rescueClock ?? null) !== null;
/** Before the crew break in (D11: the surge-window lines only play while Lux is alone). */
const alone = (v: CueView): boolean => !rescued(v);
/** Servers live behind the balancer, the crew's lesson number. */
const LIVE_FOR_REI = 3;
/** Retries this far up count as "retries climb" (the chat's retriesRising edge). */
const RETRIES_CLIMB = 0.2;
/** C4.triage.03: the needle at 300 with nobody new on the streets. */
const REFRESH_DEMAND = 300;

/** The cues, in firing order. */
export const CUES: readonly Cue[] = [
  // C1: job card and first server.
  { id: 'C1.triage.01', when: (v) => v.cardClosed && v.now < C.c3 },
  { id: 'C1.triage.02', follows: ['C1.triage.01'], when: (v, f) => after(f, 'C1.triage.01', 2, at(v)) },
  // TRIAGE panics about the lights, Lux steadies and TRIAGE says how to build; the lights coming back
  // waits for the first live box, so the gauge reads the real line (never before the first wire:
  // learning-5 (d)). No sums in C1 (Rolando, 30 Oct 2026); C1.triage.04 is not played.
  { id: 'C1.lux.01', follows: ['C1.triage.02'], when: (v, f) => after(f, 'C1.triage.02', 2, at(v)) },
  {
    id: 'C1.triage.05',
    follows: ['C1.lux.01'],
    when: (v, f) => v.now < C.c3 && after(f, 'C1.lux.01', 2, at(v)),
  },
  {
    id: 'C1.triage.03',
    follows: ['C1.lux.01'],
    when: (v, f) => v.capacity > 0 && v.now < C.c3 && after(f, 'C1.lux.01', 2, at(v)),
  },
  { id: 'C1.chat.01', when: (v) => v.capacity > 0 && v.now < C.c3 },
  { id: 'C1.chat.02', when: (v) => v.capacity > 0 && v.now < C.c3 },
  {
    id: 'C1.triage.06',
    holdFor: 10,
    when: (v) =>
      v.cardClosed &&
      v.now < C.c3 &&
      v.dropped === 0 &&
      v.capacity >= BROWNOUT.server.capacity &&
      v.demand <= BROWNOUT.block.flats / BROWNOUT.block.callEverySeconds + 0.5,
  },

  // C2: the Solace banner.
  { id: 'C2.triage.01', when: (v) => v.bannerShown },
  { id: 'C2.lux.pay', when: (v) => v.banner === 'pay' },
  { id: 'C2.lux.ignore', when: (v) => v.banner === 'ignore' },
  { id: 'C2.lux.bin', when: (v) => v.banner === 'bin' },
  { id: 'C2.triage.pay', follows: ['C2.lux.pay'], when: (v, f) => after(f, 'C2.lux.pay', 3, at(v)) },
  {
    id: 'C2.triage.after',
    follows: ['C2.lux.pay', 'C2.lux.ignore', 'C2.lux.bin'],
    when: (v, f) =>
      after(f, 'C2.lux.pay', 5, at(v)) ||
      after(f, 'C2.lux.ignore', 5, at(v)) ||
      after(f, 'C2.lux.bin', 5, at(v)),
  },

  // C3: bigger or more?
  { id: 'C3.chat.01', when: (v) => between(v.now, C.c3 - SURGE_WARNING_LEAD, C.c4) },
  { id: 'C3.chat.02', when: (v) => between(v.now, C.c3 - SURGE_WARNING_LEAD, C.c4) },
  { id: 'C3.triage.01', when: (v) => between(v.now, C.c3, C.c4) },
  { id: 'C3.triage.02', when: (v) => between(v.now, C.c3, C.c4) && v.servers >= 2 },
  {
    id: 'C3.lux.01',
    holdFor: 5,
    follows: ['C3.triage.02'],
    when: (v, f) => f['C3.triage.02'] !== undefined && v.idleServer && v.now < C.c4,
  },
  { id: 'C3.triage.03', when: (v) => v.overclocked && v.now < C.c4 },
  { id: 'C3.triage.04', holdFor: 4, when: (v) => between(v.now, C.c3, C.c4) && v.overloaded },
  // A server cooked: from C3 on, whenever it happens.
  { id: 'C3.chat.03', when: (v) => v.now >= C.c3 && (v.deadServers ?? 0) > 0 },

  // C4: the district surge, while Lux is alone.
  { id: 'C4.triage.01', when: (v) => between(v.now, C.c4 - SURGE_WARNING_LEAD, C.c4 + 5) },
  { id: 'C4.lux.01', when: (v) => between(v.now, C.c4, C.c4 + 5) },
  // The surge's power dip takes the big box (the one with the kit) dark; a stock box going dark is not it.
  {
    id: 'C4.triage.02',
    when: (v) =>
      between(v.now, C.c4, C.c5) &&
      alone(v) &&
      (v.darkPart ?? null) !== null &&
      v.darkPart === (v.overclockedId ?? null),
  },
  {
    id: 'C4.chat.dark',
    when: (v) => between(v.now, C.c4, C.c5) && alone(v) && (v.darkPart ?? null) !== null,
  },
  { id: 'C4.chat.01', holdFor: 5, when: (v) => between(v.now, C.c4, C.c5) && v.dropped > 0 },
  {
    id: 'C4.chat.02',
    when: (v) => between(v.now, C.c4, C.c5) && alone(v) && (v.retry ?? 0) >= RETRIES_CLIMB,
  },
  // Dark, then refresh, then climb: only once the big box is down, with retries pushing past 300.
  {
    id: 'C4.triage.03',
    follows: ['C4.triage.02'],
    when: (v, f) =>
      f['C4.triage.02'] !== undefined &&
      between(v.now, C.c4, C.c5) &&
      alone(v) &&
      (v.retry ?? 0) > 0 &&
      v.demand >= REFRESH_DEMAND,
  },
  { id: 'C4.lux.cut', when: (v) => v.laundryCut },
  { id: 'C4.chat.cut', when: (v) => v.laundryCut },
  { id: 'C4.triage.cut', follows: ['C4.lux.cut'], when: (v, f) => after(f, 'C4.lux.cut', 3, at(v)) },
  // The surge windows (D11): only while the crew have not broken in.
  { id: 'C4.chat.seed', when: (v) => between(v.now, C.c4 + 15, C.c5) && alone(v) },
  { id: 'C4.chat.03', when: (v) => between(v.now, C.c4 + 20, C.c5) && alone(v) },
  { id: 'C4.chat.04', when: (v) => between(v.now, C.c4 + 25, C.c5) && alone(v) },
  { id: 'C4.grandma.01', when: (v) => between(v.now, C.c4 + 30, C.c5) && alone(v) },
  { id: 'C4.lux.02', when: (v) => between(v.now, C.c4 + 35, C.c5) && alone(v) },

  // C5: back on the board after the rescue scene (holds on the HUD clock, so they count while the
  // sim clock waits for the crew build).
  { id: 'C5.triage.02', holdFor: 1, when: (v) => boardBack(v) && v.now < C.c6 },
  { id: 'C5.chat.lb', holdFor: 3, when: (v) => boardBack(v) && v.now < C.c6 },
  {
    id: 'C5.triage.03',
    holdFor: 10,
    when: (v) => boardBack(v) && v.now < C.c6 && (v.liveBehindLb ?? 0) < LIVE_FOR_REI,
  },
  {
    id: 'C5.rei.05',
    when: (v) =>
      boardBack(v) &&
      v.now < C.c6 &&
      (v.liveBehindLb ?? 0) === LIVE_FOR_REI &&
      (v.bootingBehindLb ?? 0) === 0,
  },
  {
    id: 'C5.ozzie.04',
    when: (v) => boardBack(v) && v.now < C.c6 && (v.serversAfterRescue ?? 0) >= BROWNOUT.finalSizing.waste,
  },
  { id: 'C5.mika.05', follows: ['C5.ozzie.04'], when: (v, f) => after(f, 'C5.ozzie.04', 3, at(v)) },
  { id: 'C5.chat.01', when: (v) => boardBack(v) && v.now < C.c6 && v.dropped === 0 },

  // C6: midnight, your call.
  // The midnight forecast is the call; the crew react to the boxes actually running.
  { id: 'C6.rei.01', when: (v) => midnightForecast(v) },
  { id: 'C6.triage.01', holdFor: 8, when: (v) => midnightForecast(v) },
  { id: 'C6.ozzie.01', when: (v) => midnightForecast(v) && v.servers >= BROWNOUT.finalSizing.waste },
  { id: 'C6.mika.01', when: (v) => midnightForecast(v) && v.servers <= BROWNOUT.finalSizing.drops },
  { id: 'C6.tv.01', when: (v) => between(v.now, MIDNIGHT - 30, MIDNIGHT - 20) },
  // The seeded dip before midnight takes a box dark.
  { id: 'C6.triage.02', when: (v) => between(v.now, C.c6, MIDNIGHT) && (v.darkPart ?? null) !== null },
  { id: 'C6.chat.dark', when: (v) => between(v.now, C.c6, MIDNIGHT) && (v.darkPart ?? null) !== null },
  { id: 'C6.tv.02', when: (v) => between(v.now, MIDNIGHT - 5, MIDNIGHT) },
  // Midnight held: nothing dropping on the stroke of twelve.
  {
    id: 'C6.chat.hold.01',
    when: (v) => between(v.now, MIDNIGHT, MIDNIGHT + 1) && v.dropped === 0 && v.midnightHeld !== false,
  },
  {
    id: 'C6.rei.hold',
    follows: ['C6.chat.hold.01'],
    when: (v, f) => f['C6.chat.hold.01'] !== undefined && !v.droppedInC6,
  },
  {
    id: 'C6.rei.scrape',
    follows: ['C6.chat.hold.01'],
    when: (v, f) => f['C6.chat.hold.01'] !== undefined && v.droppedInC6,
  },
  { id: 'C6.triage.hold', follows: ['C6.chat.hold.01'], when: (v, f) => f['C6.chat.hold.01'] !== undefined },
  { id: 'C6.lux.hold', follows: ['C6.chat.hold.01'], when: (v, f) => f['C6.chat.hold.01'] !== undefined },
  {
    id: 'C6.chat.hold.02',
    follows: ['C6.chat.hold.01'],
    when: (v, f) => after(f, 'C6.chat.hold.01', 2, at(v)),
  },
  // Dark at midnight: the chat stops (see chatSilenced) until the rewind.
  { id: 'C6.fail.chat', when: (v) => v.midnightHeld === false },

  // C7: scale down.
  { id: 'C7.chat.01', follows: ['C6.chat.hold.01'], when: (v, f) => after(f, 'C6.chat.hold.01', 5, at(v)) },
  { id: 'C7.ozzie.01', when: (v) => between(v.now, MIDNIGHT + 10, MIDNIGHT + 20) },
  { id: 'C7.triage.01', when: (v) => between(v.now, MIDNIGHT + 15, MIDNIGHT + 25) },
  {
    id: 'C7.ozzie.down',
    when: (v) => v.now >= MIDNIGHT && v.decommissionsAfterMidnight > 0 && v.servers <= 2,
  },
  {
    id: 'C7.ozzie.none',
    follows: ['C7.ozzie.down'],
    when: (v, f) => between(v.now, MIDNIGHT + 35, MIDNIGHT + 45) && v.servers >= 4 && !f['C7.ozzie.down'],
  },
];

/** C3.lux.near: demand this close to capacity reads as "close to the limit". */
const NEAR_LIMIT = 0.85;
/** C3.lux.broke: under the cheapest thing that adds room (the scale-up kit). */
const BROKE_BELOW = BROWNOUT.overclock.cost;

/**
 * Lux on the board (docs/SCRIPT.md "Lux on the board"; Rolando, 30 Oct 2026: give her more lines
 * about how to play). Her reactions to what the player does and sees, in her own voice. They are a
 * layer over the scripted night: the director runs them after CUES (BOARD_CUES), and the comms band
 * drops one that has waited too long (lineMeta LUX_ASIDES), so they never hold up a scripted line.
 */
export const LUX_CUES: readonly Cue[] = [
  // C1: the first server.
  {
    id: 'C1.lux.placed',
    holdFor: 3,
    when: (v) => v.cardClosed && v.now < C.c3 && v.capacity === 0 && (v.unwiredServer ?? false),
  },
  {
    id: 'C1.lux.live',
    follows: ['C1.triage.03'],
    when: (v, f) => v.now < C.c3 && after(f, 'C1.triage.03', 1, at(v)),
  },
  {
    id: 'C1.lux.chat',
    follows: ['C1.chat.02'],
    when: (v, f) => v.now < C.c3 && after(f, 'C1.chat.02', 4, at(v)),
  },
  { id: 'C1.lux.goodcall', follows: ['C1.triage.06'], when: (v, f) => after(f, 'C1.triage.06', 1, at(v)) },
  { id: 'C1.lux.moved', when: (v) => (v.moves ?? 0) > 0 },

  // C2: room to spare.
  {
    id: 'C2.lux.headroom',
    follows: ['C2.triage.after'],
    when: (v, f) => after(f, 'C2.triage.after', 2, at(v)),
  },

  // C3: the climb, the limit, the money.
  { id: 'C3.lux.climbing', when: (v) => between(v.now, C.c3 - SURGE_WARNING_LEAD, C.c3 + 5) && alone(v) },
  {
    id: 'C3.lux.watch',
    follows: ['C3.lux.climbing'],
    when: (v, f) => v.now < C.c4 && after(f, 'C3.lux.climbing', 5, at(v)),
  },
  {
    id: 'C3.lux.father',
    follows: ['C3.chat.01'],
    when: (v, f) => v.now < C.c4 && after(f, 'C3.chat.01', 3, at(v)),
  },
  {
    id: 'C3.lux.near',
    holdFor: 1,
    when: (v) =>
      v.now >= C.c3 - SURGE_WARNING_LEAD &&
      v.now < MIDNIGHT &&
      alone(v) &&
      v.capacity > 0 &&
      v.dropped === 0 &&
      v.demand >= NEAR_LIMIT * v.capacity,
  },
  {
    id: 'C3.lux.over',
    holdFor: 2,
    when: (v) => v.now >= C.c3 && v.now < MIDNIGHT && alone(v) && v.dropped > 0,
  },
  { id: 'C3.lux.eyes', follows: ['C3.triage.04'], when: (v, f) => after(f, 'C3.triage.04', 1, at(v)) },
  { id: 'C3.lux.scaledup', follows: ['C3.triage.03'], when: (v, f) => after(f, 'C3.triage.03', 3, at(v)) },
  {
    id: 'C3.lux.broke',
    holdFor: 3,
    when: (v) => v.now >= C.c3 && v.now < MIDNIGHT && v.servers > 0 && (v.credits ?? 0) < BROKE_BELOW,
  },
  { id: 'C3.lux.tip', when: (v) => v.now >= C.c3 && (v.helpTip ?? false) },
  { id: 'C3.lux.thanks', when: (v) => v.recoveredTip ?? false },

  // C4: the district surge, while she is alone.
  { id: 'C4.lux.forecast', follows: ['C4.triage.01'], when: (v, f) => after(f, 'C4.triage.01', 1, at(v)) },
  {
    id: 'C4.lux.forecast2',
    when: (v) => between(v.now, C.c4 - 5, C.c4) && alone(v) && v.capacity < BROWNOUT.demand.surge,
  },
  { id: 'C4.lux.dark', follows: ['C4.triage.02'], when: (v, f) => after(f, 'C4.triage.02', 1, at(v)) },
  { id: 'C4.lux.retry', follows: ['C4.triage.03'], when: (v, f) => after(f, 'C4.triage.03', 1, at(v)) },
  {
    id: 'C4.lux.okafor',
    follows: ['C4.chat.01'],
    when: (v, f) => v.now < C.c5 && alone(v) && after(f, 'C4.chat.01', 2, at(v)),
  },

  // C5 to C7: back on her feet, midnight, the morning after.
  { id: 'C5.lux.recover', follows: ['C5.chat.01'], when: (v, f) => after(f, 'C5.chat.01', 2, at(v)) },
  {
    id: 'C6.lux.spare',
    follows: ['C6.triage.02'],
    when: (v, f) => v.now < MIDNIGHT && v.dropped === 0 && after(f, 'C6.triage.02', 3, at(v)),
  },
  {
    id: 'C6.lux.countdown',
    when: (v) => between(v.now, MIDNIGHT - 10, MIDNIGHT - 5) && (v.midnightHeld ?? null) === null,
  },
  { id: 'C6.lux.midnight', follows: ['C6.lux.hold'], when: (v, f) => after(f, 'C6.lux.hold', 2, at(v)) },
  { id: 'C7.lux.count', follows: ['C7.triage.01'], when: (v, f) => after(f, 'C7.triage.01', 1, at(v)) },
];

/** Every cue the board's director runs: the scripted night, then Lux's asides. */
export const BOARD_CUES: readonly Cue[] = [...CUES, ...LUX_CUES];

/**
 * Lines with no cue. C4.triage.04 waits on the database choking on the repeats, which the sim never
 * shows (route() caps the database at 200): decision D2 retires the beat, so it stays unfired.
 */
export const AWAITING_ENG503: readonly LineId[] = [
  'C4.triage.04', // database starts timing out (D2: retired; would read CueView.databaseShare > 1)
];

/** The line that stops the chat: the block went dark at midnight. */
export const CHAT_SILENCE: LineId = 'C6.fail.chat';

/** Cue ids that are chat lines (the block or the stream), silenced after a dark midnight. */
const CHAT_CUES: ReadonlySet<LineId> = new Set(
  CUES.filter((c) => LINES[c.id].kind === 'chat' && c.id !== CHAT_SILENCE).map((c) => c.id),
);

/** Whether the chat is silent: the block went dark at midnight and no rewind has come yet. */
export function chatSilenced(s: DirectorState): boolean {
  return s.fired[CHAT_SILENCE] !== undefined;
}

/** The sim time a line's challenge starts, from its id's `C<n>.` prefix; null for other ids. */
export function challengeStart(id: LineId): number | null {
  const m = /^C(\d)\./.exec(id);
  if (!m) return null;
  return (C as Readonly<Record<string, number>>)[`c${m[1]}`] ?? null;
}

/**
 * The director after a rewind to `to` (sim seconds): the cues of every challenge from the one it
 * goes back to onward can fire again; earlier challenges stay fired.
 */
export function rewindDirector(s: DirectorState, to: number): DirectorState {
  const keep = (id: string): boolean => {
    const start = challengeStart(id as LineId);
    return start === null || start < to;
  };
  const fired: Record<string, number> = {};
  for (const id of Object.keys(s.fired)) if (keep(id)) fired[id] = s.fired[id];
  const since: Record<string, number> = {};
  for (const id of Object.keys(s.since)) if (keep(id)) since[id] = s.since[id];
  return { fired, since, rewinds: s.rewinds };
}

/** One frame of the director: which cues fire now, and the state after. */
export function direct(
  s: DirectorState,
  v: CueView,
  cues: readonly Cue[] = CUES,
): { state: DirectorState; fired: readonly LineId[] } {
  const rewinds = v.rewinds ?? 0;
  const start = rewinds > (s.rewinds ?? 0) ? { ...rewindDirector(s, v.rewoundTo ?? 0), rewinds } : s;
  let fired = start.fired;
  let since = start.since;
  let out: LineId[] | null = null;
  for (const cue of cues) {
    if (fired[cue.id] !== undefined) continue;
    if (fired[CHAT_SILENCE] !== undefined && CHAT_CUES.has(cue.id)) continue;
    const on = cue.when(v, fired);
    if (cue.holdFor) {
      const begun = since[cue.id];
      if (!on) {
        if (begun !== undefined) {
          since = { ...since };
          delete (since as Record<string, number>)[cue.id];
        }
        continue;
      }
      if (begun === undefined) {
        since = { ...since, [cue.id]: at(v) };
        continue;
      }
      if (at(v) < begun + cue.holdFor) continue;
    } else if (!on) continue;
    fired = { ...fired, [cue.id]: at(v) };
    (out ??= []).push(cue.id);
  }
  if (start === s && fired === s.fired && since === s.since) return { state: s, fired: NO_CUES };
  return { state: { fired, since, rewinds: start.rewinds }, fired: out ?? NO_CUES };
}

/** A blank view to build into (see cueViewOf's `out`). */
export function emptyCueView(): CueView {
  return {
    now: 0,
    clock: 0,
    demand: 0,
    capacity: 0,
    dropped: 0,
    servers: 0,
    idleServer: false,
    overloaded: false,
    overclocked: false,
    cardClosed: false,
    bannerShown: false,
    banner: null,
    laundryCut: false,
    decommissionsAfterMidnight: 0,
    droppedInC6: false,
    rescued: false,
    rescueClock: null,
    darkPart: null,
    overclockedId: null,
    liveBehindLb: 0,
    bootingBehindLb: 0,
    serversAfterRescue: 0,
    databaseShare: 0,
    retry: 0,
    deadServers: 0,
    midnightHeld: null,
    rewinds: 0,
    rewoundTo: 0,
    unwiredServer: false,
    credits: 0,
    helpTip: false,
    recoveredTip: false,
    moves: 0,
  };
}

/** Whether any wire runs into `to`. */
function wiredInto(f: Frame, to: string): boolean {
  for (const w of f.wires) if (w.to === to) return true;
  return false;
}

/** Whether a wire runs from `from` to `to`. */
function wired(f: Frame, from: string, to: string): boolean {
  for (const w of f.wires) if (w.from === from && w.to === to) return true;
  return false;
}

/**
 * The CueView for this frame, from the Frame, this frame's occurrences, the HUD clock and what the
 * HUD knows (`host`). `prev` is the last frame's view: it carries what only builds up over frames
 * (requests dropped in C6, the clock the board came back after the rescue). Written into `out` when
 * given (the HUD passes its one view, which may also be `prev`), so a frame allocates nothing;
 * otherwise a fresh view comes back. Reads nothing else: no run(), no clock of its own.
 */
export function cueViewOf(
  prev: CueView | null,
  f: Frame,
  occurrences: readonly Occurrence[],
  clock: number,
  host: CueHost,
  out?: CueView,
): CueView {
  // Read what carries over before `out` (which may be `prev`) is written.
  const rewinds = f.rewinds.length;
  const rewound = rewinds !== (prev?.rewinds ?? 0);
  const prevDroppedInC6 = !rewound && (prev?.droppedInC6 ?? false);
  const prevRescueClock = rewound ? null : (prev?.rescueClock ?? null);

  const v = out ?? emptyCueView();
  const now = f.now;
  const dropped = f.dropped > 1e-6 ? f.dropped : 0;

  let servers = 0;
  let unwired = false;
  let idle = false;
  let overloaded = false;
  let overclockedId: string | null = null;
  let lb: string | null = null;
  for (const p of f.parts) {
    if (p.kind === 'balancer' && lb === null) lb = p.id;
    if (p.kind !== 'server') continue;
    servers++;
    if (!unwired && !wiredInto(f, p.id)) unwired = true;
    if ((p.boost ?? 1) > 1 && overclockedId === null) overclockedId = p.id;
    if (f.offline.includes(p.id)) continue;
    const load = f.flow.load[p.id] ?? 0;
    if (load <= 0) idle = true;
    if (dropped > 0 && load >= capacityOf(p, BROWNOUT_RULES) - 1e-6) overloaded = true;
  }

  let live = 0;
  let booting = 0;
  if (lb !== null) {
    for (const p of f.parts) {
      if (p.kind !== 'server' || !wired(f, lb, p.id) || !wired(f, p.id, 'database')) continue;
      if (!f.offline.includes(p.id)) live++;
      else if ((f.offlineUntil[p.id] ?? 0) > now) booting++;
    }
  }

  // The part that went dark this frame, else one still dark.
  let darkPart: string | null = null;
  for (const o of occurrences) {
    if (o.kind === 'dark' && o.id !== undefined) {
      darkPart = o.id;
      break;
    }
  }
  if (darkPart === null && f.dark.length > 0) darkPart = f.dark[0];

  v.now = now;
  v.clock = clock;
  v.demand = f.demand;
  v.capacity = f.capacity;
  v.dropped = dropped;
  v.servers = servers;
  v.idleServer = idle;
  v.overloaded = overloaded;
  v.overclocked = overclockedId !== null;
  v.cardClosed = host.cardClosed;
  v.bannerShown = host.bannerShown;
  v.banner = f.banner?.choice ?? null;
  v.laundryCut = f.laundryCut !== null;
  v.decommissionsAfterMidnight = host.decommissionsAfterMidnight;
  v.droppedInC6 =
    prevDroppedInC6 ||
    (dropped > 0 && now >= C.c6 - BROWNOUT.demand.forecastLeadSeconds && now <= MIDNIGHT + 1);

  v.rescued = f.rescued;
  // The board is back once the crew are in and nothing holds it (the rescue scene has ended).
  v.rescueClock = f.rescued ? (prevRescueClock ?? (f.paused ? null : clock)) : null;
  v.darkPart = darkPart;
  v.overclockedId = overclockedId;
  v.liveBehindLb = live;
  v.bootingBehindLb = booting;
  v.serversAfterRescue = f.rescued ? servers : 0;
  v.databaseShare = (f.flow.load['database'] ?? 0) / BROWNOUT.database.capacity;
  v.retry = f.retry;
  v.deadServers = f.dead.length;
  v.midnightHeld = f.midnight ? f.midnight.held : null;
  v.rewinds = rewinds;
  v.rewoundTo = rewinds > 0 ? f.rewinds[rewinds - 1].to : 0;
  v.unwiredServer = unwired;
  v.credits = f.credits;
  let helpTip = false;
  let recoveredTip = false;
  for (const t of f.tips) {
    if (t.kind === 'help') helpTip = true;
    else if (t.kind === 'recovered') recoveredTip = true;
  }
  v.helpTip = helpTip;
  v.recoveredTip = recoveredTip;
  v.moves = host.moves ?? 0;
  return v;
}
