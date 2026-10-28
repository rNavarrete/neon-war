// The board's two waits (board-6): C1 holds the clock until the first box is wired gateway to
// database, and after the rescue the clock waits until the boxes behind the crew's balancer cover
// the tail. The board shows why: the out-port that needs a wire blinks, the cubes with nowhere to go
// tumble off it as grey sparks, and the empty pads pulse. Pure: no Phaser, no clock; time comes in
// as `t` (board seconds). The flags themselves are the run's (Frame.waitingForFirstBuild and
// waitingForCrewBuild); this only draws them.

import type { Part, Wire } from '../../sim/board';
import { capacityOf } from '../../sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../../sim/brownout';
import { GATEWAY, LB_SLOT, PART_SIZE, type Point } from './layout';

/** Req/s the boxes behind the balancer must cover before the clock runs again (the tail). */
export const CREW_NEED = BROWNOUT.demand.tail;

/**
 * Req/s the boxes behind the balancer can carry, the way the run counts it for its wait: servers not
 * dead, with a wire in from the balancer and a wire out to the database (booting ones count).
 */
export function crewCover(parts: readonly Part[], wires: readonly Wire[], dead: readonly string[]): number {
  let lb: string | null = null;
  for (const p of parts) if (p.kind === 'balancer') lb = p.id;
  if (lb === null) return 0;
  let total = 0;
  for (const p of parts) {
    if (p.kind !== 'server' || dead.includes(p.id)) continue;
    let fed = false;
    let out = false;
    for (const w of wires) {
      if (w.from === lb && w.to === p.id) fed = true;
      if (w.from === p.id && w.to === 'database') out = true;
    }
    if (fed && out) total += capacityOf(p, BROWNOUT_RULES);
  }
  return total;
}

/** The waiting port blinks at 2 Hz; steady (lit) under reduce flicker. */
export const PORT_BLINK_HZ = 2;

export function portLit(t: number, reduceFlicker: boolean): boolean {
  if (reduceFlicker) return true;
  return Math.floor(t * PORT_BLINK_HZ * 2) % 2 === 0;
}

/** An empty pad's alpha while the board waits: a 0.75 Hz pulse, steady under reduce flicker. */
export function padPulseAlpha(t: number, reduceFlicker: boolean): number {
  if (reduceFlicker) return 1;
  return 0.6 + 0.4 * Math.abs(Math.sin(Math.PI * 0.75 * t));
}

/** The out-port that needs a wire: the gateway's in C1, the balancer's after the rescue. */
export const GATEWAY_OUT: Point = { x: GATEWAY.x + PART_SIZE.gateway.w / 2, y: GATEWAY.y };
export const BALANCER_OUT: Point = { x: LB_SLOT.x + PART_SIZE.balancer.w / 2, y: LB_SLOT.y };

export interface WaitState {
  first: boolean;
  crew: boolean;
  /** Req/s the boxes behind the balancer cover now, and what they must cover (the crew wait). */
  behind: number;
  need: number;
  /** The port blinking (null when nothing waits), and whether it is lit this frame. */
  port: Point | null;
  portLit: boolean;
  /** The blink is on (false under reduce flicker: the port stays lit instead). */
  blinking: boolean;
}

export function emptyWait(): WaitState {
  return {
    first: false,
    crew: false,
    behind: 0,
    need: CREW_NEED,
    port: null,
    portLit: false,
    blinking: false,
  };
}

export interface WaitInput {
  readonly waitingForFirstBuild: boolean;
  readonly waitingForCrewBuild: boolean;
  readonly parts: readonly Part[];
  readonly wires: readonly Wire[];
  readonly dead: readonly string[];
}

/** Refill `out` for this frame and return it; allocates nothing. */
export function waitInto(out: WaitState, f: WaitInput, t: number, reduceFlicker: boolean): WaitState {
  out.first = f.waitingForFirstBuild;
  out.crew = !out.first && f.waitingForCrewBuild;
  out.behind = out.crew ? crewCover(f.parts, f.wires, f.dead) : 0;
  out.need = CREW_NEED;
  out.port = out.first ? GATEWAY_OUT : out.crew ? BALANCER_OUT : null;
  out.blinking = out.port !== null && !reduceFlicker;
  out.portLit = out.port !== null && portLit(t, reduceFlicker);
  return out;
}

/** The crew wait's chip near the balancer: what the boxes behind it cover of what they must. */
export function crewChip(behind: number, need: number): string {
  return `${Math.round(behind)}/${Math.round(need)}`;
}

/** A cube tumbling off a waiting port. */
export interface Tumble {
  active: boolean;
  age: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  spin: number;
}

/** How long a tumbling cube lives, its fall, and the most at once. */
export const TUMBLE_LIFE = 0.9;
export const TUMBLE_GRAVITY = 700;
export const TUMBLE_MAX = 16;

/**
 * The cubes with nowhere to go tumbling off the waiting port: a fixed pool of TUMBLE_MAX slots,
 * launched at `rate` a second on exact multiples of 1/rate (as PacketPool does), each with its own
 * deterministic kick so the spray never repeats in step. Nothing allocates after construction.
 */
export class TumblePool {
  readonly items: Tumble[] = [];
  private owed = 0;
  private launched = 0;

  constructor() {
    for (let i = 0; i < TUMBLE_MAX; i++)
      this.items.push({ active: false, age: 0, x0: 0, y0: 0, vx: 0, vy: 0, spin: 0 });
  }

  get active(): number {
    let n = 0;
    for (let i = 0; i < this.items.length; i++) if (this.items[i].active) n++;
    return n;
  }

  /** Advance by dt; launch from `from` at `rate` cubes a second (0 or a null port launches none). */
  step(dt: number, rate: number, from: Point | null): void {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= TUMBLE_LIFE) p.active = false;
    }
    if (!from || !(rate > 0)) {
      this.owed = 0;
      return;
    }
    this.owed += rate * dt;
    while (this.owed >= 1) {
      this.owed -= 1;
      const age = this.owed / rate;
      if (age < TUMBLE_LIFE) this.launch(from, age);
    }
  }

  /** Where a cube is now, written into `out`; returns its rotation in radians. */
  at(p: Tumble, out: { x: number; y: number }): number {
    out.x = p.x0 + p.vx * p.age;
    out.y = p.y0 + p.vy * p.age + 0.5 * TUMBLE_GRAVITY * p.age * p.age;
    return p.spin * p.age;
  }

  clear(): void {
    for (let i = 0; i < this.items.length; i++) this.items[i].active = false;
    this.owed = 0;
  }

  private launch(from: Point, age: number): void {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.active) continue;
      // A deterministic spread: each launch kicks a little differently.
      const k = (this.launched++ * 0.618034) % 1;
      p.active = true;
      p.age = age;
      p.x0 = from.x;
      p.y0 = from.y;
      p.vx = 40 + 80 * k;
      p.vy = -120 - 90 * ((k * 7) % 1);
      p.spin = (k - 0.5) * 14;
      return;
    }
  }
}
