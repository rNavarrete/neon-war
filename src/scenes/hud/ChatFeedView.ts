// LIVE CHAT (ZONES.chat) as a Live screen view: the block's chat and Lux's stream merged into one
// caused feed (chatEngine.ts), and the tiny honest audience.
//
// ChatFeed is the controller (chat-3), Phaser-free: one ChatState fed each frame by the shared Frame
// (chatInputsOf: never run().flow) and the host loop's occurrences, plus what it hears on the bus
// between frames: `cue` chat ids post at once through postScripted, `line` starts the 2 s lesson
// quiet, `action` overclock and banner react. It seeds the four C0 phone messages when the board
// opens and again on a rewind (play.rewinds grows), and starts over on a new run (reset). Every
// viewersOf change goes out as bus `audience {watching}`; hud.audience mirrors it.
//
// ChatFeedView draws it (chat-4): the painted plate the size of the zone; a header with LIVE CHAT and
// the BLOCK + STREAM / BLOCK ONLY tag (a click on the header toggles it, the only click); and the
// newest four or five rows that fit the body (visibleRows(feed, filter)), laid out bottom-up. Block
// rows show the resident's painted round avatar and an amber name, stream rows a cyan ring with the
// handle's initial, system rows an amber rule and Lux_Net; every row has its 2 px cause tick and its
// words, never hearts. Five pooled row slots, redrawn only when the feed, the filter or the silence
// changes; the newest row fades in over 150 ms of HUD clock, at once under reduce flicker; rows sit
// back to alpha 0.4 while the chat is silent.
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import type { Occurrence } from '../../game/occurrences';
import { settings } from '../../game/settings';
import type { LineId } from '../../strings';
import { type AvatarScene, BLOCK_AVATARS, preloadAvatars, roundAvatar } from '../avatars';
import { type Rect, pagePoint } from '../live/layout';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import { type ChatDrawnRow, type ChatTestState, chatSection, provideChatHook } from '../live/views/chat';
import {
  CHAT_BODY,
  CHAT_HEADER,
  ROW_AVATAR,
  ROW_GAP,
  ROW_NAME_H,
  ROW_TEXT_X,
  SILENCED_ALPHA,
  type TickColor,
  arrivalAlpha,
  rowHeight,
  rowLines,
  rowLook,
  seededRandom,
  stackRows,
} from './chat';
import {
  type ChatEvent,
  type ChatFilter,
  type ChatRow,
  type ChatState,
  type ChatStep,
  VISIBLE_ROWS,
  chatInputsOf,
  emptyChatInputs,
  initialChat,
  postScripted,
  seedChat,
  stepChat,
  toggleFilter,
  visibleRows,
} from './chatEngine';
import { provideHudSection } from './hook';
import { COLORS, FONT, FONT_SANS } from './layout';
import { isLesson } from './lineMeta';
import { panel } from './panel';

/** Seed for the chat's randomness, so a run's chat is the same every time (and in tests). */
export const CHAT_SEED = 20261231;

/** The header's words (UI micro-copy, not lines). */
export const CHAT_TEXT = Object.freeze({
  title: 'LIVE CHAT',
  all: 'BLOCK + STREAM',
  block: 'BLOCK ONLY',
});

/** The header tag for a filter. */
export const headerTag = (filter: ChatFilter): string =>
  filter === 'block' ? CHAT_TEXT.block : CHAT_TEXT.all;

// ---- the trace (chat-5): what the chat stepped on, as edges, for the browser spec ----

/** One spell of errors as the chat saw it (Frame.errorShare > 0), on the HUD clock. */
export interface ChatErrorSpell {
  from: number;
  /** When the errors stopped, or null while they still run. */
  to: number | null;
}

/** The retries level as the chat saw it climb past a step (TRACE_RETRY_STEP), on the HUD clock. */
export interface ChatRetryMark {
  at: number;
  retry: number;
}

/**
 * hud.chatTrace: the error spells and retry climbs the chat stepped on, so a spec can order rows
 * against them (a complaint after the errors start, the thanks after they stop) on the same clock.
 * A test mirror: nothing reads it back.
 */
