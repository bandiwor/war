import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HALF_PI, PI, atan, atan2, clamp, cos, lerp, sin, wrapAngle } from './dmath';

const angle = fc.double({ min: -1000, max: 1000, noNaN: true });

describe('dmath', () => {
  it('sin/cos match Math within 1e-9', () => {
    fc.assert(
      fc.property(angle, (x) => {
        expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-9);
        expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-9);
      }),
    );
  });

  it('atan/atan2 match Math within 1e-9', () => {
    const v = fc.double({ min: -1e6, max: 1e6, noNaN: true });
    fc.assert(
      fc.property(v, v, (y, x) => {
        expect(Math.abs(atan(y) - Math.atan(y))).toBeLessThan(1e-9);
        expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-9);
      }),
    );
  });

  it('atan2 axis cases', () => {
    expect(atan2(1, 0)).toBe(HALF_PI);
    expect(atan2(-1, 0)).toBe(-HALF_PI);
    expect(atan2(0, 0)).toBe(0);
    expect(atan2(0, -1)).toBeCloseTo(PI, 12);
    expect(atan2(-1e-9, -1)).toBeCloseTo(-PI, 8);
    for (const [y, x] of [
      [0, -0],
      [-0, -0],
      [0, 0],
      [-0, 0],
      [-0, -1],
      [0, -1],
      [-0, 1],
    ] as const) {
      expect(Object.is(atan2(y, x), Math.atan2(y, x))).toBe(true);
    }
    expect(atan2(1, -0)).toBe(HALF_PI);
  });

  it('wrapAngle lands in [-PI, PI] and preserves the angle', () => {
    fc.assert(
      fc.property(angle, (x) => {
        const w = wrapAngle(x);
        expect(w).toBeGreaterThanOrEqual(-PI - 1e-12);
        expect(w).toBeLessThanOrEqual(PI + 1e-12);
        expect(Math.abs(Math.sin(w) - Math.sin(x))).toBeLessThan(1e-9);
      }),
    );
  });

  it('clamp and lerp', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(lerp(2, 4, 0.5)).toBe(3);
  });
});
