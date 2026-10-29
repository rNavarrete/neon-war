// Packets along the board's wires: how many to show for a wire's req/s, and a pool that reuses
// packet slots so drawing the flow allocates nothing once it is steady. No Phaser here: the board
// scene keeps one sprite per pool slot and moves it to the slot's position.
//
// Packets v2 (board-7): packets crawl at half speed into an overloaded part, and retries are drawn
// as the same requests coming back: red cubes born at the dropping port of a part run a return path
// to the channel's mouth and re-enter there, never spawned new at the mouth. A small spark pool
// throws sparks off the in-port of a part that drops; the board leaves it off under reduce flicker
// and in ?test lite mode, and no hook value reads it.

import { type BoardRules, type Part, type Wire, capacityOf } from '../../sim/board';

/** Packets drawn per second for each request per second on a wire. */
export const PACKETS_PER_REQUEST = 0.1;
/** Most packets per second one wire shows, so a surge stays readable. */
export const MAX_PACKETS_PER_SECOND = 16;
/** How fast a packet travels along a wire, in game pixels per second. */
export const PACKET_SPEED = 320;

/** Packets per second to draw on a wire carrying `rate` req/s. */
export function packetsPerSecond(rate: number): number {
  if (!(rate > 0)) return 0;
  return Math.min(MAX_PACKETS_PER_SECOND, rate * PACKETS_PER_REQUEST);
}

/** Seconds a packet takes to cross a wire this long. */
export function travelSeconds(length: number): number {
  return Math.max(0.2, length / PACKET_SPEED);
}

/**
 * Most packets a wire can hold at once: one every 1/pps seconds, each alive for `travel` seconds.
 * The pool never needs more than the sum of this over the wires.
 */
export function maxInFlight(rate: number, travel: number): number {
  const pps = packetsPerSecond(rate);
  return pps > 0 ? Math.floor(travel * pps) + 1 : 0;
}

/** Each inbound lane's share of the block's demand, scaled up so the incoming stream reads as busy. */
export const INBOUND_STAGGER: readonly number[] = [1.7, 2.1, 1.9];

/**
 * Refill `out` with this frame's packet rates and return it: every wire's req/s from the routing,
 * plus the inbound lanes (`inboundKeys`, one per lane) sharing the block's demand a little out of
 * step so the crowd never marches. A key no longer carrying anything is set to 0 rather than
 * deleted, which the pool reads the same as missing; nothing is allocated once the keys exist.
 */
export function fillPacketRates(
  out: Record<string, number>,
  wires: Readonly<Record<string, number>>,
  demand: number,
  inboundKeys: readonly string[],
): Record<string, number> {
  for (const key in out) out[key] = 0;
  for (const key in wires) out[key] = wires[key];
  const n = inboundKeys.length;
  for (let i = 0; i < n; i++)
    out[inboundKeys[i]] = (demand * INBOUND_STAGGER[i % INBOUND_STAGGER.length]) / n;
  return out;
}

export interface Packet {
  active: boolean;
  /** Wire key ("from>to") the packet is on. */
  wire: string;
  /** Seconds since the packet left the start of its wire (a slowed wire counts them slower). */
  age: number;
  /** Seconds it takes to cross its wire. */
  travel: number;
  /**
   * A retry going back (board-7): born at the dropping port of a part, it runs that part's return
   * path (a RETURN_PREFIX key) to the channel's mouth, then re-enters on an inbound lane.
   */
  returning: boolean;
  /** Drawn red: a retry, going back or re-entering. Never set on a cube spawned at the mouth. */
  red: boolean;
}

/** Keys of the return paths retries run back to the mouth on: RETURN_PREFIX + the part id. */
export const RETURN_PREFIX = 'back:';

/** Whether a packet key is a return path's. */
export function isReturnKey(key: string): boolean {
  return key.startsWith(RETURN_PREFIX);
}

/** How fast packets crawl along a wire into an overloaded part: half speed. */
export const HOT_SPEED = 0.5;

/** The speed of packets on a wire into a part with this load share: half once it is over 100%. */
export function wireSpeed(share: number | null): number {
  return share !== null && share > 1 ? HOT_SPEED : 1;
}

/** What PacketPool.step takes besides the rates: how fast each wire runs and where retries re-enter. */
export interface StepOptions {
  /** A wire's speed factor (1, or HOT_SPEED into an overloaded part); 1 when missing. */
  readonly speedOf?: (wire: string) => number;
  /** The inbound lanes a returning retry re-enters on when it reaches the mouth, in turn. */
  readonly reenter?: readonly string[];
}

