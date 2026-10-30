import { ATTRACT_IDLE_S, attractDue } from '../src/scenes/opening';
import { attractSeconds } from '../src/testHook';

describe('the anime opening', () => {
  it('plays after 20 s idle on the title', () => {
    expect(ATTRACT_IDLE_S).toBe(20);
  });

  it('attract mode is due once the title has idled for the limit, and never when off', () => {
    expect(attractDue(0, ATTRACT_IDLE_S - 0.1, ATTRACT_IDLE_S)).toBe(false);
    expect(attractDue(0, ATTRACT_IDLE_S, ATTRACT_IDLE_S)).toBe(true);
    // Input resets the clock: idle counts from the last input, not from when the title opened.
    expect(attractDue(25, 40, ATTRACT_IDLE_S)).toBe(false);
    expect(attractDue(25, 45, ATTRACT_IDLE_S)).toBe(true);
    expect(attractDue(0, 1e6, null)).toBe(false);
  });

  it('reads its test overrides from the URL: attract off under ?test unless a test sets it', () => {
    expect(attractSeconds('', 20)).toBe(20);
    expect(attractSeconds('?test', 20)).toBeNull();
    expect(attractSeconds('?test&attract=2', 20)).toBe(2);
    expect(attractSeconds('?test&attract=0', 20)).toBeNull();
    expect(attractSeconds('?attract=2', 20)).toBe(20);
  });
});
