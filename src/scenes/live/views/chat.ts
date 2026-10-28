// LIVE CHAT's section of the read-only test hook (chat-3): hud.chat (the merged feed as the engine
// holds it and the panel draws it) beside the legacy block and stream lists, and hud.audience (the
// mirror of bus `audience`, which the chat view emits on every viewersOf change). Test mirror only:
// nothing reads it back; the title hears the audience through the bus.

import type Phaser from 'phaser';
import type { LineId } from '../../../strings';
import type { ChatKind, TickColor } from '../../hud/chat';
import type { ChatCause, ChatFilter, ChatRow, ChatState } from '../../hud/chatEngine';
import { visibleRows } from '../../hud/chatEngine';
import { type PagePoint, provideHudSection } from '../../hud/hook';

/** One row of the feed, as the engine posted it. */
export interface ChatFeedRowState {
  id: LineId;
  chat: ChatKind;
  who: string;
  text: string;
  cause: ChatCause;
  /** HUD clock it posted. */
  at: number;
  scripted: boolean;
  complaint: boolean;
  thanks: boolean;
  system: boolean;
}

/** One row as the panel draws it, in game pixels. */
export interface ChatDrawnRow {
  id: LineId;
  chat: ChatKind;
  /** The name shown: the resident, the viewer's handle, or Lux_Net for a system row. */
  name: string;
  /** Its colour: amber for the block, cyan for the stream. */
  nameColor: 'amber' | 'cyan';
  /** The painted avatar's manifest key, or null (a ring or the rule instead). */
  avatar: string | null;
  ring: 'cyan' | 'amber' | null;
  rule: boolean;
  tick: TickColor;
  /** 1 or 2 lines of words. */
  lines: number;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
}

export interface ChatTestState {
  /** The legacy lists hud.spec and story.spec read: each chat's newest rows as "who: text". */
  block: string[];
  stream: string[];
  /** Every row posted this run (the newest 40), oldest first. */
  feed: ChatFeedRowState[];
  /** How many rows the panel shows: visibleRows(feed, filter).length. */
  shown: number;
  /** The last thing the chat heard: 'occurrence:<kind>', 'line:<id>', 'action:<type>', 'cue:<id>', 'rewind', 'seed'. */
  lastEvent: string | null;
  /** HUD clock the lesson quiet runs to, or null when none has started. */
  quietUntil: number | null;
  /** Dark at midnight, until the rewind. */
  silenced: boolean;
  /** Neighbours who left the chat. */
  left: string[];
  /** Rows posted this run, in all. */
  posts: number;
  /** The HUD clock the chat last stepped at. */
  clock: number;
  filter: ChatFilter;
  /** The header: its words and tag, and the point to click (page CSS pixels) to toggle BLOCK ONLY. */
  header: { title: string; tag: string } & PagePoint;
  /** What the panel draws now, oldest first (game pixels). */
  rows: ChatDrawnRow[];
  /** Reactions waiting to post. */
  queue: number;
}

export interface AudienceTestState {
  /** The last bus audience value: null until the first viewersOf change, then 0..4. */
  watching: number | null;
}

declare module '../../hud/hook' {
  interface HudTestState {
    /** The chat's audience (chat-3), mirrored from bus `audience`. */
    audience?: AudienceTestState;
  }
}

const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

/** "who: text" for the legacy lists. */
const legacy = (r: ChatRow): string => `${r.who}: ${r.text}`;

/** The legacy lists keep each chat's newest six rows, as the old chat column did. */
export const LEGACY_ROWS = 6;

/** What the chat's hook reads from the view, besides the engine state. */
export interface ChatHookInputs {
  readonly state: ChatState;
  readonly posts: number;
  readonly lastEvent: string | null;
  readonly clock: number;
  readonly header: { title: string; tag: string } & PagePoint;
  readonly rows: readonly ChatDrawnRow[];
}

/** hud.chat from the engine's state and what the panel draws. Pure; built only when the hook is read. */
export function chatSection(h: ChatHookInputs): ChatTestState {
  const s = h.state;
  const block: string[] = [];
  const stream: string[] = [];
  for (const r of s.feed) (r.chat === 'block' ? block : stream).push(legacy(r));
  return {
    block: block.slice(Math.max(0, block.length - LEGACY_ROWS)),
    stream: stream.slice(Math.max(0, stream.length - LEGACY_ROWS)),
    feed: s.feed.map((r) => ({ ...r })),
    shown: visibleRows(s.feed, s.filter).length,
    lastEvent: h.lastEvent,
    quietUntil: finite(s.quietUntil),
    silenced: s.silenced,
    left: [...s.left],
    posts: h.posts,
    clock: h.clock,
    filter: s.filter,
    header: { ...h.header },
    rows: h.rows.map((r) => ({ ...r })),
    queue: s.queue.length,
  };
}

/** Mirror the chat as hud.chat and its audience as hud.audience; returns the function that takes both out. */
export function provideChatHook(
  scene: Phaser.Scene,
  read: () => ChatTestState,
  audience: () => AudienceTestState,
): () => void {
  const offChat = provideHudSection('chat', read);
  const offAudience = provideHudSection('audience', audience);
  return () => {
    offChat();
    offAudience();
  };
}
