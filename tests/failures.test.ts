import { type Board, type Part, capacityOf, route } from '../src/sim/board';
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
  secondsToOverheat,
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
  createPlay,
  cutLaundry,
  debriefNumbers,
  decommissionServer,
  liveServers,
  nextEdge,
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
  while (p.t < T - 1e-9 && !p.failure) p = step(p, Math.min(dt, T - p.t));
  return p;
}

/** Step in 0.1 s ticks until the crew arrive (or the board freezes on a failure). */
function untilRescue(play: Play): Play {
  let p = play;
  while (!p.rescue && !p.failure) p = step(p, 0.1);
  return p;
}

/** Step in 0.1 s ticks until the board freezes on a failure, giving up at T. */
function untilFailure(play: Play, T: number): Play {
  return stepTo(play, T);
}

function newPlay(seed = 7): Play {
  return createPlay({ slots: SLOTS, parts: fixed, seed });
}

/**
 * Best play up to the end of C3, all through the product's actions: one server racked as C1 opens,
 * the banner ignored, the overclock kit fitted early in C2. Optionally an idle second server racked
 * in C3.
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

/**
 * Played to 23:59 with n servers behind the balancer: an idle second server racked in C3, the rest
 * racked as soon as the crew arrive. Credits allow up to 5.
 */
function postRescueAtC6(n: number): Play {
  let p = untilRescue(throughC3({ idleSecond: true }));
  for (let i = 3; i <= n; i++) p = ok(rackServer(p, `s${i}`));
  p = stepTo(p, C.c6);
  expect(p.t).toBe(275);
  expect(p.failure).toBeNull();
  expect(liveServers(p)).toBe(n);
  return p;
}

/** Play from 23:59 with no action through the end of the midnight dip (or a failure). */
function throughDip(p: Play): { end: Play; dropped: number } {
  const end = stepTo(p, 345);
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

/** Deep equality with floating-point slack on numbers (ticks may differ by a few ulps). */
function expectSame(a: unknown, b: unknown, path = 'play'): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isFinite(a) || Number.isFinite(b)) expect(a, path).toBeCloseTo(b, 6);
    else expect(a, path).toBe(b);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    expect(Object.keys(a).sort(), path).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(a)) {
      expectSame((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    }
    return;
  }
  expect(a, path).toEqual(b);
}