/**
 * Req/s each part drops this moment, written into `out` by part id (0 for a part dropping nothing):
 * all it receives while offline, what it receives over its limit, and what it serves with nowhere
 * to send it. Mirrors route() in src/sim/board.ts, so retries are born where the sim drops.
 */
export function dropsInto(
  out: Record<string, number>,
  parts: readonly Part[],
  wires: readonly Wire[],
  load: Readonly<Record<string, number>>,
  offline: readonly string[],
  rules: BoardRules,
): Record<string, number> {
  for (const key in out) out[key] = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const inRate = load[p.id] ?? 0;
    if (!(inRate > 0)) {
      out[p.id] = 0;
      continue;
    }
    if (offline.includes(p.id)) {
      out[p.id] = inRate;
      continue;
    }
    const ok = Math.min(inRate, capacityOf(p, rules));
    let dropped = inRate - ok;
    if (rules.wiring[p.kind].length > 0) {
      const checks = rules.healthCheck.includes(p.kind);
      let outs = 0;
      for (let k = 0; k < wires.length; k++) {
        const w = wires[k];
        if (w.from === p.id && !(checks && offline.includes(w.to))) outs++;
      }
      if (outs === 0) dropped += ok;
    }
    out[p.id] = dropped;
  }
  return out;
}

/**
 * Retry cubes a second born at each dropping part, into `out` by part id: the red share of the
 * cubes coming in (retryShare x lanePps) split across the parts by what each drops. Nothing is born
 * when nothing drops: a retry always comes back from a part, never out of the mouth.
 */
export function retryBirthsInto(
  out: Record<string, number>,
  drops: Readonly<Record<string, number>>,
  retryShare: number,
  lanePps: number,
): Record<string, number> {
  for (const key in out) out[key] = 0;
  let sum = 0;
  for (const id in drops) {
    out[id] = 0;
    if (drops[id] > 0) sum += drops[id];
  }
  const total = retryShare > 0 && lanePps > 0 ? retryShare * lanePps : 0;
  if (!(sum > 0) || total <= 0) return out;
  for (const id in drops) out[id] = drops[id] > 0 ? (total * drops[id]) / sum : 0;
  return out;
}

/** Progress of a packet along its wire, from 0 to 1. */
export function progress(p: Packet): number {
  return Math.min(1, p.age / p.travel);
}

/**
 * A pool of packets. Packets leave each wire at exact multiples of 1/pps seconds whatever the
 * frame times are, so the number alive on a wire never goes past maxInFlight and the pool stops
 * growing once every wire has filled. A packet finding no free slot is skipped rather than growing
 * the pool, so the pool is never bigger than the most the flow has needed (`need`).
 */
export class PacketPool {
  readonly items: Packet[] = [];
  /** Fractional packets owed to each wire since its last packet left. */
  private owed = new Map<string, number>();
  /** The most slots the flow has needed so far: the pool's size never passes it. */
  need = 0;
  /** Retry cubes born at a part so far, and how many of them reached the mouth and re-entered. */
  born = 0;
  reentered = 0;
  private nextLane = 0;

  get size(): number {
    return this.items.length;
  }

  get active(): number {
    let n = 0;
    for (const p of this.items) if (p.active) n++;
    return n;
  }

  /** Red cubes on the board now: retries going back plus those re-entering. */
  get red(): number {
    let n = 0;
    for (const p of this.items) if (p.active && p.red) n++;
    return n;
  }

  /** Retry cubes on their way back to the mouth now. */
  get returning(): number {
    let n = 0;
    for (const p of this.items) if (p.active && p.returning) n++;
    return n;
  }

