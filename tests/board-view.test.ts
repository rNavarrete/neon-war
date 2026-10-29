import boardSource from '../src/scenes/BoardScene.ts?raw';
import { SERVER_SLOTS } from '../src/sim/tick';
import { frame, readFrame, resetFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import type { Part } from '../src/sim/board';
import { BROWNOUT } from '../src/sim/brownout';
import { balancerGiven, balancerGivenIn } from '../src/scenes/board/crew';
import { BoardSnapshot } from '../src/scenes/board/snapshot';
import {
  FLICKER_HZ,
  LabelCache,
  type PartTrouble,
  SKIP_TAG_HOLD,
  artFor,
  emptyLook,
  flickerLit,
  loadColour,
  loadLabel,
  partLook,
  partLookInto,
  partTags,
  skipTagUntil,
  tagChip,
} from '../src/scenes/board/view';
import { PART_ART, type PartArtOptions } from '../src/scenes/board/art';

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
  expect(r.placeServer(SERVER_SLOTS[0]).ok).toBe(true);
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
      r.placeServer(SERVER_SLOTS[0]);
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
    expect(r.placeServer(SERVER_SLOTS[0]).ok).toBe(true);
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

describe('part states (board-5)', () => {
  const now = 100;
  const dip = { id: 'surge', part: server.id, warnAt: now - 7, darkAt: now - 5, endsAt: now + 15 };
  const calm: PartTrouble = { dead: [], dark: [], dips: [], overload: {} };

  it('reads a dipped server DARK with its countdown, never DEAD, on unlit (not dead) art', () => {
    const trouble: PartTrouble = { ...calm, dark: [server.id], dips: [dip] };
    const look = partLook(server, 40, [server.id], {}, now, trouble);
    expect(look.status).toBe('dark');
    expect(look.darkLeft).toBeCloseTo(15);
    expect(look.dark).toBe(true);
    expect(look.art).toBe('server');
    expect(partLook(boosted, 0, [server.id], {}, now, trouble).art).toBe('server-overclocked');
    expect(loadLabel(look)).toBe('DARK 15 s');
    expect(loadLabel(look)).not.toMatch(/DEAD/);
    expect(look.warning).toBe(true);
    expect(look.diesIn).toBeNull();
    expect(partTags(look, false)).toEqual(['DARK']);
    expect(loadLabel(partLook(server, 0, [server.id], {}, now + 14.2, trouble))).toBe('DARK 1 s');
  });

  it('reads a cooked server DEAD on the dead art, its DIES IN at 0', () => {
    const look = partLook(server, 0, [server.id], {}, now, { ...calm, dead: [server.id] });
    expect(look.status).toBe('dead');
    expect(look.art).toBe('server-dead');
    expect(loadLabel(look)).toBe('DEAD');
    expect(look.diesIn).toBe(0);
    expect(look.darkLeft).toBeNull();
    expect(partTags(look, false)).toEqual([]);
  });

  it('counts DIES IN down from 8 for a server over 100%, with a red full bar and the triangle', () => {
    const look = partLook(server, 90, [], {}, now, { ...calm, overload: { [server.id]: 3 } });
    expect(look.diesIn).toBeCloseTo(BROWNOUT.overheat.overloadSeconds - 3);
    expect(look.warning).toBe(true);
    expect(look.bar).toBe(1);
    expect(look.barColour).toBe('red');
    expect(partTags(look, false)).toEqual(['DIES IN']);
    expect(tagChip(look)).toBe('DIES IN 5 s');
    expect(tagChip(partLook(server, 90, [], {}, now, { ...calm, overload: { [server.id]: 7.9 } }))).toBe(
      'DIES IN 1 s',
    );
    // Not overloaded (yet): no countdown.
    expect(partLook(server, 90, [], {}, now, calm).diesIn).toBeNull();
  });

  it('runs DIES IN down to 0 on the tick the sim kills the server', () => {
    resetFrame();
    const r = wiredRun();
    const seen: number[] = [];
    let deadLook: ReturnType<typeof partLook> | null = null;
    const id = r.session.board.parts.find((p) => p.kind === 'server')!.id;
    for (let i = 0; i < 4000 && !deadLook; i++) {
      r.tick(0.1);
      const f = readFrame(r);
      const part = f.parts.find((p) => p.id === id)!;
      const trouble: PartTrouble = {
        dead: f.dead,
        dark: f.dark,
        dips: f.dips,
        overload: r.play.heat.overload,
      };
      const look = partLook(part, f.flow.load[id] ?? 0, f.offline, f.offlineUntil, f.now, trouble);
      if (look.status === 'dead') deadLook = look;
      else if (look.diesIn !== null) seen.push(look.diesIn);
    }
    expect(deadLook).not.toBeNull();
    expect(deadLook!.diesIn).toBe(0);
    expect(loadLabel(deadLook!)).toBe('DEAD');
    // The countdown started near 8 and only ever went down, to within a tick of 0.
    expect(seen.length).toBeGreaterThan(10);
    expect(seen[0]).toBeGreaterThan(7.5);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThan(seen[i - 1]);
    expect(seen[seen.length - 1]).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('tags an online server with no load UNFED, and nothing else', () => {
    const idle = partLook(server, 0, [], {}, now, calm);
    expect(idle.unfed).toBe(true);
    expect(partTags(idle, false)).toEqual(['UNFED']);
    expect(tagChip(idle)).toBe('UNFED');
    expect(idle.bar).toBe(0);
    expect(partLook(server, 10, [], {}, now, calm).unfed).toBe(false);
    expect(partLook(server, 0, [server.id], { [server.id]: now + 2 }, now, calm).unfed).toBe(false);
    expect(partLook(gateway, 0, [], {}, now, calm).unfed).toBe(false);
    expect(partLook(database, 0, [], {}, now, calm).unfed).toBe(false);
  });

  it('puts the triangle on the database only over 200 (D2), never on the gateway', () => {
    expect(partLook(database, 150, [], {}, now, calm).warning).toBe(false);
    expect(partLook(database, 200, [], {}, now, calm).warning).toBe(false);
    expect(partLook(database, 250, [], {}, now, calm).warning).toBe(true);
    expect(partLook(gateway, 400, [], {}, now, calm).warning).toBe(false);
    expect(partLook(server, 55, [], {}, now, calm).warning).toBe(false);
  });

  it('fills the bar with load / capacity in cyan, amber and red, and with boot progress in cyan', () => {
    const at = (load: number) => partLook(server, load, [], {}, now, calm);
    expect(at(30)).toMatchObject({ bar: 0.5, barColour: 'cyan' });
    expect(at(54)).toMatchObject({ bar: 0.9, barColour: 'amber' });
    expect(at(120)).toMatchObject({ bar: 1, barColour: 'red' });
    const boot = partLook(server, 0, [server.id], { [server.id]: now + 1.5 }, now, calm);
    expect(boot.bar).toBeCloseTo(1 - 1.5 / BROWNOUT.server.bootSeconds);
    expect(boot.barColour).toBe('cyan');
    expect(partTags(boot, false)).toEqual(['BOOTING']);
    expect(partTags(boot, true)).toEqual(['SKIPPED', 'BOOTING']);
    expect(partLook(server, 0, [server.id], {}, now, { ...calm, dead: [server.id] }).barColour).toBe('grey');
  });

  it('keeps the SKIPPED tag at least 1 s after the skip clears', () => {
    expect(SKIP_TAG_HOLD).toBe(1);
    let until = -Infinity;
    const shown = (t: number) => t < until;
    for (const t of [10, 10.2, 10.4]) {
      until = skipTagUntil(until, true, t);
      expect(shown(t)).toBe(true);
    }
    // The skip clears after 10.4: the tag stays until 11.4.
    for (const t of [10.5, 10.9, 11.3, 11.39]) {
      until = skipTagUntil(until, false, t);
      expect(shown(t)).toBe(true);
    }
    until = skipTagUntil(until, false, 11.41);
    expect(shown(11.41)).toBe(false);
  });

  it('blinks a flickering part at 6 Hz, and never under reduce flicker', () => {
    expect(FLICKER_HZ).toBe(6);
    const samples = Array.from({ length: 60 }, (_, i) => i / 60);
    expect(new Set(samples.map((t) => flickerLit(true, t, false)))).toEqual(new Set([true, false]));
    for (const t of samples) {
      expect(flickerLit(true, t, true)).toBe(true);
      expect(flickerLit(false, t, false)).toBe(true);
    }
  });
});

describe('part state art (board-12)', () => {
  const now = 100;
  const dip = { id: 'surge', part: server.id, warnAt: now - 7, darkAt: now - 5, endsAt: now + 15 };
  const trouble: PartTrouble = { dead: [], dark: [server.id], dips: [dip], overload: {} };
  const all = new Set<string>(Object.values(PART_ART));
  const opts = (o: Partial<PartArtOptions> = {}): PartArtOptions => ({
    t: 0,
    calm: false,
    pinging: false,
    picked: all,
    ...o,
  });
  const balancer: Part = { id: 'lb-1', kind: 'balancer', slot: 'lb' };

  it('partLook with no new arguments returns exactly what it returned before board-12', () => {
    // The look's cases, with and without trouble: the art keys are today's, and with art options
    // whose picked set is empty nothing changes either.
    const cases: [Part, number, string[], Record<string, number>, number, PartTrouble | undefined][] = [
      [server, 30, [], {}, 10, undefined],
      [boosted, 150, [], {}, 10, undefined],
      [server, 30, [server.id], { [server.id]: 13 }, 10.5, undefined],
      [boosted, 30, [server.id], { [server.id]: 13 }, 11, undefined],
      [server, 30, [server.id], {}, 10, undefined],
      [server, 40, [server.id], {}, now, trouble],
      [boosted, 0, [server.id], {}, now, trouble],
      [balancer, 60, [], {}, 10, undefined],
    ];
    const legacy = [
      'server',
      'server-overclocked-hot',
      'server',
      'server-overclocked',
      'server-dead',
      'server',
      'server-overclocked',
      'balancer',
    ];
    for (const [i, [part, load, offline, until, t, tr]] of cases.entries()) {
      const before = partLook(part, load, offline, until, t, tr);
      expect(before.art).toBe(legacy[i]);
      const none = partLook(part, load, offline, until, t, tr, opts({ picked: new Set(), pinging: true }));
      expect({ ...none }).toEqual({ ...before });
    }
  });

  it('a dipped server uses the unlit art when it is picked, the tinted fallback otherwise', () => {
    const look = partLook(server, 40, [server.id], {}, now, trouble, opts());
    expect(look.status).toBe('dark');
    expect(look.art).toBe('board/server-dark');
    // Not picked: today's art, which the board darkens in code (look.dark).
    const fallback = partLook(server, 40, [server.id], {}, now, trouble, opts({ picked: new Set() }));
    expect(fallback.art).toBe('server');
    expect(fallback.dark).toBe(true);
  });

  it('the overclocked server in the surge dip reads dark, not dead: the unlit kit-fitted art', () => {
    const look = partLook(boosted, 0, [server.id], {}, now, trouble, opts());
    expect(look.status).toBe('dark');
    expect(look.art).toBe('board/server-overclocked-dark');
    expect(look.art).not.toMatch(/dead/);
    expect(loadLabel(look)).toBe('DARK 15 s');
    // Rebooting after the kit is the same unlit box; a dead one keeps the dead art.
    expect(partLook(boosted, 0, [server.id], { [server.id]: now + 2 }, now, undefined, opts()).art).toBe(
      'board/server-overclocked-dark',
    );
    const dead: PartTrouble = { ...trouble, dead: [server.id], dark: [] };
    expect(partLook(boosted, 0, [server.id], {}, now, dead, opts()).art).toBe('server-dead');
  });

  it('booting and ping frames alternate in full and never under reduce flicker', () => {
    const until = { [server.id]: now + 2 };
    const bootAt = (t: number, calm: boolean) =>
      partLook(server, 0, [server.id], until, now, undefined, opts({ t, calm })).art;
    const pingAt = (t: number, calm: boolean) =>
      partLook(balancer, 60, [], {}, now, undefined, opts({ t, calm, pinging: true })).art;
    const full = new Set<string>();
    const calmBoot = new Set<string>();
    const fullPing = new Set<string>();
    const calmPing = new Set<string>();
    for (let t = 0; t < 4; t += 1 / 60) {
      full.add(bootAt(t, false));
      calmBoot.add(bootAt(t, true));
      fullPing.add(pingAt(t, false));
      calmPing.add(pingAt(t, true));
    }
    expect([...full].sort()).toEqual(['board/server-booting-a', 'board/server-booting-b']);
    expect([...calmBoot]).toEqual(['board/server-booting-a']);
    expect([...fullPing].sort()).toEqual(['board/balancer-ping-a', 'board/balancer-ping-b']);
    expect([...calmPing]).toEqual(['board/balancer-ping-b']);
    // A balancer with no box to ping keeps its own art.
    expect(partLook(balancer, 60, [], {}, now, undefined, opts()).art).toBe('balancer');
  });
});
