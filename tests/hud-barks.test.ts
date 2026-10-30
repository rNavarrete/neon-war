import { bestPlay } from '../src/game/autopilot';
import { type Frame, frame, resetFrame } from '../src/game/frame';
import { type Occurrence, detectOccurrences } from '../src/game/occurrences';
import { Run } from '../src/game/run';
import { BARK_QUEUE_MAX, BARK_SECONDS, NO_BARKS, enqueueBark, stepBarks } from '../src/scenes/hud/barks';
import {
  type CueHost,
  type CueView,
  AWAITING_ENG503,
  CUES,
  NEW_DIRECTOR,
  challengeStart,
  chatSilenced,
  cueViewOf,
  direct,
  emptyCueView,
  rewindDirector,
} from '../src/scenes/hud/cues';
import { BROWNOUT } from '../src/sim/brownout';
import { LINES, type LineId } from '../src/strings';

describe('bark queue', () => {
  it('shows one bark at a time for about 4 s, then the next', () => {
    let s = enqueueBark(NO_BARKS, 'C1.triage.01');
    s = enqueueBark(s, 'C1.triage.02');
    s = stepBarks(s, 0);
    expect(s.current?.id).toBe('C1.triage.01');
    expect(stepBarks(s, BARK_SECONDS - 0.1)).toBe(s);
    s = stepBarks(s, BARK_SECONDS);
    expect(s.current?.id).toBe('C1.triage.02');
    s = stepBarks(s, 2 * BARK_SECONDS);
    expect(s.current).toBeNull();
    expect(s.history).toEqual(['C1.triage.01', 'C1.triage.02']);
  });

  it('drops the oldest waiting barks when too many pile up', () => {
    let s = NO_BARKS;
    const ids: LineId[] = [
      'C2.triage.01',
      'C2.lux.pay',
      'C2.triage.pay',
      'C2.triage.after',
      'C3.triage.01',
      'C3.triage.02',
      'C3.triage.03',
    ];
    for (const id of ids) s = enqueueBark(s, id);
    expect(s.queue).toEqual(ids.slice(ids.length - BARK_QUEUE_MAX));
  });

  it('does not change its input', () => {
    const s = enqueueBark(NO_BARKS, 'C1.triage.01');
    stepBarks(s, 0);
    expect(s.current).toBeNull();
    expect(s.queue).toEqual(['C1.triage.01']);
  });
});

const C = BROWNOUT.challenges;

function view(over: Partial<CueView> = {}): CueView {
  return {
    now: C.c1,
    demand: 30,
    capacity: 0,
    dropped: 30,
    servers: 0,
    idleServer: false,
    overloaded: false,
    overclocked: false,
    cardClosed: false,
    bannerShown: false,
    banner: null,
    laundryCut: false,
    decommissionsAfterMidnight: 0,
    droppedInC6: false,
    ...over,
  };
}

/** Run the director over a sequence of views and collect what fired. */
function play(views: CueView[]): LineId[] {
  let s = NEW_DIRECTOR;
  const out: LineId[] = [];
  for (const v of views) {
    const r = direct(s, v);
    s = r.state;
    out.push(...r.fired);
  }
  return out;
}

