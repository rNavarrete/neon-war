// The board's plumbing: parts on the table's grid, wires between them, and how requests flow through.
// Pure functions over plain data, kept from the Viral Signal prototype (PR #2) without its
// story or numbers. Session rules (traffic curves, overheating, upkeep, power dips) build on
// this and pass their numbers in through BoardRules.

import { fits } from './grid';

export type PartKind = 'gateway' | 'balancer' | 'server' | 'database';

/** Traffic moves from earlier kinds to later ones only, so wiring can never loop. */
export const KIND_ORDER: readonly PartKind[] = ['gateway', 'balancer', 'server', 'database'];

export interface Part {
  readonly id: string;
  readonly kind: PartKind;
  /**
   * The part's anchor cell on the table's grid ('c4-11': the far-left cell of its footprint, see
   * grid.ts), or null for the parts the session starts with (they stand in fixed bays).
   */
  readonly slot: string | null;
  /** Capacity multiplier from an upgrade such as the overclock kit; missing means 1. */
  readonly boost?: number;
}

export interface Wire {
  readonly from: string;
  readonly to: string;
}

export interface Board {
  readonly credits: number;
  readonly parts: readonly Part[];
  readonly wires: readonly Wire[];
  /** Every cell a part may stand on (an old board may list plain slot names instead). */
  readonly slots: readonly string[];
  readonly nextId: number;
}

export interface BoardRules {
  /** Price of each kind the player may place. Kinds missing here can't be placed. */
  readonly cost: Readonly<Partial<Record<PartKind, number>>>;
  /** Share of the price given back when a placed part is decommissioned. */
  readonly refund: number;
  /** Requests per second a part serves; kinds missing here are unlimited. */
  readonly capacity: Readonly<Partial<Record<PartKind, number>>>;
  /** Which kinds each kind may send traffic to. */
  readonly wiring: Readonly<Record<PartKind, readonly PartKind[]>>;
  /** Most wires a kind may send out; kinds missing here are unlimited. */
  readonly maxOut: Readonly<Partial<Record<PartKind, number>>>;
  /** Kinds that health-check their targets: they skip offline parts instead of feeding them. */
  readonly healthCheck: readonly PartKind[];
  /** A one-off upgrade (the overclock kit): which kinds take it, its price, its capacity multiplier. */
  readonly upgrade?: { readonly kinds: readonly PartKind[]; readonly cost: number; readonly factor: number };
}

/** Requests per second through each wire and part in one moment, for the rules and for drawing. */
export interface Flow {
  readonly wires: Readonly<Record<string, number>>;
  readonly load: Readonly<Record<string, number>>;
  /** Requests per second that reached a part with nowhere further to go (the end of the line). */
  readonly served: number;
  /** Requests per second lost: over capacity, offline, or sent nowhere. */
  readonly dropped: number;
  /** Wires a health-checking part skipped because their target was offline. */
  readonly skipped: readonly string[];
}

export type BoardResult = { ok: true; board: Board } | { ok: false; reason: string };

const fail = (reason: string): BoardResult => ({ ok: false, reason });

export const wireKey = (w: Wire): string => `${w.from}>${w.to}`;

export function createBoard(init: {
  credits: number;
  slots: readonly string[];
  parts?: readonly Part[];
  wires?: readonly Wire[];
}): Board {
  return {
    credits: init.credits,
    slots: [...init.slots],
    parts: [...(init.parts ?? [])],
    wires: [...(init.wires ?? [])],
    nextId: 1,
  };
}

export function partById(board: Board, id: string): Part | undefined {
  return board.parts.find((p) => p.id === id);
}

/**
 * Place a part with its footprint's anchor at `slot`. Every cell of the footprint must be on the
 * table, outside the fixed parts' bays and free (grid.ts fits), and the price must be in hand.
 */
export function place(board: Board, rules: BoardRules, slot: string, kind: PartKind): BoardResult {
  const fit = fits(board.slots, board.parts, kind, slot);
  if (!fit.ok) return fail(fit.reason);
  const cost = rules.cost[kind];
  if (cost === undefined) return fail(`a ${kind} can't be placed`);
  if (board.credits < cost) return fail('not enough credits');
  const part: Part = { id: `${kind}-p${board.nextId}`, kind, slot };
  return {
    ok: true,
    board: {
      ...board,
      credits: board.credits - cost,
      parts: [...board.parts, part],
      nextId: board.nextId + 1,
    },
  };
}

/** Remove a placed part and its wires, giving back part of its price. */
export function decommission(board: Board, rules: BoardRules, id: string): BoardResult {
  const part = partById(board, id);
  if (!part) return fail(`no part ${id}`);
  if (part.slot === null) return fail('only placed parts can be decommissioned');
  if (rules.cost[part.kind] === undefined) return fail('that part stays where the crew put it');
  const refund = Math.floor((rules.cost[part.kind] ?? 0) * rules.refund);
  return {
    ok: true,
    board: {
      ...board,
      credits: board.credits + refund,
      parts: board.parts.filter((p) => p.id !== id),
      wires: board.wires.filter((w) => w.from !== id && w.to !== id),
    },
  };
}