  /**
   * Advance by dt seconds. `rates` maps wire keys to req/s; a wire missing from it carries
   * nothing and its packets vanish (a retry already going back finishes its trip). `travelOf` gives
   * a wire's crossing time in seconds at full speed; `opts.speedOf` slows a wire down, and
   * `opts.reenter` names the lanes a retry comes in again on once it is back at the mouth.
   */
  step(
    dt: number,
    rates: Readonly<Record<string, number>>,
    travelOf: (wire: string) => number,
    opts: StepOptions = NO_OPTIONS,
  ): void {
    const speedOf = opts.speedOf;
    const lanes = opts.reenter ?? NO_LANES;
    for (const p of this.items) {
      if (!p.active) continue;
      if (p.returning) {
        p.age += dt;
        if (p.age < p.travel) continue;
        if (lanes.length === 0) {
          p.active = false;
          continue;
        }
        // Back at the mouth: the same request comes in again on the next lane, still red.
        const lane = lanes[this.nextLane++ % lanes.length];
        p.wire = lane;
        p.age = 0;
        p.travel = travelOf(lane);
        p.returning = false;
        this.reentered++;
        continue;
      }
      if (!(rates[p.wire] > 0)) {
        p.active = false;
        continue;
      }
      p.age += dt * (speedOf ? speedOf(p.wire) : 1);
      if (p.age >= p.travel) p.active = false;
    }
    // Grow the pool to the most the current flow can ever hold, so it doesn't creep up later
    // when frame times happen to line packets up. A slowed wire holds its packets longer; a return
    // path's cubes go on to cross an inbound lane after it.
    let laneTravel = 0;
    for (let i = 0; i < lanes.length; i++) laneTravel = Math.max(laneTravel, travelOf(lanes[i]));
    let need = 0;
    for (const wire in rates) {
      const speed = speedOf ? speedOf(wire) : 1;
      need += maxInFlight(rates[wire], travelOf(wire) / (speed > 0 ? speed : 1));
      if (laneTravel > 0 && isReturnKey(wire)) need += maxInFlight(rates[wire], laneTravel);
    }
    if (need > this.need) this.need = need;
    while (this.items.length < need) this.items.push(blank());
    for (const wire in rates) {
      const pps = packetsPerSecond(rates[wire]);
      if (pps <= 0) {
        this.owed.set(wire, 0);
        continue;
      }
      let owed = (this.owed.get(wire) ?? 0) + pps * dt;
      const travel = travelOf(wire);
      const back = isReturnKey(wire);
      const speed = back || !speedOf ? 1 : speedOf(wire);
      while (owed >= 1) {
        owed -= 1;
        // This packet should have left owed/pps seconds ago.
        const age = (owed / pps) * speed;
        if (age < travel) this.spawn(wire, age, travel, back);
      }
      this.owed.set(wire, owed);
    }
  }

  /** Drop every packet (a new run, or the board restarting). */
  clear(): void {
    for (const p of this.items) {
      p.active = false;
      p.returning = false;
      p.red = false;
    }
    this.owed.clear();
  }

  private spawn(wire: string, age: number, travel: number, back: boolean): void {
    for (const p of this.items) {
      if (!p.active) {
        p.active = true;
        p.wire = wire;
        p.age = age;
        p.travel = travel;
        // Only a return path's cube is red: nothing red is ever spawned on a lane at the mouth.
        p.returning = back;
        p.red = back;
        if (back) this.born++;
        return;
      }
    }
    // No free slot: skip this packet rather than grow past what the flow needs.
  }
}

const NO_OPTIONS: StepOptions = {};
const NO_LANES: readonly string[] = [];

function blank(): Packet {
  return { active: false, wire: '', age: 0, travel: 1, returning: false, red: false };
}

/** Sparks thrown off the in-port of a part that drops: a fixed pool, nothing allocated once made. */
export interface Spark {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/** How long a spark lives, in seconds, and how many the pool holds. */
export const SPARK_LIFE = 0.45;
export const SPARK_POOL = 48;
/** Most sparks a second one port throws. */
export const MAX_SPARKS_PER_SECOND = 6;

/** Sparks a second off a port dropping `dropped` req/s: one per 10 req/s, at most 6. */
export function sparkRate(dropped: number): number {
  if (!(dropped > 0)) return 0;
  return Math.min(MAX_SPARKS_PER_SECOND, dropped * 0.1);
}

export class SparkPool {
  readonly items: Spark[] = [];
  private seed = 7;

  constructor(size = SPARK_POOL) {
    for (let i = 0; i < size; i++) this.items.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0 });
  }

  get active(): number {
    let n = 0;
    for (const s of this.items) if (s.active) n++;
    return n;
  }

  /** Throw `n` sparks from (x, y), back and out of the port; sparks past the pool's size are skipped. */
  emit(x: number, y: number, n: number): void {
    for (let k = 0; k < n; k++) {
      let free: Spark | null = null;
      for (const s of this.items) {
        if (!s.active) {
          free = s;
          break;
        }
      }
      if (!free) return;
      free.active = true;
      free.x = x;
      free.y = y;
      free.vx = -40 - 90 * this.rand();
      free.vy = -70 + 140 * this.rand();
      free.age = 0;
    }
  }

  /** Move every spark on by dt seconds with a little gravity; a spark past SPARK_LIFE goes out. */
  step(dt: number): void {
    for (const s of this.items) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= SPARK_LIFE) {
        s.active = false;
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 260 * dt;
    }
  }

  clear(): void {
    for (const s of this.items) s.active = false;
  }

  /** A deterministic 0..1 (no Math.random, so runs repeat). */
  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
}
