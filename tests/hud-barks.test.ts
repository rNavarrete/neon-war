import { BARK_QUEUE_MAX, BARK_SECONDS, NO_BARKS, enqueueBark, stepBarks } from '../src/scenes/hud/barks';
import { type CueView, AWAITING_ENG503, CUES, NEW_DIRECTOR, direct } from '../src/scenes/hud/cues';
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
    dialTouched: false,
    estimate: null,
    sizing: null,
    sizingOpen: false,
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
  it('C1: TRIAGE guesses 480 two seconds after the card closes', () => {
    const fired = play([view(), view({ cardClosed: true }), view({ cardClosed: true, now: C.c1 + 2 })]);
    expect(fired).toEqual(['C1.triage.01', 'C1.triage.02']);
    expect(LINES['C1.triage.02'].text).toBe("480 a second! I'm great at math.");
  });

  it('C1: a close estimate gets the sheepish line, a wrong one the thinking line', () => {
    expect(play([view({ cardClosed: true, estimate: 30 })])).toContain('C1.triage.03');
    const wrong = play([view({ cardClosed: true, estimate: 480 })]);
    expect(wrong).toContain('C1.triage.04');
    expect(wrong).not.toContain('C1.triage.03');
    expect(wrong.indexOf('C1.triage.04')).toBeLessThan(wrong.indexOf('C1.triage.05'));
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

  it('C6: the prompt opens with Rei, TRIAGE does the math after 8 s, and the answer gets a reaction', () => {
    const open = { now: 440, sizingOpen: true };
    expect(play([view(open), view({ ...open, now: 448 })])).toEqual(['C6.rei.01', 'C6.triage.01']);
    expect(play([view({ now: 445, sizing: 2 })])).toContain('C6.mika.01');
    expect(play([view({ now: 445, sizing: 6 })])).toContain('C6.ozzie.01');
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
