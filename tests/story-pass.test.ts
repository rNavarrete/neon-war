// Rolando's story pass (31 Oct 2026): clarity and pacing for Session 0. Each rule here comes from
// one of his notes: scale up first in C3, one clear task in the surge with the crew right after it,
// help that stops the moment the player acts, the midnight forecast pointing back at the failure,
// and a Solace purchase whose failed promise is unmistakable without leaving anyone stuck.

import { NO_COMMS, enqueueComms, stepComms, withdrawComms } from '../src/scenes/hud/comms';
import { type CueView, NEW_DIRECTOR, SUPERSEDED, direct } from '../src/scenes/hud/cues';
import { deckState, keyAlpha } from '../src/scenes/hud/deck';
import { BROWNOUT } from '../src/sim/brownout';
import { rescueAfterCut, rescueDue } from '../src/sim/failures';
import {
  type Play,
  answerBanner,
  createPlay,
  overclockServer as fitKit,
  rackServer,
  step,
} from '../src/sim/play';
import type { Part } from '../src/sim/board';
import { LINES, type LineId } from '../src/strings';

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;

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
    cardClosed: true,
    bannerShown: false,
    banner: null,
    laundryCut: false,
    decommissionsAfterMidnight: 0,
    droppedInC6: false,
    ...over,
  };
}

/** Run the director over views, each at its own HUD clock (its `now` unless given), and collect what fired. */
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

/** Views every 0.5 s from `from` to `to`, built by `at`. */
function sweep(from: number, to: number, at: (t: number) => Partial<CueView>): CueView[] {
  const out: CueView[] = [];
  for (let t = from; t <= to + 1e-9; t += 0.5) out.push(view({ now: t, clock: t, ...at(t) }));
  return out;
}

function ok(r: { ok: true; play: Play } | { ok: false; reason: string }): Play {
  if (!r.ok) throw new Error(r.reason);
  return r.play;
}

function stepTo(p: Play, t: number): Play {
  let q = p;
  while (q.t < t - 1e-9 && !q.failure) q = step(q, Math.min(0.1, t - q.t));
  return q;
}

const FIXED: Part[] = [
  { id: 'gateway', kind: 'gateway', slot: null },
  { id: 'database', kind: 'database', slot: null },
];

function newPlay(): Play {
  return createPlay({ slots: ['s1', 's2', 's3', 's4'], parts: FIXED, seed: 7 });
}

describe('1. scale up first (C3)', () => {
  it('TRIAGE names SCALE UP as the one tool, not "scale up or scale out?"', () => {
    expect(LINES['C3.triage.01'].text).toBe('New toy! SCALE UP swaps your server for one twice as big.');
    expect(play([view({ now: C.c3, servers: 1, capacity: 60 })])).toContain('C3.triage.01');
  });

  it('says nothing about the new tool once the server is already bigger', () => {
    expect(
      play([view({ now: C.c3, servers: 1, capacity: 120, overclocked: true })]).includes('C3.triage.01'),
    ).toBe(false);
  });

  it('explains the missing piece for a second server: it needs a load balancer', () => {
    expect(LINES['C3.lux.01'].text).toBe('The gateway feeds one server. A second one needs a load balancer.');
    const idle = sweep(C.c3, C.c3 + 6, () => ({ servers: 2, capacity: 120, idleServer: true }));
    expect(play(idle).filter((id) => id.startsWith('C3.triage') || id.startsWith('C3.lux'))).toEqual([
      'C3.triage.01',
      'C3.triage.02',
      'C3.lux.01',
    ]);
  });
});