describe('bark and chat cues', () => {
  it('C1: TRIAGE raises the alarm about the lights two seconds after the card closes, with no sums', () => {
    const fired = play([view(), view({ cardClosed: true }), view({ cardClosed: true, now: C.c1 + 2 })]);
    expect(fired).toEqual(['C1.triage.01', 'C1.triage.02']);
    expect(LINES['C1.triage.01'].text).toBe('Lux! The lights are going out all over the block!');
    // The opening is the hook (Rolando, 30 Oct 2026): none of C1's spoken lines asks for a sum.
    for (const id of ['C1.triage.01', 'C1.triage.02', 'C1.lux.01', 'C1.triage.05', 'C1.triage.03'] as const)
      expect(LINES[id].text, id).not.toMatch(/\d|math|multipl|divide|req\/s/i);
  });

  it('C1: Lux steadies, then the build line; the lights-are-back line waits for a live box', () => {
    const closed = { cardClosed: true };
    const fired = play([0, 2, 4, 6, 8].map((s) => view({ ...closed, now: C.c1 + s })));
    expect(fired).toEqual(['C1.triage.01', 'C1.triage.02', 'C1.lux.01', 'C1.triage.05']);
    const live = { cardClosed: true, capacity: 60, dropped: 0, servers: 1 };
    const later = play([
      ...[0, 2, 4, 6, 8].map((s) => view({ ...closed, now: C.c1 + s })),
      view({ ...live, now: C.c1 + 20 }),
    ]);
    expect(later).toContain('C1.triage.03');
    expect(later.indexOf('C1.triage.03')).toBeGreaterThan(later.indexOf('C1.triage.05'));
    // The wrong-guess reply never plays: there is no guess.
    expect(later).not.toContain('C1.triage.04');
  });

  it('C1: a server going live gets both chats; 10 s at 30 against 60 gets the happy bark', () => {
    const live = { cardClosed: true, capacity: 60, dropped: 0, servers: 1 };
    const fired = play([view(live), view({ ...live, now: C.c1 + 5 }), view({ ...live, now: C.c1 + 10 })]);
    expect(fired).toEqual(expect.arrayContaining(['C1.chat.01', 'C1.chat.02', 'C1.triage.06']));
    const broken = play([
      view(live),
      view({ ...live, now: C.c1 + 5, dropped: 1 }),
      view({ ...live, now: C.c1 + 10 }),
    ]);
    expect(broken).not.toContain('C1.triage.06');
  });

  it('C2: each banner choice gets its own line, and Pay gets TRIAGE 3 s later', () => {
    const fired = play([
      view({ now: C.c2, bannerShown: true }),
      view({ now: C.c2 + 1, bannerShown: true, banner: 'pay' }),
      view({ now: C.c2 + 4, bannerShown: true, banner: 'pay' }),
      view({ now: C.c2 + 6, bannerShown: true, banner: 'pay' }),
    ]);
    expect(fired).toEqual(['C2.triage.01', 'C2.lux.pay', 'C2.triage.pay', 'C2.triage.after']);
    expect(play([view({ now: C.c2, bannerShown: true, banner: 'bin' })])).toContain('C2.lux.bin');
  });

  it('C3: an idle second server gets Lux after 5 s', () => {
    const idle = { now: C.c3 + 1, servers: 2, idleServer: true };
    const fired = play([view(idle), view({ ...idle, now: C.c3 + 2 }), view({ ...idle, now: C.c3 + 7 })]);
    expect(fired).toEqual(expect.arrayContaining(['C3.triage.02', 'C3.lux.01']));
  });

  it('C6: the forecast opens with Rei, TRIAGE does the math after 8 s, and the boxes running get a reaction', () => {
    const open = { now: C.c6 - 10, cardClosed: true, servers: 3 };
    expect(play([view(open), view({ ...open, now: C.c6 - 2 })])).toEqual(['C6.rei.01', 'C6.triage.01']);
    expect(play([view({ ...open, servers: 2 })])).toContain('C6.mika.01');
    expect(play([view({ ...open, servers: 6 })])).toContain('C6.ozzie.01');
    expect(play([view({ ...open, now: C.c6 - 11 })])).toEqual([]);
  });

  it('C6: midnight held cleanly gets "Clean.", with drops "Ugly. But it held."', () => {
    const m = BROWNOUT.clock.midnight;
    const clean = play([view({ now: m, dropped: 0, capacity: 240 }), view({ now: m + 2, dropped: 0 })]);
    expect(clean).toEqual(expect.arrayContaining(['C6.chat.hold.01', 'C6.rei.hold', 'C6.chat.hold.02']));
    expect(clean).not.toContain('C6.rei.scrape');
    expect(play([view({ now: m, dropped: 0, droppedInC6: true })])).toContain('C6.rei.scrape');
    expect(play([view({ now: m, dropped: 10 })])).not.toContain('C6.chat.hold.01');
  });

  it('C7: scaling down to 2 gets Ozzie', () => {
    const m = BROWNOUT.clock.midnight;
    expect(play([view({ now: m + 12, servers: 2, decommissionsAfterMidnight: 1 })])).toContain(
      'C7.ozzie.down',
    );
    expect(play([view({ now: m + 40, servers: 4 })])).toContain('C7.ozzie.none');
  });

  it('fires each cue once and returns the same state when nothing changes', () => {
    let s = NEW_DIRECTOR;
    s = direct(s, view({ cardClosed: true })).state;
    const again = direct(s, view({ cardClosed: true, now: C.c1 + 0.5 }));
    expect(again.fired).toEqual([]);
    expect(again.state).toBe(s);
  });

  it('only cues barks and chat lines, and leaves the ENG-503 lines for later', () => {
    for (const c of CUES) expect(['bark', 'chat']).toContain(LINES[c.id].kind);
    const cued = new Set(CUES.map((c) => c.id));
    for (const id of AWAITING_ENG503) expect(cued.has(id)).toBe(false);
  });
});

