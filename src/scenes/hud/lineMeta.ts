// What each spoken or chat line is for, beside its words in src/strings.ts: the tag the comms band
// shows (HINT, WARNING, CREW, LUX, HOUSE), whether it is one of the lesson lines (never cut short,
// never dropped stale, a 2 s quiet in the chat, a moment in the debrief's taught trace), what it
// points at on screen (the leader line's subject) and which of the debrief's terms it teaches
// without naming them. Pure data and lookups: no Phaser, no clock.
//
// The terms themselves are named only in the debrief (docs/SCRIPT.md C8.terms.*); nothing here is
// drawn, and the keys below are code identifiers, not on-screen words.

import type { LineTag } from '../../game/bus';
import { LINES, type LineId } from '../../strings';
import type { CardId, ZoneId } from '../live/layout';

export type { LineTag };

/** Every tag the band can show, in slot order. */
export const LINE_TAGS: readonly LineTag[] = ['HINT', 'WARNING', 'CREW', 'LUX', 'HOUSE'];

/**
 * A part a line points at that the board decides at the moment it is said, rather than a fixed id:
 * the server sitting idle, the one overheating, the one dark in a power dip, the one with the
 * overclock kit, and the crew's balancer (racked as 'balancer' by the crew or under a placed id).
 * The comms band resolves a role on the Frame; any other `part:` subject is a part id ('gateway',
 * 'database').
 */
export const PART_ROLES = ['idle', 'hot', 'dark', 'overclocked', 'balancer'] as const;
export type PartRole = (typeof PART_ROLES)[number];

/** The deck's keys, as the deck lane names them (1 REGROUP, 2 CUT 3F). */
export type KeyName = 'one' | 'two';

/** What a line points at: a part (by id or role), a zone or card of the Live screen, a deck key, or nothing. */
export type Subject =
  `part:${PartRole | 'gateway' | 'database'}` | `zone:${ZoneId | CardId}` | `key:${KeyName}` | null;

/** The debrief's bold terms (docs/SCRIPT.md C8.terms.*), as code keys, in the order the debrief names them. */
export const TERM_KEYS = [
  'requirements',
  'requestsPerSecond',
  'capacity',
  'estimate',
  'headroom',
  'peakVsAverage',
  'scalingUp',
  'scalingOut',
  'loadBalancer',
  'healthChecks',
  'scalingDown',
  'singlePointOfFailure',
  'cascadingFailure',
  'retryStorm',
  'loadShedding',
  'redundancy',
] as const;
export type TermKey = (typeof TERM_KEYS)[number];

/** The debrief's three term groups. */
export type TermGroup = 'sizing' | 'scaling' | 'failure';

/** Which group (C8.terms.sizing, .scaling, .failure) names each term. */
export const TERM_GROUP: Readonly<Record<TermKey, TermGroup>> = {
  requirements: 'sizing',
  requestsPerSecond: 'sizing',
  capacity: 'sizing',
  estimate: 'sizing',
  headroom: 'sizing',
  peakVsAverage: 'sizing',
  scalingUp: 'scaling',
  scalingOut: 'scaling',
  loadBalancer: 'scaling',
  healthChecks: 'scaling',
  scalingDown: 'scaling',
  singlePointOfFailure: 'failure',
  cascadingFailure: 'failure',
  retryStorm: 'failure',
  loadShedding: 'failure',
  redundancy: 'failure',
};

export interface LineMeta {
  readonly tag: LineTag;
  /** One of the lesson lines: never cut short or stale-dropped; quiets the chat; joins the taught trace. */
  readonly lesson: boolean;
  /** What the band's leader line points at while the line shows. */
  readonly subject: Subject;
  /** The debrief terms this line shows in practice, before they are named. */
  readonly teaches: readonly TermKey[];
}

/** Every TRIAGE (panicking) bark: the band lets these cut a HINT short. */
export const WARNING_IDS: readonly LineId[] = [
  'C3.triage.04',
  'C4.triage.01',
  'C4.triage.02',
  'C4.triage.03',
  'C6.triage.02',
];

/** The lesson lines: where the night's lesson is said in the crew's words. */
export const LESSON_IDS: readonly LineId[] = [
  'C1.triage.06',
  'C2.triage.after',
  'C3.triage.01',
  'C3.lux.01',
  'C4.triage.03',
  'C4.triage.cut',
  'C5.triage.03',
  'C5.mika.05',
  'C6.triage.01',
  'C7.ozzie.01',
  'C7.triage.01',
];

/**
 * Lines whose band line draws a leader to something on screen, and to what. Lines not listed point
 * at nothing.
 */
