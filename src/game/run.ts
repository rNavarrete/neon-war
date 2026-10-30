// The live run of Session 0: the one place that holds the sim state while the game plays. Scenes
// read `run` every frame and call its actions; the rules stay pure in src/sim/ (play.ts steps the
// whole session: failures, the rescue, Regroup, rewinds, midnight). Not pure itself: it is the
// boundary between the pure sim and Phaser, and it turns changes in the sim into bus events.

import { type Flow, connect, decommission, disconnect, move, wireKey } from '../sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../sim/brownout';
import { type BannerChoice, placeServer } from '../sim/economy';
import { type DebriefNumbers, type Play, type PlayResult, createPlay, debriefNumbers } from '../sim/play';
import {
  answerBanner,
  cutLaundry,
  decommissionServer,
  offlineParts,
  overclockServer,
  playDemand,
  replaceServer,
  rewind,
  routePlay,
  step,
  useRegroup,
} from '../sim/play';
import { DIP_SCRIPT, blockDemand, dipParts, dipWarnAt, flickeringParts } from '../sim/failures';
import { capacityOf } from '../sim/board';
import { BOARD_SLOTS, STARTING_PARTS } from '../sim/tick';
import { bus } from './bus';

export type ActionResult = { ok: true } | { ok: false; reason: string };

/** Longest step one frame may take, so a stalled tab doesn't jump the sim forward. */
export const MAX_FRAME_SECONDS = 0.25;

/** Longest slice of a frame stepped at once (see tick). */
const MAX_SLICE_SECONDS = 0.5;

/** The midnight dip picks its server from this seed, the same way on every replay. */
const SEED = 2026;

export class Run {
  play: Play = createPlay({ slots: BOARD_SLOTS, parts: STARTING_PARTS, seed: SEED });
  /** Why the board is stopped right now (pause menu, job card, a scene); empty while it runs. */
  private holds = new Set<string>();
  private ended = false;
  /** Set once the player's post-rescue build covers the tail (see waitingForCrewBuild). */
  private crewBuilt = false;

  /** Test-only scripted player (`?test&autopilot`), run before each step. */
  autopilot: ((r: Run) => void) | null = null;

  /** @param speed test-only multiplier from `?test&speed=N`. */
  constructor(readonly speed = 1) {}

  /**
   * True while C1 waits for the player's first build. The clock and the block's demand start only
   * once a server is wired from the gateway through to the database, so reading the job card and
   * dragging the first server can't fail the block before it was ever up.
   */
  get waitingForFirstBuild(): boolean {
    const t = this.now;
    if (t < BROWNOUT.challenges.c1 || t >= BROWNOUT.challenges.c2) return false;
    const { parts, wires } = this.session.board;
    return !parts.some(
      (p) =>
        p.kind === 'server' &&
        wires.some((w) => w.from === 'gateway' && w.to === p.id) &&
        wires.some((w) => w.from === p.id && w.to === 'database'),
    );
  }

  /**
   * True while the board waits for the player's build after the rescue. The crew arrive with trust
   * under 30 and one stock server behind their balancer, against a 120 req/s tail: at speed 1 that is
   * a few seconds before trust runs out, too short to rack and wire anything. So, like C1, the clock
   * waits until the servers wired behind the balancer (booting ones count) can carry the tail. How
   * many to rack is still the player's call; once the tail is covered the clock never waits again.
   */
  get waitingForCrewBuild(): boolean {
    if (this.crewBuilt || !this.rescued || this.now >= BROWNOUT.challenges.c6) return false;
    const { parts, wires } = this.session.board;
    const lb = parts.find((p) => p.kind === 'balancer');
    if (!lb) return true;
    const dead = this.dead;
    const behind = parts
      .filter(
        (p) =>
          p.kind === 'server' &&
          !dead.includes(p.id) &&
          wires.some((w) => w.from === lb.id && w.to === p.id) &&
          wires.some((w) => w.from === p.id && w.to === 'database'),
      )
      .reduce((sum, p) => sum + capacityOf(p, BROWNOUT_RULES), 0);
    return behind < BROWNOUT.demand.tail;
  }

  get session() {
    return this.play.session;
  }

  /** Seconds since the clock opened at 23:54:25. Setting it jumps the clock (the cold open hands over at C1). */
  get now(): number {
    return this.play.t;
  }

  set now(t: number) {
    this.play = { ...this.play, t };
  }

  get demand(): number {
    return playDemand(this.play, this.now);
  }

