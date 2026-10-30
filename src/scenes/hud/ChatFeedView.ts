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
// chat-6 drops the requested art in through the manifest: the wide plate, the four stream avatars
// and the system glyph each draw once picked and their texture is in, and the code fallbacks (the
// portrait panel nine-sliced, the cyan ring, the amber rule) until then; nothing loads a file that
// has not landed. Rolando's picks have landed: the wide plate is nine-sliced so its painted header
// band sits in the header strip (the title and tag centre on it), the viewers' painted discs and
// the unnamed neighbour's draw at 32 px from 243-244 px files, the glyph at 20 px from 64. The chat
// plays no sound: its post tick stays off (05-comms, D5).
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import type { Occurrence } from '../../game/occurrences';
import { settings } from '../../game/settings';
import { BROWNOUT } from '../../sim/brownout';
import type { LineId } from '../../strings';
import { artRequest, isPicked, requestFile } from '../../game/artManifest';
import { type AvatarScene, BLOCK_AVATARS, STREAM_AVATARS, preloadAvatars, roundAvatar } from '../avatars';
import { artTexture } from '../plates';
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
  type RowLook,
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
import { LABELS } from './labels';
import { isLesson } from './lineMeta';
import { panel } from './panel';

/** Seed for the chat's randomness, so a run's chat is the same every time (and in tests). */
export const CHAT_SEED = 20261231;

/** The header's words (UI micro-copy, not lines): LABELS.chat. */
export const CHAT_TEXT = Object.freeze({
  title: LABELS.chat.title,
  all: LABELS.chat.both,
  block: LABELS.chat.blockOnly,
});

/** The header tag for a filter. */
export const headerTag = (filter: ChatFilter): string =>
  filter === 'block' ? CHAT_TEXT.block : CHAT_TEXT.all;

// ---- the art drop-in (chat-6): the wide plate, the stream avatars and the system glyph ----

/** The landscape LIVE CHAT plate (docs/ART-REQUESTS.md), drawn the size of the zone once picked. */
export const CHAT_PLATE_WIDE = 'hud/chat-plate-wide';
/** The system row's glyph, drawn in place of the amber rule once picked. */
export const SYSTEM_GLYPH = 'hud/icons/system';
/** The system glyph's size on a row, in game pixels (its request's display size). */
export const SYSTEM_GLYPH_SIZE = 20;

/**
 * The glyph's drawn size: its file fitted inside the 20 px box at its own aspect, never above 1:1
 * (the round 2 antenna is 41x64, so it draws about 12.8x20 rather than squashed square). Pure.
 */
export function systemGlyphSize(cut: { readonly w: number; readonly h: number } | null): {
  w: number;
  h: number;
} {
  if (!cut || cut.w <= 0 || cut.h <= 0) return { w: SYSTEM_GLYPH_SIZE, h: SYSTEM_GLYPH_SIZE };
  const k = Math.min(1, SYSTEM_GLYPH_SIZE / cut.w, SYSTEM_GLYPH_SIZE / cut.h);
  return { w: cut.w * k, h: cut.h * k };
}

/** The glyph's drawn size from the manifest's cut, resolved once. */
const GLYPH_DRAWN = systemGlyphSize(artRequest(SYSTEM_GLYPH)?.cut ?? null);

/**
 * The wide plate as it landed (770x485, a little shorter than its 770x550 cut) drawn into the
 * 385x275 zone. A plain scale would squash it unevenly (0.5 across, 0.57 down) and drop the painted
 * header band to 24-45 px, past the 40 px header strip; so it is nine-sliced at corner scale k 0.42:
 * the rim, the corner tape and the band keep their shape, the band lands at 20-38 px inside the
 * header strip, and only the plain glass in the middle stretches. Every region still draws smaller
 * than its file (chatPlateScales), so nothing is upscaled.
 */
export const CHAT_PLATE_K = 0.42;
/** The wide plate's nine-slice insets in file pixels, [left, right, top, bottom]: the tape pieces sit inside them. */
export const CHAT_PLATE_SLICE: readonly [number, number, number, number] = [100, 120, 100, 125];
/** The wide plate's painted header band, in file pixel rows. */
export const CHAT_PLATE_BAND = Object.freeze({ top: 48, bottom: 90 });

/**
 * Whether a nine-sliced file can fill `display` with every region at or under its file size. The
 * layout A chat (465x750, Rolando 30 Oct 2026) is taller than either painted plate can reach, so it
 * draws the code glass plate (CHAT_GLASS) instead of stretching the plain glass up past 1:1. Pure.
 */
export function plateFits(
  file: { w: number; h: number },
  display: { w: number; h: number },
  k: number,
  slice: readonly [number, number, number, number],
): boolean {
  const s = nineSliceScales(file, display, k, slice);
  return s.corner <= 1 && s.midX > 0 && s.midX <= 1 && s.midY > 0 && s.midY <= 1;
}

