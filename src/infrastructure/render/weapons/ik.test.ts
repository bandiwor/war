import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { solveTwoBone, type V3 } from './ik';

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const v = fc.tuple(
  fc.double({ min: -1, max: 1, noNaN: true }),
  fc.double({ min: -1, max: 1, noNaN: true }),
  fc.double({ min: -1, max: 1, noNaN: true }),
);

describe('two-bone IK', () => {
  it('keeps bone lengths, reaches reachable targets, bends toward the pole', () => {
    fc.assert(
      fc.property(v, v, (target, pole) => {
        const shoulder: V3 = [0, 0, 0];
        const { elbow, hand } = solveTwoBone(shoulder, target, 0.3, 0.28, pole);
        expect(dist(shoulder, elbow)).toBeCloseTo(0.3, 6);
        expect(dist(elbow, hand)).toBeCloseTo(0.28, 6);
        const reach = dist(shoulder, target);
        if (reach < 0.579 && reach > 0.021) expect(dist(hand, target)).toBeLessThan(1e-6);
      }),
    );
  });

  it('out-of-reach targets straighten the arm toward them', () => {
    const { elbow, hand } = solveTwoBone([0, 0, 0], [0, 0, -5], 0.3, 0.28, [0, -1, 0]);
    expect(hand[2]).toBeCloseTo(-0.58, 3);
    expect(elbow[2]).toBeCloseTo(-0.3, 2);
  });

  it('elbow goes to the pole side; degenerate poles and targets still resolve', () => {
    const down = solveTwoBone([0, 0, 0], [0, 0, -0.4], 0.3, 0.28, [0, -1, -0.2]);
    expect(down.elbow[1]).toBeLessThan(0);
    const up = solveTwoBone([0, 0, 0], [0, 0, -0.4], 0.3, 0.28, [0, 1, -0.2]);
    expect(up.elbow[1]).toBeGreaterThan(0);
    const colinear = solveTwoBone([0, 0, 0], [0, 0, -0.4], 0.3, 0.28, [0, 0, -1]);
    expect(Number.isFinite(colinear.elbow[0])).toBe(true);
    const vertical = solveTwoBone([0, 0, 0], [0, -0.4, 0], 0.3, 0.28, [0, -1, 0]);
    expect(Number.isFinite(vertical.elbow[0])).toBe(true);
    const zero = solveTwoBone([0, 0, 0], [0, 0, 0], 0.3, 0.28, [0, -1, 0]);
    expect(Number.isFinite(zero.hand[2])).toBe(true);
  });
});

describe('viewmodel springs', () => {
  it('stay stable and settle at any frame rate (10–240 fps)', async () => {
    const { stepSpring } = await import('./spring');
    for (const fps of [10, 30, 60, 240]) {
      const s = { pos: 0, vel: 5 };
      for (let i = 0; i < fps * 3; i++) stepSpring(s, 260, 22, 1 / fps);
      expect(Math.abs(s.pos)).toBeLessThan(1e-3);
      expect(Number.isFinite(s.vel)).toBe(true);
    }
  });
});
