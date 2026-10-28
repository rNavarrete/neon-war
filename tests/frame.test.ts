import { bestPlay } from '../src/game/autopilot';
import { type Frame, frame, liveCapacity, readFrame, resetFrame, wiredCapacity } from '../src/game/frame';
import { Run } from '../src/game/run';
import { BROWNOUT } from '../src/sim/brownout';

const C = BROWNOUT.challenges;

/** Tick a run in 0.1 s frames until its clock reaches `t` (or `limit` frames pass). */
function playTo(r: Run, t: number, limit = 20_000): void {
  for (let n = 0; r.now < t && n < limit && !r.play.failure; n++) r.tick(0.1);
}

/** A run at C1 with one server placed in s1 (unwired), and that server's id. */
function runWithServer(): { r: Run; id: string } {
  const r = new Run();
  r.now = C.c1;
  expect(r.placeServer('s1').ok).toBe(true);
  const parts = r.session.board.parts;
  return { r, id: parts[parts.length - 1].id };
}

beforeEach(() => resetFrame());

describe('frame(run)', () => {
  it('returns the identical snapshot until the sim changes, routing the board only once', () => {
    const r = new Run();
    r.now = C.c1;
    const routing = vi.spyOn(r, 'flow', 'get');
    const a = frame(r);
    expect(routing).toHaveBeenCalledTimes(1);
    const b = frame(r);
    const c = frame(r);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(routing).toHaveBeenCalledTimes(1);
    // A tick that moves nothing (C1 waits for the first build) changes no sim state either.
    r.tick(0.1);
    expect(frame(r)).toBe(a);
    expect(routing).toHaveBeenCalledTimes(1);
  });

  it('reflects a placed server in one refill', () => {
    const r = new Run();
    r.now = C.c1;
    const routing = vi.spyOn(r, 'flow', 'get');
    const before = frame(r);
    expect(before.parts.map((p) => p.id)).toEqual(['gateway', 'database']);
    expect(r.placeServer('s1').ok).toBe(true);
    const after = frame(r);
    expect(after).not.toBe(before);
    expect(routing).toHaveBeenCalledTimes(2);
    expect(after.parts.map((p) => p.kind)).toEqual(['gateway', 'database', 'server']);
    expect(after.parts[2].slot).toBe('s1');
    expect(after.credits).toBe(before.credits - BROWNOUT.server.cost);
    // The new server is booting: offline, counted in capacity once it is up, never wired yet.
    expect(after.offline).toEqual([after.parts[2].id]);
    expect(after.wiredCapacity).toBe(0);
    expect(frame(r)).toBe(after);
    expect(routing).toHaveBeenCalledTimes(2);
  });

  it('refills on a hold, a release, a dial answer and a new run', () => {
    const r = new Run();
    r.now = C.c1;
    const a = frame(r);
    expect(a.paused).toBe(false);
    r.hold('job-card');
    const b = frame(r);
    expect(b).not.toBe(a);
    expect(b.paused).toBe(true);
    r.release('job-card');
    const c = frame(r);
    expect(c).not.toBe(b);
    expect(c.paused).toBe(false);
    r.notes = { ...r.notes, estimate: 30 };
    const d = frame(r);
    expect(d).not.toBe(c);
    expect(d.notes).toEqual({ estimate: 30, sizing: null });
    const other = new Run();
    other.now = C.c1;
    const e = frame(other);
    expect(e).not.toBe(d);
    expect(e.notes).toEqual({ estimate: null, sizing: null });
    // Switching back is a change too: the memo holds one run at a time.
    expect(frame(r)).not.toBe(e);
  });

  it('reads the clock, the demand, the capacity and the waiting flags from the run', () => {
    const { r, id } = runWithServer();
    const f = frame(r);
    expect(f.now).toBe(C.c1);
    expect(f.clock).toBe(r.clock());
    expect(f.speed).toBe(1);
    expect(f.timeScale).toBe(1);
    expect(f.waitingForFirstBuild).toBe(true);
    expect(f.waitingForCrewBuild).toBe(false);
    expect(f.demand).toBe(r.demand);
    expect(f.blockDemand).toBe(r.blockDemand);
    expect(f.capacity).toBe(r.capacity);
    expect(f.trust).toBe(100);
    expect(f.retry).toBe(0);
    expect(f.rescued).toBe(false);
    expect(f.laundryCut).toBeNull();
    expect(f.surge).toBeNull();
    expect(f.fall).toBeNull();
    expect(f.dip).toBeNull();
    expect(f.midnight).toBeNull();
    expect(f.failure).toBeNull();
    expect(f.rewinds).toEqual([]);
    expect(f.dead).toEqual([]);
    expect(f.overheating).toEqual([]);
    expect(f.dark).toEqual([]);
    expect(f.flickering).toEqual([]);
    expect(f.dips).toEqual([]);
    expect(f.regroup).toEqual(r.play.regroup);
    expect(f.banner).toBeNull();
    expect(f.notes).toBe(r.notes);
    expect(f.flow).toEqual(r.flow);
    expect(f.served).toBe(r.flow.served);
    expect(f.dropped).toBe(r.flow.dropped);
    expect(f.errorShare).toBeGreaterThanOrEqual(0);
    expect(f.errorShare).toBeLessThanOrEqual(1);

    // Wire it in: the clock runs, and once the server boots the wired capacity is its 60.
    expect(r.connect('gateway', id).ok).toBe(true);
    expect(r.connect(id, 'database').ok).toBe(true);
    const wired = frame(r);
    expect(wired.wires).toEqual([
      { from: 'gateway', to: id },
      { from: id, to: 'database' },
    ]);
    expect(wired.waitingForFirstBuild).toBe(false);
    expect(wired.wiredCapacity).toBe(0);
    playTo(r, C.c1 + BROWNOUT.server.bootSeconds + 0.5);
    const up = frame(r);
    expect(up.offline).toEqual([]);
    expect(up.capacity).toBe(BROWNOUT.server.capacity);
    expect(up.wiredCapacity).toBe(BROWNOUT.server.capacity);
    expect(up.served).toBeGreaterThan(0);
    expect(up.dropped).toBeCloseTo(0, 6);
    expect(up.errorShare).toBeCloseTo(0, 6);
    expect(up.now).toBeGreaterThan(C.c1 + BROWNOUT.server.bootSeconds);
    expect(up.clock).toBe(r.clock());
  });

  it('counts wired capacity only for servers fed from the gateway (or its balancer) and wired to the database', () => {
    const parts = [
      { id: 'gateway', kind: 'gateway', slot: null },
      { id: 'database', kind: 'database', slot: null },
      { id: 'lb', kind: 'balancer', slot: 'lb' },
      { id: 's-a', kind: 'server', slot: 's1' },
      { id: 's-b', kind: 'server', slot: 's2', boost: 1.5 },
      { id: 's-c', kind: 'server', slot: 's3' },
      { id: 's-d', kind: 'server', slot: 's4' },
    ] as const;
    const cap = BROWNOUT.server.capacity;
    // s-a straight from the gateway; s-b behind a fed balancer, overclocked; s-c fed but not wired on;
    // s-d wired on but fed by nothing.
    const wires = [
      { from: 'gateway', to: 's-a' },
      { from: 's-a', to: 'database' },
      { from: 'gateway', to: 'lb' },
      { from: 'lb', to: 's-b' },
      { from: 's-b', to: 'database' },
      { from: 'lb', to: 's-c' },
      { from: 's-d', to: 'database' },
    ];
    expect(wiredCapacity(parts, wires, [])).toBe(cap + cap * 1.5);
    expect(wiredCapacity(parts, wires, ['s-a'])).toBe(cap * 1.5);
    // A balancer nothing feeds carries nothing through.
    const unfed = wires.filter((w) => !(w.from === 'gateway' && w.to === 'lb'));
    expect(wiredCapacity(parts, unfed, [])).toBe(cap);
    expect(wiredCapacity(parts, [], [])).toBe(0);
  });

  it('is a plain read: readFrame gives equal fields to frame, and never the memo', () => {
    const { r } = runWithServer();
    const memoised = frame(r);
    const plain = readFrame(r);
    expect(plain).not.toBe(memoised);
    expect(plain).toEqual(memoised);
  });

  it('sees the rescue, the dips and midnight through a best-play session', () => {
    const r = new Run();
    r.autopilot = bestPlay;
    let sawDip: Frame | null = null;
    let sawDark: Frame | null = null;
    let sawSurge: Frame | null = null;
    for (let n = 0; r.now < C.c7 && n < 20_000 && !r.play.failure; n++) {
      r.tick(0.1);
      const f = frame(r);
      if (!sawDip && f.dip) sawDip = f;
      if (!sawDark && f.dark.length > 0) sawDark = f;
      if (!sawSurge && f.surge) sawSurge = f;
    }
    const f = frame(r);
    expect(f.rescued).toBe(true);
    expect(f.rescue?.at).toBeGreaterThan(C.c4);
    expect(f.crewMet).toBe(true);
    expect(f.midnight).toEqual({ held: true, dropped: 0, servers: 4, waste: false });
    expect(f.rewinds).toEqual([]);
    expect(f.dips.length).toBeGreaterThan(0);
    expect(sawSurge?.surge?.surge.startsAt).toBe(C.c3);
    expect(sawDip?.dip?.partId).toMatch(/^server-/);
    expect(sawDip?.flickering).toEqual([sawDip?.dip?.partId]);
    expect(sawDark?.dark).toEqual([sawDip?.dip?.partId]);
    expect(sawDark?.offline).toContain(sawDip?.dip?.partId);
    expect(sawDark!.now).toBeGreaterThanOrEqual(sawDip!.dip!.at);
  });
});

