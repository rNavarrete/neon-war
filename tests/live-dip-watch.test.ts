import { bestPlay } from '../src/game/autopilot';
import { Run } from '../src/game/run';
import { dismissJobCard, openJobCard } from '../src/scenes/hud/jobCard';
import { upcomingDip } from '../src/scenes/hud/pending503';
import { dipWarningAt } from '../src/scenes/hud/warnings';
import { BROWNOUT } from '../src/sim/brownout';

// Tech follow-up 5: why live-skeleton.spec's 'the power-dip mark sits on its part' sometimes never
// saw the dip. The warning is up for BROWNOUT.powerDip.warningSeconds (2) of sim time, and a frame
// advances the sim by min(frame, 0.25 s) times the test speed. At speed 20 a frame slower than
// 100 ms (headless Chromium under 10 fps) stepped 2 s or more at once and could jump the whole
// warning, so no frame ever drew it. Run.tick now stops its slices on the tick a dip's warning starts
// (as it stops at the rescue), so the warning is on at least one frame at any speed and frame rate,
// and the spec runs at speed 20 again. At speed 7 it was always on even before that.

/** Whether any frame of an autopilot run at `speed` with `ms` frames shows the C4 dip's warning. */
function dipShown(speed: number, ms: number, phase: number): boolean {
  const r = new Run(speed);
  r.autopilot = bestPlay;
  openJobCard(r);
  dismissJobCard(r);
  r.tick(phase);
  for (let i = 0; i < 50_000 && r.now < BROWNOUT.challenges.c4 + 10 && !r.rescued; i++) {
    r.tick(ms / 1000);
    if (dipWarningAt(upcomingDip(r), r.now, true)) return true;
  }
  return false;
}

describe('the dip warning against the frame step', () => {
  it('is a 2 s window', () => {
    expect(BROWNOUT.powerDip.warningSeconds).toBe(2);
  });

  it('is never jumped at speed 20, even when frames take 250 ms (4 fps): Run.tick stops at warnAt', () => {
    const phases = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09];
    const shown = phases.filter((p) => dipShown(20, 250, p)).length;
    expect(shown).toBe(phases.length);
    for (const ms of [33, 100, 1000]) expect(dipShown(20, ms, 0.013), `${ms} ms`).toBe(true);
  });

  it('is always on a frame at speed 7, from 30 fps down to 1 fps', () => {
    for (const ms of [33, 100, 250, 1000])
      for (const p of [0, 0.013, 0.029, 0.041]) expect(dipShown(7, ms, p), `${ms} ms, phase ${p}`).toBe(true);
  });
});
