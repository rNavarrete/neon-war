// Block chat and Lux's stream chat: the message log and the filler lines that keep both chats
// alive between scripted messages (docs/SCRIPT.md "Chat filler"), and the LIVE CHAT panel's look
// and layout (chat-4: rows bottom-up in the body, badges, the cause tick, the arrival fade). Pure;
// randomness comes from an injected generator so tests stay deterministic.

import { LINES, type LineId } from '../../strings';
import { type ErrorState } from './format';
import { RIGHT } from './layout';

export type ChatKind = 'block' | 'stream';

export interface ChatEntry {
  readonly id: LineId;
  /** Who wrote it (shown beside the avatar), e.g. "kenji" or "viewer". */
  readonly who: string;
  readonly text: string;
}

export const CHAT_ROWS = 6;
export const FILLER_MIN_SECONDS = 3.5;
export const FILLER_MAX_SECONDS = 6.5;

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

// ---- the LIVE CHAT panel (chat-4): how a row looks and where it sits ----

/** The rows' body inside ZONES.chat (src/scenes/hud/layout.ts RIGHT.chatBody: x 1545-1890, y 840-1060). */
export const CHAT_BODY = Object.freeze({ ...RIGHT.chatBody });

/** The header strip over the body: ZONES.chat's top 40 px; a click there toggles BLOCK ONLY. */
export const CHAT_HEADER = Object.freeze({
  x: RIGHT.chat.x,
  y: RIGHT.chat.y,
  w: RIGHT.chat.w,
  h: CHAT_BODY.y - RIGHT.chat.y,
});

/** A row's badge (a painted avatar for residents, a ring for viewers), in px. */
export const ROW_AVATAR = 32;
/** The words start this far right of the body's left edge (tick, badge, gap). */
export const ROW_TEXT_X = 48;
/** The name line, then each 14 px message line. */
export const ROW_NAME_H = 15;
export const ROW_LINE_H = 17;
/** Space under each row. */
export const ROW_GAP = 4;
/**
 * A message this long or shorter fits one line of the 297 px column at 14 px; a longer one wraps to
 * two, never more (the view sets maxLines from rowLines). Conservative, so a one-line row never wraps.
 */
export const ONE_LINE_CHARS = 34;

/** The handles viewers post under in Lux's stream (05-comms "Live chat"). */
export const VIEWER_HANDLES: readonly string[] = [
  'kiro_',
  'noodlecam',
  'ghost.exe',
  'rainproxy',
  'void99',
  'tokyo.exe',
];

/** What the panel needs from a chat row (chatEngine.ts ChatRow). */
export interface PanelRow {
  readonly id: LineId;
  readonly chat: ChatKind;
  readonly who: string;
  readonly text: string;
  readonly cause: string;
  readonly at: number;
  readonly complaint: boolean;
  readonly thanks: boolean;
  readonly system: boolean;
}

/** How many lines a row's message takes in the panel: 1 or 2. */
export function rowLines(text: string): 1 | 2 {
  return text.length <= ONE_LINE_CHARS ? 1 : 2;
}

/** A row's height in the panel, gap included: 36 for one line (the badge's height), 53 for two. */
export function rowHeight(text: string): number {
  return Math.max(ROW_AVATAR, ROW_NAME_H + rowLines(text) * ROW_LINE_H) + ROW_GAP;
}

/**
 * The newest rows that fit the body, oldest first: walking back from the newest, take rows while
 * their heights fit `bodyH`, at most `max`. Four or five rows in practice.
 */
export function fitRows<T extends { readonly text: string }>(
  rows: readonly T[],
  max: number,
  bodyH: number = CHAT_BODY.h,
): T[] {
  let used = 0;
  let first = rows.length;
  for (let i = rows.length - 1; i >= 0 && rows.length - i <= max; i--) {
    const h = rowHeight(rows[i].text);
    if (used + h > bodyH) break;
    used += h;
    first = i;
  }
  return rows.slice(first);
}

