import { GATE, gateAlpha, gateWanted } from '../src/scenes/titleFx';

// The title's "press any key" gate (Rolando, 30 Oct 2026: the title music must play by default).
// Browsers hold sound until the first press, so the gate takes that press instead of START.
describe('the title gate', () => {
  it('shows while the browser holds sound; under the test hook only when the test asks', () => {
    expect(gateWanted(true)).toBe(true);
    expect(gateWanted(false)).toBe(false);
    expect(gateWanted(true, true)).toBe(false);
    expect(gateWanted(false, true, true)).toBe(true);
  });

  it('breathes between its floor and full, starting full', () => {
    expect(gateAlpha(0)).toBeCloseTo(1, 6);
    expect(gateAlpha(GATE.pulseSeconds / 2)).toBeCloseTo(GATE.minAlpha, 6);
    expect(gateAlpha(GATE.pulseSeconds)).toBeCloseTo(1, 6);
    for (let t = 0; t < 5; t += 0.05) {
      expect(gateAlpha(t)).toBeGreaterThanOrEqual(GATE.minAlpha - 1e-9);
      expect(gateAlpha(t)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('asks for a press in plain words', () => {
    expect(GATE.text).toBe('CLICK OR PRESS ANY KEY');
  });
});