describe('frame overload and capacity (M2 follow-up)', () => {
  it('reads run().offline once per refill and works capacity out from it, equal to the run’s', () => {
    const r = new Run();
    r.autopilot = bestPlay;
    const offline = vi.spyOn(r, 'offline', 'get');
    const capacity = vi.spyOn(r, 'capacity', 'get');
    let checked = 0;
    for (let n = 0; r.now < C.c7 && n < 20_000 && !r.play.failure; n++) {
      r.tick(0.1);
      if (n % 25 !== 0) continue;
      offline.mockClear();
      capacity.mockClear();
      const f = readFrame(r);
      expect(offline).toHaveBeenCalledTimes(1);
      expect(capacity).not.toHaveBeenCalled();
      // The spy calls through: the run's own getter gives the same number.
      expect(f.capacity).toBe(r.capacity);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    expect(liveCapacity([], [])).toBe(0);
  });

  it('carries play.heat.overload as overload, its keys as overheating', () => {
    const { r, id } = runWithServer();
    expect(readFrame(r).overload).toEqual({});
    r.play = { ...r.play, heat: { overload: { [id]: 3.5 }, dead: [] } };
    const f = readFrame(r);
    expect(f.overload).toBe(r.play.heat.overload);
    expect(f.overload).toEqual({ [id]: 3.5 });
    expect(f.overheating).toEqual([id]);
  });
});
