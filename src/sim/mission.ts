// Mission 2, Viral Signal: the whole rule set as pure functions over plain data.
// Numbers come from docs/GAME.md; Rolando owns them, so they all live in MISSION.

export type NodeKind = 'gateway' | 'balancer' | 'server' | 'database' | 'cache';
export type Placeable = 'server' | 'cache';
export type Outcome = 'playing' | 'won' | 'lost';

export interface SimNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** Rack slot the node was placed in, or null for the fixed nodes. */
  readonly slot: string | null;
  /** Seconds since the node was placed (caches warm up over this). */
  readonly age: number;
}

export interface Link {
  readonly from: string;
  readonly to: string;
}

/** Requests per second through each link and node in the last step, for drawing. */
export interface Flow {
  readonly links: Readonly<Record<string, number>>;
  readonly nodeLoad: Readonly<Record<string, number>>;
}

export interface MissionState {
  readonly time: number;
  readonly credits: number;
  readonly nodes: readonly SimNode[];
  readonly links: readonly Link[];
  readonly slots: readonly string[];
  /** Requests waiting at the database. */
  readonly backlog: number;
  readonly trust: number;
  /** Incoming requests per second at the gateway. */
  readonly traffic: number;
  /** Failed requests per second in the last step. */
  readonly errorRate: number;
  /** Database load in the last step as a share of its capacity (1 = full). */
  readonly dbLoad: number;
  /** Seconds the errors have stayed under the win threshold at peak traffic. */
  readonly calmAtPeak: number;
  readonly outcome: Outcome;
  readonly flow: Flow;
  readonly nextId: number;
}

export const MISSION = {
  budget: 400,
  cost: { server: 250, cache: 300 } as Record<Placeable, number>,
  /** Share of the cost given back when a placed node is decommissioned. */
  refund: 0.5,
  capacity: { server: 150, database: 90 },
  traffic: { calm: 40, peak: 240, rampStart: 10, rampEnd: 20 },
  cache: { hitRate: 0.8, warmup: 4 },
  backlogMax: 200,
  /** Trust lost per second at a 100% error rate. */
  trustDrain: 12,
  winErrorShare: 0.02,
  winHold: 12,
  slots: ['slot-1', 'slot-2', 'slot-3'],
} as const;

export const linkKey = (l: Link): string => `${l.from}>${l.to}`;

export function trafficAt(t: number): number {
  const { calm, peak, rampStart, rampEnd } = MISSION.traffic;
  if (t <= rampStart) return calm;
  if (t >= rampEnd) return peak;
  return calm + ((peak - calm) * (t - rampStart)) / (rampEnd - rampStart);
}

export function createMission(): MissionState {
  const nodes: SimNode[] = [
    { id: 'gateway', kind: 'gateway', slot: null, age: 0 },
    { id: 'balancer', kind: 'balancer', slot: null, age: 0 },
    { id: 'server-1', kind: 'server', slot: null, age: 0 },
    { id: 'server-2', kind: 'server', slot: null, age: 0 },
    { id: 'database', kind: 'database', slot: null, age: 0 },
  ];
  const links: Link[] = [
    { from: 'gateway', to: 'balancer' },
    { from: 'balancer', to: 'server-1' },
    { from: 'balancer', to: 'server-2' },
    { from: 'server-1', to: 'database' },
    { from: 'server-2', to: 'database' },
  ];
  return {
    time: 0,
    credits: MISSION.budget,
    nodes,
    links,
    slots: MISSION.slots,
    backlog: 0,
    trust: 100,
    traffic: trafficAt(0),
    errorRate: 0,
    dbLoad: 0,
    calmAtPeak: 0,
    outcome: 'playing',
    flow: { links: {}, nodeLoad: {} },
    nextId: 1,
  };
}

export type ActionResult = { ok: true; state: MissionState } | { ok: false; reason: string };

const fail = (reason: string): ActionResult => ({ ok: false, reason });

export function nodeById(state: MissionState, id: string): SimNode | undefined {
  return state.nodes.find((n) => n.id === id);
}

export function place(state: MissionState, slot: string, kind: Placeable): ActionResult {
  if (state.outcome !== 'playing') return fail('the mission is over');
  if (!state.slots.includes(slot)) return fail(`no slot ${slot}`);
  if (state.nodes.some((n) => n.slot === slot)) return fail('that slot is taken');
  const cost = MISSION.cost[kind];
  if (state.credits < cost) return fail('not enough credits');
  const node: SimNode = { id: `${kind}-p${state.nextId}`, kind, slot, age: 0 };
  return {
    ok: true,
    state: {
      ...state,
      credits: state.credits - cost,
      nodes: [...state.nodes, node],
      nextId: state.nextId + 1,
    },
  };
}

export function decommission(state: MissionState, id: string): ActionResult {
  if (state.outcome !== 'playing') return fail('the mission is over');
  const node = nodeById(state, id);
  if (!node) return fail(`no node ${id}`);
  if (node.slot === null) return fail('only placed components can be decommissioned');
  const refund = Math.floor(MISSION.cost[node.kind as Placeable] * MISSION.refund);
  return {
    ok: true,
    state: {
      ...state,
      credits: state.credits + refund,
      nodes: state.nodes.filter((n) => n.id !== id),
      links: state.links.filter((l) => l.from !== id && l.to !== id),
    },
  };
}

// Which kinds may send traffic to which. Anything else is refused, so the player can't
// build a loop or skip the balancer.
const ALLOWED: Record<NodeKind, readonly NodeKind[]> = {
  gateway: ['balancer'],
  balancer: ['server'],
  server: ['database', 'cache'],
  cache: ['database'],
  database: [],
};

