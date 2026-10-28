import boardSource from '../src/scenes/BoardScene.ts?raw';
import { frame, readFrame, resetFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import type { Part } from '../src/sim/board';
import { BROWNOUT } from '../src/sim/brownout';
import { balancerGiven, balancerGivenIn } from '../src/scenes/board/crew';
import { BoardSnapshot } from '../src/scenes/board/snapshot';
import {
  LabelCache,
  artFor,
  emptyLook,
  loadColour,
  loadLabel,
  partLook,
  partLookInto,
} from '../src/scenes/board/view';

const server: Part = { id: 'server-p1', kind: 'server', slot: 's1' };
const boosted: Part = { ...server, boost: 2 };
const gateway: Part = { id: 'gateway', kind: 'gateway', slot: null };
const database: Part = { id: 'database', kind: 'database', slot: null };

describe('part look', () => {
  it('shows load as a share of capacity', () => {
    const look = partLook(server, 30, [], {}, 10);
    expect(look.status).toBe('online');
    expect(look.capacity).toBe(BROWNOUT.server.capacity);
    expect(look.share).toBeCloseTo(0.5);
    expect(loadLabel(look)).toBe('30/60 · 50%');
    expect(partLook(database, 30, [], {}, 10).share).toBeCloseTo(30 / BROWNOUT.database.capacity);
  });

  it('gives the gateway no limit', () => {
    const look = partLook(gateway, 30, [], {}, 10);
    expect(look.capacity).toBeNull();
    expect(look.share).toBeNull();
    expect(loadLabel(look)).toBe('30 req/s');
  });

  it('counts an overclocked server at 120 req/s and draws the kit', () => {
    const look = partLook(boosted, 90, [], {}, 10);
    expect(look.capacity).toBe(120);
    expect(look.art).toBe('server-overclocked');
  });

  it('shows a booting server dark with its seconds left, then a rebooting one after the kit', () => {
    const boot = partLook(server, 30, [server.id], { [server.id]: 13 }, 10.5);
    expect(boot.status).toBe('booting');
    expect(boot.left).toBeCloseTo(2.5);
    expect(boot.dark).toBe(true);
    expect(loadLabel(boot)).toBe('BOOTING 2.5s');
    const reboot = partLook(boosted, 30, [server.id], { [server.id]: 13 }, 11);
    expect(reboot.status).toBe('rebooting');
    expect(loadLabel(reboot)).toBe('REBOOTING 2.0s');
  });

  it('shows a server that is offline for another reason as dead and dark', () => {
    const look = partLook(server, 30, [server.id], {}, 10);
    expect(look.status).toBe('offline');
    expect(look.art).toBe('server-dead');
    expect(look.dark).toBe(true);
    expect(loadLabel(look)).toBe('OFFLINE');
  });

  it('runs hot past 100%', () => {
    expect(partLook(server, 90, [], {}, 10).art).toBe('server-hot');
    expect(partLook(boosted, 150, [], {}, 10).art).toBe('server-overclocked-hot');
    expect(partLook(database, 375, [], {}, 10).art).toBe('database-hot');
    expect(artFor(server, false)).toBe('server');
    expect(loadColour(partLook(server, 30, [], {}, 10))).toBe('#2de2e6');
    expect(loadColour(partLook(server, 55, [], {}, 10))).toBe('#ffb02e');
    expect(loadColour(partLook(server, 90, [], {}, 10))).toBe('#ff4d5e');
  });
});

describe('part look reuse (board-3)', () => {
  it('refills one object in place and agrees with partLook', () => {
    const out = emptyLook();
    const cases: [Part, number, string[], Record<string, number>, number][] = [
      [server, 30, [], {}, 10],
      [boosted, 150, [], {}, 10],
      [server, 30, [server.id], { [server.id]: 13 }, 10.5],
      [boosted, 30, [server.id], { [server.id]: 13 }, 11],
      [server, 30, [server.id], {}, 10],
      [gateway, 30, [], {}, 10],
      [database, 375, [], {}, 10],
    ];
    for (const [part, load, offline, until, now] of cases) {
      const look = partLookInto(out, part, load, offline, until, now);
      expect(look).toBe(out);
      expect({ ...look }).toEqual(partLook(part, load, offline, until, now));
    }
  });

  it('rebuilds the readout only when what it shows changes', () => {
    const cache = new LabelCache();
    const look = emptyLook();
    expect(cache.update(partLookInto(look, server, 30, [], {}, 10))).toBe(true);
    expect(cache.text).toBe('30/60 · 50%');
    expect(cache.colour).toBe('#2de2e6');
    // The same whole req/s and percent: nothing to rebuild.
    expect(cache.update(partLookInto(look, server, 30.2, [], {}, 10))).toBe(false);
    expect(cache.text).toBe('30/60 · 50%');
    expect(cache.update(partLookInto(look, server, 31, [], {}, 10))).toBe(true);
    expect(cache.text).toBe(loadLabel(look));
    // Crossing into amber and red changes the colour as well as the text.
    expect(cache.update(partLookInto(look, server, 55, [], {}, 10))).toBe(true);
    expect(cache.colour).toBe('#ffb02e');
    expect(cache.update(partLookInto(look, server, 90, [], {}, 10))).toBe(true);
    expect(cache.colour).toBe('#ff4d5e');
    // A boot counts down in tenths of a second.
    expect(cache.update(partLookInto(look, server, 0, [server.id], { [server.id]: 13 }, 10.5))).toBe(true);
    expect(cache.text).toBe('BOOTING 2.5s');
    expect(cache.update(partLookInto(look, server, 0, [server.id], { [server.id]: 13 }, 10.51))).toBe(false);
    expect(cache.update(partLookInto(look, server, 0, [server.id], { [server.id]: 13 }, 10.6))).toBe(true);
    expect(cache.text).toBe('BOOTING 2.4s');
    expect(cache.colour).toBe(loadColour(look));
  });

  it('tells whether the balancer is given from the frame, as balancerGiven does from the run', () => {
    const r = new Run();
    expect(balancerGivenIn(r.rescued, r.session.board.parts)).toBe(balancerGiven(r));
    expect(balancerGivenIn(false, [gateway, database])).toBe(false);
    expect(balancerGivenIn(true, [gateway, database])).toBe(true);
    expect(balancerGivenIn(false, [gateway, { id: 'lb', kind: 'balancer', slot: 'lb' }])).toBe(true);
  });
});

/** A run at C1 with a server wired gateway -> server -> database, so the clock runs. */
function wiredRun(): Run {
  const r = new Run();
  r.now = BROWNOUT.challenges.c1;
  expect(r.placeServer('s1').ok).toBe(true);
  const id = r.session.board.parts[r.session.board.parts.length - 1].id;
  expect(r.connect('gateway', id).ok).toBe(true);
  expect(r.connect(id, 'database').ok).toBe(true);
  return r;
}

/** What BoardScene's sync reads from a frame: every field it draws from, nothing from the run. */
function useLikeTheBoard(snap: BoardSnapshot, r: Run): number {
  const f = snap.next(r);
  const look = emptyLook();
  let sum = f.demand + f.credits + f.now;
  for (const part of f.parts) {
    partLookInto(look, part, f.flow.load[part.id] ?? 0, f.offline, f.offlineUntil, f.now);
    sum += look.load;
  }
  for (const key in f.flow.wires) sum += f.flow.wires[key];
  return sum + f.flow.skipped.length;
}

describe('the board reads the run once per frame (board-3)', () => {
  beforeEach(() => resetFrame());

  it('reads run().flow at most once per frame, and run().offline only through frame()', () => {
    const r = wiredRun();
    // How many times one read of the frame touches run().offline (capacity reads it as well).
    const probe = vi.spyOn(r, 'offline', 'get');
    readFrame(r);
    const offlinePerRead = probe.mock.calls.length;
    probe.mockRestore();
    expect(offlinePerRead).toBeGreaterThan(0);

    const flow = vi.spyOn(r, 'flow', 'get');
    const offline = vi.spyOn(r, 'offline', 'get');
    const snap = new BoardSnapshot();
    const frames = 120;
    for (let i = 0; i < frames; i++) {
      r.tick(1 / 60);
      useLikeTheBoard(snap, r);
      // A second look in the same frame (another view, the HUD) reads nothing more.
      expect(frame(r)).toBe(snap.current);
      expect(snap.readAt).toBe(snap.count);
    }
    expect(snap.count).toBe(frames);
    expect(flow.mock.calls.length).toBeLessThanOrEqual(frames);
    expect(flow.mock.calls.length).toBe(snap.changes);
    expect(offline.mock.calls.length).toBe(snap.changes * offlinePerRead);
  });

  it('reads nothing while the sim stands still', () => {
    const r = new Run();
    r.now = BROWNOUT.challenges.c1; // C1 waits for the first build: the clock holds
    const snap = new BoardSnapshot();
    useLikeTheBoard(snap, r);
    const flow = vi.spyOn(r, 'flow', 'get');
    for (let i = 0; i < 30; i++) {
      r.tick(1 / 60);
      useLikeTheBoard(snap, r);
    }
    expect(flow).not.toHaveBeenCalled();
    expect(snap.count).toBe(31);
    expect(snap.changes).toBe(1);
    expect(snap.readAt).toBe(snap.count);
  });

  it('forgets everything on reset', () => {
    const snap = new BoardSnapshot();
    snap.next(new Run());
    snap.reset();
    expect(snap).toMatchObject({ count: 0, readAt: 0, changes: 0, current: null });
  });
});

/** The body of a method or arrow in BoardScene.ts, from its first `{` to the matching `}`. */
function bodyOf(head: string): string {
  const start = boardSource.indexOf(head);
  expect(start, head).toBeGreaterThanOrEqual(0);
  const open = boardSource.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < boardSource.length; i++) {
    if (boardSource[i] === '{') depth++;
    else if (boardSource[i] === '}' && --depth === 0) return boardSource.slice(open, i + 1);
  }
  throw new Error(`unbalanced ${head}`);
}

