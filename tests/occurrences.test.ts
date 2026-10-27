import { bestPlay } from '../src/game/autopilot';
import { type Frame, frame, resetFrame } from '../src/game/frame';
import {
  NO_OCCURRENCES,
  OCCURRENCE_KINDS,
  type Occurrence,
  detectOccurrences,
} from '../src/game/occurrences';
import { Run } from '../src/game/run';
import { BROWNOUT } from '../src/sim/brownout';

const C = BROWNOUT.challenges;

/** A frame at C1 with the board empty, as a base to build edges on by hand. */
function base(): Frame {
  const r = new Run();
  r.now = C.c1;
  return frame(r);
}

const kinds = (list: readonly Occurrence[]) => list.map((o) => o.kind);

beforeEach(() => resetFrame());

describe('detectOccurrences', () => {
  it('lists the thirteen kinds of the contract', () => {
    expect(OCCURRENCE_KINDS).toEqual([
      'placed',
      'wired',
      'cut',
      'hot',
      'died',
      'dip',
      'skipped',
      'retriesRising',
      'laundryCut',
      'rescued',
      'held',
      'dark',
      'fall',
    ]);
  });

  it('gives an empty list for identical frames, no previous frame, or a quiet tick', () => {
    const f = base();
    expect(detectOccurrences(f, f)).toEqual([]);
    expect(detectOccurrences(null, f)).toEqual([]);
    expect(detectOccurrences(f, f)).toBe(NO_OCCURRENCES);
    expect(detectOccurrences(f, { ...f })).toEqual([]);
    const r = new Run();
    r.now = C.c1;
    const a = frame(r);
    r.hold('x');
    const b = frame(r);
    expect(b).not.toBe(a);
    expect(detectOccurrences(a, b)).toEqual([]);
  });

  it('reuses the array it is given and empties it first', () => {
    const f = base();
    const out: Occurrence[] = [{ kind: 'fall', at: 0 }];
    expect(detectOccurrences(f, f, out)).toBe(out);
    expect(out).toEqual([]);
    const placed = { ...f, parts: [...f.parts, { id: 'server-1', kind: 'server' as const, slot: 's1' }] };
    expect(detectOccurrences(f, placed, out)).toBe(out);
    expect(out).toEqual([{ kind: 'placed', id: 'server-1', at: f.now }]);
    expect(detectOccurrences(placed, placed, out)).toBe(out);
    expect(out).toEqual([]);
  });

  it('sees a server placed, wired in and cut through the run', () => {
    const r = new Run();
    r.now = C.c1;
    const empty = frame(r);
    expect(r.placeServer('s1').ok).toBe(true);
    const id = r.session.board.parts[r.session.board.parts.length - 1].id;
    const placed = frame(r);
    expect(detectOccurrences(empty, placed)).toEqual([{ kind: 'placed', id, at: C.c1 }]);
    expect(r.connect('gateway', id).ok).toBe(true);
    expect(r.connect(id, 'database').ok).toBe(true);
    const wired = frame(r);
    expect(detectOccurrences(placed, wired)).toEqual([
      { kind: 'wired', id: `gateway>${id}`, at: C.c1 },
      { kind: 'wired', id: `${id}>database`, at: C.c1 },
    ]);
    // Skipping a frame loses nothing: the edges are between whatever two frames are compared.
    expect(kinds(detectOccurrences(empty, wired))).toEqual(['placed', 'wired', 'wired']);
    expect(r.cut('gateway', id).ok).toBe(true);
    const cut = frame(r);
    expect(detectOccurrences(wired, cut)).toEqual([{ kind: 'cut', id: `gateway>${id}`, at: C.c1 }]);
    // Decommissioning takes the part and its last wire, but is not a 'placed' and the part has no kind of its own.
    expect(r.decommission(id).ok).toBe(true);
    expect(detectOccurrences(cut, frame(r))).toEqual([{ kind: 'cut', id: `${id}>database`, at: C.c1 }]);
  });

  it('sees heat, dips, skips, retries, the cut, the rescue and the fall as edges', () => {
    const f = base();
    const at = f.now;
    const edge = (next: Partial<Frame>) => detectOccurrences(f, { ...f, ...next });
    expect(edge({ overheating: ['server-1'] })).toEqual([{ kind: 'hot', id: 'server-1', at }]);
    expect(edge({ dead: ['server-1'] })).toEqual([{ kind: 'died', id: 'server-1', at }]);
    expect(edge({ dip: { partId: 'server-2', at: at + 2 } })).toEqual([{ kind: 'dip', id: 'server-2', at }]);
    expect(edge({ flow: { ...f.flow, skipped: ['lb>server-3'] } })).toEqual([
      { kind: 'skipped', id: 'lb>server-3', at },
    ]);
    expect(edge({ retry: 0.01 })).toEqual([{ kind: 'retriesRising', at }]);
    expect(edge({ laundryCut: { at } })).toEqual([{ kind: 'laundryCut', at }]);
    expect(edge({ rescued: true, rescue: { at, by: 'time' } })).toEqual([{ kind: 'rescued', at }]);
    expect(edge({ dark: ['server-2'] })).toEqual([{ kind: 'dark', id: 'server-2', at }]);
    expect(edge({ fall: { demand: 40 } })).toEqual([{ kind: 'fall', at }]);
    // Something already true in the previous frame is no edge; its end is no edge either.
    const hot = { ...f, overheating: ['server-1'], retry: 0.2, dip: { partId: 's', at: at + 1 } };
    expect(detectOccurrences(hot, { ...hot })).toEqual([]);
    expect(detectOccurrences(hot, { ...hot, retry: 0.3 })).toEqual([]);
    expect(detectOccurrences(hot, f)).toEqual([]);
    // Retries that fall back to zero and rise again are a new edge; a new dip on the same part too.
    expect(detectOccurrences({ ...hot, retry: 0 }, hot)).toEqual([{ kind: 'retriesRising', at }]);
    expect(detectOccurrences(hot, { ...hot, dip: { partId: 's', at: at + 9 } })).toEqual([
      { kind: 'dip', id: 's', at },
    ]);
  });

  it('calls midnight held or dark, and keeps the fixed order when several things happen at once', () => {
    const f = base();
    const at = f.now;
    const held = { held: true, dropped: 0, servers: 4, waste: false };
    expect(detectOccurrences(f, { ...f, midnight: held })).toEqual([{ kind: 'held', at }]);
    expect(detectOccurrences(f, { ...f, midnight: { ...held, held: false, dropped: 30 } })).toEqual([
      { kind: 'dark', at },
    ]);
    const busy = {
      ...f,
      parts: [...f.parts, { id: 'server-9', kind: 'server' as const, slot: 's1' }],
      wires: [{ from: 'gateway', to: 'server-9' }],
      overheating: ['server-1'],
      dead: ['server-1'],
      dip: { partId: 'server-2', at: at + 2 },
      flow: { ...f.flow, skipped: ['lb>server-3'] },
      retry: 0.1,
      laundryCut: { at },
      rescued: true,
      midnight: held,
      dark: ['server-2'],
      fall: { demand: 40 },
    };
    expect(kinds(detectOccurrences(f, busy))).toEqual([
      'placed',
      'wired',
      'hot',
      'died',
      'dip',
      'skipped',
      'retriesRising',
      'laundryCut',
      'rescued',
      'held',
      'dark',
      'fall',
    ]);
    // Deterministic: the same two frames give the same list again.
    expect(detectOccurrences(f, busy)).toEqual(detectOccurrences(f, busy));
  });

  it('streams the whole best-play session the same way every time', () => {
    const play = (): Occurrence[] => {
      resetFrame();
      const r = new Run();
      r.autopilot = bestPlay;
      const seen: Occurrence[] = [];
      let prev = frame(r);
      for (let n = 0; r.now < C.c8 && n < 20_000 && !r.play.failure; n++) {
        r.tick(0.1);
        const next = frame(r);
        for (const o of detectOccurrences(prev, next)) seen.push(o);
        prev = next;
      }
      expect(r.play.failure).toBeNull();
      return seen;
    };
    const first = play();
    expect(play()).toEqual(first);
    const of = (kind: Occurrence['kind']) => first.filter((o) => o.kind === kind);
    // Best play: one server in C1, three behind the balancer after the rescue, four before midnight.
    expect(of('placed').length).toBeGreaterThanOrEqual(4);
    expect(of('wired').length).toBeGreaterThanOrEqual(of('placed').length);
    expect(of('cut').length).toBeGreaterThan(0);
    expect(of('rescued')).toHaveLength(1);
    expect(of('rescued')[0].at).toBeGreaterThan(C.c4);
    expect(of('rescued')[0].at).toBeLessThanOrEqual(C.c5 + 1);
    expect(of('held')).toHaveLength(1);
    expect(of('held')[0].at).toBeGreaterThanOrEqual(BROWNOUT.clock.midnight);
    expect(of('fall')).toHaveLength(1);
    expect(of('dip').length).toBeGreaterThan(0);
    expect(of('dark').length).toBe(of('dip').length);
    for (const d of of('dark')) expect(d.id).toMatch(/^server-/);
    expect(of('retriesRising').length).toBeGreaterThan(0);
    expect(of('died')).toEqual([]);
    expect(of('laundryCut')).toEqual([]);
    // Every occurrence is stamped with a sim time that never runs backwards.
    for (let i = 1; i < first.length; i++) expect(first[i].at).toBeGreaterThanOrEqual(first[i - 1].at);
  });
});
