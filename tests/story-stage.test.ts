import {
  BOX_TOP,
  HOVERING,
  HOVER_BOB,
  SPRITE_H,
  TEXT_FRAME,
  TEXT_LINE,
  TEXT_POS,
  bobAt,
  facesLeft,
  frameFor,
  hoverFor,
  slotsBetween,
  slotsFor,
  standOrder,
} from '../src/story/stage';

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
    // The two Lux sprites are cut at 927 px so the speaker's 3% step lands on their own size.
    expect(frameFor(927, 620, 1080).scale * 1.03).toBeCloseTo(1, 2);
    // Its head is in the upper sixth of the frame.
    const f = frameFor(1536, 620, 1080);
    expect(f.bottom - 1536 * f.scale).toBeLessThanOrEqual(1080 / 6);
  });

  it('sinks a bust behind the text box near its own size, so its cut edge never shows', () => {
    const f = frameFor(440, 620, 1080);
    // The speaker steps forward 3%, which must not upscale the art.
    expect(f.scale * 1.03).toBeLessThanOrEqual(1);
    expect(f.bottom).toBeGreaterThan(BOX_TOP);
    expect(f.bottom - 440).toBeLessThan(BOX_TOP);
  });
});

describe('flyers', () => {
  it('hovers TRIAGE beside the first person, fully above the text box, and bobs a few px', () => {
    expect(HOVERING.has('TRIAGE')).toBe(true);
    const f = hoverFor(slotsFor(1));
    expect(f.x).toBeGreaterThan(slotsFor(1)[0]!);
    // The drone art is ~290 px tall; all of it stays above the box even at the bottom of its bob.
    expect(f.bottom + HOVER_BOB.amp).toBeLessThan(BOX_TOP);
    expect(f.bottom - 290).toBeGreaterThan(0);
    expect(hoverFor([]).x).toBe(slotsFor(1)[0]);
    expect(Math.abs(bobAt(0.6))).toBeLessThanOrEqual(HOVER_BOB.amp);
    expect(bobAt(0)).toBeCloseTo(bobAt(HOVER_BOB.period));
  });

  it('stands a cast between two edges evenly, for a scene whose panels own the left (the debrief)', () => {
    expect(slotsBetween(0, 1000, 1900)).toEqual([]);
    expect(slotsBetween(1, 1000, 1900)).toEqual([1450]);
    expect(slotsBetween(2, 1000, 1900)).toEqual([1225, 1675]);
    // A tall sprite at its drawn width (about 450 x 0.97) stays inside the stretch.
    for (const x of slotsBetween(2, 1000, 1900)) {
      expect(x - 225).toBeGreaterThanOrEqual(1000);
      expect(x + 225).toBeLessThanOrEqual(1920);
    }
  });

  it("starts a line's text clear of the text box's top bar, with room for three lines above the bottom bar", () => {
    expect(TEXT_POS.y - TEXT_FRAME.top).toBeGreaterThanOrEqual(20);
    const threeLines = 3 * TEXT_LINE.size * 1.25 + 2 * TEXT_LINE.gap;
    expect(TEXT_POS.y + threeLines).toBeLessThanOrEqual(TEXT_FRAME.bottom - 15);
  });
});

describe('who stands where and which way they face', () => {
  it('Lux always takes the left slot, whoever came on first; the rest keep their order', () => {
    expect(standOrder(['Rei', 'Lux'])).toEqual(['Lux', 'Rei']);
    expect(standOrder(['Mika', 'TRIAGE', 'Lux', 'Ozzie'])).toEqual(['Lux', 'Mika', 'TRIAGE', 'Ozzie']);
    expect(standOrder(['Rei', 'Mika'])).toEqual(['Rei', 'Mika']);
  });

  it('Lux is never mirrored (her shirt would print backwards); everyone with her turns to face her', () => {
    for (const x of [300, 620, 1560]) expect(facesLeft('Lux', x, true)).toBe(false);
    const xs = slotsFor(3);
    const order = standOrder(['Rei', 'Mika', 'Lux']);
    expect(order.map((who, i) => facesLeft(who, xs[i]!, true))).toEqual([false, true, true]);
  });

  it('without Lux, whoever stands right of the middle turns in toward the scene', () => {
    expect(facesLeft('Rei', 560, false)).toBe(false);
    expect(facesLeft('Mika', 1260, false)).toBe(true);
  });

  it("beside Lux alone, TRIAGE's face hovers at her eye level with room between them", () => {
    // Rolando, 30 Oct 2026: "he should be eye level to Lux and give me a bit more space".
    const lux = frameFor(927, slotsFor(1)[0]!, 1080);
    const h = hoverFor(slotsFor(1));
    // Lux's eyes sit about 146 px down her 927 px art; the drone's screen about 100 px down its 290.
    const luxEyes = lux.bottom - (927 - 146) * lux.scale;
    const droneTop = h.bottom - 290 * h.scale;
    const droneFace = droneTop + 100 * h.scale;
    expect(Math.abs(droneFace - luxEyes)).toBeLessThan(15);
    // Clear of her: Lux is ~538 px wide at her scale and the drone ~230, with at least 100 px of air.
    expect(h.x - 115 * h.scale - (lux.x + 269 * lux.scale)).toBeGreaterThan(100);
    // ...and clear of the story chat panel on the right (x 1480).
    expect(h.x + 115 * h.scale).toBeLessThan(1480);
  });

  it("TRIAGE hovers off Lux's shoulder on the middle side when she shares the stage", () => {
    const xs = slotsFor(2);
    const h = hoverFor(xs);
    expect(standOrder(['Rei', 'Lux'])[0]).toBe('Lux');
    expect(h.x).toBeGreaterThan(xs[0]!);
    expect(h.x).toBeLessThan(xs[1]!);
  });
});
