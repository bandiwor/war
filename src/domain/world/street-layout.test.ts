import { describe, expect, it } from 'vitest';
import { seed } from '../core/brand';
import { isMaterialId } from '../procgen/materials';
import { STREET, generateStreetLayout } from './street-layout';

describe('street layout', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(generateStreetLayout(seed(1))).toEqual(generateStreetLayout(seed(1)));
    expect(generateStreetLayout(seed(1))).not.toEqual(generateStreetLayout(seed(2)));
  });

  it.each([1, 2, 3, 42, 1337])('seed %i: has the required set pieces within bounds', (s) => {
    const l = generateStreetLayout(seed(s));
    const kinds = new Set(l.lights.map((x) => x.kind));
    expect(kinds.has('emergencyBeacon')).toBe(true);
    expect(kinds.has('bioluminescence')).toBe(true);
    expect(l.props.some((p) => p.kind === 'lampPost')).toBe(true);
    expect(l.lights.length).toBeLessThanOrEqual(24);
    for (const b of l.boxes) {
      expect(isMaterialId(b.material)).toBe(true);
      expect(Math.abs(b.center[2])).toBeLessThanOrEqual(STREET.length / 2 + 1);
      for (const d of b.size) expect(d).toBeGreaterThan(0);
    }
    const [minX, minZ, maxX, maxZ] = l.walkBounds;
    const [sx, , sz] = l.spawn.position;
    expect(sx > minX && sx < maxX && sz > minZ && sz < maxZ).toBe(true);
  });
});
