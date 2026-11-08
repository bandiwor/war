import { describe, expect, it } from 'vitest';
import { seed } from '../core/brand';
import { isMaterialId } from '../procgen/materials';
import { STREET, generateStreetLayout, zoneWeightsAt } from './street-layout';

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

describe('zones', () => {
  it('city south of the barricade, industrial north, cross-faded at the border', () => {
    const l = generateStreetLayout(seed(1337));
    const border = l.zones[0]?.max[1] ?? 0;
    expect(zoneWeightsAt(l, 0, -50)).toEqual({ abandonedCity: 1 });
    expect(zoneWeightsAt(l, 0, 50)).toEqual({ industrial: 1 });
    const mid = zoneWeightsAt(l, 0, border);
    expect(mid.abandonedCity).toBeCloseTo(0.5);
    expect(mid.industrial).toBeCloseTo(0.5);
    const near = zoneWeightsAt(l, 0, border + 2);
    expect(near.industrial ?? 0).toBeGreaterThan(near.abandonedCity ?? 0);
    expect(zoneWeightsAt(l, 500, 500)).toEqual({});
  });
});