export function connect(board: Board, rules: BoardRules, from: string, to: string): BoardResult {
  const a = partById(board, from);
  const b = partById(board, to);
  if (!a || !b) return fail('unknown part');
  if (!rules.wiring[a.kind].includes(b.kind)) return fail(`a ${a.kind} can't send traffic to a ${b.kind}`);
  if (board.wires.some((w) => w.from === from && w.to === to)) return fail('already connected');
  const max = rules.maxOut[a.kind];
  if (max !== undefined && board.wires.filter((w) => w.from === from).length >= max) {
    return fail(max === 1 ? `a ${a.kind} feeds one part only` : `a ${a.kind} feeds ${max} parts at most`);
  }
  return { ok: true, board: { ...board, wires: [...board.wires, { from, to }] } };
}

export function disconnect(board: Board, from: string, to: string): BoardResult {
  if (!board.wires.some((w) => w.from === from && w.to === to)) return fail('not connected');
  return {
    ok: true,
    board: { ...board, wires: board.wires.filter((w) => !(w.from === from && w.to === to)) },
  };
}

/** Requests per second a part can serve, including any upgrade. */
export function capacityOf(part: Part, rules: BoardRules): number {
  return (rules.capacity[part.kind] ?? Infinity) * (part.boost ?? 1);
}

/** Spend the upgrade's price to multiply one part's capacity. Each part takes it once. */
export function upgrade(board: Board, rules: BoardRules, id: string): BoardResult {
  const part = partById(board, id);
  if (!part) return fail(`no part ${id}`);
  const up = rules.upgrade;
  if (!up || !up.kinds.includes(part.kind)) return fail(`a ${part.kind} can't be upgraded`);
  if (part.boost !== undefined) return fail('already upgraded');
  if (board.credits < up.cost) return fail('not enough credits');
  return {
    ok: true,
    board: {
      ...board,
      credits: board.credits - up.cost,
      parts: board.parts.map((p) => (p.id === id ? { ...p, boost: up.factor } : p)),
    },
  };
}

/** Remove a part's upgrade (it burned out); the part keeps running at its normal capacity. */
export function loseUpgrade(board: Board, id: string): BoardResult {
  const part = partById(board, id);
  if (!part) return fail(`no part ${id}`);
  if (part.boost === undefined) return fail('not upgraded');
  return {
    ok: true,
    board: {
      ...board,
      parts: board.parts.map((p) => (p.id === id ? { id: p.id, kind: p.kind, slot: p.slot } : p)),
    },
  };
}

/**
 * Where `demand` requests per second go right now. Demand enters at the gateways, split evenly.
 * Each part serves up to its capacity and splits what it serves evenly across its out-wires.
 * A part whose kind may send nowhere is the end of the line and counts as served. Offline parts
 * (booting, dead, in a power dip) drop everything they receive, except that health-checking
 * kinds (the load balancer) skip offline targets and split across the live ones.
 */
export function route(
  board: Board,
  rules: BoardRules,
  demand: number,
  offline: readonly string[] = [],
): Flow {
  const wires: Record<string, number> = {};
  const load: Record<string, number> = {};
  let served = 0;
  let dropped = 0;
  const skipped: string[] = [];

  const gateways = board.parts.filter((p) => p.kind === 'gateway');
  if (gateways.length === 0) dropped += demand;
  for (const g of gateways) load[g.id] = demand / gateways.length;

  for (const kind of KIND_ORDER) {
    for (const part of board.parts) {
      if (part.kind !== kind) continue;
      const inRate = load[part.id] ?? 0;
      if (inRate <= 0) continue;
      if (offline.includes(part.id)) {
        dropped += inRate;
        continue;
      }
      const ok = Math.min(inRate, capacityOf(part, rules));
      dropped += inRate - ok;
      if (rules.wiring[kind].length === 0) {
        served += ok;
        continue;
      }
      let outs = board.wires.filter((w) => w.from === part.id);
      if (rules.healthCheck.includes(kind)) {
        for (const w of outs) if (offline.includes(w.to)) skipped.push(wireKey(w));
        outs = outs.filter((w) => !offline.includes(w.to));
      }
      if (outs.length === 0) {
        dropped += ok;
        continue;
      }
      for (const w of outs) {
        const share = ok / outs.length;
        wires[wireKey(w)] = (wires[wireKey(w)] ?? 0) + share;
        load[w.to] = (load[w.to] ?? 0) + share;
      }
    }
  }
  return { wires, load, served, dropped, skipped };
}

/** Share of demand that failed, from 0 to 1. */
export function errorShare(flow: Flow, demand: number): number {
  return demand > 0 ? Math.min(1, flow.dropped / demand) : 0;
}

/**
 * The neighbours' trust after dt seconds: drains in proportion to the error share and recovers
 * at a steady rate only while nothing fails. Stays between 0 and max.
 */
export function updateTrust(
  trust: number,
  share: number,
  dt: number,
  rates: { drain: number; recover: number; max: number },
): number {
  const next = share > 0 ? trust - rates.drain * share * dt : trust + rates.recover * dt;
  return Math.min(rates.max, Math.max(0, next));
}