  /** What the block sends right now before retries: the demand curve, less the laundry cut. */
  get blockDemand(): number {
    return blockDemand(this.now, this.rescued, this.play.laundryCut !== null);
  }

  get flow(): Flow {
    return routePlay(this.play, this.demand, this.now);
  }

  /** Slow-motion factor: 0.25 while Regroup runs, otherwise 1. */
  get timeScale(): number {
    return this.play.regroup.left > 0 ? BROWNOUT.regroup.speed : 1;
  }

  /** True while anything holds the board still, or a failure is waiting for its rewind. */
  get paused(): boolean {
    return this.holds.size > 0 || this.play.failure !== null;
  }

  /** Stop the sim for a reason ('pause', 'job-card', 'scene'...). Holds stack: each is released on its own. */
  hold(reason: string): void {
    this.holds.add(reason);
  }

  release(reason: string): void {
    this.holds.delete(reason);
  }

  /** Advance by one frame of real time (seconds). Does nothing while paused. */
  tick(realSeconds: number): void {
    if (this.paused) return;
    this.autopilot?.(this);
    if (this.waitingForFirstBuild) return;
    if (this.rescued && !this.crewBuilt) {
      if (this.waitingForCrewBuild) return;
      this.crewBuilt = true;
    }
    let left = Math.min(realSeconds, MAX_FRAME_SECONDS) * this.speed;
    const before = this.play;
    // In slices, so a fast test speed stops on the tick the crew arrive, and on the tick a power dip's
    // 2 s warning starts, instead of running on past them: one slow frame at speed 20 (5 sim seconds)
    // would otherwise jump the whole warning, and the frame after shows the part already dark.
    while (left > 0 && !this.play.failure) {
      const warn = nextDipWarn(this.play);
      const toWarn = warn - this.now;
      const slice = Math.min(left, MAX_SLICE_SECONDS, toWarn > 0 ? toWarn : left);
      const wasRescued = this.rescued;
      const dips = this.play.dips.length;
      this.play = step(this.play, slice);
      left -= slice;
      if (!wasRescued && this.rescued) break;
      // Only a warning this slice ran into: a clock set past warnAt (a jump) does not stop the frame.
      if (toWarn > -1e-6 && this.play.dips.length > dips) break;
    }
    if (this.play !== before) this.announce(before, this.play);
  }

  /** Total req/s the live servers can serve right now. */
  get capacity(): number {
    const off = this.offline;
    return this.session.board.parts
      .filter((p) => p.kind === 'server' && !off.includes(p.id))
      .reduce((sum, p) => sum + capacityOf(p, BROWNOUT_RULES), 0);
  }

  /** Parts serving nothing right now: booting, rebooting, dead or dark in a power dip. */
  get offline(): string[] {
    return offlineParts(this.play, this.now);
  }

  /** Parts showing the 2 s power-flicker warning right now. */
  get flickering(): string[] {
    return flickeringParts(this.play.dips, this.now);
  }

  /** Servers that died from overheating and wait to be replaced. */
  get dead(): readonly string[] {
    return this.play.heat.dead;
  }

  get rescued(): boolean {
    return this.play.rescue !== null;
  }

  get debrief(): DebriefNumbers {
    return debriefNumbers(this.play);
  }

  /** Rack a scrap server with its footprint's anchor at `slot` (a cell id). */
  placeServer(slot: string): ActionResult {
    return this.applySession(placeServer(this.session, slot, this.now), () => {
      const parts = this.session.board.parts;
      bus.emit('action', { type: 'place', id: parts[parts.length - 1].id });
    });
  }

  /** Swap a dead server for a fresh one in its slot, on the same wires. */
  replaceServer(id: string): ActionResult {
    return this.apply(replaceServer(this.play, id), () => {
      const parts = this.session.board.parts;
      bus.emit('action', { type: 'place', id: parts[parts.length - 1].id });
    });
  }

  connect(from: string, to: string): ActionResult {
    return this.applyBoard(connect(this.session.board, BROWNOUT_RULES, from, to), () =>
      bus.emit('action', { type: 'wire', from, to }),
    );
  }

  /** Pick a placed part up and set it down with its anchor at `slot`: free, instant, wires kept. */
  move(id: string, slot: string): ActionResult {
    return this.applyBoard(move(this.session.board, id, slot), () =>
      bus.emit('action', { type: 'move', id, slot }),
    );
  }

