import {
  ATTRACT_IDLE_S,
  FADE,
  attractDue,
  cancelLevels,
  entryLevels,
  exitLevels,
} from '../src/scenes/opening';
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

  it('fades through black going in: title and music out together, a beat of silence, then the opening up', () => {
    expect(entryLevels(0)).toEqual({ music: 1, black: 0, video: 0 });
    expect(entryLevels(0.75)).toEqual({ music: 0.5, black: 0.5, video: 0 });
    expect(entryLevels(1.5)).toEqual({ music: 0, black: 1, video: 0 });
    expect(entryLevels(2.0)).toEqual({ music: 0, black: 1, video: 0 });
    expect(entryLevels(2.2).video).toBeCloseTo(0.5);
    expect(entryLevels(2.4)).toEqual({ music: 0, black: 1, video: 1 });
  });

  it('fades through black coming out: the opening down, then the title up and its music back', () => {
    expect(exitLevels(0, FADE.skip)).toEqual({ music: 0, black: 1, video: 1 });
    expect(exitLevels(0.15, FADE.skip).video).toBeCloseTo(0.5);
    expect(exitLevels(0.3, FADE.skip)).toEqual({ music: 0, black: 1, video: 0 });
    const half = exitLevels(0.3 + 0.25, FADE.skip);
    expect(half.black).toBeCloseTo(0.5);
    expect(half.music).toBeCloseTo(0.25 / 1.5);
    expect(exitLevels(0.3 + 1.5, FADE.skip)).toEqual({ music: 1, black: 0, video: 0 });
    // When it ends by itself the opening takes a second to go down.
    expect(exitLevels(0.5, FADE.ended).video).toBeCloseTo(0.5);
    expect(exitLevels(1, FADE.ended).black).toBe(1);
  });

  it('an input during the fade in brings the title back from wherever it was, in 0.3 s', () => {
    const caught = entryLevels(0.75);
    expect(cancelLevels(0, caught)).toEqual({ music: 0.5, black: 0.5, video: 0 });
    expect(cancelLevels(0.15, caught).music).toBeCloseTo(0.75);
    expect(cancelLevels(0.15, caught).black).toBeCloseTo(0.25);
    expect(cancelLevels(0.3, caught)).toEqual({ music: 1, black: 0, video: 0 });
  });
});