// ---- learning-2: the one trigger table over Frame and occurrences ----

describe('the AWAITING lines, cued from the Frame', () => {
  const m = BROWNOUT.clock.midnight;
  const big = 'server-p3';
  /** The surge's dip with the kitted box dark, Lux still alone. */
  const surgeDip: Partial<CueView> = {
    now: C.c4 + 5,
    cardClosed: true,
    capacity: 60,
    demand: 270,
    dropped: 210,
    servers: 2,
    overclocked: true,
    overclockedId: big,
    darkPart: big,
    retry: 0.1,
  };
  /** Back on the board after the rescue scene, the crew's balancer racked. */
  const back: Partial<CueView> = {
    now: C.c5 + 2,
    clock: 400,
    cardClosed: true,
    rescued: true,
    rescueClock: 400,
    servers: 1,
    serversAfterRescue: 1,
    liveBehindLb: 1,
    capacity: 60,
    demand: 120,
    dropped: 60,
  };

  it('fires C4.triage.02 on the tick the boosted server goes dark in c4..c5, never on a stock box', () => {
    expect(play([view(surgeDip)])).toContain('C4.triage.02');
    expect(play([view({ ...surgeDip, overclockedId: null, overclocked: false })])).not.toContain(
      'C4.triage.02',
    );
    expect(play([view({ ...surgeDip, overclockedId: 'server-p4' })])).not.toContain('C4.triage.02');
    expect(play([view({ ...surgeDip, darkPart: null })])).not.toContain('C4.triage.02');
    expect(play([view({ ...surgeDip, now: C.c4 - 1 })])).not.toContain('C4.triage.02');
    expect(play([view({ ...surgeDip, now: C.c5 })])).not.toContain('C4.triage.02');
    expect(LINES['C4.triage.02'].speaker).toBe('TRIAGE (panicking)');
  });

  it('fires C4.triage.03 only after C4.triage.02, with retries pushing demand to 300', () => {
    const climb = { ...surgeDip, now: C.c4 + 7, demand: 310, retry: 0.25 };
    expect(play([view({ ...climb, darkPart: null })])).not.toContain('C4.triage.03');
    const fired = play([view(surgeDip), view(climb)]);
    expect(fired.indexOf('C4.triage.02')).toBeGreaterThanOrEqual(0);
    expect(fired.indexOf('C4.triage.02')).toBeLessThan(fired.indexOf('C4.triage.03'));
    expect(play([view(surgeDip), view({ ...climb, demand: 290 })])).not.toContain('C4.triage.03');
    expect(play([view(surgeDip), view({ ...climb, retry: 0 })])).not.toContain('C4.triage.03');
  });

  it('fires C5.rei.05 at exactly 3 online servers behind the balancer, not while any is booting', () => {
    const three = { ...back, servers: 3, serversAfterRescue: 3, liveBehindLb: 3, dropped: 0, capacity: 180 };
    expect(play([view(three)])).toContain('C5.rei.05');
    expect(play([view({ ...three, bootingBehindLb: 1 })])).not.toContain('C5.rei.05');
    expect(play([view({ ...three, liveBehindLb: 2 })])).not.toContain('C5.rei.05');
    expect(play([view({ ...three, liveBehindLb: 4 })])).not.toContain('C5.rei.05');
    expect(play([view({ ...three, rescueClock: null })])).not.toContain('C5.rei.05');
  });

  it('fires C5.triage.03 10 HUD seconds after the board returns under 3 live, with the sim clock waiting', () => {
    // The sim clock is held at the same `now` (the crew build wait); only the HUD clock moves.
    const frozen = (clock: number, over: Partial<CueView> = {}): CueView => view({ ...back, clock, ...over });
    let s = NEW_DIRECTOR;
    const at: Record<string, number> = {};
    // Before the board returns (the rescue scene is up), nothing is counted.
    for (let t = 380; t < 400; t += 0.5) {
      const r = direct(s, frozen(t, { rescueClock: null }));
      s = r.state;
      for (const id of r.fired) at[id] = t;
    }
    expect(at['C5.triage.03']).toBeUndefined();
    for (let t = 400; t <= 412; t += 0.5) {
      const r = direct(s, frozen(t));
      s = r.state;
      for (const id of r.fired) at[id] = t;
    }
    expect(at['C5.triage.03']).toBe(410);
    expect(at['C5.triage.02']).toBe(401);
    // With 3 live before the 10 s are up, it never fires.
    const enough = play([
      frozen(400),
      frozen(405, { liveBehindLb: 3 }),
      frozen(411, { liveBehindLb: 3 }),
      frozen(420, { liveBehindLb: 3 }),
    ]);
    expect(enough).not.toContain('C5.triage.03');
  });

  it('silences scripted chat after a dark midnight, and the chat resumes after the rewind', () => {
    const dark = view({ now: m, dropped: 40, midnightHeld: false });
    let s = direct(NEW_DIRECTOR, dark).state;
    expect(s.fired['C6.fail.chat']).toBeDefined();
    expect(chatSilenced(s)).toBe(true);
    // A chat cue whose condition holds stays unfired while the chat is silent; a bark still fires.
    const cut = view({ now: m, dropped: 40, midnightHeld: false, laundryCut: true });
    const silent = direct(s, cut);
    expect(silent.fired).toContain('C4.lux.cut');
    expect(silent.fired).not.toContain('C4.chat.cut');
    s = silent.state;
    // Rei rewinds to one minute out: the C6 lines can fire again and the chat speaks.
    const after = direct(s, view({ now: C.c6, laundryCut: true, rewinds: 1, rewoundTo: C.c6 }));
    expect(chatSilenced(after.state)).toBe(false);
    expect(after.fired).toContain('C4.chat.cut');
    expect(after.state.fired['C6.fail.chat']).toBeUndefined();
  });

  it('fires each of the newly cued lines exactly once from its condition, never before its challenge', () => {
    const cases: { id: LineId; on: Partial<CueView>; early: Partial<CueView> }[] = [
      { id: 'C3.chat.03', on: { now: C.c3 + 20, deadServers: 1 }, early: { now: C.c3 - 1, deadServers: 1 } },
      { id: 'C4.triage.02', on: surgeDip, early: { ...surgeDip, now: C.c4 - 0.5 } },
      {
        id: 'C4.chat.02',
        on: { ...surgeDip, retry: 0.3 },
        early: { ...surgeDip, now: C.c4 - 0.5, retry: 0.3 },
      },
      { id: 'C5.triage.02', on: back, early: { ...back, rescued: false, rescueClock: null } },
      {
        id: 'C5.ozzie.04',
        on: { ...back, servers: 5, serversAfterRescue: 5 },
        early: { ...back, rescued: false, rescueClock: null, servers: 5, serversAfterRescue: 0 },
      },
      {
        id: 'C5.chat.01',
        on: { ...back, dropped: 0 },
        early: { ...back, rescued: false, rescueClock: null, dropped: 0 },
      },
      {
        id: 'C6.triage.02',
        on: { now: m - 10, darkPart: 'server-p5' },
        early: { now: C.c6 - 1, darkPart: 'server-p5' },
      },
      { id: 'C6.fail.chat', on: { now: m, midnightHeld: false }, early: { now: m - 1, midnightHeld: null } },
    ];
    for (const c of cases) {
      const views = [0, 1, 2, 5, 12].map((dt) => view({ ...c.on, clock: (c.on.clock ?? 1000) + dt }));
      const fired = play(views);
      expect(
        fired.filter((id) => id === c.id),
        c.id,
      ).toHaveLength(1);
      expect(play([view(c.early), view({ ...c.early, clock: 50 })]), c.id).not.toContain(c.id);
    }
    // The delayed one fires once too.
    const five = { ...back, servers: 5, serversAfterRescue: 5 };
    const mika = play([0, 1, 3, 4, 8].map((dt) => view({ ...five, clock: 400 + dt })));
    expect(mika.filter((id) => id === 'C5.mika.05')).toHaveLength(1);
  });

  it('leaves only C4.triage.04 waiting: the database never chokes (D2)', () => {
    expect(AWAITING_ENG503).toEqual(['C4.triage.04']);
    expect(play([view({ ...surgeDip, databaseShare: 1.5 })])).not.toContain('C4.triage.04');
  });

  it('gates the five C4 window lines on Lux still being alone (D11)', () => {
    const windows: [LineId, number][] = [
      ['C4.chat.seed', 15],
      ['C4.chat.03', 20],
      ['C4.chat.04', 25],
      ['C4.grandma.01', 30],
      ['C4.lux.02', 35],
    ];
    for (const [id, s] of windows) {
      expect(play([view({ now: C.c4 + s })]), id).toContain(id);
      expect(play([view({ now: C.c4 + s, rescued: true, rescueClock: 0 })]), id).not.toContain(id);
      expect(play([view({ now: C.c4 + s, rescued: true })]), id).not.toContain(id);
    }
    // C4.triage.03 is the same: after the rescue it never fires.
    const climb = { ...surgeDip, now: C.c4 + 7, demand: 310, retry: 0.25 };
    expect(play([view(surgeDip), view({ ...climb, rescued: true })])).not.toContain('C4.triage.03');
  });

  it('lets the C3 cues fire again after a rewind to C3, while C1 and C2 stay fired', () => {
    const c1 = view({ cardClosed: true });
    const c2 = view({ now: C.c2, cardClosed: true, bannerShown: true });
    const c3 = view({ now: C.c3 + 1, cardClosed: true, servers: 2 });
    let s = NEW_DIRECTOR;
    for (const v of [c1, c2, c3]) s = direct(s, v).state;
    expect(s.fired['C3.triage.02']).toBeDefined();
    const again = direct(s, { ...c3, now: C.c3, rewinds: 1, rewoundTo: C.c3 });
    expect(again.fired).toEqual(expect.arrayContaining(['C3.triage.01', 'C3.triage.02', 'C3.chat.01']));
    expect(again.fired).not.toContain('C1.triage.01');
    expect(again.fired).not.toContain('C2.triage.01');
    expect(again.state.fired['C1.triage.01']).toBe(s.fired['C1.triage.01']);
    expect(again.state.fired['C2.triage.01']).toBe(s.fired['C2.triage.01']);
    // The same rewind count again changes nothing.
    const still = direct(again.state, { ...c3, now: C.c3 + 0.5, rewinds: 1, rewoundTo: C.c3 });
    expect(still.state).toBe(again.state);
    expect(rewindDirector(s, C.c3).fired['C3.triage.02']).toBeUndefined();
    expect(challengeStart('C3.triage.02')).toBe(C.c3);
    expect(challengeStart('fill.block.ok.01')).toBeNull();
  });
});

