import {
  MISSION,
  type MissionState,
  connect,
  createMission,
  decommission,
  disconnect,
  place,
  runUntilDone,
  step,
  trafficAt,
} from '../src/sim/mission';

function must(result: ReturnType<typeof place>): MissionState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function placedId(state: MissionState, kind: 'server' | 'cache'): string {
  const node = state.nodes.find((n) => n.kind === kind && n.slot !== null);
  if (!node) throw new Error(`no placed ${kind}`);
  return node.id;
}

function withCache(fromServers: string[]): MissionState {
  let s = must(place(createMission(), 'slot-1', 'cache'));
  const cache = placedId(s, 'cache');
  for (const srv of fromServers) s = must(connect(s, srv, cache));
  return must(connect(s, cache, 'database'));
}

describe('the four scenarios in docs/GAME.md', () => {
  it('with no changes the database overloads and the mission is lost', () => {
    const end = runUntilDone(createMission());
    expect(end.outcome).toBe('lost');
    expect(end.dbLoad).toBeGreaterThan(1);
  });

  it('a third app server, wired correctly, still loses', () => {
    let s = must(place(createMission(), 'slot-1', 'server'));
    const srv = placedId(s, 'server');
    s = must(connect(s, 'balancer', srv));
    s = must(connect(s, srv, 'database'));
    const end = runUntilDone(s);
    expect(end.outcome).toBe('lost');
    expect(end.dbLoad).toBeGreaterThan(1);
  });

  it('a cache wired from only one server still loses', () => {
    const end = runUntilDone(withCache(['server-1']));
    expect(end.outcome).toBe('lost');
  });

  it('a cache wired from both servers into the database wins', () => {
    const end = runUntilDone(withCache(['server-1', 'server-2']));
    expect(end.outcome).toBe('won');
    expect(end.dbLoad).toBeLessThan(1);
    expect(end.trust).toBeGreaterThan(0);
  });

  it('a cache placed late, once the database is already drowning, can still save it', () => {
    let s = createMission();
    while (s.time < 16 && s.outcome === 'playing') s = step(s, 0.1);
    expect(s.backlog).toBeGreaterThan(0);
    s = must(place(s, 'slot-2', 'cache'));
    const cache = placedId(s, 'cache');
    s = must(connect(s, 'server-1', cache));
    s = must(connect(s, 'server-2', cache));
    s = must(connect(s, cache, 'database'));
    expect(runUntilDone(s).outcome).toBe('won');
  });
});

describe('traffic', () => {
  it('is calm, ramps between the ramp times, then holds at peak', () => {
    expect(trafficAt(0)).toBe(MISSION.traffic.calm);
    expect(trafficAt(15)).toBeCloseTo((MISSION.traffic.calm + MISSION.traffic.peak) / 2);
    expect(trafficAt(20)).toBe(MISSION.traffic.peak);
    expect(trafficAt(300)).toBe(MISSION.traffic.peak);
  });

  it('is handled without errors before the ramp', () => {
    let s = createMission();
    while (s.time < 9 && s.outcome === 'playing') s = step(s, 0.1);
    expect(s.errorRate).toBe(0);
    expect(s.trust).toBe(100);
  });
});

describe('the cache', () => {
  it('warms up instead of answering at full rate the moment it is placed', () => {
    let s = createMission();
    while (s.time < 25 && s.outcome === 'playing') s = step(s, 0.1);
    s = must(place(s, 'slot-1', 'cache'));
    const cache = placedId(s, 'cache');
    s = must(connect(s, 'server-1', cache));
    s = must(connect(s, 'server-2', cache));
    s = must(connect(s, cache, 'database'));
    const first = step(s, 0.1);
    const later = runUntilDone(s, 0.1, s.time + 5);
    expect(first.flow.links[`${cache}>database`]).toBeGreaterThan(later.flow.links[`${cache}>database`] ?? 0);
  });

  it('turns its misses into errors when it is not wired to the database', () => {
    let s = must(place(createMission(), 'slot-1', 'cache'));
    const cache = placedId(s, 'cache');
    s = must(connect(s, 'server-1', cache));
    s = must(connect(s, 'server-2', cache));
    s = step(s, 0.1);
    expect(s.errorRate).toBeGreaterThan(0);
  });
});

describe('building', () => {
  it('can afford a cache or a server, not both', () => {
    const s = must(place(createMission(), 'slot-1', 'cache'));
    expect(s.credits).toBe(MISSION.budget - MISSION.cost.cache);
    const second = place(s, 'slot-2', 'server');
    expect(second.ok).toBe(false);
  });

  it('refuses a taken slot and an unknown slot', () => {
    const s = must(place(createMission(), 'slot-1', 'cache'));
    expect(place(s, 'slot-1', 'cache').ok).toBe(false);
    expect(place(createMission(), 'slot-9', 'cache').ok).toBe(false);
  });

  it('refuses links that skip the chain or point backwards', () => {
    const s = createMission();
    expect(connect(s, 'gateway', 'database').ok).toBe(false);
    expect(connect(s, 'database', 'server-1').ok).toBe(false);
    expect(connect(s, 'server-1', 'server-2').ok).toBe(false);
    expect(connect(s, 'balancer', 'server-1').ok).toBe(false); // already connected
  });

  it('rewiring a server to the cache replaces its database link', () => {
    let s = must(place(createMission(), 'slot-1', 'cache'));
    const cache = placedId(s, 'cache');
    s = must(connect(s, 'server-1', cache));
    expect(s.links.filter((l) => l.from === 'server-1')).toEqual([{ from: 'server-1', to: cache }]);
  });

  it('cutting the only link to the servers fails every request', () => {
    let s = must(disconnect(createMission(), 'gateway', 'balancer'));
    s = step(s, 0.1);
    expect(s.errorRate).toBeCloseTo(s.traffic);
  });

  it('decommission refunds half, removes its links and frees the slot', () => {
    let s = withCache(['server-1']);
    const cache = placedId(s, 'cache');
    s = must(decommission(s, cache));
    expect(s.credits).toBe(MISSION.budget - MISSION.cost.cache + MISSION.cost.cache * MISSION.refund);
    expect(s.links.some((l) => l.from === cache || l.to === cache)).toBe(false);
    expect(place(s, 'slot-1', 'cache').ok).toBe(false); // 250 credits left: can't afford 300
    expect(place(s, 'slot-1', 'server').ok).toBe(true);
  });

  it('the fixed components cannot be decommissioned', () => {
    expect(decommission(createMission(), 'database').ok).toBe(false);
  });

  it('nothing changes after the mission ends', () => {
    const end = runUntilDone(createMission());
    expect(step(end, 1)).toBe(end);
    expect(place(end, 'slot-1', 'cache').ok).toBe(false);
  });
});

describe('step', () => {
  it('does not mutate the state it is given', () => {
    const s = createMission();
    const copy = structuredClone(s);
    step(s, 1);
    expect(s).toEqual(copy);
  });

  it('gives the same result for the same inputs', () => {
    expect(runUntilDone(withCache(['server-1', 'server-2']))).toEqual(
      runUntilDone(withCache(['server-1', 'server-2'])),
    );
  });
});
