import { bestPlay } from '../src/game/autopilot';
import { SERVER_SLOTS } from '../src/sim/tick';
import { tipTotal } from '../src/sim/tips';
import { Run } from '../src/game/run';
import { BROWNOUT } from '../src/sim/brownout';

const C = BROWNOUT.challenges;

/** Tick a run in 0.1 s frames until its clock reaches `t` (or `limit` frames pass). */
function playTo(r: Run, t: number, limit = 20_000): number {
  let frames = 0;
  while (r.now < t && frames < limit && !r.play.failure) {
    r.tick(0.1);
    frames++;
  }
  return frames;
}

describe('the live run', () => {
  it('holds the C1 clock until a server is wired from the gateway to the database', () => {
    const r = new Run();
    r.now = C.c1;
    for (let i = 0; i < 300; i++) r.tick(0.1);
    expect(r.now).toBe(C.c1);
    expect(r.session.trust).toBe(100);
    expect(r.placeServer(SERVER_SLOTS[0]).ok).toBe(true);
    const id = r.session.board.parts[r.session.board.parts.length - 1].id;
    expect(r.connect('gateway', id).ok).toBe(true);
    r.tick(0.1);
    expect(r.now).toBe(C.c1);
    expect(r.connect(id, 'database').ok).toBe(true);
    r.tick(0.1);
    expect(r.now).toBeCloseTo(C.c1 + 0.1);
  });

  it('plays the whole session with scripted best play: no rewinds, midnight held clean', () => {
    const r = new Run();
    r.autopilot = bestPlay;
    playTo(r, C.c6);
    expect(r.play.failure).toBeNull();
    expect(r.rescued).toBe(true);
    // The economy's ledger, with the viewers' tips (src/sim/tips.ts) on top.
    const beforeMidnight = r.session.board.credits - tipTotal(r.play.tips);
    expect(beforeMidnight).toBeGreaterThan(120);
    expect(beforeMidnight).toBeLessThan(180);
    playTo(r, C.c8);
    expect(r.play.failure).toBeNull();
    expect(r.now).toBeGreaterThanOrEqual(C.c8);
    expect(r.play.rewinds).toEqual([]);
    expect(r.play.midnight).toEqual({ held: true, dropped: 0, servers: 4, waste: false });
    expect(r.debrief.ozzieDebt).toBe(0);
    expect(r.debrief.scaledDown).toBe(true);
    expect(r.session.trust).toBeGreaterThan(0);
  });

  it('waits after the rescue until the servers behind the balancer can carry the tail', () => {
    const r = new Run();
    r.now = C.c1;
    expect(r.placeServer(SERVER_SLOTS[0]).ok).toBe(true);
    const first = r.session.board.parts[r.session.board.parts.length - 1].id;
    r.connect('gateway', first);
    r.connect(first, 'database');
    r.autopilot = (run) => {
      if (run.now >= C.c3 - 20 && !run.rescued) {
        const s = run.session.board.parts.find((p) => p.id === first);
        if (s && s.boost === undefined) run.overclock(first);
      }
    };
    playTo(r, C.c4);
    for (let i = 0; i < 2000 && !r.rescued && !r.play.failure; i++) r.tick(0.1);
    expect(r.play.failure).toBeNull();
    expect(r.rescued).toBe(true);
    r.autopilot = null;
    // A player reading the board for 30 s loses nothing: the clock waits.
    const at = r.now;
    const trust = r.session.trust;
    expect(r.waitingForCrewBuild).toBe(true);
    for (let i = 0; i < 300; i++) r.tick(0.1);
    expect(r.now).toBe(at);
    expect(r.session.trust).toBe(trust);
    expect(trust).toBeGreaterThan(0);
    // One more stock server behind the balancer covers the 120 req/s tail: the clock runs again.
    // Best play racks a third before it does (C5 still has a power dip).
    const lb = r.session.board.parts.find((p) => p.kind === 'balancer')!;
    const rackOne = () => {
      const taken = new Set(r.session.board.parts.map((p) => p.slot));
      const free = SERVER_SLOTS.find((s) => !taken.has(s))!;
      expect(r.placeServer(free).ok).toBe(true);
      const id = r.session.board.parts[r.session.board.parts.length - 1].id;
      expect(r.connect(lb.id, id).ok).toBe(true);
      return id;
    };
    const second = rackOne();
    expect(r.waitingForCrewBuild).toBe(true);
    r.connect(second, 'database');
    expect(r.waitingForCrewBuild).toBe(false);
    r.connect(rackOne(), 'database');
    playTo(r, C.c5);
    expect(r.play.failure).toBeNull();
    expect(r.now).toBeGreaterThanOrEqual(C.c5);
    expect(r.session.trust).toBeGreaterThan(trust);
  });
});
