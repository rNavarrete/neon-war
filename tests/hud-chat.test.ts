import {
  FILLER_MAX_SECONDS,
  FILLER_MIN_SECONDS,
  avatarFor,
  chatEntry,
  chatOf,
  fillerDelay,
  fillerPool,
  pickFiller,
  pushChat,
  seededRandom,
} from '../src/scenes/hud/chat';
import {
  REGROUP_UNUSED,
  regroupActive,
  regroupSpent,
  regroupTimeScale,
  startRegroup,
} from '../src/scenes/hud/regroup';
import { dipWarningAt, surgeWarningAt } from '../src/scenes/hud/warnings';
import { BROWNOUT } from '../src/sim/brownout';
import type Phaser from 'phaser';
import { Bus } from '../src/game/bus';
import type { Frame } from '../src/game/frame';
import type { Occurrence } from '../src/game/occurrences';
import {
  CHAT_GLASS,
  CHAT_PANEL_FILE,
  CHAT_PANEL_K,
  CHAT_PANEL_SLICE,
  CHAT_PLATE_K,
  CHAT_PLATE_SLICE,
  CHAT_PLATE_WIDE,
  CHAT_TEXT,
  ChatFeed,
  ChatFeedView,
  SYSTEM_GLYPH,
  chatArtOf,
  chatPlateFor,
  plateFits,
  lookWithArt,
  streamAvatarFor,
} from '../src/scenes/hud/ChatFeedView';
import { artRequest, isPicked } from '../src/game/artManifest';
import { isSfxKey } from '../src/game/audio';
import { STREAM_AVATARS } from '../src/scenes/avatars';
import { artTexture } from '../src/scenes/plates';
import {
  ARRIVAL_FADE,
  CHAT_BODY,
  CHAT_HEADER,
  ONE_LINE_CHARS,
  VIEWER_HANDLES,
  arrivalAlpha,
  fitRows,
  handleFor,
  rowHeight,
  rowLook,
  stackRows,
  tickOf,
} from '../src/scenes/hud/chat';
import {
  CHAT_PACE,
  HYPE_BURST,
  type ChatEvent,
  type ChatInputs,
  type ChatRow,
  type ChatState,
  DROPPABLE_SCRIPTED,
  NO_POSTS,
  SEED_IDS,
  initialChat,
  postScripted,
  stepChat,
  visibleRows,
} from '../src/scenes/hud/chatEngine';
import { updateSettings } from '../src/game/settings';
import { BLOCK_AVATARS } from '../src/scenes/avatars';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';
import { LESSON_IDS } from '../src/scenes/hud/lineMeta';
import { type Rect, ZONES } from '../src/scenes/live/layout';
import type { LiveClock, LiveHost } from '../src/scenes/live/view';
import type { ChatTestState } from '../src/scenes/live/views/chat';
import { LINES, type LineId } from '../src/strings';
import chatFeedSource from '../src/scenes/hud/ChatFeedView.ts?raw';
import chatSource from '../src/scenes/hud/chat.ts?raw';
import chatEngineSource from '../src/scenes/hud/chatEngine.ts?raw';
import chatHookSource from '../src/scenes/live/views/chat.ts?raw';
import hudSceneSource from '../src/scenes/HudScene.ts?raw';

const CHAT_SOURCES = {
  ChatFeedView: chatFeedSource,
  chat: chatSource,
  chatEngine: chatEngineSource,
  hook: chatHookSource,
};

describe('chat', () => {
  it('routes scripted lines to the block or stream chat', () => {
    expect(chatOf('C1.chat.01')).toBe('block');
    expect(chatOf('C1.chat.02')).toBe('stream');
    expect(chatOf('fill.stream.ok.01')).toBe('stream');
    expect(chatOf('C1.triage.01')).toBeNull();
  });

  it('names the writer and finds their avatar', () => {
    expect(chatEntry('C1.chat.01')).toMatchObject({ who: 'mrs okafor', text: "It's back! Bless you Lux" });
    expect(chatEntry('fill.block.ok.01')).toMatchObject({
      who: 'old man noodles',
      text: 'is the noodle cam on?',
    });
    expect(chatEntry('C4.chat.03').who).toBe('system');
    expect(avatarFor('mrs okafor')).toBe('mrs-okafor');
    expect(avatarFor('viewer')).toBeNull();
  });

  it('keeps the newest messages without changing the old log', () => {
    const log = [chatEntry('C1.chat.01')];
    const next = pushChat(log, chatEntry('fill.block.ok.01'), 1);
    expect(next.map((e) => e.id)).toEqual(['fill.block.ok.01']);
    expect(log.map((e) => e.id)).toEqual(['C1.chat.01']);
  });

  it('picks filler from the pool for the error state', () => {
    expect(fillerPool('block', 'ok')).toHaveLength(10);
    expect(fillerPool('block', 'slow')).toHaveLength(5);
    // The four original down lines, then the hype pack's nine (Rolando, 30 Oct 2026).
    expect(fillerPool('stream', 'down').slice(0, 4)).toEqual([
      'fill.stream.down.01',
      'fill.stream.down.02',
      'fill.stream.down.03',
      'fill.stream.down.04',
    ]);
    expect(fillerPool('stream', 'down')).toHaveLength(13);
    const rand = seededRandom(1);
    for (let i = 0; i < 20; i++) expect(pickFiller('block', 'down', rand)).toMatch(/^fill\.block\.down\./);
    expect(pickFiller('stream', 'down', () => 0, 'fill.stream.down.01')).toBe('fill.stream.down.02');
  });

  it('waits 6 to 10 s between filler lines, deterministically for a seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 50; i++) {
      const d = fillerDelay(a);
      expect(d).toBeGreaterThanOrEqual(FILLER_MIN_SECONDS);
      expect(d).toBeLessThan(FILLER_MAX_SECONDS);
      expect(fillerDelay(b)).toBe(d);
    }
  });
});

describe('warnings', () => {
  const C = BROWNOUT.challenges;

  it('shows the C4 and C6 surges with their numbers at least 10 s ahead', () => {
    expect(surgeWarningAt(C.c4 - 10)).toMatchObject({
      surge: { demand: 250 },
      inSeconds: 10,
      line: 'C4.warn.01',
    });
    expect(surgeWarningAt(C.c6 - 10)).toMatchObject({ surge: { demand: 150 }, line: 'C6.warn.01' });
    expect(surgeWarningAt(C.c4 - 10.5)?.surge.startsAt).toBe(C.c4);
    expect(surgeWarningAt(C.c4 - 11.5)?.surge.startsAt).toBe(C.c4);
    expect(surgeWarningAt(C.c4 - 13)).toBeNull();
    expect(surgeWarningAt(C.c4 + 1)?.inSeconds).toBe(0);
    expect(surgeWarningAt(C.c4 + 30)).toBeNull();
  });

  it('flickers on the part 2 s before a dip, steady with reduce flicker', () => {
    const dip = { partId: 's1', at: 100 };
    expect(dipWarningAt(dip, 97.5, false)).toBeNull();
    expect(dipWarningAt(null, 99, false)).toBeNull();
    const lit = [98.05, 98.15, 98.25, 98.35].map((t) => dipWarningAt(dip, t, false)?.lit);
    expect(new Set(lit).size).toBe(2);
    for (const t of [98.05, 98.15, 98.25, 98.35]) {
      expect(dipWarningAt(dip, t, true)).toEqual({ partId: 's1', lit: true, flashing: false });
    }
    expect(dipWarningAt(dip, 100, false)).toBeNull();
  });
});

