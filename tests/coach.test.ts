import type { Part, Wire } from '../src/sim/board';
import { BROWNOUT } from '../src/sim/brownout';
import {
  type CoachInput,
  NEW_COACH,
  coachHint,
  coachLit,
  coachProblem,
  FEED_SPLITTER,
  gapAfter,
  NUDGES,
  nudgeFor,
  quietCoach,
  stepCoach,
} from '../src/scenes/hud/coach';
import { LINES } from '../src/strings';
import {
  COACH_REACTIONS,
  COUNTDOWN_MARKS,
  LINE_REACTIONS,
  emptyChatInputs,
  initialChat,
  stepChat,
} from '../src/scenes/hud/chatEngine';

// The tutorial coach (src/scenes/hud/coach.ts): what counts as stuck, how long before each kind of
// help, and the nudges in order. Pure: the board comes in as plain parts and wires.

const C = BROWNOUT.challenges;
const gateway: Part = { id: 'gateway', kind: 'gateway', slot: null };
const database: Part = { id: 'database', kind: 'database', slot: null };
const box = (id: string, slot = `c${id.length}-5`): Part => ({ id, kind: 'server', slot });
const lb: Part = { id: 'balancer', kind: 'balancer', slot: 'c5-12' };

function input(over: Partial<CoachInput> = {}): CoachInput {
  return {
    now: C.c1,
    paused: false,
    cardOpen: false,
    waitingForFirstBuild: true,
    rescued: false,
    parts: [gateway, database],
    wires: [],
    dead: [],
    offline: [],
    load: {},
    dropped: 0,
    ...over,
  };
}

const w = (from: string, to: string): Wire => ({ from, to });

describe('coachProblem: what counts as stuck', () => {
  it('nothing while the job card is up', () => {
    expect(coachProblem(input({ cardOpen: true }))).toBe(null);
  });

  it('an empty grid in C1 is the place step, lighting the SERVER card', () => {
    expect(coachProblem(input())).toMatchObject({
      step: 'place',
      key: 'place',
      cards: ['server'],
      parts: [],
      wire: null,
      hint: 'C1.alert.place',
    });
  });

  it('a box the gateway does not feed is the feed step, with a ghost wire from the gateway', () => {
    const p = coachProblem(input({ parts: [gateway, database, box('s1')] }));
    expect(p).toMatchObject({
      step: 'feed',
      key: 'feed:s1',
      parts: ['s1'],
      wire: { from: 'gateway', to: 's1' },
      hint: 'C1.alert.feed',
    });
  });

  it('with two loose boxes, the feed step points at the one already wired to the database', () => {
    const p = coachProblem(
      input({ parts: [gateway, database, box('s1'), box('s22')], wires: [w('s22', 'database')] }),
    );
    expect(p?.wire).toEqual({ from: 'gateway', to: 's22' });
  });

  it('a fed box with no wire to the database is the store step', () => {
    const p = coachProblem(input({ parts: [gateway, database, box('s1')], wires: [w('gateway', 's1')] }));
    expect(p).toMatchObject({
      step: 'store',
      key: 'store:s1',
      wire: { from: 's1', to: 'database' },
      hint: 'C1.alert.store',
    });
  });

  it('a box wired through is not a problem', () => {
    const p = coachProblem(
      input({
        waitingForFirstBuild: false,
        now: C.c2,
        parts: [gateway, database, box('s1')],
        wires: [w('gateway', 's1'), w('s1', 'database')],
      }),
    );
    expect(p).toBe(null);
  });

  it('before the crew, a second box the gateway cannot feed is lit with the sell-it-back nudge', () => {
    // It was left alone as C3's lesson until Rolando got stuck on three idle boxes and no credits
    // (30 Oct 2026): the box still idles (the lesson), and the coach now says how to get out.
    const p = coachProblem(
      input({
        waitingForFirstBuild: false,
        now: C.c3 + 5,
        parts: [gateway, database, box('s1'), box('s22')],
        wires: [w('gateway', 's1'), w('s1', 'database')],
      }),
    );
    expect(p?.step).toBe('idle');
    expect(p?.parts).toEqual(['s22']);
    expect(p?.lines).toEqual(['C3.triage.nudge.idle', 'C3.lux.nudge.idle']);
  });

  it('after the crew, the gateway must feed the splitter', () => {
    const p = coachProblem(
      input({
        waitingForFirstBuild: false,
        rescued: true,
        now: C.c5,
        parts: [gateway, database, box('s1'), lb],
        wires: [w('s1', 'database')],
      }),
    );
    expect(p).toMatchObject({
      step: 'feed',
      key: 'feed:balancer',
      wire: { from: 'gateway', to: 'balancer' },
      hint: 'C5.alert.splitter',
      lines: ['C5.triage.nudge.splitter', 'C5.lux.nudge.splitter'],
    });
  });

  it('after the crew, a box outside the splitter is the behind step', () => {
    const p = coachProblem(
      input({
        waitingForFirstBuild: false,
        rescued: true,
        now: C.c5,
        parts: [gateway, database, box('s1'), lb, box('s22')],
        wires: [w('gateway', 'balancer'), w('balancer', 's1'), w('s1', 'database'), w('s22', 'database')],
      }),
    );
    expect(p).toMatchObject({
      step: 'behind',
      key: 'behind:s22',
      wire: { from: 'balancer', to: 's22' },
      hint: 'C5.alert.behind',
    });
  });

  it('after the crew, a dead box is the replace step', () => {
    const p = coachProblem(
      input({
        waitingForFirstBuild: false,
        rescued: true,
        now: C.c6,
        parts: [gateway, database, box('s1'), lb],
        wires: [w('gateway', 'balancer'), w('balancer', 's1'), w('s1', 'database')],
        dead: ['s1'],
      }),
    );
    expect(p).toMatchObject({ step: 'replace', key: 'replace:s1', cards: ['server'], parts: ['s1'] });
  });

  // Rolando, 31 Oct 2026: C3 offered "scale up or scale out?" when a second server can't work yet.
  // One instruction, one target: the SCALE UP card, from the start of C3.
  it('in C3, a stock box the gateway feeds lights the SCALE UP card only, before anything drops', () => {
    const p = coachProblem(
      input({
        waitingForFirstBuild: false,
        now: C.c3,
        parts: [gateway, database, box('s1')],
        wires: [w('gateway', 's1'), w('s1', 'database')],
        load: { s1: 30 },
        dropped: 0,
      }),
    );
    expect(p).toMatchObject({ step: 'choose', cards: ['overclock'], parts: ['s1'], hint: null });
  });

  it('in C3, the box already scaled up needs nothing', () => {
    const big = { ...box('s1'), boost: 2 };
    const p = coachProblem(
      input({
        waitingForFirstBuild: false,
        now: C.c3 + 30,
        parts: [gateway, database, big],
        wires: [w('gateway', 's1'), w('s1', 'database')],
        load: { s1: 60 },
      }),
    );
    expect(p).toBe(null);
  });

  it('lights the SCALE UP card at once in C3 and nudges only 10 s later', () => {
    const p = coachProblem(
      input({
        waitingForFirstBuild: false,
        now: C.c3,
        parts: [gateway, database, box('s1')],
        wires: [w('gateway', 's1'), w('s1', 'database')],
      }),
    )!;
    const lit = stepCoach(stepCoach(NEW_COACH, p, 0, false).state, p, 0.1, false);
    expect(coachLit(lit.state)).toBe(true);
    const at9 = stepCoach(lit.state, p, 8.8, false);
    expect(at9.nudge).toBe(null);
    const at10 = stepCoach(at9.state, p, 1.1, false);
    expect(at10.nudge).toBe('C3.triage.nudge.choose.1');
  });

  it('nothing after midnight', () => {
    expect(coachProblem(input({ now: C.c7, waitingForFirstBuild: false }))).toBe(null);
  });
});

