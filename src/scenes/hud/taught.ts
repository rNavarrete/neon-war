// The taught trace (learning-4, decision D10): when the player saw each of the debrief's terms in
// practice, before it was named. Every entry ties one C8 term key to a moment on the night's clock:
// a line the comms band showed that teaches it (lineMeta's `teaches`: the lesson lines, and the
// WARNINGs C4.triage.02/.03 and C6.triage.02), a dial answer (the C1 estimate, the C6 sizing), an
// occurrence on the board (the first SKIPPED, the big box going dark, a box counting DIES IN at
// midnight, midnight held with the spare...) or something the player did (the kit, a decommission).
// The debrief prints one grey line per term from it (src/story/debrief.ts seenLines).
//
// Beside it, `hud.measure`: the dial answers with the sim time each was set, and the board's wires.
//
// The top half is pure (no Phaser, no clock: time comes in as `at`), unit-tested in node. The
// recorder at the bottom listens on the bus and reads frame(run()) when something arrives; it never
// reads the test hook, and it is provided to the hook as hud.taught and hud.measure.

import { type GameEvents, bus } from '../../game/bus';
import { type Frame, frame } from '../../game/frame';
import type { Occurrence } from '../../game/occurrences';
import { type Run, type RunNotes, run } from '../../game/run';
import { BROWNOUT } from '../../sim/brownout';
import type { LineId } from '../../strings';
import { provideHudSection } from './hook';
import { TERM_GROUP, type TermGroup, type TermKey, metaOf } from './lineMeta';

const C = BROWNOUT.challenges;

/** Moments that teach a term without a line: dial answers, board occurrences and player actions. */
export const MOMENT_KINDS = [
  'estimateSet',
  'firstLive',
  'kitFitted',
  'secondBox',
  'splitterRacked',
  'firstSkipped',
  'bigBoxDark',
  'retriesRising',
  'laundryCut',
  'sizingSet',
  'diesInAtMidnight',
  'heldWithSpare',
  'decommission',
] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

/** The debrief terms each moment shows in practice. */
export const MOMENT_TEACHES: Readonly<Record<MomentKind, readonly TermKey[]>> = {
  // The job card asks how many a second; the dial is the back-of-the-envelope answer.
  estimateSet: ['requirements', 'requestsPerSecond', 'estimate'],
  // One box wired gateway to database: what one box can do.
  firstLive: ['capacity'],
  // The kit makes one box bigger.
  kitFitted: ['scalingUp'],
  // A second box on the rack: more boxes.
  secondBox: ['scalingOut'],
  // The crew's splitter shares the load between boxes.
  splitterRacked: ['loadBalancer'],
  // The splitter steps over a box that is dark.
  firstSkipped: ['healthChecks'],
  // The one big (overclocked) box goes dark and everything stops with it.
  bigBoxDark: ['singlePointOfFailure'],
  // Refreshes pile on top of the load.
  retriesRising: ['retryStorm'],
  // Cutting the laundry floor loose sheds load.
  laundryCut: ['loadShedding'],
  // Sizing for the midnight peak, not the evening.
  sizingSet: ['peakVsAverage'],
  // At midnight one box falls and the next follow (D2: the sim's one cascade).
  diesInAtMidnight: ['cascadingFailure'],
  // The dip took one box and the spare carried midnight.
  heldWithSpare: ['redundancy'],
  // Turning boxes off after the peak.
  decommission: ['scalingDown'],
};

export interface TaughtEntry {
  readonly term: TermKey;
  readonly group: TermGroup;
  /** The line that showed it, or null for a moment. */
  readonly line: LineId | null;
  /** The moment that showed it, or null for a line. */
  readonly moment: MomentKind | null;
  /** A number the moment carries (the dial value, the boxes at midnight), else null. */
  readonly value: number | null;
  /** Sim seconds it was seen. */
  readonly at: number;
  /** The in-world clock it was seen, hh:mm:ss. */
  readonly clock: string;
}

export type TaughtTrace = readonly TaughtEntry[];

export const EMPTY_TRACE: TaughtTrace = Object.freeze([]);

/** Where an entry comes from: a line or a moment, with the clock it was seen. */
export interface Seen {
  readonly line?: LineId;
  readonly moment?: MomentKind;
  readonly value?: number | null;
  readonly at: number;
  readonly clock: string;
}

