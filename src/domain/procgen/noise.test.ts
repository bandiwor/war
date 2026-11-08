import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createWorleyResult,
  fbm2,
  gradient2,
  hash2,
  hash2i,
  smoothstep,
  warpedFbm2,
  worley2,
} from './noise';

const coord = fc.double({ min: -50, max: 50, noNaN: true });
const period = fc.integer({ min: 1, max: 32 });

describe('noise', () => {
  it('hash is deterministic, in range, and seed-sensitive', () => {
    expect(hash2i(3, 4, 5)).toBe(hash2i(3, 4, 5));
    expect(hash2i(3, 4, 5)).not.toBe(hash2i(3, 4, 6));
    expect(hash2i(3, 4, 5)).not.toBe(hash2i(4, 3, 5));
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.integer(), (x, y, s) => {
        const h = hash2(x, y, s);
        expect(h >= 0 && h < 1).toBe(true);
      }),
    );
  });

  it('gradient noise is bounded, zero on lattice points, and periodic', () => {
    fc.assert(
      fc.property(coord, coord, period, (x, y, p) => {
        const n = gradient2(x, y, p, 1);
        expect(Math.abs(n)).toBeLessThanOrEqual(1);
        expect(gradient2(x + p, y, p, 1)).toBeCloseTo(n, 9);
        expect(gradient2(x, y - p, p, 1)).toBeCloseTo(n, 9);
      }),
    );
    expect(gradient2(3, 7, 8, 1)).toBe(0);
  });

  it('fbm stays in [0,1] and tiles across the unit square', () => {
    const o = { octaves: 5, period: 4, seed: 9 };
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (u, v) => {
          const n = fbm2(u, v, o);
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(1);
          expect(fbm2(u + 1, v, o)).toBeCloseTo(n, 9);
          expect(fbm2(u, v + 1, { ...o, gain: 0.6 })).toBeCloseTo(
            fbm2(u, v, { ...o, gain: 0.6 }),
            9,
          );
        },
      ),
    );
  });

  it('warped fbm tiles and reduces to fbm with zero warp', () => {
    const o = { octaves: 4, period: 3, seed: 2 };
    expect(warpedFbm2(0.3, 0.6, o, 0)).toBe(fbm2(0.3, 0.6, o));
    expect(warpedFbm2(1.3, 0.6, o, 0.8)).toBeCloseTo(warpedFbm2(0.3, 0.6, o, 0.8), 9);
  });

  it('worley returns ordered distances and stable cells, periodic', () => {
    const r = createWorleyResult();
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        period,
        (u, v, p) => {
          worley2(u, v, p, 4, r);
          const { f1, f2, cell } = r;
          expect(f1).toBeLessThanOrEqual(f2);
          expect(f1).toBeLessThan(1.5);
          worley2(u + 1, v, p, 4, r);
          expect(r.f1).toBeCloseTo(f1, 9);
          expect(r.cell).toBe(cell);
        },
      ),
    );
  });

  it('smoothstep', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
});
