import { midpoint, pointAt, route, routeLength } from '../src/scenes/layout';

describe('orthogonal routes', () => {
  const pts = route([0, 0], [100, 40]);

  it('go across, down, then across', () => {
    expect(pts).toEqual([
      [0, 0],
      [50, 0],
      [50, 40],
      [100, 40],
    ]);
    expect(routeLength(pts)).toBe(140);
  });

  it('find points along the way and clamp past the end', () => {
    expect(pointAt(pts, 0)).toEqual([0, 0]);
    expect(pointAt(pts, 70)).toEqual([50, 20]);
    expect(pointAt(pts, 500)).toEqual([100, 40]);
    expect(midpoint(pts)).toEqual([50, 20]);
  });

  it('handle a straight line', () => {
    const flat = route([10, 5], [30, 5]);
    expect(routeLength(flat)).toBe(20);
    expect(midpoint(flat)).toEqual([20, 5]);
  });
});