/** The portrait chat panel's file size and nine-slice, its fallback plate. */
export const CHAT_PANEL_FILE = Object.freeze({ w: 353, h: 524 });
export const CHAT_PANEL_K = 0.55;
export const CHAT_PANEL_SLICE: readonly [number, number, number, number] = [70, 70, 70, 70];

/** The code plate for a chat too tall for the painted ones: dark navy glass, see-through, a thin amber rim. */
export const CHAT_GLASS = Object.freeze({
  fill: 0x0b1220,
  alpha: 0.82,
  rim: 0xffa62b,
  rimAlpha: 0.7,
  rimWidth: 2,
});

/**
 * Which plate draws in `zone`: the picked wide plate where it fits without upscaling, else the code
 * glass in its colours. The portrait panel stays the fallback for a plate that has not landed. Pure.
 */
export function chatPlateFor(want: ChatArt['plate'], zone: { w: number; h: number }): ChatArt['plate'] {
  if (want !== 'wide') return want;
  const wide = artRequest(CHAT_PLATE_WIDE)?.cut;
  return wide && plateFits(wide, zone, CHAT_PLATE_K, CHAT_PLATE_SLICE) ? 'wide' : 'glass';
}

/** How much each part of a nine-sliced file is scaled to draw at `display` (1 = file size). Pure. */
export function nineSliceScales(
  file: { w: number; h: number },
  display: { w: number; h: number },
  k: number,
  slice: readonly [number, number, number, number],
): { corner: number; midX: number; midY: number } {
  const [l, r, t, b] = slice;
  return {
    corner: k,
    midX: (display.w - (l + r) * k) / (file.w - l - r),
    midY: (display.h - (t + b) * k) / (file.h - t - b),
  };
}

/** Where the header's title and tag sit, by plate: centred on the wide plate's band, else as chat-4 drew them. */
export interface ChatHeaderLayout {
  /** The title's top edge (portrait) or centre line (wide), in game pixels. */
  titleY: number;
  titleOriginY: number;
  /** The tag's centre line, in game pixels. */
  tagY: number;
  /** Whether the code divider is drawn under the header (the wide plate paints its own band edge). */
  divider: boolean;
}

/** The header layout for a plate. Pure. */
export function chatHeaderLayout(plate: ChatArt['plate']): ChatHeaderLayout {
  if (plate === 'wide') {
    const mid =
      CHAT_HEADER.y + Math.round(((CHAT_PLATE_BAND.top + CHAT_PLATE_BAND.bottom) / 2) * CHAT_PLATE_K);
    return { titleY: mid, titleOriginY: 0.5, tagY: mid, divider: false };
  }
  return { titleY: CHAT_HEADER.y + 14, titleOriginY: 0, tagY: CHAT_HEADER.y + 22, divider: true };
}

/** Whether a requested key's picked file has landed (the manifest carries its cut size). */
export function chatArtPicked(key: string): boolean {
  const r = artRequest(key);
  return r !== undefined && isPicked(r);
}

/** Which of the chat's requested art draws: each falls back to code until its file is picked. */
export interface ChatArt {
  /**
   * 'wide' once hud/chat-plate-wide is picked; the portrait chat panel nine-sliced until then; 'glass'
   * (a code plate) where the zone is too tall for either to fill without upscaling (chatPlateFor).
   */
  plate: 'wide' | 'portrait' | 'glass';
  /** Stream rows show painted avatars (all four chars/avatars/stream-N picked); a cyan ring until then. */
  streamAvatars: boolean;
  /** System rows show the glyph (hud/icons/system picked); the amber rule until then. */
  systemGlyph: boolean;
}

/** The chat's art from the manifest (or `picked`, which tests use to stand for a landed drop). Pure. */
export function chatArtOf(picked: (key: string) => boolean = chatArtPicked): ChatArt {
  return {
    plate: picked(CHAT_PLATE_WIDE) ? 'wide' : 'portrait',
    streamAvatars: STREAM_AVATARS.every((k) => picked(k)),
    systemGlyph: picked(SYSTEM_GLYPH),
  };
}

/** A viewer's painted avatar, the same one for the same handle every time. Pure. */
export function streamAvatarFor(handle: string): string {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return STREAM_AVATARS[h % STREAM_AVATARS.length];
}

/**
 * A row's look with the landed art: a stream row's cyan ring becomes the viewer's painted avatar,
 * a system row's rule becomes the glyph (as `avatar`, the glyph's key). Returns `look` itself when
 * no art applies. Pure.
 */
