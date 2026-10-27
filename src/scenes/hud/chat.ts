// Block chat and Lux's stream chat: the message log and the filler lines that keep both chats
// alive between scripted messages (docs/SCRIPT.md "Chat filler"). Pure; randomness comes from an
// injected generator so tests stay deterministic.

import { LINES, type LineId } from '../../strings';
import { type ErrorState } from './format';

export type ChatKind = 'block' | 'stream';

export interface ChatEntry {
  readonly id: LineId;
  /** Who wrote it (shown beside the avatar), e.g. "kenji" or "viewer". */
  readonly who: string;
  readonly text: string;
}

export const CHAT_ROWS = 6;
export const FILLER_MIN_SECONDS = 6;
export const FILLER_MAX_SECONDS = 10;

/** A small seeded random generator (mulberry32), returning numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which chat a line belongs in, or null for lines that aren't chat. */
export function chatOf(id: LineId): ChatKind | null {
  const l = LINES[id];
  if (l.kind === 'block' || l.kind === 'stream') return l.kind;
  if (l.kind !== 'chat') return null;
  return l.speaker.startsWith('stream') ? 'stream' : 'block';
}

/** A chat line as an entry: scripted lines name the writer in the speaker, filler in the text. */
export function chatEntry(id: LineId): ChatEntry {
  const l = LINES[id];
  if (l.kind === 'block') {
    const i = l.text.indexOf(': ');
    return { id, who: l.text.slice(0, i), text: l.text.slice(i + 2) };
  }
  if (l.kind === 'stream') return { id, who: 'viewer', text: l.text };
  const m = /^(?:block|stream)(?::\s*(.+)|\s*\((.+)\))$/.exec(l.speaker);
  return { id, who: m?.[1] ?? m?.[2] ?? l.speaker, text: l.text };
}

/** The log with one more message, keeping the newest `max`. */
export function pushChat(log: readonly ChatEntry[], entry: ChatEntry, max = CHAT_ROWS): ChatEntry[] {
  const next = [...log, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

const FILLER_IDS = (Object.keys(LINES) as LineId[]).filter((id) => id.startsWith('fill.'));

/** The filler lines for one chat in one error state. */
export function fillerPool(chat: ChatKind, state: ErrorState): LineId[] {
  return FILLER_IDS.filter((id) => id.startsWith(`fill.${chat}.${state}.`));
}

/** Pick a filler line, avoiding the last one shown when the pool allows. */
export function pickFiller(
  chat: ChatKind,
  state: ErrorState,
  rand: () => number,
  last: LineId | null = null,
): LineId {
  const pool = fillerPool(chat, state);
  const options = pool.length > 1 && last ? pool.filter((id) => id !== last) : pool;
  return options[Math.min(options.length - 1, Math.floor(rand() * options.length))];
}

/** Seconds until the next filler line: 6 to 10. */
export function fillerDelay(rand: () => number): number {
  return FILLER_MIN_SECONDS + rand() * (FILLER_MAX_SECONDS - FILLER_MIN_SECONDS);
}

/** Avatar file stem for a neighbour's name, or null when the writer has no painted avatar. */
export function avatarFor(who: string): string | null {
  const stem = who.toLowerCase().replace(/\s+/g, '-');
  return ['kenji', 'mrs-okafor', 'young-father', 'old-man-noodles'].includes(stem) ? stem : null;
}
