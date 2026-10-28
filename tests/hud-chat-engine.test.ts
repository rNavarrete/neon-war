import { seededRandom } from '../src/scenes/hud/chat';
import {
  CHAT_PACE,
  type ChatEvent,
  type ChatInputs,
  type ChatRow,
  type ChatState,
  NO_POSTS,
  REACTIONS,
  SCRIPTED_REACTION,
  SURGE_WINDOWS,
  chatSetFor,
  fillerAllowed,
  initialChat,
  inSurge,
  postScripted,
  reactionLines,
  seedChat,
  stepChat,
  toggleFilter,
  viewersOf,
  visibleRows,
} from '../src/scenes/hud/chatEngine';
import { isLesson } from '../src/scenes/hud/lineMeta';
import type { Occurrence, OccurrenceKind } from '../src/game/occurrences';
import { BROWNOUT } from '../src/sim/brownout';
import type { LineId } from '../src/strings';

// chat-1: the pure chat model (src/scenes/hud/chatEngine.ts).

const C = BROWNOUT.challenges;
const DT = 0.05;

/** A quiet block in C2: served, no errors, no surge. */
const CALM: ChatInputs = {
  clock: 0,
  now: 120,
  errorShare: 0,
  retry: 0,
  served: 30,
  servingBoxes: 1,
  surgeAt: null,
  midnightHeld: false,
  midnightDark: false,
  rewinds: 0,
};

const occ = (kind: OccurrenceKind, at = 0, id?: string): ChatEvent => ({
  kind: 'occurrence',
  occurrence: (id === undefined ? { kind, at } : { kind, id, at }) as Occurrence,
});
const line = (id: LineId, lesson?: boolean): ChatEvent => ({ kind: 'line', id, lesson });

interface Sim {
  s: ChatState;
  rows: ChatRow[];
  rand: () => number;
}

/** A chat that has already seen the first serve, settled at `clock`. */
function sim(clock = 0, seed = 1): Sim {
  const rand = seededRandom(seed);
  const s: ChatState = { ...initialChat(clock, rand), servedOnce: true, servingMax: 1, watching: 3 };
  return { s, rows: [], rand };
}

/** Step `m` over (from, to] at DT frames; `events(clock)` may add events on a frame. */
function play(
  m: Sim,
  from: number,
  to: number,
  inputs: (clock: number) => Partial<ChatInputs>,
  events: (clock: number, i: number) => readonly ChatEvent[] = () => [],
): Sim {
  const n = Math.round((to - from) / DT);
  for (let i = 1; i <= n; i++) {
    const clock = from + i * DT;
    const step = stepChat(m.s, { ...CALM, ...inputs(clock), clock }, events(clock, i), m.rand);
    m.s = step.state;
    m.rows.push(...step.posts);
  }
  return m;
}

/** The most posts inside any 30 s window. */
function maxInWindow(rows: readonly ChatRow[]): number {
  let max = 0;
  for (const r of rows) {
    const n = rows.filter((q) => q.at >= r.at && q.at < r.at + CHAT_PACE.windowSeconds - 1e-9).length;
    max = Math.max(max, n);
  }
  return max;
}

