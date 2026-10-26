import { initialState } from '../src/sim/state';
import { testHookEnabled } from '../src/testHook';

describe('initialState', () => {
  it('starts at time zero in the briefing phase', () => {
    expect(initialState()).toEqual({ time: 0, phase: 'briefing' });
  });

  it('returns a fresh object each call', () => {
    expect(initialState()).not.toBe(initialState());
  });
});

describe('testHookEnabled', () => {
  it('is on only when the URL has a test parameter', () => {
    expect(testHookEnabled('?test')).toBe(true);
    expect(testHookEnabled('?foo=1&test=1')).toBe(true);
    expect(testHookEnabled('')).toBe(false);
    expect(testHookEnabled('?testing=1')).toBe(false);
  });
});
