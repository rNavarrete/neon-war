// When the board's barks and scripted chat lines fire (docs/SCRIPT.md "When" column). Each cue is a
// condition on a plain view of the run; the director fires each cue once, in table order, and can
// require a condition to hold for some seconds first. Pure: state in, new state and cues out, with
// the same objects returned when nothing changed so the per-frame call doesn't allocate.

import { BROWNOUT } from '../../sim/brownout';
import type { BannerChoice } from '../../sim/economy';
import type { LineId } from '../../strings';
import { estimateClose } from './dial';
import { SURGE_WARNING_LEAD } from './warnings';

const C = BROWNOUT.challenges;

/** What the cues read about the run at one moment; the HUD builds it each frame. */
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
  /** The player has turned the estimate dial. */
  dialTouched: boolean;
  estimate: number | null;
  sizing: number | null;
  sizingOpen: boolean;
  bannerShown: boolean;
  banner: BannerChoice | null;
  laundryCut: boolean;
  /** Decommissions made since midnight. */
  decommissionsAfterMidnight: number;
  /** Any request dropped since the C6 forecast. */
  droppedInC6: boolean;
}

export interface Cue {
  readonly id: LineId;
  readonly when: (v: CueView, fired: Readonly<Record<string, number>>) => boolean;
  /** Seconds the condition must hold before the cue fires. */
  readonly holdFor?: number;
}

export interface DirectorState {
  /** When each cue fired, on the HUD clock (see `at`). */
  readonly fired: Readonly<Record<string, number>>;
  /** When each held condition became true (HUD clock), while it stays true. */
  readonly since: Readonly<Record<string, number>>;
}

export const NEW_DIRECTOR: DirectorState = { fired: {}, since: {} };

const NO_CUES: readonly LineId[] = [];

const after = (fired: Readonly<Record<string, number>>, id: LineId, secs: number, now: number): boolean =>
  fired[id] !== undefined && now >= fired[id] + secs;

/** The time delays and holds are measured on. */
const at = (v: CueView): number => v.clock ?? v.now;

const between = (now: number, from: number, to: number): boolean => now >= from && now < to;

const MIDNIGHT = BROWNOUT.clock.midnight;

