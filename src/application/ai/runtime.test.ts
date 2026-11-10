import { describe, expect, it } from 'vitest';
import { SpatialHash } from './runtime';

describe('spatial hash', () => {
  it('grows past its initial capacity and finds exactly the items in range', () => {
    const h = new SpatialHash();
    const n = 300;
    h.reset(n);
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = ((i * 37) % 101) - 50;
      const z = ((i * 53) % 97) - 48;
      xs.push(x);
      zs.push(z);
      h.insert(i, x, z);
    }
    for (const [qx, qz, r] of [
      [0, 0, 5],
      [-40, 30, 8],
      [7.5, -7.5, 3],
    ] as const) {
      const found = new Set(Array.from(h.found.subarray(0, h.near(qx, qz, r))));
      const expected = new Set(
        xs.map((_, i) => i).filter((i) => Math.hypot((xs[i] ?? 0) - qx, (zs[i] ?? 0) - qz) <= r),
      );
      expect(found).toEqual(expected);
    }
  });
});