describe('Regroup', () => {
  it('runs quarter speed for 10 s once, then is spent', () => {
    expect(regroupTimeScale(REGROUP_UNUSED, 5)).toBe(1);
    const s = startRegroup(REGROUP_UNUSED, 5);
    expect(regroupActive(s, 5)).toBe(true);
    expect(regroupTimeScale(s, 14.9)).toBe(0.25);
    expect(regroupSpent(s, 14.9)).toBe(false);
    expect(regroupTimeScale(s, 15)).toBe(1);
    expect(regroupSpent(s, 15)).toBe(true);
    expect(startRegroup(s, 20)).toBe(s);
  });
});

// ---- chat-3: the chat in the host loop (ChatFeed and ChatFeedView, hud.chat, hud.audience) ----

/** A frame of the run with only what the chat reads; `over` sets the rest. */
function frameAt(over: Partial<Record<keyof Frame, unknown>> = {}): Frame {
  return {
    now: 120,
    errorShare: 0,
    retry: 0,
    served: 0,
    flow: { wires: {}, load: {}, served: 0, dropped: 0, skipped: [] },
    parts: [],
    surge: null,
    midnight: null,
    rewinds: [],
    ...over,
  } as unknown as Frame;
}

/** One box serving 30 a second. */
const SERVING = {
  served: 30,
  parts: [{ id: 'server-1', kind: 'server', slot: 'a' }],
  flow: { wires: {}, load: { 'server-1': 30 }, served: 30, dropped: 0, skipped: [] },
};

/**
 * A stand-in for a Phaser scene: every call returns a chainable stub, and the scene's pointer
 * handlers are recorded so a test can click.
 */
function stubScene(): { scene: Phaser.Scene; down: ((p: { x: number; y: number }) => void)[] } {
  const down: ((p: { x: number; y: number }) => void)[] = [];
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, k) =>
      k === 'then' || typeof k === 'symbol' ? undefined : k === 'width' || k === 'height' ? 0 : chain,
    apply: () => chain,
  });
  const scene = {
    add: chain,
    make: chain,
    textures: chain,
    load: chain,
    tweens: chain,
    input: {
      on: (event: string, fn: (p: { x: number; y: number }) => void) => {
        if (event === 'pointerdown') down.push(fn);
      },
      off: (event: string, fn: (p: { x: number; y: number }) => void) => {
        const i = down.indexOf(fn);
        if (event === 'pointerdown' && i >= 0) down.splice(i, 1);
      },
    },
    game: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }) } },
  };
  return { scene: scene as unknown as Phaser.Scene, down };
}

function hostOn(scene: Phaser.Scene, b: Bus, rect: Rect = ZONES.chat): LiveHost {
  return { scene, bus: b, rect, flags: { lite: true } };
}

/**
 * A chat the size the painted plates were requested for (385x275, the chat zone before layout A).
 * The layout A2 column (410x680, Rolando 30 Oct 2026) is too tall for either plate to fill without
 * upscaling, so it draws the code glass; the drop-in tests run here, where the plates fit.
 */
const PAINTED_CHAT: Rect = { ...ZONES.chat, w: 385, h: 275 };

/** The hud section as the hook publishes it, over an empty base. */
const hudRead = (): HudTestState => hudSection({} as HudTestState);

const clockAt = (now: number, dt = 0.05): LiveClock => ({ now, dt });

