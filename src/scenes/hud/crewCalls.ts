// The crew's calls over the HUD (Rolando, 1 Nov 2026): the Night Shift hack into Lux's comms instead
// of cutting to a scene, fill the quiet stretch after the build with banter, and sign off with the
// arcade invitation before the scorecard. A call is a short script of comms lines, each with the chat
// reactions it sets off; this module decides when the next line goes to the band. Lines go one at a
// time, only when the band is free (nothing showing, nothing waiting), so a cue line that comes up
// mid-call (a coach nudge, the midnight forecast) simply goes first.
//
// Why this shape: Metal Gear Solid 4 moved its Codec calls out of a separate screen and into live play
// so talk never takes the player out of the field; Valve's dynamic dialog (Elan Ruskin, GDC 2012) lets
// idle chatter play only when the world is quiet and gives way to anything that matters.
//
// Pure: state in, new state out (the same object back when nothing changed). No Phaser, no timers.

import { BROWNOUT } from '../../sim/brownout';
import type { LineId } from '../../strings';
import { type DebriefResults, debriefLines } from '../../story/debrief';

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;

/** Something a step does as its line starts, besides showing it. */
export type CallCue =
  /** The call panel floods with static: an unknown signal is on the channel. */
  | 'static'
  /** A crew face comes through the static (the interference eases). */
  | 'resolve'
  /** The load balancer comes down: the frozen board comes back and the static clears. */
  | 'handoff';

export interface CallStep {
  readonly id: LineId;
  /** Chat lines this line sets off, posted a beat after it starts (CHAT_BEAT apart). */
  readonly chat?: readonly LineId[];
  readonly cue?: CallCue;
  /** Played only when the laundry floor was cut. */
  readonly onlyIf?: 'laundryCut';
}

export type CallKind = 'hijack' | 'banter' | 'ending';

/** Seconds after a line starts before its first chat reaction lands, and between reactions. */
export const CHAT_BEAT = 1.2;
/** Seconds of quiet band between two lines of a call (a breath between speakers). */
export const LINE_GAP = 0.35;

/** The hijack: the crew break into Lux's comms. The board stays frozen until the hand-off. */
export const HIJACK: readonly CallStep[] = [
  { id: 'C5.triage.01', cue: 'static', chat: ['C5.chat.hack'] },
  { id: 'C5.lux.who', chat: ['C5.chat.fuzzy'] },
  { id: 'C5.triage.who', chat: ['C5.chat.chest'] },
  { id: 'C5.rei.01', cue: 'resolve', chat: ['C5.chat.who', 'C5.chat.hair'] },
  { id: 'C5.lux.01' },
  { id: 'C5.rei.build', chat: ['C5.chat.compliment'] },
  { id: 'C5.lux.fine', chat: ['C5.chat.trust'] },
  { id: 'C5.mika.collapse', cue: 'resolve', chat: ['C5.chat.red'] },
  { id: 'C5.rei.02', chat: ['C5.chat.nightshift'] },
  { id: 'C5.rei.03', cue: 'handoff', chat: ['C5.chat.lb', 'C5.chat.lb2'] },
  { id: 'C5.rei.health' },
  { id: 'C5.rei.cut', onlyIf: 'laundryCut' },
  { id: 'C5.lux.cut', onlyIf: 'laundryCut' },
  { id: 'C5.ozzie.01', cue: 'resolve', chat: ['C5.chat.ozzie'] },
  { id: 'C5.mika.02' },
  { id: 'C5.rei.04' },
];

/** The quiet-stretch banter, one exchange at a time, in this order: who the crew are, then the lesson. */
export const BANTER: readonly (readonly CallStep[])[] = [
  [{ id: 'C5.triage.band' }, { id: 'C5.ozzie.band' }, { id: 'C5.rei.who', chat: ['C5.chat.goodguys'] }],
  [{ id: 'C5.mika.watched' }, { id: 'C5.lux.creepy', chat: ['C5.chat.fans'] }, { id: 'C5.ozzie.snacks' }],
  [{ id: 'C5.ozzie.roles' }, { id: 'C5.rei.voice' }, { id: 'C5.mika.voice', chat: ['C5.chat.ozzie2'] }],
  [{ id: 'C5.triage.pings' }, { id: 'C5.mika.health', chat: ['C5.chat.ohh'] }, { id: 'C5.lux.neat' }],
  [{ id: 'C5.rei.wire' }, { id: 'C5.lux.whoknew' }, { id: 'C5.rei.later', chat: ['C5.chat.lore'] }],
  [{ id: 'C5.ozzie.solace' }, { id: 'C5.mika.solace', chat: ['C5.chat.solace'] }],
];

/** The sign-off after midnight: Rei's grade for these results, the invitation, TRIAGE saves the stream. */
export function endingCall(r: DebriefResults): CallStep[] {
  return [
    ...debriefLines(r).map((id): CallStep => ({ id })),
    { id: 'C8.rei.invite' },
    { id: 'C8.rei.leagues' },
    { id: 'C8.rei.end', chat: ['C8.chat.arcade', 'C8.chat.invite'] },
    { id: 'C8.lux.invite' },
    { id: 'C8.triage.going' },
    { id: 'C8.triage.end', chat: ['C8.chat.gg'] },
  ];
}

/** The steps a call plays given the run's flags (the laundry cut adds Rei's aside to the hijack). */
export function callSteps(steps: readonly CallStep[], flags: { readonly laundryCut?: boolean }): CallStep[] {
  return steps.filter((s) => !s.onlyIf || flags[s.onlyIf] === true);
}