/**
 * The trace with one entry per term in `terms` for this sighting, unless the trace already has that
 * term from the same line or moment (a line shown twice, a second decommission). Returns a new
 * array, or `trace` itself when nothing is new.
 */
export function addSeen(trace: TaughtTrace, terms: readonly TermKey[], seen: Seen): TaughtTrace {
  const line = seen.line ?? null;
  const moment = seen.moment ?? null;
  let out: TaughtEntry[] | null = null;
  for (const term of terms) {
    const have = (out ?? trace).some((e) => e.term === term && e.line === line && e.moment === moment);
    if (have) continue;
    out ??= [...trace];
    out.push({
      term,
      group: TERM_GROUP[term],
      line,
      moment,
      value: seen.value ?? null,
      at: seen.at,
      clock: seen.clock,
    });
  }
  return out ?? trace;
}

/** The trace after the band showed `id`: the terms lineMeta says it teaches, if any. */
export function seeLine(trace: TaughtTrace, id: LineId, at: number, clock: string): TaughtTrace {
  const terms = metaOf(id)?.teaches ?? [];
  return terms.length === 0 ? trace : addSeen(trace, terms, { line: id, at, clock });
}

/** The trace after a moment. */
export function seeMoment(
  trace: TaughtTrace,
  moment: MomentKind,
  at: number,
  clock: string,
  value: number | null = null,
): TaughtTrace {
  return addSeen(trace, MOMENT_TEACHES[moment], { moment, value, at, clock });
}

/** What of the frame an occurrence needs to be read as a moment. */
export type MomentFacts = Pick<Frame, 'parts' | 'midnight'>;

/** The moment an occurrence is, if it teaches anything; `f` is the frame it was seen on. */
export function momentOfOccurrence(o: Occurrence, f: MomentFacts): MomentKind | null {
  switch (o.kind) {
    case 'wired':
      // A wire into the database: a box is serving.
      return o.id?.endsWith('>database') ? 'firstLive' : null;
    case 'placed': {
      const servers = f.parts.filter((p) => p.kind === 'server').length;
      const placed = f.parts.find((p) => p.id === o.id);
      return placed?.kind === 'server' && servers >= 2 ? 'secondBox' : null;
    }
    case 'rescued':
      return 'splitterRacked';
    case 'skipped':
      return 'firstSkipped';
    case 'dark': {
      // With an id: a part went dark in a dip. Only the overclocked one is the big box.
      if (o.id === undefined) return null;
      const part = f.parts.find((p) => p.id === o.id);
      return part?.kind === 'server' && part.boost !== undefined ? 'bigBoxDark' : null;
    }
    case 'retriesRising':
      // Only the surge's pile-on: a blip of retries before the first box is wired teaches nothing.
      return o.at >= C.c4 ? 'retriesRising' : null;
    case 'laundryCut':
      return 'laundryCut';
    case 'hot':
      // A box over 100% in the midnight stretch reads DIES IN: the others are next.
      return o.at >= C.c6 ? 'diesInAtMidnight' : null;
    case 'held':
      return (f.midnight?.servers ?? 0) >= BROWNOUT.finalSizing.holds ? 'heldWithSpare' : null;
    default:
      return null;
  }
}

/** The moment a player action is, if it teaches anything. */
export function momentOfAction(a: GameEvents['action']): MomentKind | null {
  if (a.type === 'overclock') return 'kitFitted';
  if (a.type === 'decommission') return 'decommission';
  return null;
}

/** The terms the trace has an entry for, in the order they were first seen. */
export function termsSeen(trace: TaughtTrace): TermKey[] {
  const out: TermKey[] = [];
  for (const e of trace) if (!out.includes(e.term)) out.push(e.term);
  return out;
}

// ---- hud.measure ----

export interface MeasureState {
  /** The C1 dial answer (req/s) and the sim seconds it was set, or null. */
  estimate: number | null;
  estimateAt: number | null;
  /** The C6 sizing answer (boxes) and the sim seconds it was set, or null. */
  sizing: number | null;
  sizingAt: number | null;
  /** Wires on the board now, and the sim seconds the first wire went in (null before). */
  wires: number;
  firstWireAt: number | null;
}