describe('the chat in the host loop (chat-3)', () => {
  it('seeds the four phone messages when the board opens, as scripted rows caused seed', () => {
    const f = new ChatFeed(0);
    expect(f.state.feed.map((r) => r.id)).toEqual(SEED_IDS);
    expect(f.state.feed.every((r) => r.cause === 'seed' && r.scripted)).toBe(true);
    expect(f.posts).toBe(4);
  });

  it('posts cue chat ids at once through postScripted, once each, and silences on C6.fail.chat', () => {
    const b = new Bus();
    const f = new ChatFeed(0);
    f.attach(b);
    b.emit('cue', { id: 'C1.chat.01', kind: 'chat', at: 3 });
    b.emit('cue', { id: 'C1.chat.01', kind: 'chat', at: 4 });
    b.emit('cue', { id: 'C1.triage.01', kind: 'bark', at: 4 });
    const rows = f.state.feed.filter((r) => r.id === 'C1.chat.01');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ at: 3, scripted: true, cause: 'served' });
    expect(f.lastEvent).toBe('cue:C1.chat.01');
    b.emit('cue', { id: 'C6.fail.chat', kind: 'chat', at: 5 });
    expect(f.state.silenced).toBe(true);
    expect(f.state.feed.some((r) => r.id === 'C6.fail.chat')).toBe(false);
    f.detach();
  });

  it('hears bus line {lesson} as the 2 s quiet, and overclock and banner actions as reactions', () => {
    const b = new Bus();
    const f = new ChatFeed(0);
    f.attach(b);
    const lesson = LESSON_IDS[0];
    b.emit('line', { id: lesson, speaker: LINES[lesson].speaker, tag: 'HINT', lesson: true, since: 1 });
    f.step(frameAt(SERVING), 1, []);
    expect(f.state.quietUntil).toBeCloseTo(1 + CHAT_PACE.lessonQuiet);
    expect(f.lastEvent).toBe(`line:${lesson}`);
    b.emit('action', { type: 'overclock', id: 'server-1' });
    f.step(frameAt(SERVING), 1.05, []);
    expect(f.lastEvent).toBe('action:overclock');
    expect(f.state.queue.map((q) => q.key)).toContain('overclock');
    f.detach();
  });

  it('reacts to the host loop’s occurrences', () => {
    const f = new ChatFeed(0);
    const placed: Occurrence = { kind: 'placed', id: 'server-1', at: 120 };
    // Well past the seed's last post, so the gap allows a reaction.
    f.step(frameAt(SERVING), 20, [placed]);
    expect(f.lastEvent).toBe('occurrence:placed');
    const posted = f.state.feed.filter((r) => r.cause === 'placed');
    expect(posted).toHaveLength(1);
    expect(posted[0].id).toMatch(/^fill\.stream\.placed\./);
  });

  it('announces the audience on the bus only on a viewersOf change; hud.audience mirrors it', () => {
    const b = new Bus();
    const heard: number[] = [];
    b.on('audience', (e) => heard.push(e.watching));
    const f = new ChatFeed(0);
    f.attach(b);
    expect(f.watching).toBeNull();
    for (let c = 0.05; c < 2; c += 0.05) f.step(frameAt(), c, []);
    expect(heard).toEqual([]);
    expect(f.watching).toBeNull();
    // The first serve: 2 -> 3.
    for (let c = 2; c < 4; c += 0.05) f.step(frameAt(SERVING), c, []);
    expect(heard).toEqual([3]);
    expect(f.watching).toBe(3);
    // Heavy errors held 5 s in the district surge: 3 -> 1.
    const surge = BROWNOUT.challenges.c4 + 10;
    for (let c = 4; c < 12; c += 0.05) f.step(frameAt({ ...SERVING, now: surge, errorShare: 0.7 }), c, []);
    expect(heard).toEqual([3, 1]);
    // Dark at midnight: 0.
    f.step(frameAt({ ...SERVING, now: surge, midnight: { held: false } }), 12.05, []);
    expect(heard).toEqual([3, 1, 0]);
    expect(heard.every((n) => n >= 0 && n <= 4)).toBe(true);
    f.detach();
  });

  it('reseeds on a rewind and lets the rewound cues post again', () => {
    const b = new Bus();
    const f = new ChatFeed(0);
    f.attach(b);
    b.emit('cue', { id: 'C1.chat.01', kind: 'chat', at: 1 });
    b.emit('cue', { id: 'C6.fail.chat', kind: 'chat', at: 2 });
    expect(f.state.silenced).toBe(true);
    const rewind = { at: 300, to: 270, by: 'player', cause: 'trust' };
    f.step(frameAt({ rewinds: [rewind] }), 3, []);
    expect(f.state.silenced).toBe(false);
    expect(f.lastEvent).toBe('rewind');
    expect(f.state.feed.slice(-4).map((r) => r.id)).toEqual(SEED_IDS);
    b.emit('cue', { id: 'C1.chat.01', kind: 'chat', at: 4 });
    expect(f.state.feed.filter((r) => r.id === 'C1.chat.01')).toHaveLength(2);
    // Only once per rewind.
    f.step(frameAt({ rewinds: [rewind] }), 3.05, []);
    expect(f.state.feed.filter((r) => r.id === 'C0.chat.01')).toHaveLength(2);
    f.detach();
  });

  it('starts over on a new run (reset): fresh feed, seeded, posts counted from zero', () => {
    const b = new Bus();
    const heard: number[] = [];
    b.on('audience', (e) => heard.push(e.watching));
    const f = new ChatFeed(0);
    f.attach(b);
    for (let c = 0.05; c < 3; c += 0.05) f.step(frameAt(SERVING), c, []);
    expect(f.watching).toBe(3);
    f.reset(50);
    expect(f.state.feed.map((r) => r.id)).toEqual(SEED_IDS);
    expect(f.posts).toBe(4);
    // The title is told the count went back to the start.
    expect(heard).toEqual([3, 2]);
    f.detach();
  });

  it('keeps hud.chat block and stream and adds the feed fields; hud.audience.watching is null, then 0..4', () => {
    const b = new Bus();
    const { scene } = stubScene();
    const view = new ChatFeedView();
    view.create(scene, hostOn(scene, b));
    view.update(frameAt(), clockAt(0.05), []);
    let h = hudRead();
    const chat = h.chat as ChatTestState;
    for (const key of [
      'block',
      'stream',
      'feed',
      'shown',
      'lastEvent',
      'quietUntil',
      'silenced',
      'left',
      'posts',
      'clock',
      'filter',
      'header',
    ]) {
      expect(chat, key).toHaveProperty(key);
    }
    expect(chat.block).toEqual([
      "kenji: lux the net's doing the thing again",
      'young father: I need to call my son at midnight!!',
      'mrs okafor: Countdown stream keeps freezing. Is it you or the rain?',
      'kenji: lux pls',
    ]);
    expect(chat.stream).toEqual([]);
    expect(chat.feed).toHaveLength(4);
    expect(chat.quietUntil).toBeNull();
    expect(chat.filter).toBe('all');
    expect(chat.header).toMatchObject({ title: 'LIVE CHAT', tag: 'BLOCK + STREAM' });
    expect(h.audience).toEqual({ watching: null });
    b.emit('cue', { id: 'C1.chat.02', kind: 'chat', at: 1 });
    for (let c = 1; c < 3; c += 0.05) view.update(frameAt(SERVING), clockAt(c), []);
    h = hudRead();
    // The scripted line first, then the first serve's hype burst pours in on top.
    const feed = (h.chat as ChatTestState).feed;
    expect(feed.find((r) => r.id === 'C1.chat.02')).toMatchObject({ chat: 'stream', scripted: true });
    expect(feed.filter((r) => r.cause === 'hype').length).toBeGreaterThanOrEqual(HYPE_BURST.min);
    expect(h.audience).toEqual({ watching: 3 });
    view.shutdown();
  });

  it('removes its bus handlers on shutdown, so a restarted scene never double-posts', () => {
    const b = new Bus();
    const first = stubScene();
    const a = new ChatFeedView();
    a.create(first.scene, hostOn(first.scene, b));
    // cue, line, coachNudge and action.
    expect(a.feed.listening).toBe(4);
    a.shutdown();
    expect(a.feed.listening).toBe(0);
    expect(first.down).toHaveLength(0);
    // The scene restarts: a fresh view on the same bus.
    const second = stubScene();
    const v = new ChatFeedView();
    v.create(second.scene, hostOn(second.scene, b));
    b.emit('cue', { id: 'C1.chat.01', kind: 'chat', at: 2 });
    expect(v.feed.state.feed.filter((r) => r.id === 'C1.chat.01')).toHaveLength(1);
    expect(a.feed.state.feed.filter((r) => r.id === 'C1.chat.01')).toHaveLength(0);
    expect((hudRead().chat as ChatTestState).feed.filter((r) => r.id === 'C1.chat.01')).toHaveLength(1);
    v.shutdown();
  });

  it('reads the routing at most once per frame, from the shared Frame and never from run()', () => {
    const f = new ChatFeed(0);
    let reads = 0;
    const base = frameAt(SERVING);
    const counted = new Proxy(base, {
      get: (t, k) => {
        if (k === 'flow') reads++;
        return Reflect.get(t, k);
      },
    });
    for (let i = 1; i <= 50; i++) {
      const before = reads;
      f.step(counted, i * 0.05, []);
      expect(reads - before).toBeLessThanOrEqual(1);
    }
    // No chat file reaches for the run; the HUD no longer routes the board for the old filler.
    for (const [name, src] of Object.entries(CHAT_SOURCES)) {
      // Code only: the comments may say what the chat never does.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, name).not.toMatch(/game\/run'/);
      expect(code, name).not.toMatch(/\brun\(\)/);
    }
    expect(hudSceneSource).not.toMatch(/errorShare\(r\.flow/);
  });
});