export interface CallState {
  readonly kind: CallKind;
  readonly steps: readonly CallStep[];
  /** Steps sent to the band so far. */
  readonly next: number;
  /** HUD clock the band was last seen free with the previous line done, or null while it is busy. */
  readonly freeSince: number | null;
  /** Chat reactions waiting to land, each at its HUD clock. */
  readonly chat: readonly { readonly id: LineId; readonly at: number }[];
}

export function startCall(kind: CallKind, steps: readonly CallStep[]): CallState {
  return { kind, steps, next: 0, freeSince: null, chat: [] };
}

/** What a call needs to know about the comms band this frame. */
export interface BandView {
  /** A line is showing (or holding for its voice). */
  readonly busy: boolean;
  /** Lines waiting their turn. */
  readonly queued: number;
}

export interface CallOut {
  readonly state: CallState;
  /** The step whose line goes to the band now, or null. */
  readonly play: CallStep | null;
  /** Chat lines to post now. */
  readonly chat: readonly LineId[];
  /** Every line has been sent and has finished showing, and every reaction has landed. */
  readonly done: boolean;
}

const NO_CHAT: readonly LineId[] = [];

/** One frame of a call at HUD clock `clock`. */
export function stepCall(s: CallState, band: BandView, clock: number): CallOut {
  let state = s;
  let chat: readonly LineId[] = NO_CHAT;
  if (s.chat.length > 0 && s.chat[0].at <= clock) {
    const due = s.chat.filter((c) => c.at <= clock);
    chat = due.map((c) => c.id);
    state = { ...state, chat: s.chat.filter((c) => c.at > clock) };
  }
  const free = !band.busy && band.queued === 0;
  if (!free) {
    if (state.freeSince !== null) state = { ...state, freeSince: null };
    return { state, play: null, chat, done: false };
  }
  if (state.freeSince === null) state = { ...state, freeSince: clock };
  if (state.next >= state.steps.length) {
    return { state, play: null, chat, done: state.chat.length === 0 };
  }
  if (clock - state.freeSince! < LINE_GAP - 1e-9 && state.next > 0)
    return { state, play: null, chat, done: false };
  const step = state.steps[state.next];
  const reactions = (step.chat ?? []).map((id, i) => ({ id, at: clock + CHAT_BEAT * (i + 1) }));
  state = {
    ...state,
    next: state.next + 1,
    freeSince: null,
    chat: reactions.length > 0 ? [...state.chat, ...reactions] : state.chat,
  };
  return { state, play: step, chat, done: false };
}

/** What the banter scheduler reads about the night. */
export interface BanterView {
  /** Sim seconds since the clock opened. */
  readonly now: number;
  /** The crew are in and their hijack call is over. */
  readonly crewIn: boolean;
  /** The clock is running (the build covers the tail). */
  readonly running: boolean;
  /** Seconds nothing has been dropped (0 while requests drop). */
  readonly calmFor: number;
  /** Seconds the band has been free (nothing showing, nothing waiting). */
  readonly bandFreeFor: number;
  /** The coach is helping with something. */
  readonly coaching: boolean;
}

/** Seconds of free band before an exchange may start. */
export const BANTER_QUIET = 4;
/** Seconds nothing must have dropped. */
export const BANTER_CALM = 3;
/** No exchange starts this close before the midnight forecast. */
export const BANTER_BEFORE_C6 = 22;
/** ...nor in the forecast's first seconds (the crew's call and TRIAGE's sum). */
export const BANTER_AFTER_C6 = 18;
/** No exchange starts later than this before midnight (the dip and the countdown own the end). */
export const BANTER_LAST = 32;

/** Whether the next banter exchange may start now. */
export function banterDue(v: BanterView): boolean {
  if (!v.crewIn || !v.running || v.coaching) return false;
  if (v.calmFor < BANTER_CALM || v.bandFreeFor < BANTER_QUIET) return false;
  if (v.now >= C.c6 - BANTER_BEFORE_C6 && v.now < C.c6 + BANTER_AFTER_C6) return false;
  return v.now < MIDNIGHT - BANTER_LAST;
}

// ---- the interference on the call panel ----

/** The call panel's signal: an unknown caller jamming it, a face coming through, clearing, or clean. */
export type Signal = 'static' | 'resolve' | 'clear' | null;

/** Static at full jam: the face under it barely shows. */
export const NOISE_JAM = 0.9;
/** What is left once a face has come through: the call still crackles. */
export const NOISE_RESIDUE = 0.35;
/** A face resolving: a burst of static this long, then it eases to the residue over RESOLVE_EASE. */
export const RESOLVE_BURST = 0.45;
export const RESOLVE_EASE = 0.8;
/** The hand-off: the residue clears over this long. */
export const CLEAR_SECONDS = 1.2;

/** How much static covers the call panel `secs` after the signal changed to `s` (0 clean to 1 jammed). */
export function noiseLevel(s: Signal, secs: number): number {
  const t = Math.max(0, secs);
  switch (s) {
    case 'static':
      return NOISE_JAM * Math.min(1, t / 0.25);
    case 'resolve':
      if (t < RESOLVE_BURST) return 1;
      return Math.max(NOISE_RESIDUE, 1 - ((t - RESOLVE_BURST) / RESOLVE_EASE) * (1 - NOISE_RESIDUE));
    case 'clear':
      return Math.max(0, NOISE_RESIDUE * (1 - t / CLEAR_SECONDS));
    default:
      return 0;
  }
}

/** The face on the call tile shows through the static at this alpha. */
export function faceThrough(noise: number): number {
  if (noise >= 0.75) return 0.12;
  return 1 - noise * 0.6;
}