  cut(from: string, to: string): ActionResult {
    return this.applyBoard(disconnect(this.session.board, from, to), () =>
      bus.emit('action', { type: 'cut', from, to }),
    );
  }

  decommission(id: string): ActionResult {
    const before = this.session.board.credits;
    const done = () =>
      bus.emit('action', { type: 'decommission', id, refund: this.session.board.credits - before });
    const part = this.session.board.parts.find((p) => p.id === id);
    if (part?.kind === 'server') return this.apply(decommissionServer(this.play, id), done);
    return this.applyBoard(decommission(this.session.board, BROWNOUT_RULES, id), done);
  }

  overclock(id: string): ActionResult {
    return this.apply(overclockServer(this.play, id), () => bus.emit('action', { type: 'overclock', id }));
  }

  chooseBanner(choice: BannerChoice): ActionResult {
    return this.apply(answerBanner(this.play, choice), () => bus.emit('action', { type: 'banner', choice }));
  }

  /** Cut the laundry floor loose in the district surge (about 40 req/s less). */
  cutLaundry(): ActionResult {
    return this.apply(cutLaundry(this.play), () => bus.emit('action', { type: 'laundryCut' }));
  }

  /** Spend Regroup's one charge: quarter speed for 10 s. */
  regroup(): ActionResult {
    return this.apply(useRegroup(this.play), () => bus.emit('sfx', { key: 'regroup-slow' }));
  }

  /** After a failure's rewind screen: back to the checkpoint with credits, parts and trust as they were. */
  rewind(): ActionResult {
    this.crewBuilt = false;
    return this.apply(rewind(this.play), () => {});
  }

  /** In-world clock at `now`, as hh:mm:ss (23:54:25 at 0, 00:00:00 at midnight). */
  clock(now = this.now): string {
    const [h, m, s] = BROWNOUT.clock.opensAt.split(':').map(Number);
    const total = (((h * 3600 + m * 60 + s + Math.floor(now)) % 86400) + 86400) % 86400;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  }

  /** Wire key helper re-exported for scenes. */
  static wireKey = wireKey;

  /** Tell the rest of the game what changed in the sim during one step. */
  private announce(a: Play, b: Play): void {
    for (const id of Object.keys(b.heat.overload)) {
      if (!(id in a.heat.overload)) bus.emit('overheat', { id });
    }
    for (const id of b.heat.dead) if (!a.heat.dead.includes(id)) bus.emit('serverDied', { id });
    for (const d of b.dips) {
      if (a.t < d.darkAt && b.t >= d.darkAt) for (const id of dipParts(d)) bus.emit('powerDip', { id });
    }
    if (!a.rescue && b.rescue) bus.emit('crewArrived', { by: b.rescue.by });
    if (!a.failure && b.failure) bus.emit('failure', b.failure);
    if (!a.midnight && b.midnight) bus.emit('midnight', b.midnight);
    if (!this.ended && b.t >= BROWNOUT.challenges.c8) {
      this.ended = true;
      bus.emit('sessionEnd', {});
    }
  }

  private apply(r: PlayResult, after: () => void): ActionResult {
    if (!r.ok) {
      bus.emit('refused', { reason: r.reason });
      return r;
    }
    this.play = r.play;
    after();
    return { ok: true };
  }

  private applySession(r: ReturnType<typeof placeServer>, after: () => void): ActionResult {
    if (this.play.failure) return this.apply({ ok: false, reason: 'the board is rewinding' }, after);
    return this.apply(r.ok ? { ok: true, play: { ...this.play, session: r.session } } : r, after);
  }

  private applyBoard(r: ReturnType<typeof connect>, after: () => void): ActionResult {
    return this.applySession(r.ok ? { ok: true, session: { ...this.session, board: r.board } } : r, after);
  }
}

/** When the next power dip that has not started yet starts its warning (Infinity: none left). */
export function nextDipWarn(play: Play): number {
  let at = Infinity;
  outer: for (const d of DIP_SCRIPT) {
    for (const p of play.dips) if (p.id === d.id) continue outer;
    at = Math.min(at, dipWarnAt(d));
  }
  return at;
}

let current = new Run();

/** The run in progress. */
export function run(): Run {
  return current;
}

/** Start a fresh run of Session 0 (Start on the title screen, Restart in pause). */
export function newRun(speed = current.speed, autopilot = current.autopilot): Run {
  current = new Run(speed);
  current.autopilot = autopilot;
  return current;
}