describe('2. the surge: one clear task, then the crew', () => {
  it('Lux names the laundry cut 1 s after "Hold", while it is open', () => {
    const fired = play(sweep(C.c4, C.c4 + 2, () => ({ demand: 250, capacity: 120, dropped: 130 })));
    expect(fired.filter((id) => id.startsWith('C4.lux'))).toEqual(['C4.lux.01', 'C4.lux.shed']);
    expect(LINES['C4.lux.shed'].text).toBe('Laundry floor. Cut it loose. Now.');
  });

  it('plays the panic exchange while the task waits: short lines from Lux, more words from TRIAGE', () => {
    const fired = play(sweep(C.c4, C.c4 + 12, () => ({ demand: 250, capacity: 120, dropped: 130 })));
    expect(
      fired.filter((id) => ['C4.triage.05', 'C4.lux.03', 'C4.triage.06', 'C4.lux.04'].includes(id)),
    ).toEqual(['C4.triage.05', 'C4.lux.03', 'C4.triage.06', 'C4.lux.04']);
    expect(LINES['C4.triage.05'].text).toBe('Lux?');
    expect(LINES['C4.lux.03'].text).toBe('I see it.');
    expect(LINES['C4.triage.06'].text).toBe("There's more of it now.");
    expect(LINES['C4.lux.04'].text).toBe('I see that too.');
  });

  it('stops the exchange the moment the floor is cut', () => {
    const fired = play([
      ...sweep(C.c4, C.c4 + 1.5, () => ({ demand: 250, capacity: 120 })),
      ...sweep(C.c4 + 2, C.c4 + 20, () => ({ demand: 210, capacity: 120, laundryCut: true })),
    ]);
    expect(fired.includes('C4.triage.05')).toBe(false);
    expect(fired.includes('C4.triage.nudge.shed')).toBe(false);
    expect(fired.includes('C4.lux.cut')).toBe(true);
  });

  it('no longer asks for capacity she cannot build: "Build before it hits" moved to midnight', () => {
    expect(LINES['C4.lux.forecast'].text).toBe('250. Nothing on this board holds that.');
    expect(LINES['C6.lux.forecast'].text).toBe('Midnight wave. Build before it hits, not after.');
  });

  it('brings the crew 5 s after the cut, but never over the big server going dark', () => {
    expect(rescueAfterCut(C.c4 + 12)).toBe(C.c4 + 17);
    expect(rescueAfterCut(C.c4)).toBe(C.c4 + 10);
    expect(rescueDue(100, C.c4 + 16.9, C.c4 + 12)).toBe(null);
    expect(rescueDue(100, C.c4 + 17, C.c4 + 12)).toBe('cut');
    expect(rescueDue(100, C.c4 + 9.9, C.c4)).toBe(null);
    expect(rescueDue(100, C.c4 + 10, C.c4)).toBe('cut');
    // Without a cut, the old triggers stand.
    expect(rescueDue(100, C.c4 + 39.9, null)).toBe(null);
    expect(rescueDue(100, C.c4 + 40, null)).toBe('time');
  });
});

describe('3. help stops once the action succeeds', () => {
  it('takes back a waiting instruction, unshown, and leaves the rest', () => {
    let s = enqueueComms(NO_COMMS, 'C1.triage.01', 0);
    s = stepComms(s, 0, 30);
    s = enqueueComms(s, 'C1.triage.05', 0.5);
    s = enqueueComms(s, 'C1.triage.02', 0.6);
    const w = withdrawComms(s, ['C1.triage.05'], 1);
    expect(w.queue.map((q) => q.id)).toEqual(['C1.triage.02']);
    expect(w.dropped).toEqual(['C1.triage.05']);
    expect(w.current?.id).toBe('C1.triage.01');
  });

  it('ends a line showing now at once, and changes nothing when none is there', () => {
    let s = enqueueComms(NO_COMMS, 'C1.triage.nudge.feed.1', 0);
    s = stepComms(s, 0, 30);
    const w = withdrawComms(s, ['C1.triage.nudge.feed.1'], 1.5);
    expect(w.current?.until).toBe(1.5);
    expect(withdrawComms(s, ['C4.lux.shed'], 1.5)).toBe(s);
  });

  it('marks the C1 instruction done once a server is down, and the surge task done once cut', () => {
    const c1 = SUPERSEDED.find((x) => x.ids.includes('C1.triage.05'))!;
    expect(c1.done(view({ servers: 0 }))).toBe(false);
    expect(c1.done(view({ servers: 1 }))).toBe(true);
    const c4 = SUPERSEDED.find((x) => x.ids.includes('C4.lux.shed'))!;
    expect(c4.done(view({ now: C.c4 + 3 }))).toBe(false);
    expect(c4.done(view({ now: C.c4 + 3, laundryCut: true }))).toBe(true);
  });

  it('never says the C1 instruction once a server is already on the grid', () => {
    const fired = play(sweep(C.c1, C.c1 + 8, (t) => ({ servers: t > C.c1 + 3 ? 1 : 0 })));
    expect(fired).toEqual(['C1.triage.01', 'C1.triage.02', 'C1.lux.01']);
  });

  it('pulses the CUT 3F key while it is the one task, steady under reduce flicker', () => {
    const input = {
      now: C.c4 + 2,
      paused: false,
      regroup: { charges: 0, handedOver: false, left: 0 },
      laundryCut: null,
      laundryCutAvailable: true,
      banner: null,
      cardOpen: false,
    };
    expect(keyAlpha(deckState(input, 0, false), 'two')).toBe(0.75);
    expect(keyAlpha(deckState(input, 0, true), 'two')).toBe(1);
  });
});

