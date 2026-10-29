import { MIN_WIDTH, needsComputer } from '../src/game/device';
import { nextTextSpeed, stepVolume } from '../src/game/settingsControls';

describe('needsComputer', () => {
  it('lets a desktop with a mouse play', () => {
    expect(needsComputer({ width: 1280, finePointer: true, maxTouchPoints: 0 })).toBe(false);
  });

  it('lets a touch laptop with a trackpad play', () => {
    expect(needsComputer({ width: 1440, finePointer: true, maxTouchPoints: 10 })).toBe(false);
  });

  it('stops a window narrower than 900 px', () => {
    expect(MIN_WIDTH).toBe(900);
    expect(needsComputer({ width: 899, finePointer: true, maxTouchPoints: 0 })).toBe(true);
    expect(needsComputer({ width: 900, finePointer: true, maxTouchPoints: 0 })).toBe(false);
  });

  it('stops a touch-only device even when it is wide', () => {
    expect(needsComputer({ width: 1366, finePointer: false, maxTouchPoints: 5 })).toBe(true);
    expect(needsComputer({ width: 390, finePointer: false, maxTouchPoints: 5 })).toBe(true);
  });
});

describe('settings controls', () => {
  it('steps volume in tenths between 0 and 1', () => {
    expect(stepVolume(0.8, -1)).toBe(0.7);
    expect(stepVolume(0.7, 1)).toBe(0.8);
    expect(stepVolume(0, -1)).toBe(0);
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0.75, 1)).toBe(0.9);
  });

  it('cycles text speed slow, normal, fast', () => {
    expect(nextTextSpeed('slow')).toBe('normal');
    expect(nextTextSpeed('normal')).toBe('fast');
    expect(nextTextSpeed('fast')).toBe('slow');
  });
});