describe('frozen views: a cue is a function of the Frame, only holds and delays use the HUD clock', () => {
  // The five frozen CueViews: job card open; C1 built at 30 against 60; C3 with an idle box; the
  // surge dip; the crew wait with 2 live.
  const frozen: [string, CueView][] = [
    ['job card open', view({ now: C.c1 })],
    [
      'C1 built at 30 against 60',
      view({ now: C.c1, cardClosed: true, capacity: 60, demand: 30, dropped: 0, servers: 1 }),
    ],
    [
      'C3 with an idle box',
      view({
        now: C.c3 + 10,
        cardClosed: true,
        capacity: 120,
        demand: 70,
        dropped: 0,
        servers: 2,
        idleServer: true,
      }),
    ],
    [
      'the surge dip',
      view({
        now: C.c4 + 5,
        cardClosed: true,
        capacity: 0,
        demand: 280,
        dropped: 280,
        servers: 1,
        overclocked: true,
        overclockedId: 'server-p3',
        darkPart: 'server-p3',
        retry: 0.12,
      }),
    ],
    [
      'the crew wait with 2 live',
      view({
        now: C.c5 + 1,
        cardClosed: true,
        rescued: true,
        rescueClock: 0,
        servers: 3,
        serversAfterRescue: 3,
        liveBehindLb: 2,
        bootingBehindLb: 1,
        capacity: 120,
        demand: 120,
        dropped: 0,
      }),
    ],
  ];

  for (const [name, base] of frozen) {
    it(`${name}: after clock 0, only declared after() and holdFor chains fire`, () => {
      let s = NEW_DIRECTOR;
      const first = direct(s, { ...base, clock: 0 });
      s = first.state;
      const fired = new Set<LineId>(first.fired);
      const later: LineId[] = [];
      for (let t = 0.25; t <= 600; t += 0.25) {
        const r = direct(s, { ...base, clock: t });
        s = r.state;
        for (const id of r.fired) {
          const cue = CUES.find((c) => c.id === id)!;
          const held = cue.holdFor !== undefined && cue.when({ ...base, clock: 0 }, s.fired);
          const chained = (cue.follows ?? []).some((f) => fired.has(f));
          expect(held || chained, `${name}: ${id} at clock ${t}`).toBe(true);
          later.push(id);
        }
        for (const id of r.fired) fired.add(id);
      }
      // Nothing keeps firing: every id fires once at most.
      expect(new Set(later).size).toBe(later.length);
    });
  }

  it('the crew wait counts C5.triage.03 on the HUD clock while the sim is frozen', () => {
    const wait = frozen[4][1];
    const fired = play([0, 5, 9.9, 10].map((clock) => ({ ...wait, clock })));
    expect(fired).toContain('C5.triage.03');
  });
});

