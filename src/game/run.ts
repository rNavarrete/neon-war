// The live run of Session 0: the one place that holds the sim state while the game plays. Scenes
// read `run` every frame and call its actions; the rules stay pure in src/sim/ (play.ts steps the
// whole session: failures, the rescue, Regroup, rewinds, midnight). Not pure itself: it is the
// boundary between the pure sim and Phaser, and it turns changes in the sim into bus events.

import { type Flow, connect, decommission, disconnect, wireKey } from '../sim/board';
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
import { flickeringParts } from '../sim/failures';
import { capacityOf } from '../sim/board';
import { SERVER_SLOTS, STARTING_PARTS } from '../sim/tick';
import { bus } from './bus';

export type ActionResult = { ok: true } | { ok: false; reason: string };

/** What the player told the game, kept for the HUD and the debrief. */
export interface RunNotes {
  /** The C1 estimate dial, in req/s, once set. */
  estimate: number | null;
  /** The C6 sizing answer, in servers, once set. */
  sizing: number | null;
}

/** Longest step one frame may take, so a stalled tab doesn't jump the sim forward. */
const MAX_FRAME_SECONDS = 0.25;

/** The midnight dip picks its server from this seed, the same way on every replay. */
const SEED = 2026;

export class Run {
  play: Play = createPlay({ slots: SERVER_SLOTS, parts: STARTING_PARTS, seed: SEED });
  notes: RunNotes = { estimate: null, sizing: null };
  /** Why the board is stopped right now (pause menu, job card, a scene); empty while it runs. */
  private holds = new Set<string>();
  private ended = false;

  /** @param speed test-only multiplier from `?test&speed=N`. */
  constructor(readonly speed = 1) {}

  get session() {
    return this.play.session;
  }

  /** Seconds since the clock opened at 23:51:30. Setting it jumps the clock (the cold open hands over at C1). */
  get now(): number {
    return this.play.t;
  }

  set now(t: number) {
    this.play = { ...this.play, t };
  }

  get demand(): number {
    return playDemand(this.play, this.now);
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
    const dt = Math.min(realSeconds, MAX_FRAME_SECONDS) * this.speed;
    if (dt <= 0) return;
    const before = this.play;
    this.play = step(before, dt);
    this.announce(before, this.play);
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
    return this.apply(rewind(this.play), () => {});
  }

  /** In-world clock at `now`, as hh:mm:ss (23:51:30 at 0, 00:00:00 at midnight). */
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
      if (d.part !== null && a.t < d.darkAt && b.t >= d.darkAt) bus.emit('powerDip', { id: d.part });
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

let current = new Run();

/** The run in progress. */
export function run(): Run {
  return current;
}

/** Start a fresh run of Session 0 (Start on the title screen, Restart in pause). */
export function newRun(speed = current.speed): Run {
  current = new Run(speed);
  return current;
}
