import { type Part, errorShare, partById, route, updateTrust } from '../src/sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../src/sim/brownout';
import { SURGES, baseDemand, demandAt, estimateDemand, forecastAt, serversFor } from '../src/sim/demand';
import {
  type Session,
  type SessionResult,
  bannerCapacity,
  chargeUpkeep,
  chooseBanner,
  createSession,
  fitOverclock,
  offlineAt,
  ozzieCover,
  ozzieFront,
  placeServer,
  routeSession,
  runningServers,
  trustAfter,
  upkeepCost,
} from '../src/sim/economy';

const fixed: Part[] = [
  { id: 'gateway', kind: 'gateway', slot: null },
  { id: 'database', kind: 'database', slot: null },
];

function start(): Session {
  return createSession({ slots: ['slot-1', 'slot-2', 'slot-3', 'slot-4'], parts: fixed });
}

function ok(result: SessionResult): Session {
  if (!result.ok) throw new Error(result.reason);
  return result.session;
}

/** A session with one server placed at t = 0 and wired gateway → server → database. */
function wired(): { session: Session; id: string } {
  const s = ok(placeServer(start(), 'slot-1', 0));
  const id = s.board.parts.at(-1)!.id;
  const board = {
    ...s.board,
    wires: [
      { from: 'gateway', to: id },
      { from: id, to: 'database' },
    ],
  };
  return { session: { ...s, board }, id };
}