export function lookWithArt(look: RowLook, art: ChatArt): RowLook {
  if (look.rule && art.systemGlyph) return { ...look, avatar: SYSTEM_GLYPH, rule: false };
  if (look.ring === 'cyan' && look.nameColor === 'cyan' && art.streamAvatars)
    return { ...look, avatar: streamAvatarFor(look.name), ring: null, initial: '' };
  return look;
}

/** hud.chatArt: which of the chat's requested art draws now (a test mirror). */
export type ChatArtTestState = ChatArt;

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
    /** The chat's art, landed or falling back (chat-6). */
    chatArt?: ChatArtTestState;
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
      bus.on('coachNudge', (n) => {
        // Only the first nudge for a problem: chat piling on every reminder is noise.
        if (n.nth === 1) this.pending.push({ kind: 'coach', step: n.step });
      }),
      bus.on('action', (a) => {
        if (a.type === 'overclock') this.pending.push({ kind: 'action', type: 'overclock' });
        else if (a.type === 'decommission')
          this.pending.push({
            kind: 'action',
            type: 'decommission',
            afterMidnight: this.inputs.now >= BROWNOUT.clock.midnight,
          });
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
  if (e.kind === 'coach') return `coach:${e.step}`;
  return `action:${e.type}`;
}

/** The header's centre, in game pixels. */
const HEADER_AT = { x: CHAT_HEADER.x + CHAT_HEADER.w / 2, y: CHAT_HEADER.y + CHAT_HEADER.h / 2 };

const onRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export class ChatFeedView implements LiveView {
  readonly zone = 'chat' as const;
  // Six fixed objects (two texts) and five per row slot (three texts), VISIBLE_ROWS slots.
  readonly budget: LiveBudget = { objects: 6 + 5 * VISIBLE_ROWS, texts: 2 + 3 * VISIBLE_ROWS };

  /** The controller; outlives create/shutdown so the HUD can reset it before the view is built. */
  readonly feed = new ChatFeed();
  private scene: Phaser.Scene | null = null;
  private root: Phaser.GameObjects.Container | null = null;
  private plate:
    Phaser.GameObjects.NineSlice | Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null = null;
  /** The art that draws: what the manifest says has landed, less anything whose texture is not in. */
  private art: ChatArt;
  /** Where the header's words sit on the plate that draws. */
  private header: ChatHeaderLayout = chatHeaderLayout('portrait');
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

  /** `picked` stands for the manifest in tests (a landed drop); the game uses the manifest. */
  constructor(private readonly picked: (key: string) => boolean = chatArtPicked) {
    this.art = chatArtOf(picked);
  }

  /**
   * Queue the block's avatars, and the chat's requested art only once picked: a file that has not
   * landed is never requested, so the fallbacks draw without a load error or texture warning.
   */
  preload(scene: Phaser.Scene): void {
    const art = chatArtOf(this.picked);
    const keys = Object.values(BLOCK_AVATARS);
    preloadAvatars(scene as unknown as AvatarScene, art.streamAvatars ? [...keys, ...STREAM_AVATARS] : keys);
    for (const key of [CHAT_PLATE_WIDE, SYSTEM_GLYPH]) {
      const want = key === CHAT_PLATE_WIDE ? art.plate === 'wide' : art.systemGlyph;
      if (want && !scene.textures.exists(artTexture(key)))
        scene.load.image(artTexture(key), requestFile(key));
    }
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.scene = scene;
    this.feed.attach(host.bus);
    const add = scene.add;
    const r = host.rect;

    // What the manifest says has landed, less anything whose texture did not load (the code fallback
    // draws then, and nothing asks Phaser for a missing texture).
    const has = (key: string): boolean => scene.textures.exists(key) === true;
    const want = chatArtOf(this.picked);
    this.art = {
      plate: chatPlateFor(want.plate === 'wide' && has(artTexture(CHAT_PLATE_WIDE)) ? 'wide' : 'portrait', r),
      streamAvatars: want.streamAvatars && STREAM_AVATARS.every((k) => has(artTexture(k))),
      systemGlyph: want.systemGlyph && has(artTexture(SYSTEM_GLYPH)),
    };

    this.plate =
      this.art.plate === 'wide'
        ? panel(scene, artTexture(CHAT_PLATE_WIDE), r.x, r.y, r.w, r.h, {
            k: CHAT_PLATE_K,
            slice: [...CHAT_PLATE_SLICE],
          })
        : this.art.plate === 'portrait'
          ? panel(scene, 'hud:chat-panel', r.x, r.y, r.w, r.h, {
              k: CHAT_PANEL_K,
              slice: [...CHAT_PANEL_SLICE],
            })
          : add
              .rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w - CHAT_GLASS.rimWidth, r.h - CHAT_GLASS.rimWidth)
              .setFillStyle(CHAT_GLASS.fill, CHAT_GLASS.alpha)
              .setStrokeStyle(CHAT_GLASS.rimWidth, CHAT_GLASS.rim, CHAT_GLASS.rimAlpha);
    this.header = chatHeaderLayout(this.art.plate);
    const title = add
      .text(TITLE_X, this.header.titleY, CHAT_TEXT.title, {
        fontFamily: FONT,
        fontSize: '15px',
        color: COLORS.cyanText,
      })
      .setOrigin(0, this.header.titleOriginY);
    title.setLetterSpacing(2);
    this.tagText = add
      .text(TAG_X, this.header.tagY, CHAT_TEXT.all, { fontFamily: FONT, fontSize: '11px', color: COLORS.dim })
      .setOrigin(1, 0.5);
    this.chrome = add.graphics();

    const avatarScene = scene as unknown as AvatarScene;
    this.avatarTextures = {};
    for (const key of Object.values(BLOCK_AVATARS)) {
      this.avatarTextures[key] = roundAvatar(avatarScene, key, ROW_AVATAR).texture;
    }
    if (this.art.streamAvatars) {
      for (const key of STREAM_AVATARS)
        this.avatarTextures[key] = roundAvatar(avatarScene, key, ROW_AVATAR).texture;
    }
    if (this.art.systemGlyph) this.avatarTextures[SYSTEM_GLYPH] = artTexture(SYSTEM_GLYPH);

    this.slots = [];
    const textW = CHAT_BODY.w - ROW_TEXT_X;
    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const g = add.graphics();
      const avatar = add.image(0, 0, this.avatarTextures[BLOCK_AVATARS.kenji]).setVisible(false);
      const initial = add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '16px', color: COLORS.cyanText })
        .setOrigin(0.5);
      const name = add.text(0, 0, '', { fontFamily: FONT, fontSize: '14px', color: COLORS.amberText });
      const text = add.text(0, 0, '', {
        fontFamily: FONT_SANS,
        fontSize: '16px',
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
      provideHudSection('chatArt', () => ({ ...this.art })),
      provideHudSection('chatTrace', () => ({
        errors: this.feed.trace.errors.map((e) => ({ ...e })),
        retries: this.feed.trace.retries.map((r) => ({ ...r })),
      })),
    );
    this.drawHeader();
    this.draw();
  }

  /** The panel, for the HUD's bounds check; null once shut down. */
  get panel(): Phaser.GameObjects.NineSlice | Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null {
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
    if (this.header.divider) {
      g.lineStyle(1, COLORS.cyan, 0.35);
      g.lineBetween(CHAT_BODY.x, CHAT_BODY.y - 4, CHAT_BODY.x + CHAT_BODY.w, CHAT_BODY.y - 4);
    }
    const w = tag.width + 14;
    g.lineStyle(1, block ? COLORS.hero : COLORS.cyan, block ? 0.9 : 0.45);
    g.strokeRoundedRect(TAG_X - w + 7, this.header.tagY - 10, w, 20, 4);
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
    const look = lookWithArt(rowLook(row, BLOCK_AVATARS), this.art);
    const x0 = CHAT_BODY.x;
    const cx = x0 + 8 + ROW_AVATAR / 2;
    const cy = top + ROW_AVATAR / 2;
    const g = slot.g;
    g.clear();
    // The 2 px cause tick down the row's left edge.
    g.fillStyle(TICK[look.tick], look.tick === 'cyan' ? 0.45 : 1);
    g.fillRect(x0, top + 2, 2, h - ROW_GAP - 4);
    if (look.avatar === SYSTEM_GLYPH) {
      // The system glyph, unringed, at its own size where the rule would be.
      slot.avatar
        .setTexture(this.avatarTextures[SYSTEM_GLYPH])
        .setPosition(cx, cy)
        .setDisplaySize(GLYPH_DRAWN.w, GLYPH_DRAWN.h)
        .setVisible(true);
    } else if (look.avatar) {
      slot.avatar
        .setTexture(this.avatarTextures[look.avatar])
        .setPosition(cx, cy)
        .setDisplaySize(ROW_AVATAR, ROW_AVATAR)
        .setVisible(true);
      // A resident's face rings amber; a viewer's painted disc keeps a cyan ring, the stream's colour.
      const viewer = look.nameColor === 'cyan';
      g.lineStyle(viewer ? 1.5 : 2, viewer ? COLORS.cyan : COLORS.hero, 0.9);
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

/** The filter tag's right edge in the header strip (its line is the header layout's tagY). */
const TAG_X = CHAT_HEADER.x + CHAT_HEADER.w - 46;

/** The title's left edge, clear of the plate's corner. */
const TITLE_X = CHAT_HEADER.x + 30;

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
