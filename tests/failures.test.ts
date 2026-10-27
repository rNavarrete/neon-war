import { type Board, type Part, route } from '../src/sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../src/sim/brownout';
import {
  DIP_SCRIPT,
  blockDemand,
  coolHeat,
  darkParts,
  dipPhase,
  flickeringParts,
  laundryCutAvailable,
  rescueDue,
  resolveDip,
  seededIndex,
  sizingVerdict,
  updateOverheat,
  updateRetries,
  withRetries,
} from '../src/sim/failures';
import {
  type Play,
  type PlayResult,
  answerBanner,
  applyRescue,
  clockAt,
  createPlay,
  cutLaundry,
  debriefNumbers,
  decommissionServer,
  liveServers,
  offlineParts,
  overclockServer,
  playDemand,
  rackServer,
  replaceServer,
  rewind,
  routePlay,
  step,
  useRegroup,
} from '../src/sim/play';

const C = BROWNOUT.challenges;
const SLOTS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
const fixed: Part[] = [
  { id: 'gateway', kind: 'gateway', slot: null },
  { id: 'database', kind: 'database', slot: null },
];

function ok(result: PlayResult): Play {
  if (!result.ok) throw new Error(result.reason);
  return result.play;
}

/** Step in 0.1 s ticks until the clock reaches T (or the board freezes on a failure). */
function stepTo(play: Play, T: number, dt = 0.1): Play {
  let p = play;
  while (p.t < T && !p.failure) p = step(p, Math.min(dt, T - p.t));
  return p;
}

function untilRescue(play: Play): Play {
  let p = play;
  while (!p.rescue && !p.failure) p = step(p, 0.05);
  return p;
}

function newPlay(seed = 7): Play {
  return createPlay({ slots: SLOTS, parts: fixed, seed });
}

/**
 * Best play up to the end of C3: one server racked as C1 opens, the banner ignored, the overclock
 * kit fitted early in C2. Optionally an idle second server racked in C3.
 */
function throughC3(opts: { idleSecond?: boolean } = {}): Play {
  let p = stepTo(newPlay(), C.c1);
  p = ok(rackServer(p, 's1'));
  p = stepTo(p, C.c2 + 5);
  p = ok(answerBanner(p, 'ignore'));
  p = stepTo(p, C.c2 + 10);
  p = ok(overclockServer(p, 'server-p1'));
  if (opts.idleSecond) {
    p = stepTo(p, C.c3 + 5);
    p = ok(rackServer(p, 's2'));
  }
  return stepTo(p, C.c4);
}

/** The post-rescue state at 23:59 with n healthy servers behind the balancer. */
function postRescueAtC6(n: number): Play {
  let p = untilRescue(throughC3({ idleSecond: true }));
  if (n > 5) p = { ...p, session: { ...p.session, board: { ...p.session.board, credits: 1000 } } };
  for (let i = 3; i <= n; i++) p = ok(rackServer(p, `s${i}`));
  p = stepTo(p, C.c6);
  expect(p.failure).toBeNull();
  expect(liveServers(p)).toBe(n);
  return p;
}

/** Play from 23:59 with no action through the end of the midnight dip (or a failure). */
function throughDip(p: Play): { end: Play; dropped: number } {
  const end = stepTo(p, DIP_SCRIPT[1].darkAt + BROWNOUT.powerDip.darkSeconds);
  return { end, dropped: end.dropped - p.dropped };
}

/** gateway → server → database, with the server's capacity from the rules. */
function oneServerBoard(): Board {
  return {
    credits: 0,
    slots: ['s1'],
    nextId: 2,
    parts: [...fixed, { id: 'srv', kind: 'server', slot: 's1' }],
    wires: [
      { from: 'gateway', to: 'srv' },
      { from: 'srv', to: 'database' },
    ],
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe('ac1: overheating', () => {
  const board = oneServerBoard();
  const over = route(board, BROWNOUT_RULES, 90);
  const under = route(board, BROWNOUT_RULES, 30);

  it('a server over 100% load for 8 s in a row dies', () => {
    let heat = coolHeat();
    for (let i = 0; i < 15; i++) heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.5);
    expect(heat.dead).toEqual([]);
    expect(heat.overload.srv).toBe(7.5);
    heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.5);
    expect(heat.dead).toEqual(['srv']);
  });

  it('7.9 s over load, then a drop under 100%, does not kill it', () => {
    let heat = coolHeat();
    for (let i = 0; i < 79; i++) heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.1);
    expect(heat.dead).toEqual([]);
    heat = updateOverheat(board, BROWNOUT_RULES, under, heat, [], 0.1);
    expect(heat.overload.srv).toBeUndefined();
    for (let i = 0; i < 79; i++) heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.1);
    expect(heat.dead).toEqual([]);
  });

  it('exactly 100% load is not over load; an offline server does not heat', () => {
    const full = route(board, BROWNOUT_RULES, BROWNOUT.server.capacity);
    expect(updateOverheat(board, BROWNOUT_RULES, full, coolHeat(), [], 10).dead).toEqual([]);
    expect(updateOverheat(board, BROWNOUT_RULES, over, coolHeat(), ['srv'], 10).dead).toEqual([]);
  });

  it('a dead server stays offline until it is replaced', () => {
    // No overclock: the C3 climb past 60 cooks the lone server.
    let p = stepTo(newPlay(), C.c1);
    p = ok(rackServer(p, 's1'));
    p = stepTo(p, C.c4);
    expect(p.failure?.cause).toBe('server-died');
    expect(p.heat.dead).toEqual(['server-p1']);
    const frozen = { ...p, failure: null };
    const later = frozen.t + 30;
    expect(offlineParts(frozen, later)).toContain('server-p1');
    expect(routePlay(frozen, 30, later).served).toBe(0);

    const replaced = ok(replaceServer(frozen, 'server-p1'));
    expect(replaced.heat.dead).toEqual([]);
    const fresh = replaced.session.board.parts.at(-1)!;
    expect(fresh.slot).toBe('s1');
    expect(replaced.session.board.credits).toBe(frozen.session.board.credits - BROWNOUT.server.cost);
    expect(routePlay(replaced, 30, replaced.t + 1).served).toBe(0); // still booting
    expect(routePlay(replaced, 30, replaced.t + BROWNOUT.server.bootSeconds).served).toBe(30);
  });
});

