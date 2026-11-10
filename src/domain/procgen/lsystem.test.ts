import { describe, expect, it } from 'vitest';
import { expand, growPlant, interpret, PLANT_SYSTEMS, type LSystemSpec } from './lsystem';

const KOCH: LSystemSpec = {
  axiom: 'F',
  rules: { F: ['F+F-F'] },
  iterations: 2,
  angle: Math.PI / 2,
  jitter: 0,
  step: 1,
  lengthDecay: 1,
  radius: 0.1,
  radiusDecay: 1,
  tropism: 0,
};

describe('L-systems', () => {
  it('rewrites deterministically', () => {
    expect(expand(KOCH, 1)).toBe('F+F-F+F+F-F-F+F-F');
    expect(expand(PLANT_SYSTEMS.vine, 7)).toBe(expand(PLANT_SYSTEMS.vine, 7));
    expect(expand(PLANT_SYSTEMS.vine, 7)).not.toBe(expand(PLANT_SYSTEMS.vine, 8));
  });

  it('the turtle draws connected segments that turn as told', () => {
    const p = interpret(KOCH, 'F+F', 0);
    expect(p.segments).toHaveLength(2);
    const [a, b] = p.segments;
    expect(b?.a).toEqual(a?.b);
    // Up, then a quarter turn: the second segment is horizontal.
    expect(b?.b[1]).toBeCloseTo(a?.b[1] ?? 0, 9);
  });

  it('branches are thinner and shorter; brackets return to the branch point', () => {
    const p = interpret({ ...KOCH, lengthDecay: 0.5, radiusDecay: 0.5 }, 'F[+F]F', 0);
    expect(p.segments).toHaveLength(3);
    const [trunk, branch, next] = p.segments;
    expect(branch?.r0).toBeLessThan(trunk?.r0 ?? 0);
    expect(next?.a).toEqual(trunk?.b);
    expect(next?.depth).toBe(0);
    expect(branch?.depth).toBe(1);
  });

  it('every plant system grows a bounded, non-trivial plant with leaves', () => {
    for (const spec of Object.values(PLANT_SYSTEMS)) {
      const p = growPlant(spec, 3);
      expect(p.segments.length).toBeGreaterThan(8);
      expect(p.leaves.length).toBeGreaterThan(0);
      for (const s of p.segments)
        for (const v of [...s.a, ...s.b]) expect(Math.abs(v)).toBeLessThan(5);
    }
  });
});