describe('cueViewOf over a real run', () => {
  const host: CueHost = {
    cardClosed: true,
    bannerShown: false,
    decommissionsAfterMidnight: 0,
  };

  it('builds every field, defaults included, and reuses the view it is given', () => {
    resetFrame();
    const r = new Run();
    r.now = C.c1;
    const f = frame(r);
    const out = emptyCueView();
    const v = cueViewOf(null, f, [], 0, host, out);
    expect(v).toBe(out);
    expect(v).toMatchObject({
      now: C.c1,
      servers: 0,
      rescued: false,
      rescueClock: null,
      darkPart: null,
      overclockedId: null,
      liveBehindLb: 0,
      serversAfterRescue: 0,
      databaseShare: 0,
      midnightHeld: null,
      rewinds: 0,
    });
    expect(cueViewOf(v, f, [], 1, host, v)).toBe(v);
    expect(cueViewOf(null, f, [], 0, host)).not.toBe(out);
  });

  it('plays best play through the night: the surge, the rescue and midnight fire their lines', () => {
    resetFrame();
    const r = new Run();
    r.autopilot = bestPlay;
    r.now = C.c1;
    let prev: Frame | null = null;
    const occ: Occurrence[] = [];
    const v = emptyCueView();
    let s = NEW_DIRECTOR;
    let clock = 0;
    const at = new Map<LineId, number>();
    for (let n = 0; n < 20_000 && r.now < C.c8 && !r.play.failure; n++) {
      r.tick(0.1);
      clock += 0.1;
      const f = frame(r);
      detectOccurrences(prev, f, occ);
      prev = f;
      cueViewOf(v, f, occ, clock, host, v);
      const out = direct(s, v);
      s = out.state;
      for (const id of out.fired) at.set(id, f.now);
    }
    expect(r.play.failure).toBeNull();
    const big = at.get('C4.triage.02');
    expect(big).toBeDefined();
    expect(big!).toBeGreaterThanOrEqual(C.c4 + BROWNOUT.surgeScript.dipAfterSeconds);
    expect(big!).toBeLessThan(C.c4 + BROWNOUT.surgeScript.dipAfterSeconds + 0.5);
    expect(at.get('C4.chat.dark')).toBe(big);
    expect(at.has('C5.triage.02')).toBe(true);
    expect(at.has('C5.rei.05')).toBe(true);
    expect(at.has('C6.triage.02')).toBe(true);
    expect(at.has('C6.chat.hold.01')).toBe(true);
    expect(at.has('C7.chat.01')).toBe(true);
    expect(at.has('C6.fail.chat')).toBe(false);
    expect(at.has('C4.triage.04')).toBe(false);
    // D11: the crew are in long before c4 + 15, so no surge-window line plays.
    for (const id of ['C4.chat.seed', 'C4.chat.03', 'C4.chat.04', 'C4.grandma.01', 'C4.lux.02'] as LineId[]) {
      expect(at.has(id), id).toBe(false);
    }
    // The newly cued lines never play before their challenge.
    const cued: LineId[] = [
      'C3.chat.03',
      'C4.triage.02',
      'C4.chat.02',
      'C4.triage.03',
      'C5.triage.02',
      'C5.triage.03',
      'C5.rei.05',
      'C5.ozzie.04',
      'C5.mika.05',
      'C5.chat.01',
      'C6.triage.02',
      'C6.fail.chat',
    ];
    // C5 is the rescue: the crew break in when trust runs low, before the nominal c5.
    const rescueAt = r.play.rescue?.at ?? Infinity;
    expect(rescueAt).toBeLessThan(C.c5);
    for (const id of cued) {
      const t = at.get(id);
      if (t === undefined) continue;
      expect(t, id).toBeGreaterThanOrEqual(id.startsWith('C5.') ? rescueAt : challengeStart(id)!);
    }
  });
});