export function connect(state: MissionState, from: string, to: string): ActionResult {
  if (state.outcome !== 'playing') return fail('the mission is over');
  const a = nodeById(state, from);
  const b = nodeById(state, to);
  if (!a || !b) return fail('unknown component');
  if (!ALLOWED[a.kind].includes(b.kind)) return fail(`a ${a.kind} can't send traffic to a ${b.kind}`);
  if (state.links.some((l) => l.from === from && l.to === to)) return fail('already connected');
  // A server sends its traffic one way: wiring it to a cache replaces its database link and vice versa.
  const links = a.kind === 'server' ? state.links.filter((l) => l.from !== from) : state.links;
  return { ok: true, state: { ...state, links: [...links, { from, to }] } };
}

export function disconnect(state: MissionState, from: string, to: string): ActionResult {
  if (state.outcome !== 'playing') return fail('the mission is over');
  if (!state.links.some((l) => l.from === from && l.to === to)) return fail('not connected');
  return {
    ok: true,
    state: { ...state, links: state.links.filter((l) => !(l.from === from && l.to === to)) },
  };
}

function cacheHitRate(node: SimNode): number {
  return MISSION.cache.hitRate * Math.min(1, node.age / MISSION.cache.warmup);
}

/** Advance the mission by dt seconds. Pure: returns a new state. */
export function step(state: MissionState, dt: number): MissionState {
  if (state.outcome !== 'playing' || dt <= 0) return state;
  const time = state.time + dt;
  const traffic = trafficAt(time);
  const nodes = state.nodes.map((n) => ({ ...n, age: n.age + dt }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outs = (id: string) => state.links.filter((l) => l.from === id);

  const linkFlow: Record<string, number> = {};
  const nodeLoad: Record<string, number> = {};
  let errors = 0;
  let toDb = 0;

  const send = (from: string, to: string, rate: number) => {
    linkFlow[linkKey({ from, to })] = (linkFlow[linkKey({ from, to })] ?? 0) + rate;
    nodeLoad[to] = (nodeLoad[to] ?? 0) + rate;
  };

  // Gateway -> balancers.
  nodeLoad.gateway = traffic;
  const gwOut = outs('gateway').filter((l) => byId.get(l.to)?.kind === 'balancer');
  if (gwOut.length === 0) errors += traffic;
  for (const l of gwOut) send(l.from, l.to, traffic / gwOut.length);

  // Balancers split evenly across the servers they are wired to.
  for (const lb of nodes.filter((n) => n.kind === 'balancer')) {
    const inRate = nodeLoad[lb.id] ?? 0;
    const targets = outs(lb.id).filter((l) => byId.get(l.to)?.kind === 'server');
    if (targets.length === 0) errors += inRate;
    for (const l of targets) send(l.from, l.to, inRate / targets.length);
  }

  // Servers drop what is over capacity and pass the rest on.
  const cacheIn: Record<string, number> = {};
  for (const srv of nodes.filter((n) => n.kind === 'server')) {
    const inRate = nodeLoad[srv.id] ?? 0;
    const served = Math.min(inRate, MISSION.capacity.server);
    errors += inRate - served;
    const out = outs(srv.id)[0];
    const target = out ? byId.get(out.to) : undefined;
    if (!out || !target) {
      errors += served;
      continue;
    }
    send(out.from, out.to, served);
    if (target.kind === 'database') toDb += served;
    else cacheIn[target.id] = (cacheIn[target.id] ?? 0) + served;
  }

  // Caches answer hits themselves and forward misses to the database.
  for (const cache of nodes.filter((n) => n.kind === 'cache')) {
    const inRate = cacheIn[cache.id] ?? 0;
    const misses = inRate * (1 - cacheHitRate(cache));
    const out = outs(cache.id).find((l) => byId.get(l.to)?.kind === 'database');
    if (!out) {
      errors += misses;
      continue;
    }
    send(out.from, out.to, misses);
    toDb += misses;
  }

  // The database works through its backlog; what doesn't fit in the backlog fails.
  const cap = MISSION.capacity.database;
  let backlog = state.backlog + (toDb - cap) * dt;
  if (backlog < 0) backlog = 0;
  if (backlog > MISSION.backlogMax) {
    errors += (backlog - MISSION.backlogMax) / dt;
    backlog = MISSION.backlogMax;
  }
  const dbLoad = toDb / cap;

  const errorShare = traffic > 0 ? Math.min(1, errors / traffic) : 0;
  const trust = Math.max(0, state.trust - MISSION.trustDrain * errorShare * dt);
  const atPeak = time >= MISSION.traffic.rampEnd;
  const calmAtPeak = atPeak && errorShare < MISSION.winErrorShare ? state.calmAtPeak + dt : 0;
  const outcome: Outcome = trust <= 0 ? 'lost' : calmAtPeak >= MISSION.winHold ? 'won' : 'playing';

  return {
    ...state,
    time,
    nodes,
    traffic,
    backlog,
    trust,
    errorRate: errors,
    dbLoad,
    calmAtPeak,
    outcome,
    flow: { links: linkFlow, nodeLoad },
  };
}

/** Run the mission with fixed steps until it ends or maxTime passes. */
export function runUntilDone(state: MissionState, dt = 0.1, maxTime = 120): MissionState {
  let s = state;
  while (s.outcome === 'playing' && s.time < maxTime) s = step(s, dt);
  return s;
}
