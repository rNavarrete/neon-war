import { type Drop, ROOM_GLASS, STREAK, type Segment, clipToGlass, fall, seedDrops } from '../src/story/rain';

// Rain in Lux's room falls outside, so it must only ever be drawn on the window glass.

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const inside = (seg: Segment) =>
  [seg.x1, seg.x2].every((x) => x >= ROOM_GLASS.x - 1e-9 && x <= ROOM_GLASS.x + ROOM_GLASS.w + 1e-9) &&
  [seg.y1, seg.y2].every((y) => y >= ROOM_GLASS.y - 1e-9 && y <= ROOM_GLASS.y + ROOM_GLASS.h + 1e-9);

describe("rain in Lux's room", () => {
  it('seeds drops on the glass only', () => {
    const drops = seedDrops(200, ROOM_GLASS, 900, 1500, lcg(1));
    for (const d of drops) {
      expect(d.x).toBeGreaterThanOrEqual(ROOM_GLASS.x);
      expect(d.x).toBeLessThanOrEqual(ROOM_GLASS.x + ROOM_GLASS.w);
      expect(d.y).toBeGreaterThanOrEqual(ROOM_GLASS.y);
      expect(d.y).toBeLessThanOrEqual(ROOM_GLASS.y + ROOM_GLASS.h);
    }
  });

  it('draws every streak inside the glass over ten seconds of falling, and keeps drawing rain', () => {
    const rand = lcg(7);
    const drops: Drop[] = seedDrops(60, ROOM_GLASS, 900, 1500, rand);
    const seg: Segment = { x1: 0, y1: 0, x2: 0, y2: 0 };
    let drawn = 0;
    for (let f = 0; f < 600; f++) {
      let frame = 0;
      for (const d of drops) {
        fall(d, 1 / 60, ROOM_GLASS, STREAK.dy, rand);
        if (!clipToGlass(d.x, d.y, STREAK.dx, STREAK.dy, ROOM_GLASS, seg)) continue;
        expect(inside(seg)).toBe(true);
        frame++;
      }
      expect(frame).toBeGreaterThan(30);
      drawn += frame;
    }
    expect(drawn).toBeGreaterThan(600 * 30);
  });

  it('clips a streak crossing the sill or the frame, and drops one wholly off the glass', () => {
    const seg: Segment = { x1: 0, y1: 0, x2: 0, y2: 0 };
    const bottom = ROOM_GLASS.y + ROOM_GLASS.h;
    expect(clipToGlass(700, bottom + 10, 6, 28, ROOM_GLASS, seg)).toBe(true);
    expect(seg.y1).toBeCloseTo(bottom);
    expect(seg.y2).toBeCloseTo(bottom + 10 - 28);
    const right = ROOM_GLASS.x + ROOM_GLASS.w;
    expect(clipToGlass(right - 2, 300, 6, 28, ROOM_GLASS, seg)).toBe(true);
    expect(seg.x2).toBeCloseTo(right);
    expect(clipToGlass(200, 800, 6, 28, ROOM_GLASS, seg)).toBe(false);
    expect(clipToGlass(700, bottom + 40, 0, 28, ROOM_GLASS, seg)).toBe(false);
  });
});