// ---- chat-4: the merged LIVE CHAT panel ----

/** A view on a stub scene, its bus and its pointer handlers. */
function liveView(): { view: ChatFeedView; bus: Bus; click: (x: number, y: number) => void } {
  const b = new Bus();
  const { scene, down } = stubScene();
  const view = new ChatFeedView();
  view.create(scene, hostOn(scene, b));
  return { view, bus: b, click: (x, y) => down.forEach((fn) => fn({ x, y })) };
}

const chatRead = (): ChatTestState => hudRead().chat as ChatTestState;

describe('the LIVE CHAT panel (chat-4)', () => {
  // Layout A2 (Rolando, 30 Oct 2026): the chat is the tall slim left column (410x680), its text
  // bigger, so the body fits up to fourteen rows (nine when every row wraps) at y 430-1050.
  it('fits the newest nine to fourteen rows into the 620 px body, bottom-up', () => {
    const one = { text: 'x'.repeat(ONE_LINE_CHARS) };
    const two = { text: 'x'.repeat(ONE_LINE_CHARS + 1) };
    expect(rowHeight(one.text)).toBe(43);
    expect(rowHeight(two.text)).toBe(63);
    expect(fitRows(Array(20).fill(one), 16)).toHaveLength(14);
    expect(fitRows(Array(20).fill(two), 16)).toHaveLength(9);
    // The worst mix still leaves nine, the newest ones.
    const mix = [one, two, two, two, one, two, two, one, two, two, two, one, two, two, two, two, one, two];
    const fit = fitRows(mix, 16);
    expect(fit.length).toBeGreaterThanOrEqual(9);
    expect(fit[fit.length - 1]).toBe(mix[mix.length - 1]);
    for (const rows of [Array(14).fill(one), Array(9).fill(two), fit]) {
      const heights = rows.map((r: { text: string }) => rowHeight(r.text));
      const tops = stackRows(heights);
      // Inside y 430-1050, the newest on the bottom edge, none over the header.
      expect(tops[0]).toBeGreaterThanOrEqual(CHAT_BODY.y);
      expect(CHAT_BODY.y).toBe(430);
      expect(CHAT_BODY.y + CHAT_BODY.h).toBe(1050);
      expect(tops[tops.length - 1] + heights[heights.length - 1]).toBe(1050);
      for (let i = 1; i < tops.length; i++) expect(tops[i]).toBe(tops[i - 1] + heights[i - 1]);
    }
    expect(CHAT_HEADER).toEqual({ x: 6, y: 390, w: 410, h: 40 });
  });

  it('draws block rows with painted avatars and amber names, stream rows with a cyan ring and a handle', () => {
    const blockRow = { ...chatEntry('C1.chat.01'), chat: 'block' as const, cause: 'served', at: 0 };
    const look = rowLook({ ...blockRow, complaint: false, thanks: false, system: false }, BLOCK_AVATARS);
    expect(look).toMatchObject({ avatar: 'chars/avatars/mrs-okafor', ring: null, nameColor: 'amber' });
    expect(look.name).toBe('mrs okafor');
    const stream = rowLook(
      {
        ...chatEntry('C1.chat.02'),
        chat: 'stream',
        cause: 'served',
        at: 0,
        complaint: false,
        thanks: false,
        system: false,
      },
      BLOCK_AVATARS,
    );
    expect(stream).toMatchObject({ avatar: null, ring: 'cyan', nameColor: 'cyan' });
    expect(VIEWER_HANDLES).toContain(stream.name);
    expect(stream.name).toBe(handleFor('C1.chat.02'));
    expect(stream.initial).toBe(stream.name[0].toUpperCase());
    const system = rowLook(
      {
        ...chatEntry('C4.chat.03'),
        chat: 'block',
        cause: 'cue',
        at: 0,
        complaint: false,
        thanks: false,
        system: true,
      },
      BLOCK_AVATARS,
    );
    expect(system).toMatchObject({ rule: true, avatar: null, ring: null, name: 'Lux_Net' });
    expect(tickOf({ cause: 'errorsRising', complaint: true, thanks: false })).toBe('red');
    expect(tickOf({ cause: 'recovered', complaint: false, thanks: true })).toBe('amber');
    expect(tickOf({ cause: 'filler', complaint: false, thanks: false })).toBe('cyan');
    // No purple dot stand-in any more.
    expect(chatFeedSource).not.toMatch(/0x6a3fb5/i);
    expect(chatFeedSource).not.toMatch(/\bdot\b/);
  });

  it('shows the newest rows bottom-up in the body with words, badges and names, in the view', () => {
    const { view, bus: b } = liveView();
    const posts: [LineId, number][] = [
      ['C1.chat.02', 1],
      ['C3.chat.01', 2],
      ['C3.chat.03', 3],
      ['C4.chat.03', 4],
      ['C6.chat.hold.01', 5],
      ['C1.chat.01', 6],
    ];
    for (const [id, at] of posts) b.emit('cue', { id, kind: 'chat', at });
    view.update(frameAt(), clockAt(6.5), []);
    const c = chatRead();
    // The tall layout A2 column (Rolando, 30 Oct 2026) has room for every one of the six posts.
    expect(c.rows.length).toBeGreaterThanOrEqual(6);
    expect(c.rows.length).toBeLessThanOrEqual(16);
    expect(c.rows.map((r) => r.id)).toEqual(c.feed.slice(-c.rows.length).map((r) => r.id));
    const last = c.rows[c.rows.length - 1];
    expect(last.y + last.h).toBe(1050);
    for (const r of c.rows) {
      expect(r.y, r.id).toBeGreaterThanOrEqual(430);
      expect(r.y + r.h, r.id).toBeLessThanOrEqual(1050);
      expect(r.x).toBe(26);
      if (r.chat === 'stream') {
        expect(r).toMatchObject({ ring: 'cyan', nameColor: 'cyan', avatar: null });
        expect(VIEWER_HANDLES).toContain(r.name);
      } else if (r.rule) {
        expect(r.name).toBe('Lux_Net');
      } else {
        expect(r.nameColor, r.id).toBe('amber');
        expect(r.avatar !== null || r.ring === 'amber', r.id).toBe(true);
      }
    }
    expect(c.rows.find((r) => r.id === 'C1.chat.01')?.avatar).toBe('chars/avatars/mrs-okafor');
    expect(c.rows.find((r) => r.id === 'C6.chat.hold.01')?.ring).toBe('amber');
    view.shutdown();
  });

  it('toggles BLOCK ONLY from a header click, and the tag says so', () => {
    const { view, bus: b, click } = liveView();
    b.emit('cue', { id: 'C1.chat.02', kind: 'chat', at: 1 });
    view.update(frameAt(), clockAt(1.5), []);
    expect(chatRead().rows.some((r) => r.chat === 'stream')).toBe(true);
    // A click in the body does nothing; one on the header toggles (y 390-430 since layout A2).
    click(200, 700);
    expect(chatRead().filter).toBe('all');
    click(200, 410);
    let c = chatRead();
    expect(c.filter).toBe('block');
    expect(c.header.tag).toBe(CHAT_TEXT.block);
    expect(c.rows.every((r) => r.chat === 'block')).toBe(true);
    click(200, 410);
    c = chatRead();
    expect(c.filter).toBe('all');
    expect(c.header.tag).toBe(CHAT_TEXT.all);
    // The header's words stay plain: no debrief term.
    for (const w of Object.values(CHAT_TEXT)) {
      expect(w.toLowerCase()).not.toMatch(/balancer|headroom|capacity|throughput|scal|redundan/);
    }
    view.shutdown();
  });

  it('fades the newest row in over 150 ms, and shows it at once under reduce flicker', () => {
    expect(arrivalAlpha(0, false)).toBe(0);
    expect(arrivalAlpha(ARRIVAL_FADE / 2, false)).toBeCloseTo(0.5);
    expect(arrivalAlpha(ARRIVAL_FADE, false)).toBe(1);
    expect(arrivalAlpha(0, true)).toBe(1);

    const { view, bus: b } = liveView();
    updateSettings({ reduceFlicker: false });
    view.update(frameAt(), clockAt(1), []);
    b.emit('cue', { id: 'C1.chat.01', kind: 'chat', at: 1 });
    view.update(frameAt(), clockAt(1.03), []);
    let newest = chatRead().rows.at(-1)!;
    expect(newest.id).toBe('C1.chat.01');
    expect(newest.alpha).toBeLessThan(1);
    view.update(frameAt(), clockAt(1.2), []);
    expect(chatRead().rows.at(-1)!.alpha).toBe(1);

    updateSettings({ reduceFlicker: true });
    b.emit('cue', { id: 'C1.chat.02', kind: 'chat', at: 2 });
    view.update(frameAt(), clockAt(2), []);
    newest = chatRead().rows.at(-1)!;
    expect(newest.id).toBe('C1.chat.02');
    expect(newest.alpha).toBe(1);
    updateSettings({ reduceFlicker: false });
    view.shutdown();
  });

  it('sits the rows back to alpha 0.4 while the chat is silent', () => {
    const { view, bus: b } = liveView();
    // Before the first filler (2 s at the earliest), so no row is still fading in.
    view.update(frameAt(), clockAt(1.5), []);
    b.emit('cue', { id: 'C6.fail.chat', kind: 'chat', at: 1.5 });
    view.update(frameAt(), clockAt(1.55), []);
    const c = chatRead();
    expect(c.silenced).toBe(true);
    expect(c.rows.every((r) => r.alpha === 0.4)).toBe(true);
    view.shutdown();
  });

  it('reports hud.chat.shown as visibleRows(feed, filter).length on every hook read', () => {
    const { view, bus: b, click } = liveView();
    const placed: Occurrence = { kind: 'placed', id: 'server-1', at: 120 };
    const ids: LineId[] = [
      'C1.chat.01',
      'C1.chat.02',
      'C3.chat.01',
      'C3.chat.02',
      'C3.chat.03',
      'C4.chat.03',
    ];
    let reads = 0;
    for (let i = 1; i <= 2400; i++) {
      const clock = i * 0.05;
      if (i % 200 === 0 && ids.length > 0) b.emit('cue', { id: ids.shift()!, kind: 'chat', at: clock });
      if (i % 333 === 0) click(1700, 820);
      const errors = i > 1200 && i < 1500 ? 0.4 : 0;
      view.update(frameAt({ ...SERVING, errorShare: errors }), clockAt(clock), i % 150 === 0 ? [placed] : []);
      if (i % 10 === 0) {
        const c = chatRead();
        expect(c.shown).toBe(visibleRows(c.feed as unknown as ChatRow[], c.filter).length);
        expect(c.rows).toHaveLength(c.shown);
        expect(c.shown).toBeGreaterThanOrEqual(Math.min(4, c.feed.length));
        reads++;
      }
    }
    expect(reads).toBe(240);
    expect(chatRead().posts).toBeGreaterThan(10);
    view.shutdown();
  });
});