describe('ac2: retries', () => {
  it('while errors last, demand rises by up to 50%: the 250 surge climbs toward 375', () => {
    const board = oneServerBoard();
    let retry = 0;
    for (let i = 0; i < 600; i++) {
      const demand = withRetries(250, retry);
      const flow = route(board, BROWNOUT_RULES, demand);
      retry = updateRetries(retry, flow.dropped / demand, 0.1);
      expect(retry).toBeLessThanOrEqual(BROWNOUT.retries.maxDemandRise);
    }
    expect(retry).toBe(0.5);
    expect(withRetries(250, retry)).toBe(375);
  });

  it('rises no further than the error share', () => {
    expect(updateRetries(0, 0.2, 60)).toBe(0.2);
    expect(updateRetries(0, 1, 60)).toBe(0.5);
    expect(updateRetries(0, 1, 1)).toBeCloseTo(BROWNOUT.retries.risePerSecond);
  });

  it('falls back to 0 when errors stop', () => {
    let retry = 0.5;
    retry = updateRetries(retry, 0, 1);
    expect(retry).toBeCloseTo(0.5 - BROWNOUT.retries.fallPerSecond);
    for (let i = 0; i < 10; i++) retry = updateRetries(retry, 0, 1);
    expect(retry).toBe(0);
    expect(withRetries(250, retry)).toBe(250);
  });

  it('in the surge, a played session climbs toward 375 and settles at the rescue', () => {
    let p = throughC3();
    p = stepTo(p, C.c4 + BROWNOUT.surgeScript.dipAfterSeconds + 3);
    expect(p.retry).toBeGreaterThan(0);
    expect(playDemand(p, p.t)).toBeGreaterThan(250);
    expect(playDemand(p, p.t)).toBeLessThanOrEqual(375);
    p = untilRescue(p);
    expect(p.retry).toBe(0);
  });
});

describe('ac3: power dips', () => {
  const dip = resolveDip(oneServerBoard(), DIP_SCRIPT[0], 1);

  it('flickers for 2 s, then the part is dark for 20 s', () => {
    expect(dip.part).toBe('srv');
    expect(dip.darkAt - dip.warnAt).toBe(2);
    expect(dip.endsAt - dip.darkAt).toBe(20);
    expect(dipPhase(dip, dip.warnAt - 0.01)).toBeNull();
    expect(dipPhase(dip, dip.warnAt)).toBe('flicker');
    expect(flickeringParts([dip], dip.warnAt + 1)).toEqual(['srv']);
    expect(darkParts([dip], dip.warnAt + 1)).toEqual([]);
    expect(dipPhase(dip, dip.darkAt)).toBe('dark');
    expect(darkParts([dip], dip.darkAt + 19.9)).toEqual(['srv']);
    expect(dipPhase(dip, dip.endsAt)).toBeNull();
  });

  it('the gateway feeds a dark part anyway, so its traffic is lost', () => {
    const flow = route(oneServerBoard(), BROWNOUT_RULES, 30, darkParts([dip], dip.darkAt));
    expect(flow.dropped).toBe(30);
    expect(flow.served).toBe(0);
    expect(flow.skipped).toEqual([]);
  });

  it('the load balancer skips a dark part and its share goes to the live ones', () => {
    const board: Board = {
      credits: 0,
      slots: ['s1', 's2'],
      nextId: 3,
      parts: [
        ...fixed,
        { id: 'lb', kind: 'balancer', slot: null },
        { id: 'a', kind: 'server', slot: 's1' },
        { id: 'b', kind: 'server', slot: 's2' },
      ],
      wires: [
        { from: 'gateway', to: 'lb' },
        { from: 'lb', to: 'a' },
        { from: 'lb', to: 'b' },
        { from: 'a', to: 'database' },
        { from: 'b', to: 'database' },
      ],
    };
    const midnight = resolveDip(board, DIP_SCRIPT[1], 3);
    const darkOne = midnight.part!;
    const liveOne = darkOne === 'a' ? 'b' : 'a';
    const flow = route(board, BROWNOUT_RULES, 60, darkParts([midnight], midnight.darkAt));
    expect(flow.skipped).toEqual([`lb>${darkOne}`]);
    expect(flow.load[liveOne]).toBe(60);
    expect(flow.dropped).toBe(0);
    // While it only flickers, the balancer still feeds it.
    const flicker = route(board, BROWNOUT_RULES, 60, darkParts([midnight], midnight.warnAt));
    expect(flicker.skipped).toEqual([]);
    expect(flicker.load[darkOne]).toBe(30);
  });
});

