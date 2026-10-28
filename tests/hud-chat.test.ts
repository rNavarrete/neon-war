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
import { ChatFeed, ChatFeedView } from '../src/scenes/hud/ChatFeedView';
import { CHAT_PACE, SEED_IDS } from '../src/scenes/hud/chatEngine';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';
import { LESSON_IDS } from '../src/scenes/hud/lineMeta';
import { ZONES } from '../src/scenes/live/layout';
import type { LiveClock, LiveHost } from '../src/scenes/live/view';
import type { ChatTestState } from '../src/scenes/live/views/chat';
import { LINES } from '../src/strings';
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
    expect(fillerPool('block', 'ok')).toHaveLength(4);
    expect(fillerPool('block', 'slow')).toHaveLength(3);
    expect(fillerPool('stream', 'down')).toEqual(['fill.stream.down.01', 'fill.stream.down.02']);
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
    get: (_t, k) => (k === 'then' || typeof k === 'symbol' ? undefined : chain),
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

function hostOn(scene: Phaser.Scene, b: Bus): LiveHost {
  return { scene, bus: b, rect: ZONES.chat, flags: { lite: true } };
}

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
    b.emit('line', { id: lesson, speaker: LINES[lesson].speaker, tag: 'HINT', since: 1 });
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
    expect((h.chat as ChatTestState).stream).toEqual(['viewer: first try lol']);
    expect(h.audience).toEqual({ watching: 3 });
    view.shutdown();
  });

  it('removes its bus handlers on shutdown, so a restarted scene never double-posts', () => {
    const b = new Bus();
    const first = stubScene();
    const a = new ChatFeedView();
    a.create(first.scene, hostOn(first.scene, b));
    expect(a.feed.listening).toBe(3);
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