describe('stepCoach: help that grows with time', () => {
  const place = coachProblem(input())!;
  const feed = coachProblem(input({ parts: [gateway, database, box('s1')] }))!;

  it('lights the place step after 4 s and says the first nudge at 8 s', () => {
    let s = stepCoach(NEW_COACH, place, 0.1, false).state;
    s = stepCoach(s, place, 3.9, false).state;
    expect(coachLit(s)).toBe(false);
    s = stepCoach(s, place, 0.1, false).state;
    expect(coachLit(s)).toBe(true);
    expect(coachHint(s)).toBe('C1.alert.place');
    const before = stepCoach(s, place, 3.9, false);
    expect(before.nudge).toBe(null);
    const at8 = stepCoach(before.state, place, 0.1, false);
    expect(at8.nudge).toBe('C1.triage.nudge.place.1');
    expect(at8.state.nudges).toBe(1);
  });

  it('nudges further apart each time, more directly, then only the most direct one every 25 s', () => {
    let s = stepCoach(NEW_COACH, feed, 0, false).state;
    const said: [number, string][] = [];
    for (let i = 1; i <= 90 * 10; i++) {
      const out = stepCoach(s, feed, 0.1, false);
      s = out.state;
      if (out.nudge) said.push([Math.round(i) / 10, out.nudge]);
    }
    expect(said).toEqual([
      [6, 'C1.triage.nudge.feed.1'],
      [15, 'C1.triage.nudge.feed.2'],
      [27, 'C1.lux.nudge.feed'],
      [52, 'C1.lux.nudge.feed'],
      [77, 'C1.lux.nudge.feed'],
    ]);
  });

  it('gapAfter: 9 s, then 12 s, then 25 s from then on', () => {
    expect([0, 1, 2, 3, 10].map(gapAfter)).toEqual([9, 12, 25, 25, 25]);
  });

  it('a drag or click holds the next nudge to 5 s after it, and leaves the highlight lit', () => {
    let s = stepCoach(NEW_COACH, feed, 0, false).state;
    s = stepCoach(s, feed, 5, false).state;
    expect(coachLit(s)).toBe(true);
    s = quietCoach(s);
    expect(s.nextNudge).toBe(10);
    expect(coachLit(s)).toBe(true);
    expect(stepCoach(s, feed, 4.9, false).nudge).toBe(null);
    expect(stepCoach(s, feed, 5, false).nudge).toBe('C1.triage.nudge.feed.1');
    // A nudge already further off than that is left alone, and no problem means nothing to hold.
    const far = { ...s, nextNudge: 30 };
    expect(quietCoach(far)).toBe(far);
    expect(quietCoach(NEW_COACH)).toBe(NEW_COACH);
  });

  it('the clock stands still while the board is held or a drag is in hand', () => {
    let s = stepCoach(NEW_COACH, feed, 0, false).state;
    s = stepCoach(s, feed, 5, false).state;
    const held = stepCoach(s, feed, 30, true);
    expect(held.nudge).toBe(null);
    expect(held.state.stuckFor).toBe(5);
  });

  it('a new problem starts over, and no problem clears the coach', () => {
    let s = stepCoach(NEW_COACH, place, 0, false).state;
    s = stepCoach(s, place, 10, false).state;
    expect(s.nudges).toBe(1);
    s = stepCoach(s, feed, 0.1, false).state;
    expect(s.problem?.key).toBe('feed:s1');
    expect(s.stuckFor).toBe(0);
    expect(s.nudges).toBe(0);
    const cleared = stepCoach(s, null, 0.1, false).state;
    expect(cleared.problem).toBe(null);
    expect(cleared.said).toBe(1);
  });

  it('nudgeFor walks the list and then stays on the last, most direct one', () => {
    expect(nudgeFor(place, 0)).toBe('C1.triage.nudge.place.1');
    expect(nudgeFor(place, 2)).toBe('C1.lux.nudge.place');
    expect(nudgeFor(place, 3)).toBe('C1.lux.nudge.place');
    expect(nudgeFor(place, 9)).toBe('C1.lux.nudge.place');
  });
});