describe('BoardScene source (board-3, the review grep)', () => {
  // Comments may name run().flow; only code counts.
  const code = boardSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('never reads run().flow or run().offline itself: everything comes from the one Frame', () => {
    expect(code.match(/\b(?:r|run\(\))\s*\.\s*(?:flow|offline)\b/g) ?? []).toEqual([]);
    expect(code.match(/session\.offlineUntil/g) ?? []).toEqual([]);
    // One read per sync, at its top.
    expect(code.match(/this\.snap\.next\(/g)).toHaveLength(1);
    expect(bodyOf('private syncBoard(')).toContain('this.snap.next(run())');
  });

  it('allocates no closure per frame in the sync, stepPackets or travelOf (INBOUND.find gone)', () => {
    expect(code).not.toContain('INBOUND.find');
    const travelOf = code.slice(
      code.indexOf('private readonly travelOf'),
      code.indexOf('private readonly sweepView'),
    );
    expect(travelOf).not.toMatch(/\.(find|some|filter|map)\(/);
    expect((travelOf.match(/=>/g) ?? []).length).toBe(1); // the arrow itself, made once with the scene
    for (const head of [
      'private stepPackets(',
      'private syncBoard(',
      'private drawWires(',
      'private placeButtons(',
    ]) {
      const body = bodyOf(head);
      expect(body, head).not.toMatch(/=>/);
      expect(body, head).not.toMatch(/\.(find|some|filter|map|flatMap)\(/);
      expect(body, head).not.toMatch(/for \(const \[/);
      expect(body, head).not.toMatch(/\bpartLook\(/);
      expect(body, head).not.toMatch(/\bdelete\b/);
    }
  });
});

describe('test speed', () => {
  it('runs the sim N times faster under ?test&speed=N', () => {
    const fast = new Run(20);
    const normal = new Run(1);
    // Each with a server wired gateway -> server -> database, so C1 doesn't wait for a first build.
    for (const r of [fast, normal]) {
      r.placeServer('s1');
      const id = r.session.board.parts[r.session.board.parts.length - 1].id;
      r.connect('gateway', id);
      r.connect(id, 'database');
    }
    for (let i = 0; i < 60; i++) {
      fast.tick(1 / 60);
      normal.tick(1 / 60);
    }
    expect(normal.now).toBeCloseTo(1);
    expect(fast.now).toBeCloseTo(20);
  });

  it('reaches C3 in under 30 s of real time at speed 20', () => {
    const r = new Run(20);
    // A server wired gateway -> server -> database keeps the block up, so nothing fails and rewinds.
    expect(r.placeServer('s1').ok).toBe(true);
    const id = r.session.board.parts[r.session.board.parts.length - 1].id;
    expect(r.connect('gateway', id).ok).toBe(true);
    expect(r.connect(id, 'database').ok).toBe(true);
    let real = 0;
    while (r.now < BROWNOUT.challenges.c3 && real < 60) {
      r.tick(1 / 60);
      real += 1 / 60;
    }
    expect(r.play.failure).toBeNull();
    expect(r.now).toBeGreaterThanOrEqual(BROWNOUT.challenges.c3);
    expect(real).toBeLessThan(30);
  });
});