export function emptyMeasure(): MeasureState {
  return { estimate: null, estimateAt: null, sizing: null, sizingAt: null, wires: 0, firstWireAt: null };
}

/**
 * The measure after the notes read `notes` at sim time `at`: an answer is stamped the first time it
 * is seen set, and keeps that stamp. Returns `m` itself when nothing changed, else a new object.
 */
export function measureNotes(m: MeasureState, notes: RunNotes, at: number): MeasureState {
  const estimate = notes.estimate !== null && m.estimate === null;
  const sizing = notes.sizing !== null && m.sizing === null;
  if (!estimate && !sizing) return m;
  return {
    ...m,
    estimate: estimate ? notes.estimate : m.estimate,
    estimateAt: estimate ? at : m.estimateAt,
    sizing: sizing ? notes.sizing : m.sizing,
    sizingAt: sizing ? at : m.sizingAt,
  };
}

// ---- the recorder: the bus and frame(run()) into the trace ----

/** The run's trace and measure, kept by the recorder. Read with taughtTrace() / taughtMeasure(). */
class TaughtRecorder {
  private runRef: Run | null = null;
  trace: TaughtTrace = EMPTY_TRACE;
  measure: MeasureState = emptyMeasure();

  constructor() {
    bus.on('line', (l) => {
      const f = this.sync();
      this.trace = seeLine(this.trace, l.id, f.now, f.clock);
    });
    bus.on('occurrence', (o) => {
      const f = this.sync();
      if (o.kind === 'wired' && this.measure.firstWireAt === null) {
        this.measure = { ...this.measure, firstWireAt: o.at };
      }
      const m = momentOfOccurrence(o, f);
      if (m) {
        const value = m === 'heldWithSpare' ? (f.midnight?.servers ?? null) : null;
        this.trace = seeMoment(this.trace, m, o.at, f.clock, value);
      }
    });
    bus.on('action', (a) => {
      const f = this.sync();
      const m = momentOfAction(a);
      if (m) this.trace = seeMoment(this.trace, m, f.now, f.clock);
    });
    // A SET changes only the notes, which no event carries: the cue table answers it on the same
    // frame (C1.triage.03/.04/.05, C6's reactions), and a perf sample comes at least once a second.
    bus.on('cue', () => this.sync());
    bus.on('perfSample', () => this.sync());
  }

  /** Whether the recorder is keeping `r`'s trace. */
  keeps(r: Run): boolean {
    return this.runRef === r;
  }

  /** Start over on a fresh run, stamp any dial answer newly set, and return this frame. */
  sync(): Frame {
    const r = run();
    if (r !== this.runRef) {
      this.runRef = r;
      this.trace = EMPTY_TRACE;
      this.measure = emptyMeasure();
    }
    const f = frame(r);
    const before = this.measure;
    this.measure = measureNotes(before, f.notes, f.now);
    if (this.measure.estimate !== null && before.estimate === null) {
      this.trace = seeMoment(this.trace, 'estimateSet', f.now, f.clock, this.measure.estimate);
    }
    if (this.measure.sizing !== null && before.sizing === null) {
      this.trace = seeMoment(this.trace, 'sizingSet', f.now, f.clock, this.measure.sizing);
    }
    if (this.measure.wires !== f.wires.length) this.measure = { ...this.measure, wires: f.wires.length };
    return f;
  }
}

const recorder = new TaughtRecorder();

/** The taught trace of the run in progress (empty for a run that has not started recording). */
export function taughtTrace(): TaughtTrace {
  return recorder.keeps(run()) ? recorder.trace : EMPTY_TRACE;
}

/** hud.measure for the run in progress. */
export function taughtMeasure(): MeasureState {
  return recorder.keeps(run()) ? recorder.measure : emptyMeasure();
}

declare module './hook' {
  interface HudTestState {
    /** The dial answers with when each was set, and the board's wires (learning-4). */
    measure?: MeasureState;
    /** The taught trace: each term the player has seen in practice, with the moment (learning-4). */
    taught?: TaughtEntry[];
  }
}

provideHudSection('measure', () => ({ ...taughtMeasure() }));
provideHudSection('taught', () => [...taughtTrace()]);