describe('ac4: the dip schedule', () => {
  it('the C4 surge script takes the overclocked server dark', () => {
    const [surge] = DIP_SCRIPT;
    expect(surge.target).toBe('overclocked');
    expect(surge.darkAt - BROWNOUT.powerDip.warningSeconds).toBeGreaterThanOrEqual(C.c4);
    expect(surge.darkAt).toBeLessThan(C.c4 + BROWNOUT.rescue.surgeSeconds);
    const board: Board = {
      ...oneServerBoard(),
      parts: [
        ...fixed,
        { id: 'stock', kind: 'server', slot: 's1' },
        { id: 'big', kind: 'server', slot: 's2', boost: 2 },
      ],
    };
    expect(resolveDip(board, surge, 0).part).toBe('big');
    expect(resolveDip(board, surge, 99).part).toBe('big');
  });

  it('in a played session the surge dip takes the overclocked server dark', () => {
    const p = stepTo(throughC3(), DIP_SCRIPT[0].darkAt + 1);
    expect(p.session.board.parts.find((q) => q.id === 'server-p1')?.boost).toBe(2);
    expect(p.dips.find((d) => d.id === 'surge')?.part).toBe('server-p1');
    expect(darkParts(p.dips, p.t)).toEqual(['server-p1']);
  });

  it('the C6 script puts one seeded dip 10 s before midnight', () => {
    const midnight = DIP_SCRIPT.filter((d) => d.darkAt >= C.c6);
    expect(midnight).toHaveLength(1);
    expect(midnight[0].target).toBe('seeded');
    expect(midnight[0].darkAt).toBe(BROWNOUT.clock.midnight - 10);
    expect(midnight[0].darkAt).toBe(500); // 23:59:50
  });

  it('the seed decides which server goes dark, the same way every time', () => {
    const board: Board = {
      ...oneServerBoard(),
      parts: [
        ...fixed,
        ...['a', 'b', 'c', 'd'].map((id, i) => ({ id, kind: 'server' as const, slot: `s${i}` })),
      ],
    };
    const picks = new Set<string | null>();
    for (let seed = 0; seed < 20; seed++) {
      const dip = resolveDip(board, DIP_SCRIPT[1], seed);
      expect(resolveDip(board, DIP_SCRIPT[1], seed)).toEqual(dip);
      expect(seededIndex(seed, 4)).toBeLessThan(4);
      picks.add(dip.part);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('ac5: cutting the laundry floor loose', () => {
  it('removes about 40 req/s of demand in the surge', () => {
    expect(blockDemand(C.c4 + 10, false, false)).toBe(250);
    expect(blockDemand(C.c4 + 10, false, true)).toBe(210);
    expect(withRetries(blockDemand(C.c4 + 10, false, true), 0.5)).toBe(315);
  });

  it('is only available in C4 before the crew arrives, and once', () => {
    expect(laundryCutAvailable(C.c4 - 1, false)).toBe(false);
    expect(laundryCutAvailable(C.c4, false)).toBe(true);
    expect(laundryCutAvailable(C.c4 + 10, true)).toBe(false);
    expect(laundryCutAvailable(C.c5, false)).toBe(false);
    expect(cutLaundry(stepTo(newPlay(), C.c3)).ok).toBe(false);
  });

  it('is recorded for the debrief', () => {
    let p = stepTo(throughC3(), C.c4 + 1);
    const before = playDemand(p, p.t);
    p = ok(cutLaundry(p));
    expect(p.laundryCut).toEqual({ at: C.c4 + 1 });
    expect(before - playDemand(p, p.t)).toBeCloseTo(40 * (1 + p.retry));
    expect(cutLaundry(p).ok).toBe(false);
    expect(debriefNumbers(p).laundryCut).toBe(true);
    expect(debriefNumbers(throughC3()).laundryCut).toBe(false);
  });
});

describe('ac6: the rescue trigger', () => {
  it('fires when trust drops under 30 or 45 s into the surge, whichever comes first', () => {
    expect(rescueDue(29.9, C.c4 + 10)).toBe('trust');
    expect(rescueDue(30, C.c4 + 10)).toBeNull();
    expect(rescueDue(100, C.c4 + 44.9)).toBeNull();
    expect(rescueDue(100, C.c4 + 45)).toBe('time');
    expect(rescueDue(10, C.c4 + 45)).toBe('trust');
    expect(rescueDue(10, C.c4 - 1)).toBeNull();
  });

  it('trust trigger: the played surge brings the crew when trust drops under 30', () => {
    const p = untilRescue(throughC3());
    expect(p.rescue?.by).toBe('trust');
    expect(p.rescue!.at).toBeLessThan(C.c4 + 45);
    expect(p.session.trust).toBeLessThan(30);
  });

  it('time trigger: a board that keeps trust up still gets the crew 45 s in', () => {
    // Six servers behind a balancer, feeding two databases: even with the surge dip taking one
    // server dark, 300 req/s of servers and 400 of database hold the 250 surge without errors.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    let p = createPlay({
      slots: SLOTS,
      seed: 1,
      parts: [
        { id: 'gateway', kind: 'gateway', slot: null },
        { id: 'db1', kind: 'database', slot: null },
        { id: 'db2', kind: 'database', slot: null },
        { id: 'lb', kind: 'balancer', slot: null },
        ...ids.map((id, i) => ({ id, kind: 'server' as const, slot: SLOTS[i] })),
      ],
      wires: [
        { from: 'gateway', to: 'lb' },
        ...ids.flatMap((id, i) => [
          { from: 'lb', to: id },
          { from: id, to: i % 2 ? 'db1' : 'db2' },
        ]),
      ],
    });
    p = untilRescue(p);
    expect(p.rescue).toEqual({ at: C.c4 + 45, by: 'time' });
    expect(p.session.trust).toBeGreaterThanOrEqual(30);
  });

  it('fires only once', () => {
    let p = untilRescue(throughC3());
    const first = p.rescue;
    const credits = p.session.board.credits;
    p = ok(rackServer(p, 's2'));
    p = ok(rackServer(p, 's3'));
    p = { ...p, session: { ...p.session, trust: 5 } };
    p = stepTo(p, C.c4 + 50);
    expect(p.rescue).toBe(first);
    expect(p.session.ozzie.fronted).toBe(true);
    expect(p.session.board.credits).toBeLessThan(credits);
  });
});

describe('ac7: after the rescue', () => {
  it('the overclocked server is back at stock 60, with a load balancer and 100 credits from Ozzie', () => {
    let p = stepTo(throughC3(), C.c4 + 8);
    expect(p.rescue).toBeNull();
    // Cook the overclocked server too: the kit fried, the crew bring it back at stock.
    p = { ...p, heat: { overload: {}, dead: ['server-p1'] } };
    const r = applyRescue(p, p.t, 'trust');
    const server = r.session.board.parts.find((q) => q.id === 'server-p1')!;
    expect(server.boost).toBeUndefined();
    expect(BROWNOUT_RULES.capacity.server).toBe(60);
    expect(r.heat.dead).toEqual([]);
    expect(r.session.board.parts.filter((q) => q.kind === 'balancer')).toHaveLength(1);
    expect(r.session.board.wires).toEqual(
      expect.arrayContaining([
        { from: 'gateway', to: 'balancer' },
        { from: 'balancer', to: 'server-p1' },
        { from: 'server-p1', to: 'database' },
      ]),
    );
    expect(r.session.board.wires.filter((w) => w.from === 'gateway')).toHaveLength(1);
    expect(r.session.board.credits).toBe(p.session.board.credits + 100);
    expect(r.session.ozzie.fronted).toBe(true);
    // The fried server serves its stock 60 at once, behind the balancer.
    const flow = routePlay(r, 120, r.t);
    expect(flow.load['server-p1']).toBe(120);
    expect(flow.served).toBe(60);
  });

  it('the surge settles to 120 once the crew is in', () => {
    const p = untilRescue(throughC3());
    expect(playDemand(p, p.t)).toBe(120);
    expect(playDemand(p, C.c6 - 1)).toBe(120);
    expect(darkParts(p.dips, p.t)).toEqual([]);
  });
});

describe('ac8: Regroup', () => {
  it('is only available after the rescue', () => {
    const before = stepTo(throughC3(), C.c4 + 1);
    expect(useRegroup(before).ok).toBe(false);
    const after = untilRescue(before);
    expect(after.regroup.charges).toBe(1);
    expect(useRegroup(after).ok).toBe(true);
  });

  it('runs the sim at quarter speed for 10 s', () => {
    let p = ok(rackServer(ok(rackServer(untilRescue(throughC3()), 's2')), 's3'));
    const t0 = p.t;
    p = ok(useRegroup(p));
    p = step(p, 1);
    expect(p.t - t0).toBeCloseTo(0.25);
    for (let i = 0; i < 9; i++) p = step(p, 1);
    expect(p.t - t0).toBeCloseTo(2.5);
    expect(p.regroup.left).toBe(0);
    p = step(p, 1);
    expect(p.t - t0).toBeCloseTo(3.5);
    // A step that runs past the end of Regroup is slow only for what was left of it.
    let q = ok(useRegroup({ ...p, regroup: { ...p.regroup, charges: 1 } }));
    const t1 = q.t;
    q = step(q, 12);
    expect(q.t - t1).toBeCloseTo(2.5 + 2);
  });

  it('has one charge per session, kept across rewinds', () => {
    let p = untilRescue(throughC3());
    p = ok(useRegroup(p));
    p = step(p, 10);
    expect(useRegroup(p).ok).toBe(false);
    // Do nothing: trust runs out, Rei rewinds to the start of the surge; the charge stays spent.
    p = stepTo(p, C.c6);
    expect(p.failure?.by).toBe('rei');
    p = untilRescue(ok(rewind(p)));
    expect(p.rescue).not.toBeNull();
    expect(p.regroup.charges).toBe(0);
    expect(useRegroup(p).ok).toBe(false);
  });
});

describe('ac9: rewinds', () => {
  function expectRestored(rewound: Play, checkpoint: Play): void {
    expect(rewound.t).toBe(checkpoint.t);
    expect(rewound.session.board.credits).toBe(checkpoint.session.board.credits);
    expect(rewound.session.board.parts).toEqual(checkpoint.session.board.parts);
    expect(rewound.session.board.wires).toEqual(checkpoint.session.board.wires);
    expect(rewound.session.trust).toBe(checkpoint.session.trust);
    expect(rewound.failure).toBeNull();
  }

  it('C1: a failure goes back to the start of C1 through TRIAGE', () => {
    const atC1 = stepTo(newPlay(), C.c1);
    const failed = stepTo(atC1, C.c2);
    expect(failed.failure).toEqual({ at: failed.t, cause: 'trust', by: 'triage', rewindTo: C.c1 });
    expect(step(failed, 5)).toBe(failed); // the board is frozen until the rewind
    const r = ok(rewind(failed));
    expectRestored(r, atC1);
    expect(r.rewinds).toEqual([{ at: failed.t, to: C.c1, by: 'triage', cause: 'trust' }]);
  });

  it('C2: a failure goes back to the start of C2', () => {
    let p = stepTo(newPlay(), C.c1);
    p = ok(rackServer(p, 's1'));
    const atC2 = stepTo(p, C.c2);
    p = ok(decommissionServer(stepTo(atC2, C.c2 + 5), 'server-p1'));
    p = stepTo(p, C.c3);
    expect(p.failure).toMatchObject({ cause: 'trust', by: 'triage', rewindTo: C.c2 });
    const r = ok(rewind(p));
    expectRestored(r, atC2);
    expect(r.session.board.parts.some((q) => q.id === 'server-p1')).toBe(true);
  });

  it('C3: the server overheating goes back to the start of C3', () => {
    let p = stepTo(newPlay(), C.c1);
    p = ok(rackServer(p, 's1'));
    const atC3 = stepTo(p, C.c3);
    p = stepTo(atC3, C.c4);
    expect(p.failure).toMatchObject({ cause: 'server-died', by: 'triage', rewindTo: C.c3 });
    const r = ok(rewind(p));
    expectRestored(r, atC3);
    expect(r.heat.dead).toEqual([]);
  });

  it('trust reaching 0 in the surge still brings the crew, and the surge restarts', () => {
    const atC4 = throughC3();
    expect(atC4.t).toBe(C.c4);
    const p = stepTo(untilRescue(atC4), C.c6); // no build after the rescue
    expect(p.session.trust).toBe(0);
    expect(p.rescue).not.toBeNull();
    expect(p.failure).toMatchObject({ cause: 'trust', by: 'rei', rewindTo: C.c4 });
    const r = ok(rewind(p));
    expectRestored(r, atC4);
    expect(r.crewMet).toBe(true);
    expect(r.rescue).toBeNull();
    expect(r.session.ozzie.fronted).toBe(false);
  });

  it('trust hitting 0 before the rescue fired still brings the crew', () => {
    const atC4 = throughC3();
    const p = step({ ...atC4, session: { ...atC4.session, trust: 31 } }, 30);
    expect(p.rescue).not.toBeNull();
    expect(p.crewMet).toBe(true);
    expect(p.failure).toMatchObject({ cause: 'trust', by: 'rei', rewindTo: C.c4 });
  });

  it('a failed midnight goes back to 23:59 (t = 450)', () => {
    const atC6 = postRescueAtC6(3);
    expect(atC6.t).toBe(450);
    const p = throughDip(atC6).end;
    expect(p.failure).toEqual({ at: 510, cause: 'dark-at-midnight', by: 'rei', rewindTo: 450 });
    expect(p.midnight?.held).toBe(false);
    const r = ok(rewind(p));
    expectRestored(r, atC6);
    expect(r.midnight).toBeNull();
    expect(r.rewinds.at(-1)).toEqual({ at: 510, to: 450, by: 'rei', cause: 'dark-at-midnight' });
  });

  it('there is nothing to rewind without a failure', () => {
    expect(rewind(newPlay()).ok).toBe(false);
  });
});

describe('ac10: midnight sizing', () => {
  it('the sizing table', () => {
    expect(sizingVerdict(2)).toBe('drops');
    expect(sizingVerdict(3)).toBe('holds-with-fast-replacement');
    expect(sizingVerdict(4)).toBe('holds');
    expect(sizingVerdict(5)).toBe('waste');
    expect(sizingVerdict(6)).toBe('waste');
  });

  it('4 healthy servers behind the balancer drop no requests through the dip', () => {
    const { end, dropped } = throughDip(postRescueAtC6(4));
    expect(end.failure).toBeNull();
    expect(darkParts(end.dips, DIP_SCRIPT[1].darkAt)).toHaveLength(1);
    expect(dropped).toBe(0);
    expect(end.midnight).toEqual({ held: true, dropped: 0, servers: 4, waste: false });
  });

  it('3 drop requests with no replacement', () => {
    // From 23:59:50 two live servers (120 req/s) face 145 rising to 150 plus retries, and cook 8 s
    // later; the block goes dark at midnight. Without retries or the cooking the drop would be
    // 275 requests, so the number below is the dip, the retry pile and the cascade together.
    const { end, dropped } = throughDip(postRescueAtC6(3));
    expect(dropped).toBeCloseTo(883.833, 2);
    expect(end.failure).toEqual({ at: 510, cause: 'dark-at-midnight', by: 'rei', rewindTo: 450 });
    expect(end.midnight).toEqual({ held: false, dropped: end.midnight!.dropped, servers: 1, waste: false });
    expect(end.midnight!.dropped).toBeCloseTo(883.833, 2);
  });

  it('3 drop none when a replacement is placed so its 3 s boot ends by the dip', () => {
    const dark = DIP_SCRIPT[1].darkAt;
    const atC6 = postRescueAtC6(3);
    let p = stepTo(atC6, dark - BROWNOUT.server.bootSeconds);
    p = ok(rackServer(p, 's4'));
    const { end } = throughDip(p);
    expect(end.dropped - atC6.dropped).toBe(0);
    expect(end.failure).toBeNull();
    expect(end.midnight).toEqual({ held: true, dropped: 0, servers: 4, waste: false });
  });

  it('3 still drop requests when the replacement goes in only once the dip lands', () => {
    // The replacement serves from 23:59:53, so only its 3 s boot is lost: 2 live servers, 120
    // req/s, against about 145 plus retries for 3 s.
    let p = stepTo(postRescueAtC6(3), DIP_SCRIPT[1].darkAt);
    p = ok(rackServer(p, 's4'));
    const { end, dropped } = throughDip(p);
    expect(dropped).toBeCloseTo(109.513, 2);
    expect(end.failure).toBeNull();
    expect(end.midnight?.held).toBe(true);
  });

  it('2 drop requests', () => {
    // Two servers (120 req/s) cook under the final climb before the dip even lands, the block goes
    // dark and trust runs out at 23:59:17.
    const { end, dropped } = throughDip(postRescueAtC6(2));
    expect(dropped).toBeCloseTo(1718.343, 2);
    expect(end.failure?.cause).toBe('dark-at-midnight');
    expect(end.failure?.rewindTo).toBe(450);
    expect(end.failure?.at).toBeCloseTo(467.146, 2);
  });

  it('5 drop none and are flagged as waste', () => {
    const { end, dropped } = throughDip(postRescueAtC6(5));
    expect(dropped).toBe(0);
    expect(end.midnight).toEqual({ held: true, dropped: 0, servers: 5, waste: true });
    expect(debriefNumbers(end).wastedCredits).toBe(80);
  });

  it('6 drop none and are flagged as waste', () => {
    const { end, dropped } = throughDip(postRescueAtC6(6));
    expect(dropped).toBe(0);
    expect(end.midnight).toEqual({ held: true, dropped: 0, servers: 6, waste: true });
    expect(debriefNumbers(end).wastedCredits).toBe(160);
  });
});

describe('ac11: the whole session, headless', () => {
  it('best play from 23:51:30 to 00:01:00: no debt, trust above 0, about 150 credits before midnight', () => {
    // Best play: skip the banner, overclock early, 3 servers at the rescue, a 4th for midnight,
    // scale down to 2 once the fireworks start.
    const start = newPlay();
    expect(clockAt(start.t)).toBe('23:51:30');
    let p = stepTo(throughC3(), C.c4);
    p = untilRescue(p);
    expect(p.rescue).toEqual({ at: 309.15, by: 'trust' });
    p = ok(rackServer(p, 's2'));
    p = ok(rackServer(p, 's3'));
    p = stepTo(p, C.c6);
    expect(clockAt(p.t)).toBe('23:59:00');
    // About 150 before midnight (±30, the economy table is approximate): 400 - 80 x 3 - 60 for the
    // kit + 100 from Ozzie, less upkeep.
    const beforeMidnight = p.session.board.credits;
    expect(beforeMidnight).toBeCloseTo(140.275, 2);
    expect(Math.abs(beforeMidnight - 150)).toBeLessThanOrEqual(30);
    p = ok(rackServer(p, 's4'));
    p = stepTo(p, C.c7 + BROWNOUT.demand.afterMidnightFallSeconds);
    p = ok(decommissionServer(p, 'server-p4'));
    p = ok(decommissionServer(p, 'server-p3'));
    p = stepTo(p, 570);

    expect(clockAt(p.t)).toBe('00:01:00');
    expect(p.t).toBe(570);
    expect(p.failure).toBeNull();
    expect(p.rewinds).toEqual([]);
    expect(p.midnight).toEqual({ held: true, dropped: 0, servers: 4, waste: false });
    expect(p.session.ozzie).toEqual({ fronted: true, debt: 0 });
    expect(p.session.trust).toBe(100);
    expect(p.session.board.credits).toBeCloseTo(26.942, 2);
    expect(debriefNumbers(p)).toMatchObject({
      wastedCredits: 0,
      trust: 100,
      banner: 'ignore',
      ozzieDebt: 0,
      scaledDown: true,
      laundryCut: false,
      midnightHeld: true,
      rewinds: 0,
    });
  });

  it('the clock reads the in-world time', () => {
    expect(clockAt(0)).toBe('23:51:30');
    expect(clockAt(15)).toBe('23:51:45');
    expect(clockAt(450)).toBe('23:59:00');
    expect(clockAt(510)).toBe('00:00:00');
    expect(clockAt(570)).toBe('00:01:00');
  });
});

describe('steps of any length play the same session', () => {
  it('one long step through the surge rescues at the same moment as short steps', () => {
    const atC4 = throughC3();
    const coarse = step(atC4, 60);
    const fine = stepTo(atC4, C.c4 + 60, 0.05);
    // With no build after the rescue, the lone stock server can't hold the 120 tail: both fail.
    expect(coarse.rescue?.by).toBe('trust');
    expect(coarse.rescue?.at).toBeCloseTo(309.15, 6);
    expect(fine.rescue?.by).toBe('trust');
    expect(fine.rescue?.at).toBeCloseTo(309.15, 6);
    expect(coarse.failure?.at).toBeCloseTo(314.529, 3);
    expect(fine.failure?.at).toBeCloseTo(314.529, 3);
    expect(coarse.failure).toMatchObject({ cause: 'trust', by: 'rei', rewindTo: 300 });
    expect(coarse.dropped).toBeCloseTo(fine.dropped, 6);
  });

  it('a step from inside the surge dip to its end still brings the crew before trust runs out', () => {
    const inDip = stepTo(throughC3(), DIP_SCRIPT[0].darkAt);
    const p = step(inDip, BROWNOUT.powerDip.darkSeconds);
    expect(p.rescue?.by).toBe('trust');
    expect(p.rescue?.at).toBeCloseTo(309.15, 6);
    // The rescue ended the dip at once, rather than at 23:57:15.
    expect(p.dips.find((d) => d.id === 'surge')?.endsAt).toBeCloseTo(309.15, 6);
  });

  it('a long step ends a boot after its 3 s, not at the end of the step', () => {
    const racked = ok(rackServer(stepTo(newPlay(), C.c1), 's1'));
    const coarse = step(racked, 10);
    const fine = stepTo(racked, C.c1 + 10, 0.05);
    // 3 s of 30 req/s plus a little retry pile are lost while it boots, then nothing.
    expect(coarse.dropped).toBeCloseTo(96.6375, 6);
    expect(fine.dropped).toBeCloseTo(96.6375, 6);
    expect(coarse.session.trust).toBeCloseTo(77, 6);
    expect(fine.session.trust).toBeCloseTo(77, 6);
    expect(offlineParts(coarse, coarse.t)).toEqual([]);
  });

  it('a long step kills an overheating server after 8 s over load, not at the end of the step', () => {
    // A lone stock server in the C3 climb: demand passes 60 req/s at 23:55:00, it cooks 8 s later.
    const atC3 = stepTo(ok(rackServer(stepTo(newPlay(), C.c1), 's1')), C.c3);
    const coarse = step(atC3, 60);
    const fine = stepTo(atC3, C.c4, 0.05);
    expect(coarse.failure?.at).toBeCloseTo(218.05, 6);
    expect(fine.failure?.at).toBeCloseTo(218.05, 6);
    expect(coarse.failure).toMatchObject({ cause: 'server-died', by: 'triage', rewindTo: 180 });
    expect(coarse.heat.dead).toEqual(['server-p1']);
  });

  it('trust running out exactly at 23:59 in the surge rewinds to the surge, not to 23:59', () => {
    const atC4 = throughC3();
    let p = untilRescue(atC4);
    p = ok(rackServer(p, 's2'));
    p = ok(rackServer(p, 's3'));
    p = stepTo(p, C.c6 - 10);
    // Pull every server: all demand drops (error share 1), trust drains at 10 a second and is set
    // so it reaches 0 exactly as C6 opens.
    p = ok(decommissionServer(p, 'server-p1'));
    p = ok(decommissionServer(p, 'server-p2'));
    p = ok(decommissionServer(p, 'server-p3'));
    p = { ...p, session: { ...p.session, trust: (C.c6 - p.t) * 10 } };
    p = step(p, 20);
    expect(p.failure?.at).toBeCloseTo(450, 6);
    expect(p.failure).toMatchObject({ cause: 'trust', by: 'rei', rewindTo: 300 });
    expect(p.session.trust).toBe(0);
    const r = ok(rewind(p));
    expect(r.t).toBe(300);
    expect(r.session.trust).toBe(atC4.session.trust);
    expect(r.session.board.credits).toBe(atC4.session.board.credits);
    expect(r.session.board.parts).toEqual(atC4.session.board.parts);
    expect(r.rescue).toBeNull();
  });
});

describe('ac12: pure functions', () => {
  // Frozen inputs: any write to them throws (modules run in strict mode), so each call below fails
  // the test if it mutates what it was given.
  it('step does not mutate its input', () => {
    const fresh = deepFreeze(newPlay());
    const p = step(fresh, 30);
    // No server racked: from C1 every request drops and trust runs out 10 s later.
    expect(p.failure).toEqual({ at: 25, cause: 'trust', by: 'triage', rewindTo: 15 });
    expect(fresh.t).toBe(0);
    expect(fresh.failure).toBeNull();
    expect(fresh.session.trust).toBe(100);
    expect(fresh.checkpoint).toBeNull();
  });

  it('player actions do not mutate their input', () => {
    const atC1 = deepFreeze(stepTo(newPlay(), C.c1));
    const racked = ok(rackServer(atC1, 's1'));
    expect(racked.session.board.credits).toBe(320);
    expect(racked.session.board.wires).toEqual([
      { from: 'gateway', to: 'server-p1' },
      { from: 'server-p1', to: 'database' },
    ]);
    expect(atC1.session.board.credits).toBe(400);
    expect(atC1.session.board.parts).toHaveLength(2);
    expect(atC1.session.board.wires).toEqual([]);

    const live = deepFreeze(racked);
    const clocked = ok(overclockServer(live, 'server-p1'));
    expect(clocked.session.board.parts[2]).toEqual({ id: 'server-p1', kind: 'server', slot: 's1', boost: 2 });
    expect(live.session.board.parts[2]).toEqual({ id: 'server-p1', kind: 'server', slot: 's1' });
    expect(ok(answerBanner(live, 'pay')).session.board.credits).toBe(120);
    expect(live.session.banner).toBeNull();
    expect(ok(decommissionServer(live, 'server-p1')).session.board.parts).toHaveLength(2);
    expect(live.session.board.parts).toHaveLength(3);

    const replaced = ok(replaceServer(live, 'server-p1'));
    expect(replaced.session.board.parts.map((q) => q.id)).toEqual(['gateway', 'database', 'server-p2']);
    expect(live.session.board.parts.map((q) => q.id)).toEqual(['gateway', 'database', 'server-p1']);
  });

  it('surge, rescue, Regroup and rewind do not mutate their input', () => {
    const surge = deepFreeze(stepTo(throughC3(), C.c4 + 1));
    expect(ok(cutLaundry(surge)).laundryCut).toEqual({ at: 301 });
    expect(surge.laundryCut).toBeNull();

    const rescued = applyRescue(surge, 301, 'time');
    expect(rescued.rescue).toEqual({ at: 301, by: 'time' });
    expect(rescued.session.board.parts.map((q) => q.kind)).toEqual([
      'gateway',
      'database',
      'server',
      'balancer',
    ]);
    expect(surge.rescue).toBeNull();
    expect(surge.session.board.parts.map((q) => q.kind)).toEqual(['gateway', 'database', 'server']);
    expect(surge.session.board.parts[2].boost).toBe(2);

    const crew = deepFreeze(rescued);
    expect(ok(useRegroup(crew)).regroup).toEqual({ charges: 0, handedOver: true, left: 10 });
    expect(crew.regroup).toEqual({ charges: 1, handedOver: true, left: 0 });

    const cooked = deepFreeze(stepTo(ok(rackServer(stepTo(newPlay(), C.c1), 's1')), C.c4));
    const back = ok(rewind(cooked));
    expect(back.t).toBe(180);
    expect(back.failure).toBeNull();
    expect(cooked.failure).toMatchObject({ cause: 'server-died', rewindTo: 180 });
  });

  it('the failure rules do not mutate their input', () => {
    const board = deepFreeze(oneServerBoard());
    const flow = deepFreeze(route(board, BROWNOUT_RULES, 90));
    const heat = deepFreeze(coolHeat());
    expect(updateOverheat(board, BROWNOUT_RULES, flow, heat, [], 1)).toEqual({
      overload: { srv: 1 },
      dead: [],
    });
    expect(heat).toEqual({ overload: {}, dead: [] });

    const script = deepFreeze(structuredClone(DIP_SCRIPT) as typeof DIP_SCRIPT);
    const dip = deepFreeze(resolveDip(board, script[0], 3));
    expect(dip).toEqual({ id: 'surge', part: 'srv', warnAt: 303, darkAt: 305, endsAt: 325 });
    expect(script[0]).toEqual({ id: 'surge', darkAt: 305, target: 'overclocked' });
    expect(darkParts([dip], 306)).toEqual(['srv']);
    expect(flickeringParts([dip], 304)).toEqual(['srv']);
    expect(dip.endsAt).toBe(325);
  });

  it('take time as a parameter and give the same answer for the same input', () => {
    // The same rule at two times gives the two answers the schedule says.
    expect(rescueDue(50, 344.9)).toBeNull();
    expect(rescueDue(50, 345)).toBe('time');
    expect(blockDemand(333, false, true)).toBe(210);
    expect(blockDemand(333, true, false)).toBe(120);
    expect(updateRetries(0.1, 0.4, 2)).toBeCloseTo(0.2, 9);
    expect(updateRetries(0.1, 0, 2)).toBe(0);

    // Two separate copies of one state stepped by the same dt land on the same, known numbers.
    const summary = (p: Play) => ({
      t: p.t,
      credits: Math.round(p.session.board.credits * 1000) / 1000,
      dark: darkParts(p.dips, p.t),
      rescue: p.rescue,
    });
    const atC4 = throughC3();
    const expected = { t: 307, credits: 235.667, dark: ['server-p1'], rescue: null };
    expect(summary(step(atC4, 7))).toEqual(expected);
    expect(summary(step(structuredClone(atC4), 7))).toEqual(expected);
  });
});