// ---- chat-6: the art drop-in (wide plate, stream avatars, system glyph); chat-pop stays off ----

/** Every texture key a stub scene was asked to load or draw, by call. */
interface ArtCalls {
  load: string[];
  image: string[];
  nineslice: string[];
  setTexture: string[];
}

/**
 * A stub scene whose texture manager holds `present` (and every texture baked on it), and which
 * records each texture key it is asked to load or draw, so a test can say what drew and that
 * nothing asked to draw a texture that is not there (Phaser's missing-texture warning).
 */
function artScene(present: (key: string) => boolean): { scene: Phaser.Scene; calls: ArtCalls } {
  const calls: ArtCalls = { load: [], image: [], nineslice: [], setTexture: [] };
  const baked = new Set<string>();
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === 'then' || typeof k === 'symbol') return undefined;
      if (k === 'width' || k === 'height') return 0;
      if (k === 'image' || k === 'nineslice' || k === 'setTexture')
        return (...args: unknown[]) => {
          calls[k].push(String(k === 'setTexture' ? args[0] : args[2]));
          return chain;
        };
      return chain;
    },
    apply: () => chain,
  });
  const textures = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'exists') return (key: string) => baked.has(key) || present(key);
        if (k === 'addDynamicTexture')
          return (key: string) => {
            baked.add(key);
            return chain;
          };
        return chain;
      },
    },
  );
  const scene = {
    add: chain,
    make: chain,
    textures,
    load: {
      image: (key: string) => {
        calls.load.push(key);
        return chain;
      },
    },
    tweens: chain,
    input: { on: () => undefined, off: () => undefined },
    game: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }) } },
  };
  return { scene: scene as unknown as Phaser.Scene, calls };
}

/** The view on an art scene, with a stream row (C1.chat.02) and a system row (C4.chat.03) posted. */
function artView(
  picked: (key: string) => boolean,
  present: (key: string) => boolean,
  rect: Rect = PAINTED_CHAT,
) {
  const b = new Bus();
  const s = artScene(present);
  const view = new ChatFeedView(picked);
  view.preload(s.scene);
  view.create(s.scene, hostOn(s.scene, b, rect));
  // Let the first serve's hype burst pour in and settle first, then the two rows under test post.
  for (let c = 0.05; c < 3.5; c += 0.05) view.update(frameAt(SERVING), clockAt(c), []);
  b.emit('cue', { id: 'C1.chat.02', kind: 'chat', at: 3.5 });
  b.emit('cue', { id: 'C4.chat.03', kind: 'chat', at: 3.55 });
  for (let c = 3.5; c < 3.7; c += 0.05) view.update(frameAt(SERVING), clockAt(c), []);
  return { view, ...s };
}