describe('the nudges themselves', () => {
  it('are barks under 70 characters', () => {
    const ids = [
      'C1.triage.nudge.place.1',
      'C1.triage.nudge.feed.2',
      'C1.triage.nudge.store.2',
      'C3.triage.nudge.choose.2',
      'C5.triage.nudge.splitter',
      'C5.triage.nudge.behind.2',
      'C5.triage.nudge.replace.1',
    ] as const;
    expect(ids.map((id) => LINES[id].kind)).toEqual(['bark', 'bark', 'bark', 'bark', 'bark', 'bark', 'bark']);
    expect(ids.map((id) => LINES[id].text.length <= 70)).toEqual([true, true, true, true, true, true, true]);
  });

  it('are ten words or fewer, every one (short enough to read at a glance mid-drag)', () => {
    const all = [...Object.values(NUDGES).flat(), ...FEED_SPLITTER];
    // 20 since the idle-server nudges (30 Oct 2026).
    expect(all.length).toBe(20);
    const long = all.filter((id) => LINES[id].text.split(/\s+/).length > 10);
    expect(long).toEqual([]);
  });

  it('never give a number in C3: TRIAGE names the one tool, SCALE UP', () => {
    expect(LINES['C3.triage.nudge.choose.1'].text).toBe('Too much for one server! Try the SCALE UP card.');
    expect(LINES['C3.triage.nudge.choose.2'].text).toBe(
      'SCALE UP onto your server. Same spot, twice the room!',
    );
  });
});

describe('the chat answers the coach, the band and the countdown', () => {
  const calm = { ...emptyChatInputs(), now: C.c1 };
  const rand = (): number => 0;

  it('a nudge about a wire gets the stream asking about the cable', () => {
    expect(COACH_REACTIONS.store).toEqual(['unplugged']);
    const s = initialChat(0, rand);
    const out = stepChat(s, { ...calm, clock: 1 }, [{ kind: 'coach', step: 'store' }], rand);
    expect(out.posts.map((r) => [r.id, r.cause])).toEqual([['fill.stream.unplugged.01', 'coach']]);
  });

  it("TRIAGE's alarm about the lift gets the chat panicking", () => {
    expect(LINE_REACTIONS['C1.triage.02']).toEqual(['panic']);
    const s = initialChat(0, rand);
    const out = stepChat(s, { ...calm, clock: 1 }, [{ kind: 'line', id: 'C1.triage.02' }], rand);
    expect(out.posts.map((r) => r.id)).toEqual(['fill.stream.panic.01']);
  });

  it('a minute out, everyone counts down', () => {
    expect(COUNTDOWN_MARKS.map((m) => m.at)).toEqual([275, 325]);
    const s = initialChat(0, rand);
    const out = stepChat(s, { ...calm, clock: 1, now: 275 }, [], rand);
    expect(out.state.countdown).toBe(1);
    expect(out.posts.map((r) => r.id)).toEqual(['fill.block.countdown.01']);
  });
});