export interface ChatTraceTestState {
  /** The last TRACE_KEEP spells, oldest first. */
  errors: ChatErrorSpell[];
  /** The last TRACE_KEEP retry climbs, oldest first. */
  retries: ChatRetryMark[];
}

declare module './hook' {
  interface HudTestState {
    /** The chat's trace (chat-5). */
    chatTrace?: ChatTraceTestState;
  }
}

/** Spells and climbs the trace keeps. */
export const TRACE_KEEP = 16;
/** A retry climb is marked each time the level passes a multiple of this. */
export const TRACE_RETRY_STEP = 0.1;

/** The trace's working state: edges only, so a quiet frame changes nothing. */
export interface ChatTrace {
  readonly errors: readonly ChatErrorSpell[];
  readonly retries: readonly ChatRetryMark[];
  /** The highest retry step marked since retries were last at 0. */
  readonly retryStep: number;
}

export const EMPTY_TRACE: ChatTrace = Object.freeze({ errors: [], retries: [], retryStep: 0 });

const keepLast = <T>(list: readonly T[], item: T): T[] => {
  const next = [...list, item];
  return next.length > TRACE_KEEP ? next.slice(next.length - TRACE_KEEP) : next;
};

/**
 * One frame of the trace. Pure: returns `t` itself unless an error spell starts or stops or the
 * retries climb past a new step (so it allocates on those edges only); a rewind clock drop is not
 * special, the spells simply carry their own times.
 */
export function traceStep(t: ChatTrace, clock: number, errorShare: number, retry: number): ChatTrace {
  let next = t;
  const open = t.errors.length > 0 && t.errors[t.errors.length - 1].to === null;
  if (errorShare > 0 && !open) next = { ...next, errors: keepLast(next.errors, { from: clock, to: null }) };
  else if (errorShare <= 0 && open) {
    const errors = next.errors.slice();
    errors[errors.length - 1] = { from: errors[errors.length - 1].from, to: clock };
    next = { ...next, errors };
  }
  const step = Math.floor(retry / TRACE_RETRY_STEP + 1e-9);
  if (retry <= 0 && t.retryStep !== 0) next = { ...next, retryStep: 0 };
  else if (step > t.retryStep) {
    next = { ...next, retryStep: step, retries: keepLast(next.retries, { at: clock, retry }) };
  }
  return next;
}

/**
 * The chat's controller: the engine state, what it heard on the bus since the last frame, the
 * audience it last announced. Phaser-free; the view hosts one.
 */
export class ChatFeed {
  /** The engine's state; replaced, never mutated. */
  state: ChatState;
  /** Rows posted this run, in all. */
  posts = 0;
  /** The last thing the chat heard, for the hook. */
  lastEvent: string | null = null;
  /** The HUD clock the chat last stepped at. */
  clock = 0;
  /** The last audience announced on the bus: null until the first viewersOf change. */
  watching: number | null = null;
  /** The error spells and retry climbs stepped on (hud.chatTrace). */
  trace: ChatTrace = EMPTY_TRACE;

  private rand: () => number;
  private bus: Bus | null = null;
  private off: (() => void)[] = [];
  /** What the bus said since the last frame; handed to the engine on the next step. */
  private pending: ChatEvent[] = [];
  /** This frame's events, one array reused every step. */
  private readonly events: ChatEvent[] = [];
  private readonly inputs = emptyChatInputs();
  /** The engine's audience after the last step, to announce only changes. */
  private lastWatching: number;
  /** Rewinds seen, to reseed once per rewind. */
  private rewinds = 0;

  constructor(
    clock = 0,
    private readonly seed = CHAT_SEED,
  ) {
    this.rand = seededRandom(seed);
    this.state = initialChat(clock, this.rand);
    this.lastWatching = this.state.watching;
    this.apply(seedChat(this.state, clock, this.rand), 'seed');
  }

