// Packets along the board's wires: how many to show for a wire's req/s, and a pool that reuses
// packet slots so drawing the flow allocates nothing once it is steady. No Phaser here: the board
// scene keeps one sprite per pool slot and moves it to the slot's position.

/** Packets drawn per second for each request per second on a wire. */
export const PACKETS_PER_REQUEST = 0.2;
/** Most packets per second one wire shows, so a surge stays readable. */
export const MAX_PACKETS_PER_SECOND = 30;
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

export interface Packet {
  active: boolean;
  /** Wire key ("from>to") the packet is on. */
  wire: string;
  /** Seconds since the packet left the start of its wire. */
  age: number;
  /** Seconds it takes to cross its wire. */
  travel: number;
}

/** Progress of a packet along its wire, from 0 to 1. */
export function progress(p: Packet): number {
  return Math.min(1, p.age / p.travel);
}

/**
 * A pool of packets. Packets leave each wire at exact multiples of 1/pps seconds whatever the
 * frame times are, so the number alive on a wire never goes past maxInFlight and the pool stops
 * growing once every wire has filled.
 */
export class PacketPool {
  readonly items: Packet[] = [];
  /** Fractional packets owed to each wire since its last packet left. */
  private owed = new Map<string, number>();

  get size(): number {
    return this.items.length;
  }

  get active(): number {
    let n = 0;
    for (const p of this.items) if (p.active) n++;
    return n;
  }

  /**
   * Advance by dt seconds. `rates` maps wire keys to req/s; a wire missing from it carries
   * nothing and its packets vanish. `travelOf` gives a wire's crossing time in seconds.
   */
  step(dt: number, rates: Readonly<Record<string, number>>, travelOf: (wire: string) => number): void {
    for (const p of this.items) {
      if (!p.active) continue;
      if (!(rates[p.wire] > 0)) {
        p.active = false;
        continue;
      }
      p.age += dt;
      if (p.age >= p.travel) p.active = false;
    }
    // Grow the pool to the most the current flow can ever hold, so it doesn't creep up later
    // when frame times happen to line packets up.
    let need = 0;
    for (const wire in rates) need += maxInFlight(rates[wire], travelOf(wire));
    while (this.items.length < need) this.items.push({ active: false, wire: '', age: 0, travel: 1 });
    for (const wire in rates) {
      const pps = packetsPerSecond(rates[wire]);
      if (pps <= 0) {
        this.owed.set(wire, 0);
        continue;
      }
      let owed = (this.owed.get(wire) ?? 0) + pps * dt;
      const travel = travelOf(wire);
      while (owed >= 1) {
        owed -= 1;
        // This packet should have left owed/pps seconds ago.
        const age = owed / pps;
        if (age < travel) this.spawn(wire, age, travel);
      }
      this.owed.set(wire, owed);
    }
  }

  /** Drop every packet (a new run, or the board restarting). */
  clear(): void {
    for (const p of this.items) p.active = false;
    this.owed.clear();
  }

  private spawn(wire: string, age: number, travel: number): void {
    for (const p of this.items) {
      if (!p.active) {
        p.active = true;
        p.wire = wire;
        p.age = age;
        p.travel = travel;
        return;
      }
    }
    this.items.push({ active: true, wire, age, travel });
  }
}