/**
 * The top y of each row in game pixels, oldest first, stacked bottom-up: the newest sits on the
 * body's bottom edge. Writes into `out` (the view passes its one array) and returns it.
 */
export function stackRows(
  heights: readonly number[],
  body: { readonly y: number; readonly h: number } = CHAT_BODY,
  out: number[] = [],
): number[] {
  out.length = heights.length;
  let bottom = body.y + body.h;
  for (let i = heights.length - 1; i >= 0; i--) {
    bottom -= heights[i];
    out[i] = bottom;
  }
  return out;
}

/** A viewer's handle for a stream row: fixed per line id, so a row never changes name. */
export function handleFor(id: LineId): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return VIEWER_HANDLES[h % VIEWER_HANDLES.length];
}

/** The name the chat posts its own notices under (someone left or joined). */
export const SYSTEM_NAME = 'Lux_Net';

export type TickColor = 'red' | 'amber' | 'cyan';

/** How a row is drawn: its name, its badge and its cause tick. */
export interface RowLook {
  readonly name: string;
  /** The resident's avatar key (src/scenes/avatars.ts BLOCK_AVATARS), or null. */
  readonly avatar: string | null;
  /** A ring with the name's initial: cyan for a viewer, amber for a neighbour with no painted face. */
  readonly ring: 'cyan' | 'amber' | null;
  readonly initial: string;
  /** A system row's amber rule in place of a face. */
  readonly rule: boolean;
  /** Amber for the block, cyan for the stream. */
  readonly nameColor: 'amber' | 'cyan';
  readonly tick: TickColor;
}

const RED_CAUSES: ReadonlySet<string> = new Set(['errorsRising', 'errorsHeavy', 'retriesRising']);
const AMBER_CAUSES: ReadonlySet<string> = new Set(['recovered', 'held']);

/** The 2 px cause tick: red for a complaint or an errors row, amber for thanks or a recovery. */
export function tickOf(row: Pick<PanelRow, 'cause' | 'complaint' | 'thanks'>): TickColor {
  if (row.complaint || RED_CAUSES.has(row.cause)) return 'red';
  if (row.thanks || AMBER_CAUSES.has(row.cause)) return 'amber';
  return 'cyan';
}

/**
 * How a row is drawn: residents with their painted avatar (`avatars`, keyed by the speaker's name)
 * and an amber name; viewers with a cyan ring, an initial and a handle; system rows with the rule
 * and SYSTEM_NAME. Never a plain dot.
 */
export function rowLook(row: PanelRow, avatars: Readonly<Record<string, string>>): RowLook {
  const tick = tickOf(row);
  if (row.system) {
    return { name: SYSTEM_NAME, avatar: null, ring: null, initial: '', rule: true, nameColor: 'amber', tick };
  }
  if (row.chat === 'stream') {
    const name = handleFor(row.id);
    return {
      name,
      avatar: null,
      ring: 'cyan',
      initial: name[0].toUpperCase(),
      rule: false,
      nameColor: 'cyan',
      tick,
    };
  }
  const avatar = avatars[row.who.toLowerCase()] ?? null;
  return {
    name: row.who,
    avatar,
    ring: avatar ? null : 'amber',
    initial: avatar ? '' : (row.who[0] ?? '?').toUpperCase(),
    rule: false,
    nameColor: 'amber',
    tick,
  };
}

/** The newest row fades in over this many seconds of HUD clock; at once under reduce flicker. */
export const ARRIVAL_FADE = 0.15;

/** The newest row's alpha `age` seconds after it posted: no tween at all under reduce flicker. */
export function arrivalAlpha(age: number, reduceFlicker: boolean): number {
  if (reduceFlicker || age >= ARRIVAL_FADE) return 1;
  return Math.max(0, age / ARRIVAL_FADE);
}

/** Rows sit back to this alpha while the chat is silent (dark at midnight, until the rewind). */
export const SILENCED_ALPHA = 0.4;