describe('ac1: overheating', () => {
  const board = oneServerBoard();
  const over = route(board, BROWNOUT_RULES, 90);
  const under = route(board, BROWNOUT_RULES, 30);

  it('ac1: a server over 100% load for 8 s in a row dies', () => {
    let heat = coolHeat();
    for (let i = 0; i < 15; i++) heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.5);
    expect(heat.dead).toEqual([]);
    expect(heat.overload.srv).toBe(7.5);
    expect(secondsToOverheat(heat)).toBe(0.5);
    heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.5);
    expect(heat.dead).toEqual(['srv']);
  });

  it('ac1: eighty 0.1 s ticks over load (exactly 8 s) kill it; seventy-nine do not', () => {
    let heat = coolHeat();
    for (let i = 0; i < 79; i++) heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.1);
    expect(heat.dead).toEqual([]);
    expect(heat.overload.srv).toBeCloseTo(7.9, 9);
    heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.1);
    expect(heat.dead).toEqual(['srv']);
  });

  it('ac1: 7.9 s over load, then a drop under 100%, does not kill it', () => {
    let heat = coolHeat();
    for (let i = 0; i < 79; i++) heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.1);
    expect(heat.dead).toEqual([]);
    heat = updateOverheat(board, BROWNOUT_RULES, under, heat, [], 0.1);
    expect(heat.overload.srv).toBeUndefined();
    for (let i = 0; i < 79; i++) heat = updateOverheat(board, BROWNOUT_RULES, over, heat, [], 0.1);
    expect(heat.dead).toEqual([]);
  });

  it('ac1: exactly 100% load is not over load; an offline server does not heat', () => {
    const full = route(board, BROWNOUT_RULES, BROWNOUT.server.capacity);
    expect(updateOverheat(board, BROWNOUT_RULES, full, coolHeat(), [], 10).dead).toEqual([]);
    expect(updateOverheat(board, BROWNOUT_RULES, over, coolHeat(), ['srv'], 10).dead).toEqual([]);
  });

  /** One stock server (no kit), banner unanswered, played into the C3 climb. */
  function loneStockServer(): Play {
    let p = stepTo(newPlay(), C.c1);
    p = ok(rackServer(p, 's1'));
    return stepTo(p, 112.5);
  }

  it('ac1: played, a lone stock server in the C3 climb dies exactly 8 s after it first goes over 60', () => {
    // The climb is 30 + 4/3 (t − 90) req/s: exactly 60 at t = 112.5, over 60 from the tick after (112.6).
    let p = loneStockServer();
    expect(playDemand(p, 112.5)).toBe(60);
    p = step(p, 0.1);
    expect(p.heat.overload['server-p1']).toBeUndefined();
    p = step(p, 0.1);
    expect(p.heat.overload['server-p1']).toBeCloseTo(0.1, 9);
    p = stepTo(p, 120.5);
    expect(p.failure).toBeNull();
    expect(p.heat.dead).toEqual([]);
    expect(p.heat.overload['server-p1']).toBeCloseTo(7.9, 9);
    p = step(p, 0.1);
    expect(p.t).toBeCloseTo(120.6, 9);
    expect(p.heat.dead).toEqual(['server-p1']);
    expect(p.failure).toEqual({ at: p.t, cause: 'server-died', by: 'triage', rewindTo: C.c3 });
  });

  it('ac1: played, 7.9 s over load then the paid banner takes it under 100%: it lives, and the count restarts', () => {
    let p = stepTo(loneStockServer(), 120.5);
    expect(p.heat.overload['server-p1']).toBeCloseTo(7.9, 9);
    // The Solace banner serves 60 first, so the server's load drops to demand − 60 < 60.
    p = ok(answerBanner(p, 'pay'));
    p = step(p, 0.1);
    expect(p.heat.overload['server-p1']).toBeUndefined();
    p = stepTo(p, 130);
    expect(p.failure).toBeNull();
    expect(p.heat.dead).toEqual([]);
    // The banner runs to 120.5 + 60 = 180.5, past the start of the surge: the climb never cooks it.
    p = untilFailure(p, C.c4);
    expect(p.failure).toBeNull();
    expect(p.heat.dead).toEqual([]);
    expect(p.t).toBe(165);
  });

  it('ac1: played, a dead server stays offline until it is replaced', () => {
    // Two servers behind the balancer at 23:59: the final surge puts both over 60 from 275.1, and
    // after the crew a dead server does not freeze the board: it just stays dark.
    let p = postRescueAtC6(2);
    p = stepTo(p, 283);
    expect(p.heat.dead).toEqual([]);
    p = step(p, 0.1);
    expect(p.t).toBeCloseTo(283.1, 9);
    expect(p.heat.dead).toEqual(['server-p1', 'server-p2']);
    p = stepTo(p, 285);
    expect(p.failure).toBeNull();
    expect(p.heat.dead).toEqual(['server-p1', 'server-p2']);
    expect(offlineParts(p, p.t)).toEqual(expect.arrayContaining(['server-p1', 'server-p2']));
    const dark = routePlay(p, playDemand(p, p.t), p.t);
    expect(dark.served).toBe(0);
    expect(dark.skipped).toEqual(['balancer>server-p1', 'balancer>server-p2']);

    const credits = p.session.board.credits;
    const replaced = ok(replaceServer(p, 'server-p1'));
    // A new box costs 80; the dead one is decommissioned for the real refund (half of 80).
    expect(replaced.session.board.credits).toBe(
      credits - BROWNOUT.server.cost + Math.floor(BROWNOUT.server.cost * BROWNOUT.decommissionRefund),
    );
    expect(replaced.heat.dead).toEqual(['server-p2']);
    const fresh = replaced.session.board.parts.at(-1)!;
    expect(fresh).toEqual({ id: 'server-p3', kind: 'server', slot: 's1' });
    expect(replaced.session.board.wires).toEqual(
      expect.arrayContaining([
        { from: 'balancer', to: 'server-p3' },
        { from: 'server-p3', to: 'database' },
      ]),
    );
    // It boots for 3 s, then serves its 60; the unreplaced one stays dead.
    let q = stepTo(replaced, 287.9);
    expect(offlineParts(q, q.t)).toContain('server-p3');
    q = stepTo(q, 288.1);
    expect(q.failure).toBeNull();
    expect(offlineParts(q, q.t)).not.toContain('server-p3');
    expect(routePlay(q, playDemand(q, q.t), q.t).served).toBe(60);
    expect(q.heat.dead).toEqual(['server-p2']);
    expect(offlineParts(q, q.t)).toContain('server-p2');
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
    expect(midnight[0].darkAt).toBe(325); // 23:59:50
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

/**
 * A starting board that holds the district surge: six servers behind a balancer feeding two
 * databases. Before the crew the real board can't get here (the gateway feeds one part only), so
 * this is the one way to show the 45 s time trigger firing on its own; everything after t = 0 is
 * the product's step.
 */
function holdingPlay(): Play {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  return createPlay({
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
}

describe('ac6: the rescue trigger', () => {
  it('ac6: fires when trust drops under 30 or 40 s into the surge, whichever comes first', () => {
    expect(rescueDue(29.9, C.c4 + 10)).toBe('trust');
    expect(rescueDue(30, C.c4 + 10)).toBeNull();
    expect(rescueDue(100, C.c4 + 39.9)).toBeNull();
    expect(rescueDue(100, C.c4 + 40)).toBe('time');
    expect(rescueDue(10, C.c4 + 40)).toBe('trust');
    expect(rescueDue(10, C.c4 - 1)).toBeNull();
  });

  it('ac6: trust trigger: the played surge brings the crew on the tick trust drops under 30', () => {
    let p = throughC3();
    expect(p.t).toBe(165);
    expect(p.session.trust).toBe(100);
    let ticks = 0;
    let before = p;
    while (!p.rescue && !p.failure) {
      before = p;
      p = step(p, 0.1);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(1);
    expect(p.failure).toBeNull();
    // The tick before: no crew yet and trust still at or over 30. This tick: under 30, crew in.
    expect(before.rescue).toBeNull();
    expect(before.session.trust).toBeGreaterThanOrEqual(30);
    expect(p.session.trust).toBeLessThan(30);
    expect(p.rescue).toEqual({ at: p.t, by: 'trust' });
    // Well before the 40 s time trigger: the surge dip takes the only server dark at 170.
    expect(p.t).toBeGreaterThan(170);
    expect(p.t).toBeLessThan(205);
  });

  it('ac6: time trigger: a board that keeps trust up still gets the crew 40 s in', () => {
    let p = holdingPlay();
    let lowest = Infinity;
    while (!p.rescue && !p.failure) {
      p = step(p, 0.1);
      if (p.t >= C.c4) lowest = Math.min(lowest, p.session.trust);
    }
    expect(p.failure).toBeNull();
    expect(lowest).toBe(100);
    expect(p.rescue?.by).toBe('time');
    expect(p.rescue?.at).toBe(205);
    expect(p.t).toBe(205);
  });

  it('ac6: one 30 s step from the start of the surge still brings the crew under 30 before trust runs out', () => {
    const atC4 = throughC3();
    const big = step(atC4, 30);
    const small = stepTo(atC4, 195);
    // No build after the crew: trust runs out later in the surge, but the crew came first.
    expect(big.rescue?.by).toBe('trust');
    expect(big.failure).toMatchObject({ cause: 'trust', by: 'rei', rewindTo: 165 });
    expect(big.rescue!.at).toBeLessThan(big.failure!.at);
    expectSame(big, small);
  });

  it('ac6: fires only once', () => {
    let p = untilRescue(throughC3());
    const first = p.rescue;
    expect(first?.by).toBe('trust');
    p = ok(rackServer(p, 's2'));
    p = ok(rackServer(p, 's3'));
    let credits = p.session.board.credits;
    let ticks = 0;
    let underAgain = 0;
    // Through the rest of the surge, past the 40 s time trigger, trust under 30 for a while.
    while (p.t < C.c6 - 1e-9 && !p.failure) {
      p = step(p, 0.1);
      ticks++;
      if (p.session.trust < 30) underAgain++;
      expect(p.rescue).toBe(first);
      expect(p.session.board.credits).toBeLessThanOrEqual(credits); // Ozzie fronts once
      credits = p.session.board.credits;
    }
    expect(p.failure).toBeNull();
    expect(p.t).toBe(275);
    expect(ticks).toBeGreaterThan(900);
    expect(underAgain).toBeGreaterThan(0);
    expect(p.session.ozzie.fronted).toBe(true);
  });
});

describe('ac7: after the rescue', () => {
  it('ac7: played, the overclocked server is back at stock 60, with a load balancer and 100 credits from Ozzie', () => {
    let p = throughC3();
    expect(p.session.board.parts.find((q) => q.id === 'server-p1')?.boost).toBe(2);
    let before = p;
    while (!p.rescue && !p.failure) {
      before = p;
      p = step(p, 0.1);
    }
    expect(p.rescue).not.toBeNull();
    const server = p.session.board.parts.find((q) => q.id === 'server-p1')!;
    expect(server.boost).toBeUndefined();
    expect(capacityOf(server, BROWNOUT_RULES)).toBe(60);
    expect(p.session.board.parts.filter((q) => q.kind === 'balancer')).toHaveLength(1);
    expect(p.session.board.wires).toEqual(
      expect.arrayContaining([
        { from: 'gateway', to: 'balancer' },
        { from: 'balancer', to: 'server-p1' },
        { from: 'server-p1', to: 'database' },
      ]),
    );
    expect(p.session.board.wires.filter((w) => w.from === 'gateway')).toHaveLength(1);
    // Ozzie's 100, less one 0.1 s tick of upkeep for one server (5 a minute).
    expect(p.session.board.credits).toBeCloseTo(before.session.board.credits + 100 - 0.1 / 12, 9);
    expect(p.session.ozzie.fronted).toBe(true);
    // The fried server serves its stock 60 at once, behind the balancer.
    const flow = routePlay(p, 120, p.t);
    expect(flow.load['server-p1']).toBe(120);
    expect(flow.served).toBe(60);
  });

  it('ac7: a kit that cooked comes back alive at stock 60', () => {
    const p = stepTo(throughC3(), C.c4 + 1);
    const cooked = { ...p, heat: { overload: {}, dead: ['server-p1'] } };
    const r = applyRescue(cooked, cooked.t, 'trust');
    expect(r.heat.dead).toEqual([]);
    expect(r.session.board.parts.find((q) => q.id === 'server-p1')?.boost).toBeUndefined();
    expect(r.session.board.credits).toBe(p.session.board.credits + 100);
  });

  it('ac7: the surge settles to 120 once the crew is in', () => {
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

  it('ac9: C1: a failure goes back to the start of C1 through TRIAGE', () => {
    const atC1 = stepTo(newPlay(), C.c1);
    expect(atC1.t).toBe(15);
    const failed = stepTo(atC1, C.c2);
    expect(failed.failure).toEqual({ at: failed.t, cause: 'trust', by: 'triage', rewindTo: 15 });
    expect(step(failed, 5)).toBe(failed); // the board is frozen until the rewind
    const r = ok(rewind(failed));
    expectRestored(r, atC1);
    expect(r.t).toBe(15);
    expect(r.session.trust).toBe(100);
    expect(r.session.board.credits).toBe(400);
    expect(r.rewinds).toEqual([{ at: failed.t, to: 15, by: 'triage', cause: 'trust' }]);
  });

  it('ac9: C2: a failure goes back to the start of C2', () => {
    let p = stepTo(newPlay(), C.c1);
    p = ok(rackServer(p, 's1'));
    const atC2 = stepTo(p, C.c2);
    expect(atC2.t).toBe(45);
    p = ok(decommissionServer(stepTo(atC2, C.c2 + 5), 'server-p1'));
    p = stepTo(p, C.c3);
    expect(p.failure).toMatchObject({ cause: 'trust', by: 'triage', rewindTo: 45 });
    const r = ok(rewind(p));
    expectRestored(r, atC2);
    expect(r.t).toBe(45);
    // The 3 s boot dropped every call (30 trust), and 27 s of calm since won 27 of it back.
    expect(r.session.trust).toBeCloseTo(97, 9);
    // 400 − 80 for the server − 30 s of its upkeep at 5 a minute.
    expect(r.session.board.credits).toBeCloseTo(400 - 80 - 30 / 12, 9);
    expect(r.session.board.parts.some((q) => q.id === 'server-p1')).toBe(true);
  });

  it('ac9: C3: the server overheating goes back to the start of C3', () => {
    let p = stepTo(newPlay(), C.c1);
    p = ok(rackServer(p, 's1'));
    const atC3 = stepTo(p, C.c3);
    expect(atC3.t).toBe(90);
    p = stepTo(atC3, C.c4);
    expect(p.failure).toMatchObject({ cause: 'server-died', by: 'triage', rewindTo: 90 });
    const r = ok(rewind(p));
    expectRestored(r, atC3);
    expect(r.t).toBe(90);
    expect(r.session.board.credits).toBeCloseTo(400 - 80 - 75 / 12, 9);
    expect(r.heat.dead).toEqual([]);
  });

  it('ac9: trust reaching 0 in the surge still brings the crew, and the surge restarts', () => {
    const atC4 = throughC3();
    expect(atC4.t).toBe(165);
    expect(atC4.session.trust).toBe(100);
    // 400 − 80 (server) − 60 (bigger box) − 150 s of one server's upkeep at 5 a minute.
    expect(atC4.session.board.credits).toBeCloseTo(400 - 80 - 60 - 150 / 12, 9);
    // No build at all: the crew arrives on trust under 30, then trust runs out in the surge.
    const p = untilFailure(atC4, C.c6);
    expect(p.failure).toMatchObject({ cause: 'trust', by: 'rei', rewindTo: 165 });
    expect(p.failure!.at).toBeLessThan(C.c6);
    expect(p.session.trust).toBe(0);
    expect(p.rescue?.by).toBe('trust');
    expect(p.rescue!.at).toBeLessThan(p.failure!.at);
    expect(p.crewMet).toBe(true);

    const r = ok(rewind(p));
    expectRestored(r, atC4);
    expect(r.t).toBe(165);
    expect(r.session.trust).toBe(100);
    expect(r.session.board.credits).toBeCloseTo(400 - 80 - 60 - 150 / 12, 9);
    expect(r.session.board.parts.find((q) => q.id === 'server-p1')?.boost).toBe(2);
    expect(r.crewMet).toBe(true);
    expect(r.rescue).toBeNull();
    expect(r.session.ozzie.fronted).toBe(false);
    // The surge plays again and the crew come again, at the same moment.
    const again = untilRescue(r);
    expect(again.rescue).toEqual(p.rescue);
  });

  it('ac9: a surge failure on the tick that reaches 23:59 still rewinds to the surge, not to 23:59', () => {
    // Best play to 23:58:59.95 with trust back at 100, then every server pulled: with nothing
    // serving, trust drains 10 a second and runs out on the tick that ends exactly at t = 275.
    let p = untilRescue(throughC3());
    p = ok(rackServer(p, 's2'));
    p = ok(rackServer(p, 's3'));
    p = stepTo(p, 264.9);
    p = step(p, 0.05);
    expect(p.t).toBeCloseTo(264.95, 9);
    expect(p.session.trust).toBe(100);
    for (const id of ['server-p1', 'server-p2', 'server-p3']) p = ok(decommissionServer(p, id));
    // One step: ticks on the 0.1 s grid, so 0.5 drains by 265, 1 per tick after, the last at 275.
    p = step(p, 20);
    expect(p.failure).toEqual({ at: 275, cause: 'trust', by: 'rei', rewindTo: 165 });
    expect(p.checkpoint?.at).toBe(165);
    const r = ok(rewind(p));
    expect(r.t).toBe(165);
    expect(r.session.trust).toBe(100);
    expect(r.rewinds.at(-1)).toEqual({ at: 275, to: 165, by: 'rei', cause: 'trust' });
  });

  it('ac9: a failed midnight goes back to 23:59 (t = 275)', () => {
    const atC6 = postRescueAtC6(3);
    expect(atC6.t).toBe(275);
    expect(atC6.session.trust).toBe(100);
    const p = throughDip(atC6).end;
    expect(p.failure).toEqual({ at: 335, cause: 'dark-at-midnight', by: 'rei', rewindTo: 275 });
    expect(p.midnight?.held).toBe(false);
    const r = ok(rewind(p));
    expectRestored(r, atC6);
    expect(r.t).toBe(275);
    expect(r.session.trust).toBe(100);
    expect(r.session.board.parts.map((q) => q.id)).toEqual([
      'gateway',
      'database',
      'server-p1',
      'server-p2',
      'balancer',
      'server-p3',
    ]);
    expect(r.heat.dead).toEqual([]);
    expect(r.rescue).not.toBeNull(); // the crew are still there at 23:59
    expect(r.midnight).toBeNull();
    expect(r.rewinds.at(-1)).toEqual({ at: 335, to: 275, by: 'rei', cause: 'dark-at-midnight' });
    // Rewound, the same choice fails the same way again.
    expect(throughDip(r).end.failure).toEqual(p.failure);
  });

  it('ac9: there is nothing to rewind without a failure', () => {
    expect(rewind(newPlay()).ok).toBe(false);
  });
});

describe('ac10: midnight sizing', () => {
  it('ac10: the sizing table', () => {
    expect(sizingVerdict(2)).toBe('drops');
    expect(sizingVerdict(3)).toBe('holds-with-fast-replacement');
    expect(sizingVerdict(4)).toBe('holds');
    expect(sizingVerdict(5)).toBe('waste');
    expect(sizingVerdict(6)).toBe('waste');
  });

  it('ac10: 4 healthy servers behind the balancer drop no requests through the dip', () => {
    const { end, dropped } = throughDip(postRescueAtC6(4));
    expect(end.failure).toBeNull();
    expect(end.t).toBe(345);
    expect(darkParts(end.dips, DIP_SCRIPT[1].darkAt)).toHaveLength(1);
    expect(dropped).toBe(0);
    expect(end.midnight).toEqual({ held: true, dropped: 0, servers: 4, waste: false });
  });

  it('ac10: 3 drop requests with no replacement', () => {
    const atC6 = postRescueAtC6(3);
    // Up to the dip, 3 × 60 = 180 covers the climb to 150: nothing dropped.
    let p = stepTo(atC6, 325);
    expect(p.dropped).toBe(atC6.dropped);
    expect(p.retry).toBe(0);
    // The dip takes one dark; the balancer skips it and the other two take 145 req/s between them.
    const darkOne = darkParts(p.dips, 325);
    expect(darkOne).toHaveLength(1);
    const flow = routePlay(p, playDemand(p, 325), 325);
    expect(playDemand(p, 325)).toBe(145);
    expect(flow.skipped).toEqual([`balancer>${darkOne[0]}`]);
    expect(flow.dropped).toBe(25);
    const live = ['server-p1', 'server-p2', 'server-p3'].filter((id) => id !== darkOne[0]);
    for (const id of live) expect(flow.load[id]).toBe(72.5);
    // The first dark tick drops exactly 25 req/s for 0.1 s.
    const first = step(p, 0.1);
    expect(first.dropped - p.dropped).toBeCloseTo(2.5, 9);
    // The two live ones run over 100% from 325 and cook 8 s later.
    p = stepTo(first, 332.9);
    expect(p.heat.dead).toEqual([]);
    p = step(p, 0.1);
    expect(p.t).toBeCloseTo(333, 9);
    expect(p.heat.dead).toEqual(live);
    const end = stepTo(p, 345);
    expect(end.failure).toEqual({ at: 335, cause: 'dark-at-midnight', by: 'rei', rewindTo: 275 });
    expect(end.midnight).toMatchObject({ held: false, servers: 1, waste: false });
    // At least the no-retry shortfall: 25 rising to 30 req/s over the 10 s from 325 to 335.
    expect(end.midnight!.dropped).toBe(end.dropped - atC6.dropped);
    expect(end.midnight!.dropped).toBeGreaterThan(274.75);
  });

  it('ac10: 3 drop none when a replacement is placed so its 3 s boot ends by the dip', () => {
    const atC6 = postRescueAtC6(3);
    let p = stepTo(atC6, 322);
    p = ok(rackServer(p, 's4'));
    const { end } = throughDip(p);
    expect(end.dropped).toBe(atC6.dropped);
    expect(end.failure).toBeNull();
    expect(end.midnight).toEqual({ held: true, dropped: 0, servers: 4, waste: false });
  });

  it('ac10: 3 still drop requests when the replacement goes in only once the dip lands', () => {
    let p = stepTo(postRescueAtC6(3), DIP_SCRIPT[1].darkAt);
    p = ok(rackServer(p, 's4'));
    // While the new box boots (325 to 328) the two live servers carry 145: 25 req/s dropped.
    const first = step(p, 0.1);
    expect(first.dropped - p.dropped).toBeCloseTo(2.5, 9);
    const { dropped } = throughDip(p);
    expect(dropped).toBeGreaterThan(7.5);
  });

  it('ac10: 2 drop requests', () => {
    const atC6 = postRescueAtC6(2);
    // 2 × 60 = 120: from the tick after 23:59 the climb is over capacity.
    let p = step(atC6, 0.1);
    expect(p.dropped).toBe(atC6.dropped);
    p = step(p, 0.1);
    expect(p.dropped - atC6.dropped).toBeCloseTo(0.005, 9); // 120.05 − 120, for 0.1 s
    // Both run over 100% from 275.1, so both cook at 283.1; then nothing serves at all.
    p = stepTo(p, 283.1);
    expect(p.heat.dead).toEqual(['server-p1', 'server-p2']);
    const flow = routePlay(p, playDemand(p, p.t), p.t);
    expect(flow.served).toBe(0);
    expect(flow.dropped).toBe(playDemand(p, p.t));
    const end = stepTo(p, 345);
    // The block goes dark before midnight: trust runs out in C6.
    expect(end.failure).toMatchObject({ cause: 'dark-at-midnight', by: 'rei', rewindTo: 275 });
    expect(end.failure!.at).toBeLessThan(335);
    expect(end.session.trust).toBe(0);
    expect(end.dropped - atC6.dropped).toBeGreaterThan(500);
  });

  it('ac10: 5 drop none and are flagged as waste', () => {
    const atC6 = postRescueAtC6(5);
    const { end, dropped } = throughDip(atC6);
    expect(end.failure).toBeNull();
    expect(end.t).toBe(345);
    expect(dropped).toBe(0);
    expect(end.midnight).toEqual({ held: true, dropped: 0, servers: 5, waste: true });
    expect(debriefNumbers(end).wastedCredits).toBe(80);
  });
});

describe('ac11: the whole session, headless', () => {
  it('ac11: best play from 23:54:25 to 00:00:30: no debt, trust above 0, about 160 credits before midnight', () => {
    // Every move through the product's actions, stepping the clock in 0.1 s ticks from t = 0.
    let p = newPlay();
    expect(p.t).toBe(0);
    p = stepTo(p, 15); // C1: rack one server
    p = ok(rackServer(p, 's1'));
    p = stepTo(p, 50); // C2: skip the banner
    p = ok(answerBanner(p, 'ignore'));
    p = stepTo(p, 55); // the bigger box early
    p = ok(overclockServer(p, 'server-p1'));
    p = untilRescue(p); // C4: the surge, then the crew
    expect(p.failure).toBeNull();
    const rescuedAt = p.rescue!.at;
    p = ok(rackServer(p, 's2')); // 3 at the rescue
    p = ok(rackServer(p, 's3'));
    p = stepTo(p, 275); // 23:59
    expect(p.failure).toBeNull();
    // Ledger: 400 − 80 − 60 + 100 (Ozzie) − 160, less upkeep at 5 a minute: one server from 15 to
    // the rescue, three from the rescue to 275.
    const beforeMidnight = p.session.board.credits;
    expect(beforeMidnight).toBeCloseTo(200 - (rescuedAt - 15) / 12 - ((275 - rescuedAt) * 3) / 12, 6);
    expect(beforeMidnight).toBeGreaterThanOrEqual(120);
    expect(beforeMidnight).toBeLessThanOrEqual(180);
    p = ok(rackServer(p, 's4')); // a 4th for the dip
    p = stepTo(p, 335);
    expect(p.midnight).toEqual({ held: true, dropped: 0, servers: 4, waste: false });
    p = stepTo(p, 355); // fireworks: demand down to 40, scale down to 2
    p = ok(decommissionServer(p, 'server-p4'));
    p = ok(decommissionServer(p, 'server-p3'));
    p = stepTo(p, 365); // 00:00:30

    expect(p.t).toBe(365);
    expect(p.failure).toBeNull();
    expect(p.rewinds).toEqual([]);
    expect(p.session.ozzie.debt).toBe(0);
    expect(p.session.trust).toBe(100);
    expect(liveServers(p)).toBe(2);
    // − 80 for the 4th, four servers' upkeep 275 to 355, + 40 back for each of two, two servers 355 to 365.
    expect(p.session.board.credits).toBeCloseTo(beforeMidnight - 80 - (80 * 4) / 12 + 80 - (10 * 2) / 12, 6);
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
});

describe('ac12: pure functions', () => {
  it('ac12: do not mutate their inputs', () => {
    // Real played states, deep-frozen: any write to them throws in strict-mode modules.
    const fresh = deepFreeze(newPlay());
    const surge = deepFreeze(stepTo(throughC3(), C.c4 + 1));
    const after = deepFreeze(untilRescue(throughC3()));
    const failed = deepFreeze(stepTo(ok(rackServer(stepTo(newPlay(), C.c1), 's1')), C.c4));
    const cooked = deepFreeze(stepTo(postRescueAtC6(2), 285)); // two dead servers, board live
    expect(failed.failure).not.toBeNull();
    expect(cooked.heat.dead).toHaveLength(2);
    const inputs = [fresh, surge, after, failed, cooked];
    const snapshots = inputs.map((p) => structuredClone(p));
    const script = deepFreeze(structuredClone(DIP_SCRIPT) as typeof DIP_SCRIPT);
    const board = surge.session.board;
    const flow = deepFreeze(route(board, BROWNOUT_RULES, 300));

    const calls: [string, () => unknown][] = [
      ['step fresh', () => step(fresh, 30)],
      ['step surge', () => step(surge, 5)],
      ['step after', () => step(after, 5)],
      ['rackServer', () => rackServer(after, 's2')],
      ['replaceServer', () => replaceServer(cooked, 'server-p1')],
      ['decommissionServer', () => decommissionServer(after, 'server-p1')],
      ['overclockServer', () => overclockServer(after, 'server-p1')],
      ['answerBanner', () => answerBanner(fresh, 'pay')],
      ['cutLaundry', () => cutLaundry(surge)],
      ['useRegroup', () => useRegroup(after)],
      ['rewind', () => rewind(failed)],
      ['applyRescue', () => applyRescue(surge, surge.t, 'time')],
      ['playDemand', () => playDemand(surge, surge.t)],
      ['routePlay', () => routePlay(surge, 300, surge.t)],
      ['offlineParts', () => offlineParts(cooked, cooked.t)],
      ['nextEdge', () => nextEdge(cooked)],
      ['debriefNumbers', () => debriefNumbers(after)],
      ['updateOverheat', () => updateOverheat(board, BROWNOUT_RULES, flow, surge.heat, [], 1)],
      ['secondsToOverheat', () => secondsToOverheat(cooked.heat)],
      ['resolveDip', () => resolveDip(board, script[0], 3)],
      ['darkParts', () => darkParts(surge.dips, surge.t)],
      ['flickeringParts', () => flickeringParts(surge.dips, surge.t)],
    ];
    let ran = 0;
    for (const [name, call] of calls) {
      expect(call, name).not.toThrow();
      ran++;
    }
    expect(ran).toBe(22);
    expect(inputs).toHaveLength(5);
    expect(inputs[0]).toEqual(snapshots[0]);
    expect(inputs[1]).toEqual(snapshots[1]);
    expect(inputs[2]).toEqual(snapshots[2]);
    expect(inputs[3]).toEqual(snapshots[3]);
    expect(inputs[4]).toEqual(snapshots[4]);
    expect(script).toEqual(DIP_SCRIPT);
    // Actions hand back a new Play rather than the one they were given.
    expect(ok(rackServer(after, 's2'))).not.toBe(after);
    expect(step(after, 1)).not.toBe(after);
  });

  it('ac12: take time as a parameter, never the clock', () => {
    // Time comes in as `now`: the answers are GAME.md's numbers at the times asked for.
    expect(blockDemand(165, false, false)).toBe(250);
    expect(blockDemand(185, false, true)).toBe(210);
    expect(blockDemand(185, true, false)).toBe(120);
    expect(blockDemand(275, true, false)).toBe(120);
    expect(blockDemand(335, true, false)).toBe(150);
    expect(withRetries(250, 0.5)).toBe(375);
    expect(rescueDue(100, 204.9)).toBeNull();
    expect(rescueDue(100, 205)).toBe('time');
    expect(laundryCutAvailable(214.9, false)).toBe(true);
    expect(laundryCutAvailable(215, false)).toBe(false);
    const board: Board = {
      ...oneServerBoard(),
      parts: [...fixed, { id: 'srv', kind: 'server', slot: 's1' }],
    };
    const midnightDip = resolveDip(board, DIP_SCRIPT[1], 5);
    expect(dipPhase(midnightDip, 322.9)).toBeNull();
    expect(dipPhase(midnightDip, 323)).toBe('flicker');
    expect(dipPhase(midnightDip, 325)).toBe('dark');
    expect(dipPhase(midnightDip, 344.9)).toBe('dark');
    expect(dipPhase(midnightDip, 345)).toBeNull();
  });

  it('ac12: the sim never reads the clock or randomness: a whole played session runs with them blocked', () => {
    const blocked = (): never => {
      throw new Error('the sim read the clock or Math.random');
    };
    const spies = [
      vi.spyOn(Date, 'now').mockImplementation(blocked),
      vi.spyOn(performance, 'now').mockImplementation(blocked),
      vi.spyOn(Math, 'random').mockImplementation(blocked),
    ];
    try {
      const a = stepTo(postRescueAtC6(4), 365);
      const b = stepTo(postRescueAtC6(4), 365);
      expect(a.t).toBe(365);
      expect(a.midnight).toEqual({ held: true, dropped: 0, servers: 4, waste: false });
      expect(a).toEqual(b);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it('ac12: step(play, 50) through the surge equals 500 steps of 0.1', () => {
    // The played surge: the dip at 170, the crew on trust under 30, then (no build) trust runs out.
    const atC4 = throughC3();
    let small = atC4;
    for (let i = 0; i < 500; i++) small = step(small, 0.1);
    const big = step(atC4, 50);
    expect(big.failure?.cause).toBe('trust');
    expect(big.rescue?.by).toBe('trust');
    expectSame(big, small);

    // A board that holds: the dip goes dark and comes back, the time trigger at 205, C5 at 215.
    const held = stepTo(holdingPlay(), C.c4);
    let ticks = held;
    for (let i = 0; i < 500; i++) ticks = step(ticks, 0.1);
    const once = step(held, 50);
    expect(once.t).toBeCloseTo(215, 9);
    expect(once.rescue).toEqual({ at: 205, by: 'time' });
    expect(once.dips.map((d) => d.id)).toEqual(['surge']);
    expectSame(once, ticks);
  });

  it('ac12: one big step lands on an overheat, a boot end and the Regroup end like small steps do', () => {
    // A lone stock server cooks at 120.6 in the C3 climb, whatever the step size.
    let p = stepTo(newPlay(), C.c1);
    p = ok(rackServer(p, 's1'));
    p = stepTo(p, 105);
    const big = step(p, 40);
    expect(big.failure?.at).toBeCloseTo(120.6, 9);
    expectSame(big, stepTo(p, 145));

    // Regroup: a 12 s step slows exactly the 10 s that Regroup lasts.
    let q = ok(rackServer(ok(rackServer(untilRescue(throughC3()), 's2')), 's3'));
    q = ok(useRegroup(q));
    let slow = q;
    for (let i = 0; i < 120; i++) slow = step(slow, 0.1);
    const fast = step(q, 12);
    expect(fast.t - q.t).toBeCloseTo(2.5 + 2, 9);
    expect(fast.regroup.left).toBe(0);
    expectSame(fast, slow);
  });
});
