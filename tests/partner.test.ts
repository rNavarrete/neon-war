import { connect, createMission, place, runUntilDone, step, type MissionState } from '../src/sim/mission';
import { newLines } from '../src/sim/partner';

function ok(r: ReturnType<typeof place>): MissionState {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe('partner lines', () => {
  it('opens with the intro and nothing else', () => {
    expect(newLines(createMission(), new Set()).map((l) => l.id)).toEqual(['intro']);
  });

  it('never repeats a line that was already said', () => {
    expect(newLines(createMission(), new Set(['intro']))).toEqual([]);
  });

  it('warns about the spike and the database as the mission goes unfixed, then mourns the loss', () => {
    const said = new Set<string>();
    const seen: string[] = [];
    let s = createMission();
    while (s.outcome === 'playing') {
      for (const l of newLines(s, said)) {
        said.add(l.id);
        seen.push(l.id);
      }
      s = step(s, 0.1);
    }
    for (const l of newLines(s, said)) seen.push(l.id);
    expect(seen).toEqual(['intro', 'spike', 'db-hot', 'dropping', 'lost']);
  });

  it('coaches the wiring after a cache is placed, then celebrates the win', () => {
    let s = ok(place(createMission(), 'slot-1', 'cache'));
    const cache = s.nodes.at(-1)!.id;
    expect(newLines(s, new Set(['intro'])).map((l) => l.id)).toEqual(['cache-placed']);
    s = ok(connect(s, 'server-1', cache));
    s = ok(connect(s, 'server-2', cache));
    s = ok(connect(s, cache, 'database'));
    expect(newLines(s, new Set(['intro', 'cache-placed'])).map((l) => l.id)).toEqual(['cache-live']);
    const end = runUntilDone(s);
    expect(newLines(end, new Set(['intro', 'cache-placed', 'cache-live', 'spike'])).at(-1)?.mood).toBe(
      'relieved',
    );
  });
});