describe('stepChat identity', () => {
  it('returns the identical state and NO_POSTS on a frame with no edges or events', () => {
    const m = sim(0);
    const s = m.s;
    // The first filler is due 6..10 s in: every frame before it changes nothing.
    for (let c = DT; c < 5.9; c += DT) {
      const step = stepChat(s, { ...CALM, clock: c }, [], m.rand);
      expect(step.state).toBe(s);
      expect(step.posts).toBe(NO_POSTS);
    }
    expect(NO_POSTS).toHaveLength(0);
    expect(Object.isFrozen(NO_POSTS)).toBe(true);
  });

  it('never mutates its inputs', () => {
    const m = sim(0);
    const s = Object.freeze({ ...m.s });
    const before = JSON.stringify(s);
    const events = Object.freeze([occ('placed', 1, 'server-1')]);
    const inputs = Object.freeze({ ...CALM, clock: 1, errorShare: 0.3 });
    const step = stepChat(s, inputs, events, m.rand);
    expect(step.state).not.toBe(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('complaints and thanks', () => {
  it('posts a block complaint only after errorShare > 0 has held 1 s, with complaint: true', () => {
    const m = play(sim(0), 0, 10, () => ({}));
    const start = 10;
    play(m, start, 20, () => ({ errorShare: 0.3 }));
    const complaints = m.rows.filter((r) => r.complaint);
    expect(complaints.length).toBeGreaterThan(0);
    for (const r of complaints) {
      expect(r.chat).toBe('block');
      expect(r.at - start).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(r.cause).toBe('errorsRising');
    }
    // Nothing in the first second of the spell is a complaint.
    expect(m.rows.filter((r) => r.at > start && r.at < start + 1 && r.complaint)).toEqual([]);
    // A blip shorter than 1 s never complains.
    const b = play(sim(0), 0, 10, () => ({}));
    play(b, 10, 20, (c) => ({ errorShare: c > 12 && c < 12.9 ? 0.3 : 0 }));
    expect(b.rows.some((r) => r.complaint)).toBe(false);
  });

  it('thanks only after a spell of at least 3 s ends and 3 s of calm follow', () => {
    // A 2 s spell: no thanks.
    const short = play(sim(0), 0, 10, () => ({}));
    play(short, 10, 30, (c) => ({ errorShare: c > 10 && c <= 12 ? 0.3 : 0 }));
    expect(short.rows.some((r) => r.thanks)).toBe(false);
    // A 4 s spell ending at 14: thanks at 17 or later, never before.
    const long = play(sim(0), 0, 10, () => ({}));
    play(long, 10, 30, (c) => ({ errorShare: c > 10 && c <= 14 ? 0.3 : 0 }));
    const thanks = long.rows.filter((r) => r.thanks);
    expect(thanks).toHaveLength(1);
    expect(thanks[0].at).toBeGreaterThanOrEqual(14 + 3 - 1e-9);
    expect(thanks[0].cause).toBe('recovered');
    expect(thanks[0].chat).toBe('block');
  });
});

describe('scripted ids and pace', () => {
  it('posts scripted ids at once, once, through the quiet and the cap, and cools their reaction', () => {
    const m = sim(0);
    // Quiet after a lesson line and a full window do not hold a scripted line back.
    let s = stepChat(m.s, { ...CALM, clock: 1 }, [line('C1.triage.06')], m.rand).state;
    expect(s.quietUntil).toBeCloseTo(3);
    const step = postScripted(s, 'C1.chat.01', 1.1, m.rand);
    expect(step.posts).toHaveLength(1);
    expect(step.posts[0]).toMatchObject({ id: 'C1.chat.01', scripted: true, at: 1.1, cause: 'served' });
    s = step.state;
    const again = postScripted(s, 'C1.chat.01', 1.2, m.rand);
    expect(again.state).toBe(s);
    expect(again.posts).toBe(NO_POSTS);
    // Its reaction is cooling: the generic pool does not double it.
    expect(s.cooldown[SCRIPTED_REACTION['C1.chat.01']!]).toBeCloseTo(1.1 + REACTIONS.servedBlock.cap);
    let full = s;
    for (let i = 0; i < 12; i++) full = { ...full, recent: [...full.recent, 2] };
    const over = postScripted(full, 'C1.chat.02', 2.1, m.rand);
    expect(over.posts).toHaveLength(1);
  });

  it('keeps the minimum gap by error state: 2.5 / 1.8 / 1.2 s', () => {
    for (const [share, gap] of [
      [0, 2.5],
      [0.3, 1.8],
      [0.6, 1.2],
    ] as const) {
      const m = play(sim(0), 0, 3, () => ({}));
      m.rows.length = 0;
      // Four reactions at once, each with lines today.
      play(
        m,
        3,
        12,
        () => ({ errorShare: share }),
        (c, i) =>
          i === 1
            ? [occ('placed', c, 'a'), occ('wired', c, 'w'), occ('rescued', c), occ('skipped', c, 'k')]
            : [],
      );
      const reactions = m.rows.filter(
        (r) => r.cause !== 'filler' && r.cause !== 'errorsRising' && r.cause !== 'errorsHeavy',
      );
      expect(reactions.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < m.rows.length; i++) {
        expect(m.rows[i].at - m.rows[i - 1].at).toBeGreaterThanOrEqual(gap - 1e-9);
      }
    }
  });

  it('holds 4 in the queue, drops any older than 6 s, and posts at most 10 in 30 s', () => {
    const m = sim(0);
    const six: ChatEvent[] = [
      occ('placed', 1, 'a'),
      occ('wired', 1, 'w'),
      occ('rescued', 1),
      occ('skipped', 1, 'k'),
      occ('held', 1),
    ];
    const s = stepChat({ ...m.s, lastPostAt: 1 }, { ...CALM, clock: 1 }, six, m.rand).state;
    expect(s.queue).toHaveLength(CHAT_PACE.queueMax);
    // Gap 2.5 s: posts at 3.5, 6, then the rest are older than 6 s by their turn.
    const run = play({ s, rows: [], rand: m.rand }, 1, 12, () => ({}));
    const fromQueue = run.rows.filter((r) => r.cause !== 'filler');
    expect(fromQueue.length).toBeLessThan(CHAT_PACE.queueMax);
    for (const r of fromQueue) expect(r.at - 1).toBeLessThanOrEqual(CHAT_PACE.staleSeconds + 1e-9);

    // A flood at heavy errors (gap 1.2 s) for 60 s never passes 10 posts in any 30 s.
    const kinds: OccurrenceKind[] = ['placed', 'wired', 'rescued', 'skipped', 'held'];
    const flood = play(
      sim(0),
      0,
      60,
      () => ({ errorShare: 0.6 }),
      (c, i) => (i % 5 === 0 ? [occ(kinds[(i / 5) % kinds.length], c, `p${i}`)] : []),
    );
    expect(flood.rows.length).toBeGreaterThanOrEqual(10);
    expect(maxInWindow(flood.rows)).toBeLessThanOrEqual(CHAT_PACE.windowMax);
  });

  it('goes quiet 2 s after a lesson line (bus line {lesson: true}), not after other band lines', () => {
    expect(isLesson('C3.lux.01')).toBe(true);
    expect(isLesson('C1.lux.01')).toBe(false);
    expect(isLesson('C4.triage.01')).toBe(false);
    for (const [ev, quiet] of [
      [line('C3.lux.01'), true],
      [line('C1.lux.01', true), true],
      [line('C1.lux.01'), false],
      [line('C4.triage.01'), false],
      [line('C5.rei.05', false), false],
    ] as const) {
      const m = sim(0);
      const s = stepChat(m.s, { ...CALM, clock: 1 }, [ev, occ('placed', 1, 'a')], m.rand);
      if (quiet) {
        expect(s.posts).toBe(NO_POSTS);
        const after = play({ s: s.state, rows: [], rand: m.rand }, 1, 4, () => ({}));
        expect(after.rows.length).toBe(1);
        expect(after.rows[0].at).toBeGreaterThanOrEqual(3 - 1e-9);
      } else {
        expect(s.posts).toHaveLength(1);
        expect(s.posts[0].cause).toBe('placed');
      }
    }
  });
});

describe('viewersOf', () => {
  const f = { now: 120, servedOnce: false, heavyFor: 0, calmFor: 10, held: false, dark: false };

  it('2 until the first serve, 3 from it, 1 after 5 s of heavy errors, 3 on recovery, 4 held, 0 dark', () => {
    expect(viewersOf(2, f)).toBe(2);
    expect(viewersOf(2, { ...f, servedOnce: true })).toBe(3);
    expect(viewersOf(3, { ...f, servedOnce: true, heavyFor: 4.9, calmFor: 0 })).toBe(3);
    expect(viewersOf(3, { ...f, servedOnce: true, heavyFor: 5, calmFor: 0 })).toBe(1);
    expect(viewersOf(1, { ...f, servedOnce: true, calmFor: 2.9 })).toBe(1);
    expect(viewersOf(1, { ...f, servedOnce: true, calmFor: 3 })).toBe(3);
    expect(viewersOf(3, { ...f, servedOnce: true, held: true })).toBe(4);
    expect(viewersOf(3, { ...f, servedOnce: true, dark: true })).toBe(0);
    expect(viewersOf(0, { ...f, servedOnce: true })).toBe(3);
  });

  it('never rises inside a surge window, and never exceeds 4', () => {
    expect(SURGE_WINDOWS[0]).toEqual([C.c4, C.c5]);
    expect(inSurge(C.c4 + 10)).toBe(true);
    expect(inSurge(C.c5)).toBe(false);
    expect(viewersOf(1, { ...f, now: C.c4 + 20, servedOnce: true, calmFor: 30 })).toBe(1);
    expect(viewersOf(1, { ...f, now: C.c5, servedOnce: true, calmFor: 30 })).toBe(3);
    for (let prev = 0; prev <= 4; prev++)
      for (const held of [false, true])
        for (const heavyFor of [0, 6])
          for (const now of [100, C.c4 + 5, C.c6 + 5, 520]) {
            const n = viewersOf(prev, {
              ...f,
              now,
              servedOnce: true,
              heavyFor,
              held,
              calmFor: heavyFor ? 0 : 5,
            });
            expect(n).toBeLessThanOrEqual(4);
            expect(n).toBeGreaterThanOrEqual(0);
            if (inSurge(now) && !held) expect(n).toBeLessThanOrEqual(Math.max(prev, prev === 0 ? 3 : 0));
          }
  });

  it('through a night: 2, 3, 1 in the surge, 3 after it, 4 at a held midnight; 0 when dark', () => {
    const rand = seededRandom(3);
    let s = initialChat(0, rand);
    const seen: number[] = [];
    const at = (now: number, extra: Partial<ChatInputs>) => {
      s = stepChat(s, { ...CALM, clock: now, now, ...extra }, [], rand).state;
      if (seen[seen.length - 1] !== s.watching) seen.push(s.watching);
    };
    for (let t = 10; t < 20; t += DT) at(t, { served: 0, servingBoxes: 0 });
    for (let t = 20; t < C.c4; t += 0.5) at(t, {});
    let maxInSurge = 0;
    let prev = s.watching;
    for (let t = C.c4; t < C.c5; t += DT) {
      at(t, { errorShare: t < C.c4 + 20 ? 0.7 : 0 });
      if (s.watching > prev) maxInSurge = Infinity;
      prev = s.watching;
    }
    expect(maxInSurge).toBe(0);
    for (let t = C.c5; t < C.c7; t += 0.5) at(t, {});
    at(C.c7, { midnightHeld: true });
    at(C.c7 + 1, { midnightHeld: true });
    expect(seen).toEqual([2, 3, 1, 3, 4]);
    expect(Math.max(...seen)).toBeLessThanOrEqual(4);

    const dark = stepChat(s, { ...CALM, clock: C.c7 + 2, now: C.c7 + 2, midnightDark: true }, [], rand).state;
    expect(dark.watching).toBe(0);
    const silenced = stepChat(
      s,
      { ...CALM, clock: C.c7 + 2, now: C.c7 + 2 },
      [occ('dark', C.c7 + 2)],
      rand,
    ).state;
    expect(silenced.silenced).toBe(true);
    expect(silenced.watching).toBe(0);
  });
});

describe('the feed is caused (T10, LRN-7)', () => {
  /** A busy 5 minutes: serves, places, a spell of errors, heavy errors, a lesson line, recovery. */
  function busy(seed: number): Sim {
    const m = sim(0, seed);
    m.s = seedChat(m.s, 0, m.rand).state;
    m.rows.push(...m.s.feed);
    play(
      m,
      0,
      300,
      (c) => ({
        errorShare: c > 60 && c < 80 ? 0.3 : c > 120 && c < 140 ? 0.7 : 0,
        retry: c > 125 && c < 140 ? 0.45 : 0,
        servingBoxes: c > 200 ? 2 : 1,
      }),
      (c, i) => {
        const out: ChatEvent[] = [];
        if (i % 97 === 0) out.push(occ('placed', c, `p${i}`));
        if (i % 211 === 0) out.push(line('C3.lux.01'));
        if (i % 157 === 0) out.push(line('C1.lux.01'));
        return out;
      },
    );
    return m;
  }

  it('every feed row carries a cause and a time', () => {
    for (const seed of [1, 2, 3]) {
      const m = busy(seed);
      expect(m.rows.length).toBeGreaterThan(20);
      for (const r of [...m.rows, ...m.s.feed]) {
        expect(typeof r.cause).toBe('string');
        expect(r.cause.length).toBeGreaterThan(0);
        expect(Number.isFinite(r.at)).toBe(true);
      }
      expect(m.rows.slice(0, 4).map((r) => r.cause)).toEqual(['seed', 'seed', 'seed', 'seed']);
    }
  });

  it('shows no slow or down filler while the block has no errors', () => {
    for (const seed of [1, 2, 3, 4]) {
      const m = sim(0, seed);
      const share = (c: number) => (c > 60 && c < 80 ? 0.3 : c > 120 && c < 140 ? 0.7 : 0);
      play(m, 0, 300, (c) => ({ errorShare: share(c) }));
      for (const r of m.rows) {
        if (/^fill\.(block|stream)\.(slow|down)\./.test(r.id)) expect(share(r.at)).toBeGreaterThan(0);
      }
      expect(m.rows.some((r) => /\.slow\./.test(r.id))).toBe(true);
    }
    expect(chatSetFor(0)).toBe('ok');
    expect(chatSetFor(0.3)).toBe('slow');
    expect(chatSetFor(0.5)).toBe('down');
  });

  it('a lesson line is followed by at least 2 s without filler', () => {
    for (const seed of [1, 2, 3]) {
      const m = sim(0, seed);
      const lessons: number[] = [];
      play(
        m,
        0,
        200,
        () => ({}),
        (c, i) => {
          if (i % 71 === 0) {
            lessons.push(c);
            return [line('C5.triage.03')];
          }
          return [];
        },
      );
      expect(lessons.length).toBeGreaterThan(10);
      for (const t of lessons) {
        expect(m.rows.filter((r) => r.cause === 'filler' && r.at >= t && r.at < t + 2 - 1e-9)).toEqual([]);
      }
      expect(fillerAllowed(m.s, m.s.quietUntil - 0.5)).toBe(false);
    }
  });

  it('block messages outnumber stream messages over a calm minute', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = play(sim(0, seed), 0, 60, () => ({}));
      const block = m.rows.filter((r) => r.chat === 'block').length;
      const stream = m.rows.filter((r) => r.chat === 'stream').length;
      expect(block + stream).toBeGreaterThanOrEqual(5);
      expect(block).toBeGreaterThan(stream);
      for (const r of m.rows) expect(r.cause).toBe('filler');
    }
  });
});

describe('reactions from the Frame’s edges', () => {
  it('the first serve and a new serving box react, caused served; a surge warning reacts once', () => {
    const rand = seededRandom(9);
    const m: Sim = { s: initialChat(0, rand), rows: [], rand };
    play(m, 0, 2, () => ({ served: 0, servingBoxes: 0 }));
    expect(m.rows).toEqual([]);
    play(m, 2, 8, () => ({}));
    expect(m.rows.slice(0, 2).map((r) => [r.cause, r.chat])).toEqual([
      ['served', 'block'],
      ['served', 'stream'],
    ]);
    m.rows.length = 0;
    play(m, 8, 14, () => ({ surgeAt: C.c3 }));
    expect(m.rows.filter((r) => r.cause === 'surgeWarning')).toHaveLength(1);
  });
});

describe('scripted extras', () => {
  it('a neighbour who left never speaks in filler; the dark direction silences without a row', () => {
    const m = sim(0);
    let s = postScripted(m.s, 'C4.chat.03', 1, m.rand).state;
    expect(s.left).toEqual(['mrs okafor']);
    const after = play({ s, rows: [], rand: m.rand }, 1, 400, () => ({}));
    expect(after.rows.some((r) => r.who.toLowerCase() === 'mrs okafor')).toBe(false);
    const dark = postScripted(s, 'C6.fail.chat', 2, m.rand);
    expect(dark.posts).toBe(NO_POSTS);
    expect(dark.state.silenced).toBe(true);
    s = dark.state;
    const quiet = play({ s, rows: [], rand: m.rand }, 2, 60, () => ({}));
    expect(quiet.rows).toEqual([]);
    // A rewind lifts the silence.
    const back = stepChat(quiet.s, { ...CALM, clock: 61, rewinds: 1 }, [], m.rand).state;
    expect(back.silenced).toBe(false);
  });

  it('toggles BLOCK ONLY and shows the newest five rows', () => {
    const m = play(sim(0), 0, 120, () => ({}));
    const all = visibleRows(m.s);
    expect(all.length).toBe(5);
    expect(all[4]).toBe(m.s.feed[m.s.feed.length - 1]);
    const blockOnly = toggleFilter(m.s);
    expect(blockOnly.filter).toBe('block');
    expect(visibleRows(blockOnly).every((r) => r.chat === 'block')).toBe(true);
    expect(toggleFilter(blockOnly).filter).toBe('all');
  });

  it('every reaction with lines today draws from chat lines', () => {
    for (const key of Object.keys(REACTIONS) as (keyof typeof REACTIONS)[]) {
      for (const id of reactionLines(key)) expect(id.startsWith('fill.')).toBe(true);
    }
    expect(reactionLines('errorsBlock').every((id) => id.startsWith('fill.block.slow.'))).toBe(true);
    expect(reactionLines('hot')).toEqual([]);
  });
});