/** The cues the HUD can detect from the run and the bus today, in firing order. */
export const CUES: readonly Cue[] = [
  // C1: job card and first server.
  { id: 'C1.triage.01', when: (v) => v.cardClosed && v.now < C.c3 },
  { id: 'C1.triage.02', when: (v, f) => after(f, 'C1.triage.01', 2, at(v)) },
  { id: 'C1.lux.01', when: (v) => v.dialTouched && v.now < C.c3 },
  { id: 'C1.triage.03', when: (v) => v.estimate !== null && estimateClose(v.estimate) },
  { id: 'C1.triage.04', when: (v) => v.estimate !== null && !estimateClose(v.estimate) },
  { id: 'C1.triage.05', when: (v) => v.estimate !== null && v.now < C.c3 },
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
  { id: 'C2.triage.pay', when: (v, f) => after(f, 'C2.lux.pay', 3, at(v)) },
  {
    id: 'C2.triage.after',
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
    when: (v, f) => f['C3.triage.02'] !== undefined && v.idleServer && v.now < C.c4,
  },
  { id: 'C3.triage.03', when: (v) => v.overclocked && v.now < C.c4 },
  { id: 'C3.triage.04', holdFor: 4, when: (v) => between(v.now, C.c3, C.c4) && v.overloaded },

  // C4: the parts of the surge the HUD can see (the rest wait on ENG-503, see AWAITING_ENG503).
  { id: 'C4.triage.01', when: (v) => between(v.now, C.c4 - SURGE_WARNING_LEAD, C.c4 + 5) },
  { id: 'C4.lux.01', when: (v) => between(v.now, C.c4, C.c4 + 5) },
  { id: 'C4.chat.01', holdFor: 5, when: (v) => between(v.now, C.c4, C.c5) && v.dropped > 0 },
  { id: 'C4.lux.cut', when: (v) => v.laundryCut },
  { id: 'C4.chat.cut', when: (v) => v.laundryCut },
  { id: 'C4.triage.cut', when: (v, f) => after(f, 'C4.lux.cut', 3, at(v)) },
  { id: 'C4.chat.seed', when: (v) => between(v.now, C.c4 + 15, C.c5) },
  { id: 'C4.chat.03', when: (v) => between(v.now, C.c4 + 20, C.c5) },
  { id: 'C4.chat.04', when: (v) => between(v.now, C.c4 + 25, C.c5) },
  { id: 'C4.grandma.01', when: (v) => between(v.now, C.c4 + 30, C.c5) },
  { id: 'C4.lux.02', when: (v) => between(v.now, C.c4 + 35, C.c5) },

  // C6: midnight, your call.
  { id: 'C6.rei.01', when: (v) => v.sizingOpen },
  { id: 'C6.triage.01', holdFor: 8, when: (v) => v.sizingOpen },
  { id: 'C6.ozzie.01', when: (v) => v.sizing !== null && v.sizing >= BROWNOUT.finalSizing.waste },
  { id: 'C6.mika.01', when: (v) => v.sizing === BROWNOUT.finalSizing.drops },
  { id: 'C6.tv.01', when: (v) => between(v.now, MIDNIGHT - 30, MIDNIGHT - 20) },
  { id: 'C6.tv.02', when: (v) => between(v.now, MIDNIGHT - 5, MIDNIGHT) },
  // Midnight held: nothing dropping on the stroke of twelve.
  { id: 'C6.chat.hold.01', when: (v) => between(v.now, MIDNIGHT, MIDNIGHT + 1) && v.dropped === 0 },
  { id: 'C6.rei.hold', when: (v, f) => f['C6.chat.hold.01'] !== undefined && !v.droppedInC6 },
  { id: 'C6.rei.scrape', when: (v, f) => f['C6.chat.hold.01'] !== undefined && v.droppedInC6 },
  { id: 'C6.triage.hold', when: (v, f) => f['C6.chat.hold.01'] !== undefined },
  { id: 'C6.lux.hold', when: (v, f) => f['C6.chat.hold.01'] !== undefined },
  { id: 'C6.chat.hold.02', when: (v, f) => after(f, 'C6.chat.hold.01', 2, at(v)) },

  // C7: scale down.
  { id: 'C7.ozzie.01', when: (v) => between(v.now, MIDNIGHT + 10, MIDNIGHT + 20) },
  { id: 'C7.triage.01', when: (v) => between(v.now, MIDNIGHT + 15, MIDNIGHT + 25) },
  {
    id: 'C7.ozzie.down',
    when: (v) => v.now >= MIDNIGHT && v.decommissionsAfterMidnight > 0 && v.servers <= 2,
  },
  {
    id: 'C7.ozzie.none',
    when: (v, f) => between(v.now, MIDNIGHT + 35, MIDNIGHT + 45) && v.servers >= 4 && !f['C7.ozzie.down'],
  },
];

/**
 * WIRING(ENG-503): lines whose trigger is an ENG-503 event (overheating, power dips, retries, the
 * database timing out, the rescue, rewinds, the midnight verdict when the block goes dark). They
 * get cues here when those rules land and emit something the HUD can see.
 */
export const AWAITING_ENG503: readonly LineId[] = [
  'C3.chat.03', // server dies (overheating)
  'C4.triage.02', // overclocked server goes dark (power dip)
  'C4.chat.02', // retries climb
  'C4.triage.03', // retries climb past 300
  'C4.triage.04', // database starts timing out
  'C5.triage.02', // board returns after the rescue
  'C5.triage.03', // 10 s after the rescue, under 3 live servers
  'C5.rei.05', // 3 servers live behind the balancer
  'C5.ozzie.04', // 5 or more servers after the rescue
  'C5.mika.05', // 5 or more servers after the rescue
  'C5.chat.01', // errors stop after the rescue
  'C6.triage.02', // a server goes dark before midnight (power dip)
  'C6.fail.chat', // block dark at midnight: the chat stops
];

/** One frame of the director: which cues fire now, and the state after. */
export function direct(
  s: DirectorState,
  v: CueView,
  cues: readonly Cue[] = CUES,
): { state: DirectorState; fired: readonly LineId[] } {
  let fired = s.fired;
  let since = s.since;
  let out: LineId[] | null = null;
  for (const cue of cues) {
    if (fired[cue.id] !== undefined) continue;
    const on = cue.when(v, fired);
    if (cue.holdFor) {
      const start = since[cue.id];
      if (!on) {
        if (start !== undefined) {
          since = { ...since };
          delete (since as Record<string, number>)[cue.id];
        }
        continue;
      }
      if (start === undefined) {
        since = { ...since, [cue.id]: at(v) };
        continue;
      }
      if (at(v) < start + cue.holdFor) continue;
    } else if (!on) continue;
    fired = { ...fired, [cue.id]: at(v) };
    (out ??= []).push(cue.id);
  }
  if (fired === s.fired && since === s.since) return { state: s, fired: NO_CUES };
  return { state: { fired, since }, fired: out ?? NO_CUES };
}
