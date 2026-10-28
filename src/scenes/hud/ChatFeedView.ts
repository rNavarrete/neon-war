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
// ChatFeedView draws it (chat-3 hosts the controller; chat-4 draws the merged panel).
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import type { Occurrence } from '../../game/occurrences';
import type { LineId } from '../../strings';
import { type Rect, pagePoint } from '../live/layout';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import { type ChatDrawnRow, type ChatTestState, chatSection, provideChatHook } from '../live/views/chat';
import { CHAT_BODY, CHAT_HEADER, seededRandom } from './chat';
import {
  type ChatEvent,
  type ChatFilter,
  type ChatState,
  type ChatStep,
  chatInputsOf,
  emptyChatInputs,
  initialChat,
  postScripted,
  seedChat,
  stepChat,
  toggleFilter,
  visibleRows,
} from './chatEngine';
import { COLORS, FONT, FONT_SANS, RIGHT } from './layout';
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
  readonly budget: LiveBudget = { objects: 26, texts: 16 };

  /** The controller; outlives create/shutdown so the HUD can reset it before the view is built. */
  readonly feed = new ChatFeed();
  private scene: Phaser.Scene | null = null;
  private root: Phaser.GameObjects.Container | null = null;
  private plate: Phaser.GameObjects.NineSlice | null = null;
  private lines: Phaser.GameObjects.Text[] = [];
  private off: (() => void)[] = [];
  /** What is drawn now, so update only redraws on a change. */
  private drawnFeed: ChatState['feed'] | null = null;
  private drawnFilter: ChatFilter | null = null;
  private rows: ChatDrawnRow[] = [];

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.scene = scene;
    this.feed.attach(host.bus);
    const r = host.rect;
    this.plate = panel(scene, 'hud:chat-panel', r.x, r.y, r.w, r.h, { k: 0.55, slice: [70, 70, 70, 70] });
    const title = scene.add.text(RIGHT.chatTitle.x, RIGHT.chatTitle.y, CHAT_TEXT.title, {
      fontFamily: FONT,
      fontSize: '14px',
      color: COLORS.cyanText,
    });
    const rowH = CHAT_BODY.h / CHAT_BODY.rows;
    this.lines = [];
    for (let i = 0; i < CHAT_BODY.rows; i++) {
      this.lines.push(
        scene.add.text(CHAT_BODY.x, CHAT_BODY.y + i * rowH, '', {
          fontFamily: FONT_SANS,
          fontSize: '14px',
          color: COLORS.white,
          wordWrap: { width: CHAT_BODY.w },
          maxLines: 2,
        }),
      );
    }
    this.root = scene.add.container(0, 0, [this.plate, title, ...this.lines]);
    const onDown = (p: Phaser.Input.Pointer): void => {
      if (onRect(CHAT_HEADER, p.x, p.y)) this.feed.toggle();
    };
    scene.input.on('pointerdown', onDown);
    this.off.push(
      () => scene.input?.off('pointerdown', onDown),
      provideChatHook(
        scene,
        () => this.snapshot(),
        () => ({ watching: this.feed.watching }),
      ),
    );
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
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    this.feed.detach();
    this.root?.destroy();
    this.root = null;
    this.plate = null;
    this.lines = [];
    this.scene = null;
    this.drawnFeed = null;
    this.drawnFilter = null;
  }

  private draw(): void {
    const s = this.feed.state;
    if (!this.root || (s.feed === this.drawnFeed && s.filter === this.drawnFilter)) return;
    this.drawnFeed = s.feed;
    this.drawnFilter = s.filter;
    const rows = visibleRows(s, this.lines.length);
    const skip = this.lines.length - rows.length;
    for (let i = 0; i < this.lines.length; i++) {
      const row = i >= skip ? rows[i - skip] : null;
      this.lines[i].setText(row ? `${row.who}: ${row.text}` : '');
    }
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