export const LEADER_FOR: Readonly<Partial<Record<LineId, Exclude<Subject, null>>>> = {
  // TRIAGE's 30, at the gauge that reads it.
  'C1.triage.03': 'zone:gauge',
  'C1.triage.05': 'zone:inventory',
  'C1.triage.06': 'zone:gauge',
  'C2.triage.pay': 'zone:scope',
  'C2.triage.after': 'zone:gauge',
  'C3.triage.01': 'zone:inventory',
  'C3.triage.02': 'part:idle',
  'C3.lux.01': 'part:gateway',
  'C3.triage.03': 'part:overclocked',
  'C3.triage.04': 'part:hot',
  'C4.triage.01': 'zone:alert',
  // The cut key, pointed at inside its window.
  'C4.lux.01': 'key:two',
  'C4.triage.02': 'part:dark',
  'C4.triage.03': 'zone:gauge',
  'C4.triage.04': 'part:database',
  'C4.triage.cut': 'zone:gauge',
  'C5.triage.03': 'zone:gauge',
  'C5.rei.05': 'part:balancer',
  'C5.mika.05': 'zone:scope',
  // The midnight forecast and its outage sub-line.
  'C6.rei.01': 'zone:alert',
  'C6.triage.01': 'zone:alert',
  'C6.triage.02': 'part:dark',
  // The credits chip in the title cluster.
  'C7.ozzie.01': 'zone:title',
  'C7.triage.01': 'zone:alert',
};

/** The debrief terms each line shows before they are named. Lines not listed teach nothing on their own. */
export const TEACHES: Readonly<Partial<Record<LineId, readonly TermKey[]>>> = {
  // 120 flats every 4 s is 30 a second: the job card's sum, owned up to as the gauge reads it.
  'C1.triage.03': ['requirements', 'requestsPerSecond', 'estimate'],
  'C1.triage.06': ['capacity', 'headroom'],
  'C2.triage.after': ['headroom'],
  'C3.triage.01': ['scalingUp', 'scalingOut'],
  'C3.lux.01': ['scalingOut', 'loadBalancer'],
  'C4.triage.02': ['singlePointOfFailure'],
  'C4.triage.03': ['retryStorm'],
  'C4.triage.cut': ['loadShedding'],
  'C5.triage.03': ['requestsPerSecond', 'scalingOut'],
  'C5.mika.05': ['headroom'],
  'C6.triage.01': ['requestsPerSecond', 'peakVsAverage'],
  // With the database beat retired (D2), the midnight dip is where one part falls and the next follow.
  'C6.triage.02': ['cascadingFailure', 'redundancy'],
  'C7.ozzie.01': ['scalingDown'],
  'C7.triage.01': ['scalingDown'],
};

const NO_TERMS: readonly TermKey[] = [];

/** The band tag for a line, from its speaker as docs/SCRIPT.md writes it. */
export function tagForSpeaker(speaker: string): LineTag {
  if (speaker.startsWith('TRIAGE')) return speaker.includes('panicking') ? 'WARNING' : 'HINT';
  if (speaker === 'Lux') return 'LUX';
  if (speaker === 'Rei' || speaker === 'Mika' || speaker === 'Ozzie') return 'CREW';
  // Grandma through the door, the TV downstairs, and the block and the stream: the house's voices.
  return 'HOUSE';
}

/** Kinds of line that get a row: the board's barks and both chats (scene and ui lines never reach the band). */
const META_KINDS = new Set(['bark', 'chat', 'block', 'stream']);

function buildMeta(): Readonly<Partial<Record<LineId, LineMeta>>> {
  const out: Partial<Record<LineId, LineMeta>> = {};
  for (const id of Object.keys(LINES) as LineId[]) {
    const l = LINES[id];
    if (!META_KINDS.has(l.kind)) continue;
    out[id] = Object.freeze({
      tag: l.kind === 'bark' ? tagForSpeaker(l.speaker) : 'HOUSE',
      lesson: LESSON_IDS.includes(id),
      subject: LEADER_FOR[id] ?? null,
      teaches: TEACHES[id] ?? NO_TERMS,
    });
  }
  return Object.freeze(out);
}

/** One row per bark and chat line in src/strings.ts. */
export const LINE_META: Readonly<Partial<Record<LineId, LineMeta>>> = buildMeta();

/** A line's row, or null for a scene or ui line. */
export function metaOf(id: LineId): LineMeta | null {
  return LINE_META[id] ?? null;
}

/** The band tag for a line; scene and ui lines read by their speaker. */
export function tagOf(id: LineId): LineTag {
  return LINE_META[id]?.tag ?? tagForSpeaker(LINES[id].speaker);
}

/** Whether a line is one of the lesson lines. */
export function isLesson(id: LineId): boolean {
  return LINE_META[id]?.lesson ?? false;
}
