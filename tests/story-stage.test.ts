import { BOX_TOP, SPRITE_H, frameFor, slotsFor } from '../src/story/stage';

// Story characters stand the way visual novels stage them: slots by head count, on the bottom of the
// frame behind the text box, big enough to read.

describe('story stage', () => {
  it('puts one person on the left third, clear of the stream chat, and spreads more out left to right', () => {
    expect(slotsFor(0)).toEqual([]);
    expect(slotsFor(1)).toEqual([620]);
    for (let n = 2; n <= 7; n++) {
      const xs = slotsFor(n);
      expect(xs).toHaveLength(n);
      for (let i = 1; i < n; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
      // The stream chat keeps the top-right corner (x 1650 and right).
      expect(xs[n - 1]!).toBeLessThanOrEqual(1560);
      expect(xs[0]!).toBeGreaterThanOrEqual(300);
    }
  });

  it('stands a tall sprite on the bottom edge at SPRITE_H, never upscaled', () => {
    expect(frameFor(1500, 620, 1080)).toEqual({ x: 620, bottom: 1080, scale: SPRITE_H / 1500 });
    expect(frameFor(800, 620, 1080).scale).toBe(1);
    // Its head is in the upper sixth of the frame.
    const f = frameFor(1536, 620, 1080);
    expect(f.bottom - 1536 * f.scale).toBeLessThanOrEqual(1080 / 6);
  });

  it('sinks a bust behind the text box at its own size, so its cut edge never shows', () => {
    const f = frameFor(440, 620, 1080);
    expect(f.scale).toBe(1);
    expect(f.bottom).toBeGreaterThan(BOX_TOP);
    expect(f.bottom - 440).toBeLessThan(BOX_TOP);
  });
});