  /** Listen on the bus: cue, line and action. Call detach (the view's shutdown) to stop. */
  attach(bus: Bus): void {
    this.detach();
    this.bus = bus;
    this.off.push(
      bus.on('cue', (c) => {
        if (c.kind === 'chat') this.post(c.id, c.at);
      }),
      bus.on('line', (l) => {
        this.pending.push({ kind: 'line', id: l.id, lesson: isLesson(l.id) });
      }),
      bus.on('action', (a) => {
        if (a.type === 'overclock') this.pending.push({ kind: 'action', type: 'overclock' });
        else if (a.type === 'banner') this.pending.push({ kind: 'action', type: 'banner', choice: a.choice });
      }),
    );
  }

  /** Stop listening (so a restarted scene never hears a cue twice). */
  detach(): void {
    for (const off of this.off) off();
    this.off = [];
    this.bus = null;
  }

  /** How many bus handlers are attached (tests). */
  get listening(): number {
    return this.off.length;
  }

  /** A new run at HUD clock `clock`: a fresh chat, seeded with the phone messages. */
  reset(clock: number): void {
    this.rand = seededRandom(this.seed);
    this.state = initialChat(clock, this.rand);
    this.pending = [];
    this.posts = 0;
    this.trace = EMPTY_TRACE;
    this.clock = clock;
    this.rewinds = 0;
    this.lastEvent = null;
    // The audience starts again at the engine's first value; announce it only if the title shows another.
    this.lastWatching = this.state.watching;
    if (this.watching !== null && this.watching !== this.lastWatching) this.announce(this.lastWatching);
    this.apply(seedChat(this.state, clock, this.rand), 'seed');
  }

  /** A scripted chat id the cue table fired: posts at once, once (C6.fail.chat silences instead). */
  post(id: LineId, at: number): void {
    this.apply(postScripted(this.state, id, at, this.rand), `cue:${id}`);
  }

  /** The header click: BLOCK + STREAM <-> BLOCK ONLY. */
  toggle(): void {
    this.state = toggleFilter(this.state);
  }

  /**
   * One frame: this frame's occurrences and what the bus said, the Frame's inputs, then the engine.
   * A rewind (play.rewinds grows) lets scripted ids post again and reseeds the phone messages.
   * Nothing is allocated on a quiet frame beyond what stepChat needs.
   */
  step(f: Frame, clock: number, occurrences: readonly Occurrence[]): void {
    this.clock = clock;
    const ev = this.events;
    ev.length = 0;
    if (this.pending.length > 0) {
      for (let i = 0; i < this.pending.length; i++) ev.push(this.pending[i]);
      this.pending.length = 0;
    }
    for (let i = 0; i < occurrences.length; i++) ev.push({ kind: 'occurrence', occurrence: occurrences[i] });
    if (ev.length > 0) this.lastEvent = describe(ev[ev.length - 1]);
    const inputs = chatInputsOf(f, clock, this.inputs);
    this.trace = traceStep(this.trace, clock, inputs.errorShare, inputs.retry);
    this.apply(stepChat(this.state, inputs, ev, this.rand), null);
    if (inputs.rewinds > this.rewinds) {
      this.rewinds = inputs.rewinds;
      this.state = { ...this.state, scripted: [] };
      this.lastEvent = 'rewind';
      this.apply(seedChat(this.state, clock, this.rand), null);
    }
    ev.length = 0;
  }

  private apply(step: ChatStep, event: string | null): void {
    if (step.state === this.state) return;
    this.state = step.state;
    this.posts += step.posts.length;
    if (event) this.lastEvent = event;
    if (this.state.watching !== this.lastWatching) {
      this.lastWatching = this.state.watching;
      this.announce(this.lastWatching);
    }
  }

  private announce(watching: number): void {
    this.watching = watching;
    this.bus?.emit('audience', { watching });
  }
}

function describe(e: ChatEvent): string {
  if (e.kind === 'occurrence') return `occurrence:${e.occurrence.kind}`;
  if (e.kind === 'line') return `line:${e.id}`;
  return `action:${e.type}`;
}

/** The header's centre, in game pixels. */
const HEADER_AT = { x: CHAT_HEADER.x + CHAT_HEADER.w / 2, y: CHAT_HEADER.y + CHAT_HEADER.h / 2 };

const onRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export class ChatFeedView implements LiveView {
  readonly zone = 'chat' as const;
  readonly budget: LiveBudget = { objects: 31, texts: 17 };

  /** The controller; outlives create/shutdown so the HUD can reset it before the view is built. */
  readonly feed = new ChatFeed();
  private scene: Phaser.Scene | null = null;
  private root: Phaser.GameObjects.Container | null = null;
  private plate: Phaser.GameObjects.NineSlice | null = null;
  private tagText: Phaser.GameObjects.Text | null = null;
  private chrome: Phaser.GameObjects.Graphics | null = null;
  /** The pooled row slots, oldest on top; never more than VISIBLE_ROWS. */
  private slots: RowSlot[] = [];
  /** Avatar textures by manifest key, baked once in create. */
  private avatarTextures: Record<string, string> = {};
  private off: (() => void)[] = [];
  /** What is drawn now, so update only redraws on a change. */
  private drawnFeed: ChatState['feed'] | null = null;
  private drawnFilter: ChatFilter | null = null;
  private drawnSilenced: boolean | null = null;
  /** The rows drawn now, for the hook (rebuilt on a change only). */
  private rows: ChatDrawnRow[] = [];
  private readonly heights: number[] = [];
  private readonly tops: number[] = [];
  /** The newest row's arrival alpha as last set, and when it posted. */
  private newestAt = 0;
  private newestAlpha = 1;

  preload(scene: Phaser.Scene): void {
    preloadAvatars(scene as unknown as AvatarScene, Object.values(BLOCK_AVATARS));
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.scene = scene;
    this.feed.attach(host.bus);
    const add = scene.add;
    const r = host.rect;

    this.plate = panel(scene, 'hud:chat-panel', r.x, r.y, r.w, r.h, { k: 0.55, slice: [70, 70, 70, 70] });
    const title = add.text(TITLE_AT.x, TITLE_AT.y, CHAT_TEXT.title, {
      fontFamily: FONT,
      fontSize: '15px',
      color: COLORS.cyanText,
    });
    title.setLetterSpacing(2);
    this.tagText = add
      .text(TAG_AT.x, TAG_AT.y, CHAT_TEXT.all, { fontFamily: FONT, fontSize: '11px', color: COLORS.dim })
      .setOrigin(1, 0.5);
    this.chrome = add.graphics();

    const avatarScene = scene as unknown as AvatarScene;
    this.avatarTextures = {};
    for (const key of Object.values(BLOCK_AVATARS)) {
      this.avatarTextures[key] = roundAvatar(avatarScene, key, ROW_AVATAR).texture;
    }

    this.slots = [];
    const textW = CHAT_BODY.w - ROW_TEXT_X;
    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const g = add.graphics();
      const avatar = add.image(0, 0, this.avatarTextures[BLOCK_AVATARS.kenji]).setVisible(false);
      const initial = add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '14px', color: COLORS.cyanText })
        .setOrigin(0.5);
      const name = add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: COLORS.amberText });
      const text = add.text(0, 0, '', {
        fontFamily: FONT_SANS,
        fontSize: '14px',
        color: COLORS.white,
        wordWrap: { width: textW },
        maxLines: 2,
      });
      this.slots.push({ g, avatar, initial, name, text });
    }

    const objects: Phaser.GameObjects.GameObject[] = [this.plate, title, this.tagText, this.chrome];
    for (const s of this.slots) objects.push(s.g, s.avatar, s.initial, s.name, s.text);
    this.root = add.container(0, 0, objects);

    const onDown = (p: Phaser.Input.Pointer): void => {
      if (!onRect(CHAT_HEADER, p.x, p.y)) return;
      this.feed.toggle();
      this.draw();
    };
    scene.input.on('pointerdown', onDown);
    this.off.push(
      () => scene.input?.off('pointerdown', onDown),
      provideChatHook(
        scene,
        () => this.snapshot(),
        () => ({ watching: this.feed.watching }),
      ),
      provideHudSection('chatTrace', () => ({
        errors: this.feed.trace.errors.map((e) => ({ ...e })),
        retries: this.feed.trace.retries.map((r) => ({ ...r })),
      })),
    );
    this.drawHeader();
    this.draw();
  }

  /** The panel, for the HUD's bounds check; null once shut down. */
  get panel(): Phaser.GameObjects.NineSlice | null {
    return this.plate;
  }

  /** A new run: the HUD scene calls it when the run is replaced. */
  reset(clock: number): void {
    this.feed.reset(clock);
    this.draw();
  }

  update(frame: Frame, clock: LiveClock, occurrences: readonly Occurrence[]): void {
    this.feed.step(frame, clock.now, occurrences);
    this.draw();
    this.fade(clock.now);
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    this.feed.detach();
    this.root?.destroy();
    this.root = null;
    this.plate = null;
    this.tagText = null;
    this.chrome = null;
    this.slots = [];
    this.rows = [];
    this.scene = null;
    this.drawnFeed = null;
    this.drawnFilter = null;
    this.drawnSilenced = null;
  }

  // ---- drawing ----

  /** The header: its divider and the filter tag in its pill. */
  private drawHeader(): void {
    const g = this.chrome;
    const tag = this.tagText;
    if (!g || !tag) return;
    const block = this.feed.state.filter === 'block';
    tag.setText(headerTag(this.feed.state.filter));
    tag.setColor(block ? COLORS.heroText : COLORS.dim);
    g.clear();
    g.lineStyle(1, COLORS.cyan, 0.35);
    g.lineBetween(CHAT_BODY.x, CHAT_BODY.y - 4, CHAT_BODY.x + CHAT_BODY.w, CHAT_BODY.y - 4);
    const w = tag.width + 14;
    g.lineStyle(1, block ? COLORS.hero : COLORS.cyan, block ? 0.9 : 0.45);
    g.strokeRoundedRect(TAG_AT.x - w + 7, TAG_AT.y - 10, w, 20, 4);
  }

  /** Lay the newest rows out bottom-up, only when the feed, the filter or the silence changed. */
  private draw(): void {
    const s = this.feed.state;
    if (!this.root) return;
    if (s.feed === this.drawnFeed && s.filter === this.drawnFilter && s.silenced === this.drawnSilenced)
      return;
    const filterChanged = s.filter !== this.drawnFilter;
    this.drawnFeed = s.feed;
    this.drawnFilter = s.filter;
    this.drawnSilenced = s.silenced;
    if (filterChanged) this.drawHeader();

    const rows = visibleRows(s.feed, s.filter);
    this.heights.length = rows.length;
    for (let i = 0; i < rows.length; i++) this.heights[i] = rowHeight(rows[i].text);
    stackRows(this.heights, CHAT_BODY, this.tops);
    const base = s.silenced ? SILENCED_ALPHA : 1;
    const newest = rows[rows.length - 1];
    this.newestAt = newest ? newest.at : 0;
    this.newestAlpha = newest ? arrivalAlpha(this.feed.clock - newest.at, settings().reduceFlicker) : 1;
    this.rows = [];
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const row = rows[i];
      if (!row) {
        hideSlot(slot);
        continue;
      }
      const alpha = base * (i === rows.length - 1 ? this.newestAlpha : 1);
      this.rows.push(this.drawRow(slot, row, this.tops[i], this.heights[i], alpha));
    }
  }

  private drawRow(slot: RowSlot, row: ChatRow, top: number, h: number, alpha: number): ChatDrawnRow {
    const look = rowLook(row, BLOCK_AVATARS);
    const x0 = CHAT_BODY.x;
    const cx = x0 + 8 + ROW_AVATAR / 2;
    const cy = top + ROW_AVATAR / 2;
    const g = slot.g;
    g.clear();
    // The 2 px cause tick down the row's left edge.
    g.fillStyle(TICK[look.tick], look.tick === 'cyan' ? 0.45 : 1);
    g.fillRect(x0, top + 2, 2, h - ROW_GAP - 4);
    if (look.avatar) {
      slot.avatar
        .setTexture(this.avatarTextures[look.avatar])
        .setPosition(cx, cy)
        .setDisplaySize(ROW_AVATAR, ROW_AVATAR)
        .setVisible(true);
      g.lineStyle(2, COLORS.hero, 0.9);
      g.strokeCircle(cx, cy, ROW_AVATAR / 2);
    } else {
      slot.avatar.setVisible(false);
    }
    if (look.ring) {
      const c = look.ring === 'cyan' ? COLORS.cyan : COLORS.hero;
      g.fillStyle(COLORS.ink, 0.9);
      g.fillCircle(cx, cy, ROW_AVATAR / 2 - 1);
      g.lineStyle(2, c, 0.95);
      g.strokeCircle(cx, cy, ROW_AVATAR / 2 - 1);
    }
    if (look.rule) {
      g.lineStyle(2, COLORS.hero, 0.9);
      g.lineBetween(x0 + 10, cy, x0 + 8 + ROW_AVATAR - 2, cy);
    }
    slot.initial
      .setText(look.initial)
      .setColor(look.ring === 'amber' ? COLORS.heroText : COLORS.cyanText)
      .setPosition(cx, cy)
      .setVisible(look.ring !== null);
    slot.name
      .setText(look.name)
      .setColor(look.nameColor === 'amber' ? COLORS.heroText : COLORS.cyanText)
      .setPosition(x0 + ROW_TEXT_X, top)
      .setVisible(true);
    const lines = rowLines(row.text);
    slot.text
      .setMaxLines(lines)
      .setText(row.text)
      .setPosition(x0 + ROW_TEXT_X, top + ROW_NAME_H)
      .setVisible(true);
    setSlotAlpha(slot, alpha);
    return {
      id: row.id,
      chat: row.chat,
      name: look.name,
      nameColor: look.nameColor,
      avatar: look.avatar,
      ring: look.ring,
      rule: look.rule,
      tick: look.tick,
      lines,
      x: x0,
      y: top,
      w: CHAT_BODY.w,
      h,
      alpha,
    };
  }

  /** The newest row's 150 ms arrival fade on the HUD clock (none under reduce flicker). No allocation. */
  private fade(clock: number): void {
    if (this.newestAlpha >= 1 || this.rows.length === 0) return;
    const a = arrivalAlpha(clock - this.newestAt, settings().reduceFlicker);
    if (a === this.newestAlpha) return;
    this.newestAlpha = a;
    const i = this.rows.length - 1;
    const alpha = (this.feed.state.silenced ? SILENCED_ALPHA : 1) * a;
    this.rows[i].alpha = alpha;
    setSlotAlpha(this.slots[i], alpha);
  }

  private snapshot(): ChatTestState {
    const canvas = this.scene?.game.canvas.getBoundingClientRect() ?? null;
    const at = canvas ? pagePoint(HEADER_AT, canvas) : { x: 0, y: 0 };
    return chatSection({
      state: this.feed.state,
      posts: this.feed.posts,
      lastEvent: this.feed.lastEvent,
      clock: this.feed.clock,
      header: { title: CHAT_TEXT.title, tag: headerTag(this.feed.state.filter), x: at.x, y: at.y },
      rows: this.rows,
    });
  }
}

/** One pooled row: its graphics (tick, ring, rule), avatar, initial, name and words. */
interface RowSlot {
  g: Phaser.GameObjects.Graphics;
  avatar: Phaser.GameObjects.Image;
  initial: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  text: Phaser.GameObjects.Text;
}

const TICK: Readonly<Record<TickColor, number>> = {
  red: COLORS.red,
  amber: COLORS.hero,
  cyan: COLORS.cyan,
};

/** The filter tag, right-aligned in the header strip. */
const TAG_AT = { x: CHAT_HEADER.x + CHAT_HEADER.w - 46, y: CHAT_HEADER.y + 22 };

/** The title, clear of the plate's corner. */
const TITLE_AT = { x: CHAT_HEADER.x + 30, y: CHAT_HEADER.y + 14 };

function hideSlot(s: RowSlot): void {
  s.g.clear();
  s.avatar.setVisible(false);
  s.initial.setVisible(false);
  s.name.setVisible(false);
  s.text.setVisible(false);
}

function setSlotAlpha(s: RowSlot, alpha: number): void {
  s.g.setAlpha(alpha);
  s.avatar.setAlpha(alpha);
  s.initial.setAlpha(alpha);
  s.name.setAlpha(alpha);
  s.text.setAlpha(alpha);
}
