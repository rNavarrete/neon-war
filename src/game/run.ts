// The live run of Session 0: the one place that holds the sim state while the game plays. Scenes
// read `run` every frame and call its actions; the rules stay pure in src/sim/. Not pure itself:
// it is the boundary between the pure sim and Phaser.

import { type Flow, connect, decommission, disconnect, route, wireKey } from '../sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../sim/brownout';
import { demandAt } from '../sim/demand';
import {
  type BannerChoice,
  type Session,
  type SessionResult,
  chooseBanner,
  fitOverclock,
  offlineAt,
  placeServer,
  routeSession,
} from '../sim/economy';
import { brownoutSession, liveCapacity, stepCalm } from '../sim/tick';
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

export class Run {
  session: Session = brownoutSession();
  /** Seconds since the clock opened at 23:51:30. */
  now = 0;
  demand = demandAt(0);
  flow: Flow = route(this.session.board, BROWNOUT_RULES, this.demand);
  /** Why the board is stopped right now (pause menu, job card, a scene); empty while it runs. */
  private holds = new Set<string>();
  /** Slow-motion factor (Regroup sets 0.25); 1 normally. */
  timeScale = 1;
  notes: RunNotes = { estimate: null, sizing: null };

  /** @param speed test-only multiplier from `?test&speed=N`. */
  constructor(readonly speed = 1) {}

  /** True while anything holds the board still. */
  get paused(): boolean {
    return this.holds.size > 0;
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
    const dt = Math.min(realSeconds, MAX_FRAME_SECONDS) * this.speed * this.timeScale;
    if (dt <= 0) return;
    const m = stepCalm(this.session, this.now, dt);
    this.session = m.session;
    this.now = m.now;
    this.demand = m.demand;
    this.flow = m.flow;
  }

  /** Total req/s the live servers can serve right now. */
  get capacity(): number {
    return liveCapacity(this.session, this.now);
  }

  get offline(): string[] {
    return offlineAt(this.session, this.now);
  }

  placeServer(slot: string): ActionResult {
    return this.apply(placeServer(this.session, slot, this.now), () => {
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
    return this.applyBoard(decommission(this.session.board, BROWNOUT_RULES, id), () =>
      bus.emit('action', { type: 'decommission', id, refund: this.session.board.credits - before }),
    );
  }

  overclock(id: string): ActionResult {
    return this.apply(fitOverclock(this.session, id, this.now), () =>
      bus.emit('action', { type: 'overclock', id }),
    );
  }

  chooseBanner(choice: BannerChoice): ActionResult {
    return this.apply(chooseBanner(this.session, choice, this.now), () =>
      bus.emit('action', { type: 'banner', choice }),
    );
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

  private apply(r: SessionResult, after: () => void): ActionResult {
    if (!r.ok) {
      bus.emit('refused', { reason: r.reason });
      return r;
    }
    this.session = r.session;
    this.flow = routeSession(this.session, this.demand, this.now);
    after();
    return { ok: true };
  }

  private applyBoard(r: ReturnType<typeof connect>, after: () => void): ActionResult {
    if (!r.ok) {
      bus.emit('refused', { reason: r.reason });
      return r;
    }
    return this.apply({ ok: true, session: { ...this.session, board: r.board } }, after);
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