describe('4. the crew entrance: Rei sets the test, Lux does the work', () => {
  it('says it in a few lines', () => {
    expect(LINES['C5.rei.01'].text).toBe('You built this?');
    expect(LINES['C5.lux.01'].text).toBe('Are you here to complain?');
    expect(LINES['C5.rei.02'].text).toBe("Night Shift. We brought the parts. You're doing the wiring.");
    expect(LINES['C5.mika.01'].text).toBe(
      "Breathe. Watch the demand gauge. It's settling to about 120 a second.",
    );
    expect(LINES['C5.ozzie.01'].text).toBe("I'll front you 100. Waste it and I'm telling your grandma.");
    expect(LINES['C5.rei.04'].text).toBe("Clock's running. Show us.");
  });
});

describe('5. midnight: back to the failure, and room for the reroute', () => {
  it('TRIAGE points at the coming power loss 3 s after its sum', () => {
    const fired = play(sweep(C.c6 - 10, C.c6 + 2, () => ({ servers: 3, capacity: 180, dropped: 0 })));
    expect(fired.slice(-1)).toEqual(['C6.triage.03']);
  });

  it('gives the dip 4 s before Lux says why you keep a spare', () => {
    const dark = (t: number): Partial<CueView> => ({
      servers: 4,
      capacity: 180,
      dropped: 0,
      darkPart: t >= MIDNIGHT - 10 ? 'server-p2' : null,
    });
    const fired = play(sweep(MIDNIGHT - 11, MIDNIGHT - 6.5, dark));
    expect(fired.includes('C6.triage.02')).toBe(true);
    expect(fired.includes('C6.lux.spare')).toBe(false);
  });
});

describe('6. the dialogue', () => {
  it('grounds Lux early, and keeps the joke true after two connections', () => {
    expect(LINES['C0.lux.04'].text).toBe(
      "This is what I get for rebuilding the block's power app. Lifetime tech support.",
    );
    expect(LINES['C1.lux.chat'].text).toBe('Chat, I literally connected a box. Calm down. ...Thank you.');
  });
});

describe('Solace: an unmistakable failed promise, and nobody left stuck', () => {
  it('TRIAGE says the gauge will not move because nothing was short, then calls out the empty minute', () => {
    expect(LINES['C2.triage.pay'].text).toBe("Solace is on. The gauge won't move: we weren't short of room.");
    const paid = { banner: 'pay' as const, bannerAt: C.c2, servers: 1, capacity: 60, dropped: 0 };
    const end = C.c2 + BROWNOUT.solace.durationSeconds;
    const fired = play([
      view({ ...paid, now: end - 1, clock: end - 1, solaceCaught: 0 }),
      view({ ...paid, now: end, clock: end, solaceCaught: 0 }),
      view({ ...paid, now: end + 2, clock: end + 2, solaceCaught: 0 }),
    ]);
    expect(fired.filter((id) => id === 'C2.triage.expired' || id === 'C2.lux.expired')).toEqual([
      'C2.triage.expired',
      'C2.lux.expired',
    ]);
  });

  it('stays quiet about it when the banner did catch requests', () => {
    const end = C.c2 + BROWNOUT.solace.durationSeconds;
    const fired = play([view({ banner: 'pay', bannerAt: C.c2, now: end, clock: end, solaceCaught: 12 })]);
    expect(fired.includes('C2.triage.expired')).toBe(false);
  });

  it('played: paying in C2 still leaves the scale-up affordable in C3', () => {
    let p = stepTo(newPlay(), C.c1);
    p = ok(rackServer(p, 's1'));
    p = stepTo(p, C.c2);
    p = ok(answerBanner(p, 'pay'));
    p = stepTo(p, C.c3);
    // 400 − 80 for the server − 200 for Solace + 40 for the first serve's tip, less upkeep and
    // plus any trickle: well over the scale-up's 60.
    expect(p.session.board.credits >= BROWNOUT.overclock.cost).toBe(true);
    expect(ok(fitKit(p, 'server-p1')).session.board.credits).toBe(p.session.board.credits - 60);
  });

  it('played: paying in C2, then racking an idle second server, the full refund still buys the scale-up', () => {
    let p = stepTo(newPlay(), C.c1);
    p = ok(rackServer(p, 's1'));
    p = stepTo(p, C.c2);
    p = ok(answerBanner(p, 'pay'));
    p = stepTo(p, C.c3);
    p = ok(rackServer(p, 's2'));
    const r = fitKit(p, 'server-p1');
    expect(r.ok).toBe(true);
  });
});
