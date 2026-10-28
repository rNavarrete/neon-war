import { bestPlay } from '../src/game/autopilot';
import { Run, nextDipWarn } from '../src/game/run';
import { DIP_SCRIPT, dipWarnAt } from '../src/sim/failures';

// Run.tick stops its slices on the tick a power dip's 2 s warning starts, as it stops at the rescue,
// so one slow frame at speed 20 (0.25 s x 20 = 5 sim seconds) can never jump the whole warning.

const WARN = DIP_SCRIPT.map((d) => ({ id: d.id, warnAt: dipWarnAt(d), darkAt: d.darkAt }));

/** A speed-20 autopilot run ticked in small frames until its clock is within `lead` of `t`. */
function runTo(t: number, lead: number): Run {
  const r = new Run(20);
  r.autopilot = bestPlay;
  let frames = 0;
  while (r.now < t - lead && frames < 200_000 && !r.play.failure) {
    r.tick(0.004);
    frames++;
  }
  expect(r.play.failure).toBeNull();
  expect(r.now).toBeLessThan(t);
  return r;
}

describe('Run.tick stops at a dip warning', () => {
  it('knows the next dip warning that has not started', () => {
    const r = new Run();
    expect(nextDipWarn(r.play)).toBe(Math.min(...WARN.map((w) => w.warnAt)));
  });

  for (const w of WARN) {
    it(`a 5 s frame at speed 20 stops on the ${w.id} dip's warnAt, with the part flickering, not dark`, () => {
      const r = runTo(w.warnAt, 1);
      expect(r.flickering).toEqual([]);
      // One slow frame: 0.25 s real at speed 20 would be 5 sim seconds, past darkAt (warnAt + 2).
      r.tick(0.25);
      expect(r.now).toBeCloseTo(w.warnAt, 6);
      const dip = r.play.dips.find((d) => d.id === w.id);
      expect(dip?.part, 'the dip picked a part').toMatch(/^server-/);
      expect(r.flickering).toEqual([dip!.part]);
      expect(r.offline).not.toContain(dip!.part);
      expect(r.now).toBeLessThan(w.darkAt);
      // The next frame runs on as before: no further stop until the next warning.
      const next = nextDipWarn(r.play);
      expect(next).toBeGreaterThan(r.now);
      const before = r.now;
      r.tick(0.05);
      expect(r.now).toBeCloseTo(before + 1, 6);
      expect(r.flickering).toEqual([dip!.part]);
    });
  }

  it('a frame that crosses no warning steps its whole length', () => {
    const r = runTo(WARN[0].warnAt, 30);
    const before = r.now;
    r.tick(0.25);
    expect(r.now).toBeCloseTo(before + 5, 6);
  });
});
