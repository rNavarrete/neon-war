import { seededRandom } from '../src/scenes/hud/chat';
import {
  ART,
  BEAMS,
  FIREWORK,
  FIREWORK_SKY,
  HERO,
  RAIN,
  beamAngle,
  burstAlpha,
  fallStreak,
  fromArt,
  igniteBurst,
  logoDips,
  overlaps,
  seedRain,
  sparkAt,
} from '../src/scenes/titleFx';

// The title screen's motion over the picked rooftop art (Rolando, 30 Oct 2026: title A).

describe('title art placement', () => {
  it('covers the 1920x1080 frame with the 1536x1024 art, cut evenly top and bottom', () => {
    expect(ART.w * ART.scale).toBe(1920);
    expect(ART.h * ART.scale + 2 * ART.dy).toBe(1080);
    expect(fromArt(0, 80)).toEqual({ x: 0, y: 0 });
  });

  it('keeps the firework sky above Lux and clear of the logo side', () => {
    expect(FIREWORK_SKY.y + FIREWORK_SKY.h).toBeLessThanOrEqual(HERO.y + 100);
    expect(FIREWORK_SKY.x).toBeGreaterThan(960);
  });
});

describe('rain', () => {
  it('seeds streaks across the frame and wraps them back above the top once they fall past', () => {
    const rand = seededRandom(1);
    const rain = seedRain(RAIN.count, 1920, 1080, rand);
    expect(rain).toHaveLength(RAIN.count);
    for (const s of rain) {
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(1080);
      expect(s.v).toBeGreaterThanOrEqual(RAIN.vMin);
    }
    const s = { x: 500, y: 1100, v: 1000 };
    fallStreak(s, 0.05, 1920, 1080, rand);
    expect(s.y).toBeLessThanOrEqual(0);
  });

  it('falls along its slant', () => {
    const s = { x: 500, y: 100, v: 1000 };
    fallStreak(s, 0.1, 1920, 1080, () => 0.5);
    expect(s.y).toBeCloseTo(200);
    expect(s.x).toBeCloseTo(500 + (100 * RAIN.dx) / RAIN.dy);
  });
});

describe('searchlights', () => {
  it('sweep up over the city and swing back within their range', () => {
    for (const b of BEAMS) {
      const angles = Array.from({ length: 40 }, (_, i) => beamAngle(b, (i * b.period) / 40));
      expect(Math.max(...angles)).toBeLessThanOrEqual(b.base + b.swing + 1e-9);
      expect(Math.min(...angles)).toBeGreaterThanOrEqual(b.base - b.swing - 1e-9);
      expect(Math.max(...angles)).toBeLessThan(0);
      expect(beamAngle(b, b.period)).toBeCloseTo(beamAngle(b, 0));
    }
  });
});

describe('fireworks', () => {
  it('burst inside the firework sky', () => {
    const rand = seededRandom(7);
    const b = { x: 0, y: 0, age: 1, color: 0, live: false };
    for (let i = 0; i < 50; i++) {
      igniteBurst(b, rand);
      expect(b.live).toBe(true);
      expect(b.age).toBe(0);
      expect(b.x).toBeGreaterThanOrEqual(FIREWORK_SKY.x);
      expect(b.x).toBeLessThanOrEqual(FIREWORK_SKY.x + FIREWORK_SKY.w);
      expect(b.y).toBeGreaterThanOrEqual(FIREWORK_SKY.y);
      expect(b.y).toBeLessThanOrEqual(FIREWORK_SKY.y + FIREWORK_SKY.h);
    }
  });

  it('open in a ring that grows and falls, then fade out by the end of their life', () => {
    const early = { dx: 0, dy: 0 };
    const late = { dx: 0, dy: 0 };
    sparkAt(0, 0.1, early);
    sparkAt(0, 1, late);
    expect(late.dx).toBeGreaterThan(early.dx);
    const top = { dx: 0, dy: 0 };
    sparkAt(FIREWORK.sparks / 4, 1.5, top);
    expect(top.dy).toBeGreaterThan(0);
    expect(burstAlpha(0)).toBe(0);
    expect(burstAlpha(0.08)).toBeGreaterThan(0.9);
    expect(burstAlpha(FIREWORK.life)).toBe(0);
  });
});

describe('logo buzz', () => {
  it('dips briefly now and then, and never with reduce flicker on', () => {
    const times = Array.from({ length: 6300 }, (_, i) => i / 1000);
    const dips = times.filter((t) => logoDips(t, false)).length;
    expect(dips).toBeGreaterThan(0);
    expect(dips / times.length).toBeLessThan(0.05);
    expect(times.some((t) => logoDips(t, true))).toBe(false);
  });
});

describe('overlaps', () => {
  it('tells touching boxes from apart ones', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});