/** The chat's requested keys (docs/ART-REQUESTS.md), as the texture keys they load and draw as. */
const CHAT_ART_KEYS = [CHAT_PLATE_WIDE, SYSTEM_GLYPH, ...STREAM_AVATARS];
const CHAT_ART_TEXTURES = CHAT_ART_KEYS.map((k) => artTexture(k));

describe('the chat art drop-in (chat-6)', () => {
  it('reads what has landed from the manifest: every chat key falls back to code until its cut is set', () => {
    const picked = (key: string) => {
      const r = artRequest(key);
      return r !== undefined && isPicked(r);
    };
    expect(chatArtOf()).toEqual({
      plate: picked(CHAT_PLATE_WIDE) ? 'wide' : 'portrait',
      streamAvatars: STREAM_AVATARS.every(picked),
      systemGlyph: picked(SYSTEM_GLYPH),
    });
    expect(chatArtOf(() => false)).toEqual({ plate: 'portrait', streamAvatars: false, systemGlyph: false });
    expect(chatArtOf(() => true)).toEqual({ plate: 'wide', streamAvatars: true, systemGlyph: true });
    // One stream avatar short of the set keeps the rings: the rows never mix rings and faces.
    expect(chatArtOf((k) => k !== STREAM_AVATARS[3]).streamAvatars).toBe(false);
    for (const key of CHAT_ART_KEYS) {
      const r = artRequest(key);
      expect(r?.lane, key).toBe('chat');
      expect(r?.fallback, key).toBeDefined();
    }
  });

  it('gives a viewer the same painted avatar every time, and swaps the ring and the rule only once the art is in', () => {
    for (const handle of VIEWER_HANDLES) {
      expect(STREAM_AVATARS).toContain(streamAvatarFor(handle));
      expect(streamAvatarFor(handle)).toBe(streamAvatarFor(handle));
    }
    const base = { cause: 'served' as const, at: 0, complaint: false, thanks: false };
    const stream = rowLook(
      { ...chatEntry('C1.chat.02'), chat: 'stream', ...base, system: false },
      BLOCK_AVATARS,
    );
    const system = rowLook(
      { ...chatEntry('C4.chat.03'), chat: 'block', ...base, system: true },
      BLOCK_AVATARS,
    );
    const block = rowLook(
      { ...chatEntry('C1.chat.01'), chat: 'block', ...base, system: false },
      BLOCK_AVATARS,
    );
    const none = chatArtOf(() => false);
    const all = chatArtOf(() => true);
    for (const look of [stream, system, block]) expect(lookWithArt(look, none)).toBe(look);
    expect(lookWithArt(block, all)).toBe(block);
    expect(lookWithArt(stream, all)).toMatchObject({
      avatar: streamAvatarFor(stream.name),
      ring: null,
      nameColor: 'cyan',
      name: stream.name,
    });
    expect(lookWithArt(system, all)).toMatchObject({ avatar: SYSTEM_GLYPH, rule: false, name: system.name });
  });

  it('with the art present, the plate is the wide one and stream rows show painted avatars', () => {
    const { view, calls } = artView(
      () => true,
      () => true,
    );
    expect(hudRead().chatArt).toEqual({ plate: 'wide', streamAvatars: true, systemGlyph: true });
    // The landed plate draws nine-sliced (CHAT_PLATE_K) so its header band sits in the header strip.
    expect(calls.nineslice).toContain(artTexture(CHAT_PLATE_WIDE));
    expect(calls.nineslice).not.toContain('hud:chat-panel');
    const rows = chatRead().rows;
    const stream = rows.filter((r) => r.chat === 'stream');
    expect(stream.length).toBeGreaterThan(0);
    for (const r of stream) {
      expect(r.avatar).toMatch(/^chars\/avatars\/stream-[1-4]$/);
      expect(r).toMatchObject({ ring: null, nameColor: 'cyan' });
    }
    expect(rows.find((r) => r.id === 'C4.chat.03')).toMatchObject({
      avatar: SYSTEM_GLYPH,
      rule: false,
      ring: null,
    });
    expect(calls.setTexture).toContain(artTexture(SYSTEM_GLYPH));
    view.shutdown();
  });

  it('without the art, the code fallbacks draw and nothing loads or draws a texture that is not there', () => {
    const present = (key: string) => !CHAT_ART_TEXTURES.includes(key);
    const { view, calls } = artView(() => false, present);
    expect(hudRead().chatArt).toEqual({ plate: 'portrait', streamAvatars: false, systemGlyph: false });
    expect(calls.nineslice).toContain('hud:chat-panel');
    for (const key of CHAT_ART_TEXTURES) {
      expect(calls.load, key).not.toContain(key);
      expect(calls.image, key).not.toContain(key);
      expect(calls.setTexture, key).not.toContain(key);
    }
    const rows = chatRead().rows;
    for (const r of rows.filter((x) => x.chat === 'stream'))
      expect(r).toMatchObject({ avatar: null, ring: 'cyan' });
    expect(rows.find((r) => r.id === 'C4.chat.03')).toMatchObject({ avatar: null, rule: true });
    view.shutdown();
  });

  it('draws the see-through code glass in the tall layout A2 column, with the painted avatars still on', () => {
    // Neither painted plate can fill 410x680 at or under 1:1 (Rolando's layout A2, 30 Oct 2026).
    expect(plateFits(artRequest(CHAT_PLATE_WIDE)!.cut!, ZONES.chat, CHAT_PLATE_K, CHAT_PLATE_SLICE)).toBe(
      false,
    );
    expect(plateFits(CHAT_PANEL_FILE, ZONES.chat, CHAT_PANEL_K, CHAT_PANEL_SLICE)).toBe(false);
    expect(chatPlateFor('portrait', ZONES.chat)).toBe('portrait');
    expect(plateFits(artRequest(CHAT_PLATE_WIDE)!.cut!, PAINTED_CHAT, CHAT_PLATE_K, CHAT_PLATE_SLICE)).toBe(
      true,
    );
    expect(chatPlateFor('wide', ZONES.chat)).toBe('glass');
    expect(chatPlateFor('wide', PAINTED_CHAT)).toBe('wide');
    expect(CHAT_GLASS.alpha).toBeLessThan(1);
    const { view, calls } = artView(
      () => true,
      () => true,
      ZONES.chat,
    );
    expect(hudRead().chatArt).toEqual({ plate: 'glass', streamAvatars: true, systemGlyph: true });
    expect(calls.nineslice).not.toContain(artTexture(CHAT_PLATE_WIDE));
    expect(calls.nineslice).not.toContain('hud:chat-panel');
    view.shutdown();
  });

  it('falls back the same way when a picked file did not load, so a missing texture is never drawn', () => {
    const present = (key: string) => !CHAT_ART_TEXTURES.includes(key);
    const { view, calls } = artView(() => true, present);
    // Queued (the manifest says picked), then not drawn because the texture is not in.
    expect(calls.load).toContain(artTexture(CHAT_PLATE_WIDE));
    expect(hudRead().chatArt).toEqual({ plate: 'portrait', streamAvatars: false, systemGlyph: false });
    for (const key of CHAT_ART_TEXTURES) {
      expect(calls.image, key).not.toContain(key);
      expect(calls.setTexture, key).not.toContain(key);
    }
    view.shutdown();
  });

  it("with Rolando's picks in the manifest, every chat piece draws its painted art, the neighbour too", () => {
    // The shipped manifest (no stand-in for `picked`): all of the chat's requested keys have landed.
    expect(chatArtOf()).toEqual({ plate: 'wide', streamAvatars: true, systemGlyph: true });
    for (const key of [...CHAT_ART_KEYS, 'chars/avatars/unnamed-neighbour']) {
      const r = artRequest(key);
      expect(r !== undefined && isPicked(r), key).toBe(true);
    }
    // A fresh scene queues every landed chat file, the neighbour's disc with the block's.
    const empty = artScene(() => false);
    new ChatFeedView().preload(empty.scene);
    for (const key of [...CHAT_ART_KEYS, 'chars/avatars/unnamed-neighbour'])
      expect(empty.calls.load, key).toContain(artTexture(key));
    const b = new Bus();
    const s = artScene(() => true);
    const view = new ChatFeedView();
    view.preload(s.scene);
    view.create(s.scene, hostOn(s.scene, b, PAINTED_CHAT));
    b.emit('cue', { id: 'C4.chat.seed', kind: 'chat', at: 1 });
    for (let c = 1; c < 2; c += 0.05) view.update(frameAt(SERVING), clockAt(c), []);
    expect(s.calls.nineslice).toContain(artTexture(CHAT_PLATE_WIDE));
    expect(chatRead().rows.find((r) => r.id === 'C4.chat.seed')).toMatchObject({
      avatar: 'chars/avatars/unnamed-neighbour',
      ring: null,
      nameColor: 'amber',
    });
    view.shutdown();
  });

  it('keeps chat-pop off: no chat sound key, and the chat files play no sound', () => {
    expect(isSfxKey('chat-pop')).toBe(false);
    for (const [name, src] of Object.entries(CHAT_SOURCES)) {
      expect(src, name).not.toMatch(/chat-pop/);
      expect(src, name).not.toMatch(/\.sound\.|playSfx|emit\(\s*'sfx'/);
    }
  });
});

// ---- the cap counts scripted rows: they wait their turn, paced rows yield to them ----

describe('the 10 per 30 s cap with scripted rows', () => {
  const DT = 0.05;
  /** A served block in the district surge, errors heavy. */
  const SURGE: ChatInputs = {
    clock: 0,
    now: 300,
    errorShare: 0.6,
    retry: 0,
    served: 30,
    servingBoxes: 1,
    surgeAt: null,
    midnightHeld: false,
    midnightDark: false,
    rewinds: 0,
  };
  const occ = (kind: 'placed' | 'wired' | 'skipped' | 'hot', at: number, id: string): ChatEvent =>
    ({ kind: 'occurrence', occurrence: { kind, id, at } }) as ChatEvent;

  /** The most rows inside any 30 s of chat clock (the browser spec's count). */
  const most = (rows: readonly ChatRow[]): number => {
    const at = rows.map((r) => r.at).sort((a, b) => a - b);
    let best = 0;
    for (let i = 0, j = 0; i < at.length; i++) {
      while (at[i] - at[j] >= CHAT_PACE.windowSeconds) j++;
      best = Math.max(best, i - j + 1);
    }
    return best;
  };

  /** A chat with `n` posts already inside the window at `at`. */
  const full = (rand: () => number, n: number = CHAT_PACE.windowMax, at = 1): ChatState => ({
    ...initialChat(0, rand),
    servedOnce: true,
    servingMax: 1,
    watching: 3,
    recent: Array.from({ length: n }, () => at),
    lastPostAt: at,
  });

  it('a surge of scripted cues, reactions and filler never paces more than windowMax in 30 s, and every scripted id posts, in order', () => {
    const rand = seededRandom(7);
    let s: ChatState = { ...initialChat(0, rand), servedOnce: true, servingMax: 1, watching: 3 };
    const rows: ChatRow[] = [];
    // The surge's scripted ids, cued close together as the autopilot night does.
    const cues: [number, LineId][] = [
      [2, 'C3.chat.01'],
      [3, 'C3.chat.02'],
      [6, 'C4.chat.01'],
      [7, 'C4.chat.02'],
      [9, 'C4.chat.03'],
      [11, 'C4.chat.04'],
      [12, 'C4.chat.cut'],
      [14, 'C3.chat.03'],
      [40, 'C5.chat.01'],
    ];
    const seeded = postScripted(s, 'C1.chat.01', 0.5, rand);
    s = seeded.state;
    rows.push(...seeded.posts);
    for (let i = 1; i <= 90 / DT; i++) {
      const clock = i * DT;
      for (const [at, id] of cues) {
        if (Math.abs(at - clock) < DT / 2) {
          const p = postScripted(s, id, clock, rand);
          s = p.state;
          rows.push(...p.posts);
        }
      }
      const ev = i % 20 === 0 ? [occ(i % 40 === 0 ? 'placed' : 'wired', clock, `p${i}`)] : [];
      const step = stepChat(s, { ...SURGE, clock, errorShare: clock < 38 ? 0.6 : 0 }, ev, rand);
      s = step.state;
      rows.push(...step.posts);
    }
    // A hype burst's rows sit on top of the window; everything else is paced.
    expect(most(rows.filter((r) => r.cause !== 'hype'))).toBeLessThanOrEqual(CHAT_PACE.windowMax);
    const scripted = rows.filter((r) => r.scripted).map((r) => r.id);
    // Every cue posted except a complaint whose errors stopped first (none here), in cue order.
    expect(scripted).toEqual(['C1.chat.01', ...cues.map(([, id]) => id)]);
    expect(s.waiting).toEqual([]);
    // Paced rows were there too, so the cap was really contested.
    expect(rows.filter((r) => !r.scripted).length).toBeGreaterThan(0);
  });

  it('holds a scripted row that would break the cap, in order, and posts it first as the window frees', () => {
    const rand = seededRandom(3);
    let s = full(rand);
    const a = postScripted(s, 'C4.chat.01', 2, rand);
    expect(a.posts).toBe(NO_POSTS);
    s = a.state;
    // A later cue queues behind it even once room appears: order holds.
    s = postScripted(s, 'C4.chat.03', 2.5, rand).state;
    expect(s.waiting.map((w) => w.id)).toEqual(['C4.chat.01', 'C4.chat.03']);
    // Once a cue waits, its reaction is cooling: the generic complaint does not double it.
    expect(s.cooldown.errorsBlock).toBeGreaterThan(2);
    // While they wait nothing paced posts, whatever piles up in the queue.
    const posted: ChatRow[] = [];
    let clock = 2;
    while (clock < 30.9) {
      clock += DT;
      const ev = Math.abs(clock - 20) < DT / 2 ? [occ('placed', clock, 'srv')] : [];
      const step = stepChat(s, { ...SURGE, clock }, ev, rand);
      s = step.state;
      posted.push(...step.posts);
    }
    expect(posted).toEqual([]);
    expect(s.waiting).toHaveLength(2);
    // The window frees at 31: both post at once, scripted, in cue order, before any paced row.
    const step = stepChat(s, { ...SURGE, clock: 31.05 }, [], rand);
    expect(step.posts.map((r) => r.id)).toEqual(['C4.chat.01', 'C4.chat.03']);
    expect(step.posts.every((r) => r.scripted && r.at === 31.05)).toBe(true);
    expect(step.state.waiting).toEqual([]);
    // Mrs Okafor leaves when her row posts, not when it was cued.
    expect(s.left).toEqual([]);
    expect(step.state.left).toEqual(['mrs okafor']);
  });

  it('paced filler yields to a waiting scripted row: no filler while one waits, and filler only after it', () => {
    const rand = seededRandom(5);
    let s: ChatState = { ...full(rand, CHAT_PACE.windowMax - 1, 0.5), nextFillerAt: 0 };
    s = postScripted(s, 'C3.chat.01', 1, rand).state;
    // The one free slot went to the scripted row.
    expect(s.feed.map((r) => r.id)).toEqual(['C3.chat.01']);
    s = postScripted(s, 'C3.chat.02', 1.1, rand).state;
    expect(s.waiting.map((w) => w.id)).toEqual(['C3.chat.02']);
    const rows: ChatRow[] = [];
    for (let clock = 1.1; clock < 45; clock += DT) {
      const step = stepChat(s, { ...SURGE, errorShare: 0, clock }, [], rand);
      s = step.state;
      rows.push(...step.posts);
    }
    const first = rows[0];
    expect(first).toMatchObject({ id: 'C3.chat.02', scripted: true });
    expect(first.at).toBeGreaterThanOrEqual(30.5 - 1e-9);
    expect(rows.slice(1).every((r) => r.at >= first.at)).toBe(true);
    expect(rows.some((r) => r.cause === 'filler')).toBe(true);
  });

  it('lets a droppable scripted row go at a full window, never posting it late', () => {
    expect(DROPPABLE_SCRIPTED.size).toBe(0);
    const rand = seededRandom(9);
    let s = full(rand);
    const d = postScripted(s, 'C4.chat.04', 2, rand, undefined, true);
    expect(d.posts).toBe(NO_POSTS);
    expect(d.state.waiting).toEqual([]);
    expect(d.state.scripted).toContain('C4.chat.04');
    s = d.state;
    for (let clock = 2; clock < 40; clock += DT) s = stepChat(s, { ...SURGE, clock }, [], rand).state;
    expect(s.feed.some((r) => r.id === 'C4.chat.04')).toBe(false);
    // With room, a droppable row posts at once like any other.
    const room = postScripted({ ...full(rand, 0), scripted: [] }, 'C4.chat.04', 2, rand, undefined, true);
    expect(room.posts.map((r) => r.id)).toEqual(['C4.chat.04']);
  });

  it('drops a waiting complaint whose errors stopped, and clears the wait on the dark silence and a rewind', () => {
    const rand = seededRandom(11);
    let s = postScripted(full(rand), 'C4.chat.01', 2, rand).state;
    s = postScripted(s, 'C3.chat.02', 2.1, rand).state;
    const calm = stepChat(s, { ...SURGE, errorShare: 0, clock: 31.05 }, [], rand);
    // The complaint goes (whileErrors); the surge row behind it posts.
    expect(calm.posts.map((r) => r.id)).toEqual(['C3.chat.02']);

    const waiting = postScripted(full(rand), 'C4.chat.02', 2, rand).state;
    expect(waiting.waiting).toHaveLength(1);
    const dark = postScripted(waiting, 'C6.fail.chat', 3, rand).state;
    expect(dark.waiting).toEqual([]);
    const darkOcc: ChatEvent = { kind: 'occurrence', occurrence: { kind: 'dark', at: 3 } as Occurrence };
    expect(stepChat(waiting, { ...SURGE, clock: 3 }, [darkOcc], rand).state.waiting).toEqual([]);
    expect(stepChat(waiting, { ...SURGE, clock: 3, rewinds: 1 }, [], rand).state.waiting).toEqual([]);
  });

  it('through the host loop: a cue at a full window waits on hud.chat.waiting and posts as the window frees', () => {
    const b = new Bus();
    const f = new ChatFeed(0);
    f.attach(b);
    // The four seeds sit in the window; ten cues fill it.
    const fill: LineId[] = [
      'C1.chat.01',
      'C1.chat.02',
      'C3.chat.01',
      'C3.chat.02',
      'C3.chat.03',
      'C4.chat.04',
      'C4.chat.01',
      'C4.chat.02',
      'C5.chat.01',
      'C6.chat.hold.01',
    ];
    expect(fill.length + 4).toBe(CHAT_PACE.windowMax);
    fill.forEach((id, i) => b.emit('cue', { id, kind: 'chat', at: 1 + i * 0.1 }));
    expect(f.posts).toBe(CHAT_PACE.windowMax);
    b.emit('cue', { id: 'C4.chat.cut', kind: 'chat', at: 2 });
    expect(f.posts).toBe(CHAT_PACE.windowMax);
    expect(f.state.waiting.map((w) => w.id)).toEqual(['C4.chat.cut']);
    f.step(frameAt(SERVING), 20, []);
    expect(f.state.feed.some((r) => r.id === 'C4.chat.cut')).toBe(false);
    // The seeds at 0 leave the window at 30.
    f.step(frameAt(SERVING), 30.05, []);
    // (The first serve's hype burst may post on the same frame; it sits outside the window.)
    expect(f.state.feed.filter((r) => r.cause !== 'hype').at(-1)).toMatchObject({
      id: 'C4.chat.cut',
      at: 30.05,
      scripted: true,
    });
    expect(f.state.waiting).toEqual([]);
    f.detach();
  });
});