function withCredits(s: Session, credits: number): Session {
  return { ...s, board: { ...s.board, credits } };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe('ac1: one constants object', () => {
  it('holds the rules table numbers', () => {
    expect(BROWNOUT.block).toEqual({ flats: 120, callEverySeconds: 4 });
    expect(BROWNOUT.server).toEqual({ capacity: 60, cost: 80, bootSeconds: 3 });
    expect(BROWNOUT.overclock).toEqual({ cost: 60, factor: 2, rebootSeconds: 3 });
    expect(BROWNOUT.database.capacity).toBe(200);
    expect(BROWNOUT.demand).toMatchObject({
      climb: 90,
      surge: 250,
      surgeWithRetries: 375,
      tail: 120,
      final: 150,
      afterMidnight: 40,
      afterMidnightFallSeconds: 20,
      forecastLeadSeconds: 10,
      laundryCut: 40,
    });
    expect(BROWNOUT.credits).toEqual({ starting: 400, upkeepPerServerPerMinute: 5 });
    expect(BROWNOUT.trust).toEqual({
      starting: 100,
      max: 100,
      drainPerSecondAtFullErrors: 10,
      recoverPerSecond: 1,
    });
    expect(BROWNOUT.ozzie).toEqual({ front: 100, coverCap: 200 });
    expect(BROWNOUT.solace).toEqual({ cost: 200, durationSeconds: 60, extraCapacity: 60 });
    expect(BROWNOUT.loadBalancer.cost).toBe(0);
    expect(BROWNOUT.overheat.overloadSeconds).toBe(8);
    expect(BROWNOUT.retries.maxDemandRise).toBe(0.5);
    expect(BROWNOUT.powerDip).toEqual({ warningSeconds: 2, darkSeconds: 20, beforeMidnightSeconds: 10 });
    expect(BROWNOUT.regroup).toEqual({ speed: 0.25, seconds: 10, charges: 1 });
    expect(BROWNOUT.rescue).toEqual({ trustBelow: 30, surgeSeconds: 45 });
    expect(BROWNOUT.finalSizing).toEqual({ holds: 4, holdsWithFastReplacement: 3, drops: 2, waste: 5 });
  });

  it('puts midnight 8:30 after the clock opens at 23:51:30', () => {
    const [h, m, s] = BROWNOUT.clock.opensAt.split(':').map(Number);
    expect(h * 3600 + m * 60 + s + BROWNOUT.clock.midnight).toBe(24 * 3600);
    expect(BROWNOUT.challenges.c7).toBe(BROWNOUT.clock.midnight);
  });

  it('builds the board rules from the constants', () => {
    expect(BROWNOUT_RULES.cost.server).toBe(BROWNOUT.server.cost);
    expect(BROWNOUT_RULES.capacity).toEqual({ server: 60, database: 200 });
    expect(BROWNOUT_RULES.upgrade).toEqual({ kinds: ['server'], cost: 60, factor: 2 });
    expect(BROWNOUT_RULES.maxOut.gateway).toBe(1);
  });

  it('no other file in src/sim/ hard-codes a table number', () => {
    const tableNumbers = new Set<number>();
    const collect = (v: unknown): void => {
      if (typeof v === 'number') tableNumbers.add(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(BROWNOUT);
    // 0 and 1 are everyday arithmetic (empty, one more, no boost), not tuning numbers.
    tableNumbers.delete(0);
    tableNumbers.delete(1);

    const sources = import.meta.glob<string>('../src/sim/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const others = Object.keys(sources).filter((f) => !f.endsWith('/brownout.ts'));
    expect(others.length).toBeGreaterThan(0);
    for (const file of others) {
      const code = sources[file]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/'[^'\n]*'|`[^`]*`/g, "''");
      const literals = (code.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g) ?? []).map(Number);
      const found = literals.filter((n) => tableNumbers.has(n));
      expect({ file, found }).toEqual({ file, found: [] });
    }
  });
});

describe('ac2: base demand', () => {
  it('is 120 flats ÷ 4 s = 30 req/s', () => {
    expect(estimateDemand(120, 4)).toBe(30);
    expect(baseDemand()).toBe(30);
  });

  it('the C6 estimate counts servers: 150 ÷ 60 = 2.5', () => {
    expect(serversFor(150)).toBe(2.5);
  });
});

describe('ac3: demandAt', () => {
  it('C1: 30 req/s', () => {
    for (const t of [15, 45, 89.9]) expect(demandAt(t)).toBe(30);
  });

  it('C2: 30 req/s', () => {
    for (const t of [90, 120, 179.9]) expect(demandAt(t)).toBe(30);
  });

  it('C3: ramps from 30 up to 90 and holds there', () => {
    expect(demandAt(180)).toBe(30);
    expect(demandAt(210)).toBe(60);
    expect(demandAt(240)).toBe(90);
    expect(demandAt(299.9)).toBe(90);
    for (let t = 180; t < 240; t += 5) expect(demandAt(t + 5)).toBeGreaterThan(demandAt(t));
  });

  it('C4: the district surge is 250, warned 10 s ahead', () => {
    expect(demandAt(299.9)).toBe(90);
    for (const t of [300, 330, 359.9]) expect(demandAt(t)).toBe(250);
    expect(forecastAt(290)).toEqual({ startsAt: 300, demand: 250 });
  });

  it('C5: the surge tail settles to 120', () => {
    for (const t of [360, 400, 449.9]) expect(demandAt(t)).toBe(120);
  });

  it('C6: climbs to 150, peaking at midnight (t = 510)', () => {
    expect(demandAt(510)).toBe(150);
    let peak = 0;
    for (let t = 450; t <= 510; t += 0.5) {
      expect(demandAt(t)).toBeLessThanOrEqual(150);
      peak = Math.max(peak, demandAt(t));
    }
    expect(peak).toBe(150);
    expect(demandAt(480)).toBeLessThan(150);
    expect(demandAt(511)).toBeLessThan(150);
  });

  it('C7: falls from 150 to 40 within 20 s after midnight', () => {
    expect(demandAt(510)).toBe(150);
    expect(demandAt(520)).toBe(95);
    expect(demandAt(530)).toBe(40);
    expect(demandAt(560)).toBe(40);
    for (let t = 510; t < 530; t += 2) expect(demandAt(t + 2)).toBeLessThan(demandAt(t));
  });
});

describe('ac4: forecastAt', () => {
  it('reports the C4 surge at least 10 s before it starts', () => {
    expect(forecastAt(289)).toBeNull();
    for (const t of [290, 295, 299.9]) expect(forecastAt(t)).toEqual({ startsAt: 300, demand: 250 });
    expect(forecastAt(300)?.demand).not.toBe(250);
  });

  it('reports the C6 final surge at least 10 s before it starts', () => {
    expect(forecastAt(439)).toBeNull();
    for (const t of [440, 445, 449.9]) expect(forecastAt(t)).toEqual({ startsAt: 450, demand: 150 });
    expect(forecastAt(450)).toBeNull();
  });

  it('every surge is forecast before demand reaches it', () => {
    for (const s of SURGES) {
      const warnAt = s.startsAt - BROWNOUT.demand.forecastLeadSeconds;
      expect(forecastAt(warnAt)).toEqual(s);
      expect(demandAt(warnAt)).toBeLessThan(s.demand);
    }
  });
});

describe('ac5: the session start', () => {
  it('starts with 400 credits and 100 trust', () => {
    const s = start();
    expect(s.board.credits).toBe(400);
    expect(s.trust).toBe(100);
    expect(s.banner).toBeNull();
    expect(s.ozzie).toEqual({ fronted: false, debt: 0 });
  });
});

describe('ac6: upkeep', () => {
  it('charges 5 credits per running server per minute', () => {
    expect(upkeepCost(1, 60)).toBe(5);
    expect(upkeepCost(2, 60)).toBe(10);
    expect(upkeepCost(4, 60)).toBe(20);
  });

  it('scales by dt with 1, 2 and 4 servers over 60 s', () => {
    for (const n of [1, 2, 4]) {
      let s = start();
      for (let i = 0; i < n; i++) s = ok(placeServer(s, `slot-${i + 1}`, 0));
      expect(runningServers(s.board)).toBe(n);
      const before = s.board.credits;
      // One minute in small steps costs the same as one big step.
      let stepped = s;
      for (let i = 0; i < 600; i++) stepped = chargeUpkeep(stepped, 0.1);
      expect(stepped.board.credits).toBeCloseTo(before - 5 * n, 9);
      expect(chargeUpkeep(s, 60).board.credits).toBe(before - 5 * n);
      expect(chargeUpkeep(s, 30).board.credits).toBe(before - 2.5 * n);
    }
  });

  it('costs nothing with no servers', () => {
    expect(chargeUpkeep(start(), 60).board.credits).toBe(400);
  });
});

describe('ac7: a new scrap server', () => {
  it('costs 80 credits', () => {
    expect(ok(placeServer(start(), 'slot-1', 0)).board.credits).toBe(320);
  });

  it('serves nothing for its first 3 s, then 60 req/s', () => {
    const { session, id } = wired();
    expect(offlineAt(session, 0)).toEqual([id]);
    expect(offlineAt(session, 2.9)).toEqual([id]);
    expect(offlineAt(session, 3)).toEqual([]);

    const booting = route(session.board, BROWNOUT_RULES, 30, offlineAt(session, 1));
    expect(booting.served).toBe(0);
    expect(booting.dropped).toBe(30);

    const live = route(session.board, BROWNOUT_RULES, 90, offlineAt(session, 3));
    expect(live.served).toBe(60);
    expect(live.dropped).toBe(30);
    expect(routeSession(session, 90, 3).served).toBe(60);
  });

  it("can't be placed without the credits", () => {
    expect(placeServer(withCredits(start(), 79), 'slot-1', 0).ok).toBe(false);
  });
});

describe('ac8: the overclock kit', () => {
  it('costs 60 credits and doubles one server to 120 req/s', () => {
    const { session, id } = wired();
    const s = ok(fitOverclock(session, id, 10));
    expect(s.board.credits).toBe(session.board.credits - 60);
    expect(partById(s.board, id)!.boost).toBe(2);
    expect(routeSession(s, 150, 13).served).toBe(120);
  });

  it('takes the server offline for 3 s while it reboots', () => {
    const { session, id } = wired();
    const s = ok(fitOverclock(session, id, 10));
    expect(offlineAt(s, 10)).toEqual([id]);
    expect(offlineAt(s, 12.9)).toEqual([id]);
    expect(routeSession(s, 30, 12).served).toBe(0);
    expect(offlineAt(s, 13)).toEqual([]);
    expect(routeSession(s, 30, 13).served).toBe(30);
  });

  it("can't be fitted twice to the same server", () => {
    const { session, id } = wired();
    const s = ok(fitOverclock(session, id, 10));
    const again = fitOverclock(s, id, 20);
    expect(again).toEqual({ ok: false, reason: 'already upgraded' });
  });

  it("can't be fitted without the credits", () => {
    const { session, id } = wired();
    expect(fitOverclock(withCredits(session, 59), id, 10).ok).toBe(false);
  });
});

describe('ac9: the Solace banner', () => {
  it('paying costs 200 credits and adds 60 req/s for 60 s', () => {
    const { session } = wired();
    const s = ok(chooseBanner(session, 'pay', 100));
    expect(s.board.credits).toBe(session.board.credits - 200);
    expect(s.banner).toEqual({ choice: 'pay', at: 100 });
    expect(bannerCapacity(s, 100)).toBe(60);
    expect(bannerCapacity(s, 159.9)).toBe(60);
    expect(bannerCapacity(s, 160)).toBe(0);
    expect(routeSession(s, 120, 100).served).toBe(120);
    expect(routeSession(s, 120, 160).served).toBe(60);
  });

  it('Ignore and Bin cost nothing and add nothing', () => {
    for (const choice of ['ignore', 'bin'] as const) {
      const { session } = wired();
      const s = ok(chooseBanner(session, choice, 100));
      expect(s.board.credits).toBe(session.board.credits);
      expect(bannerCapacity(s, 110)).toBe(0);
      expect(routeSession(s, 120, 110).served).toBe(60);
    }
  });

  it('records the choice for the debrief, once', () => {
    const s = ok(chooseBanner(start(), 'bin', 95));
    expect(s.banner).toEqual({ choice: 'bin', at: 95 });
    expect(chooseBanner(s, 'pay', 96).ok).toBe(false);
  });

  it("can't be paid without the credits", () => {
    expect(chooseBanner(withCredits(start(), 199), 'pay', 100).ok).toBe(false);
  });

  it('Ignore and Bin still work when credits are below 0', () => {
    for (const choice of ['ignore', 'bin'] as const) {
      const s = ok(chooseBanner(withCredits(start(), -40), choice, 100));
      expect(s.board.credits).toBe(-40);
      expect(s.banner).toEqual({ choice, at: 100 });
    }
  });
});

describe("ac10: Ozzie's tab", () => {
  it('fronts 100 credits at the rescue, once', () => {
    const s = ozzieFront(withCredits(start(), 50));
    expect(s.board.credits).toBe(150);
    expect(s.ozzie).toEqual({ fronted: true, debt: 0 });
    expect(ozzieFront(s).board.credits).toBe(150);
  });

  it('covers a shortfall below 0 at midnight and records it as debt', () => {
    const s = ozzieCover(withCredits(start(), -130));
    expect(s.board.credits).toBe(0);
    expect(s.ozzie.debt).toBe(130);
  });

  it('covers nothing when credits stay at or above 0', () => {
    expect(ozzieCover(withCredits(start(), 60)).ozzie.debt).toBe(0);
    expect(ozzieCover(withCredits(start(), 0)).ozzie.debt).toBe(0);
  });

  it('covers 200 at most', () => {
    const s = ozzieCover(withCredits(start(), -350));
    expect(s.ozzie.debt).toBe(200);
    expect(s.board.credits).toBe(-150);
    // Later shortfalls share the same 200 cap.
    const a = ozzieCover(withCredits(start(), -150));
    const b = ozzieCover(withCredits(a, -100));
    expect(b.ozzie.debt).toBe(200);
    expect(b.board.credits).toBe(-50);
  });

  it('never blocks the session for lack of credits', () => {
    const { session } = wired();
    let s = withCredits(session, 0);
    for (let i = 0; i < 10; i++) s = chargeUpkeep(s, 60);
    expect(s.board.credits).toBe(-50);
    s = ozzieCover(s);
    expect(s.board.credits).toBe(0);
    s = ozzieCover(chargeUpkeep(withCredits(s, -500), 60));
    expect(s.ozzie.debt).toBe(200);
    expect(s.board.credits).toBeLessThan(0);
    expect(routeSession(s, 30, 100).served).toBe(30);
  });
});

describe('ac11: trust', () => {
  const rates = { drain: 10, recover: 1, max: 100 };

  it('drains 10 per second at a 100% error rate, scaled by the error share', () => {
    expect(updateTrust(100, 1, 1, rates)).toBe(90);
    expect(updateTrust(100, 0.5, 1, rates)).toBe(95);
    expect(updateTrust(100, 0.25, 2, rates)).toBe(95);
    expect(trustAfter(100, 1, 1)).toBe(updateTrust(100, 1, 1, rates));
    expect(trustAfter(100, 0.5, 2)).toBe(90);
  });

  it('recovers 1 per second with no errors', () => {
    expect(updateTrust(50, 0, 1, rates)).toBe(51);
    expect(trustAfter(50, 0, 3)).toBe(53);
  });

  it('stays within 0 to 100', () => {
    expect(trustAfter(5, 1, 1)).toBe(0);
    expect(trustAfter(99.5, 0, 1)).toBe(100);
    expect(trustAfter(100, 0, 10)).toBe(100);
  });

  it('drains from a real route with errors', () => {
    const { session } = wired();
    const flow = routeSession(session, 120, 5);
    const share = errorShare(flow, 120);
    expect(share).toBe(0.5);
    expect(trustAfter(session.trust, share, 1)).toBe(95);
  });
});

describe('ac12: pure functions', () => {
  it('do not mutate their inputs', () => {
    const { session, id } = wired();
    const paid = ok(chooseBanner(session, 'pay', 100));
    const frozen = deepFreeze(structuredClone(session));
    const frozenPaid = deepFreeze(structuredClone(paid));
    const copy = structuredClone(session);
    const surges = deepFreeze(structuredClone(SURGES) as typeof SURGES);

    chargeUpkeep(frozen, 60);
    placeServer(frozen, 'slot-2', 0);
    fitOverclock(frozen, id, 10);
    chooseBanner(frozen, 'pay', 100);
    bannerCapacity(frozenPaid, 110);
    routeSession(frozenPaid, 120, 110);
    offlineAt(frozen, 1);
    ozzieFront(frozen);
    ozzieCover(withCredits(frozen, -50));
    forecastAt(290, surges);
    runningServers(frozen.board);

    expect(frozen).toEqual(copy);
    expect(surges).toEqual(SURGES);
  });

  it('createSession does not mutate its input', () => {
    const init = {
      slots: ['slot-1', 'slot-2'],
      parts: fixed,
      wires: [{ from: 'gateway', to: 'database' }],
    };
    const frozenInit = deepFreeze(structuredClone(init));
    createSession(frozenInit);
    expect(frozenInit).toEqual(init);
  });

  it('take time as a parameter and give the same answer for the same input', () => {
    const { session, id } = wired();
    expect(demandAt(333)).toBe(demandAt(333));
    expect(forecastAt(445)).toEqual(forecastAt(445));
    expect(fitOverclock(session, id, 7)).toEqual(fitOverclock(session, id, 7));
    expect(placeServer(start(), 'slot-2', 42)).toEqual(placeServer(start(), 'slot-2', 42));
    expect(ok(placeServer(start(), 'slot-2', 42)).offlineUntil['server-p1']).toBe(45);
  });
});
