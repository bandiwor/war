import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HITBOXES,
  intersectArchetype,
  rayBox,
  rayCapsule,
  raySphere,
  type HitResult,
} from './hitboxes';
import { RACES, VULNERABILITY, damageTo, raceAt, raceIndex } from './races';

const coord = fc.double({ min: -3, max: 3, noNaN: true });

/** Brute force: march along the segment and test point containment. */
function march(
  inside: (x: number, y: number, z: number) => boolean,
  o: number[],
  d: number[],
  maxT: number,
): number {
  const steps = 4000;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * maxT;
    if (
      inside(
        (o[0] ?? 0) + (d[0] ?? 0) * t,
        (o[1] ?? 0) + (d[1] ?? 0) * t,
        (o[2] ?? 0) + (d[2] ?? 0) * t,
      )
    )
      return t;
  }
  return -1;
}

describe('ray intersection (vs brute-force marching)', () => {
  const dir = fc.tuple(coord, coord, coord).filter(([a, b, c]) => Math.hypot(a, b, c) > 0.1);

  it('sphere', () => {
    fc.assert(
      fc.property(fc.tuple(coord, coord, coord), dir, (o, d) => {
        const r = 0.7;
        const exact = raySphere(o[0], o[1], o[2], d[0], d[1], d[2], 0.2, -0.1, 0.3, r, 2);
        const brute = march(
          (x, y, z) => (x - 0.2) ** 2 + (y + 0.1) ** 2 + (z - 0.3) ** 2 <= r * r,
          o,
          d,
          2,
        );
        if (brute < 0) expect(exact).toBe(-1);
        else expect(Math.abs(exact - brute)).toBeLessThan(0.002);
      }),
    );
  });

  it('capsule', () => {
    const inside = (x: number, y: number, z: number): boolean => {
      const t = Math.max(0, Math.min(1, (y + 0.5) / 1.0)); // segment (0,-0.5,0)→(0,0.5,0)
      const py = -0.5 + t;
      return x * x + (y - py) ** 2 + z * z <= 0.3 * 0.3;
    };
    fc.assert(
      fc.property(fc.tuple(coord, coord, coord), dir, (o, d) => {
        const exact = rayCapsule(o[0], o[1], o[2], d[0], d[1], d[2], 0, -0.5, 0, 0, 0.5, 0, 0.3, 2);
        const brute = march(inside, o, d, 2);
        if (brute < 0) expect(exact).toBe(-1);
        else expect(Math.abs(exact - brute)).toBeLessThan(0.002);
      }),
    );
  });

  it('box', () => {
    fc.assert(
      fc.property(fc.tuple(coord, coord, coord), dir, (o, d) => {
        const exact = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], 0, 0, 0, 0.4, 0.6, 0.2, 2);
        const brute = march(
          (x, y, z) => Math.abs(x) <= 0.4 && Math.abs(y) <= 0.6 && Math.abs(z) <= 0.2,
          o,
          d,
          2,
        );
        if (brute < 0) expect(exact).toBe(-1);
        else expect(Math.abs(exact - brute)).toBeLessThan(0.002);
      }),
    );
  });

  it('degenerate capsule and axis-parallel box rays', () => {
    expect(rayCapsule(-2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 5)).toBeCloseTo(1.5);
    expect(rayBox(0, 5, 0, 0, -1, 0, 0, 0, 0, 1, 1, 1, 10)).toBeCloseTo(4);
    expect(rayBox(3, 5, 0, 0, -1, 0, 0, 0, 0, 1, 1, 1, 10)).toBe(-1);
  });
});

describe('archetypes', () => {
  it('a level shot from the front hits the expected parts; yaw rotates the hitboxes', () => {
    const out: HitResult = { t: -1, part: null };
    // Shooter 10 m away along +Z looking toward −Z at a zombie facing +Z (yaw π).
    intersectArchetype('zombie', 0, 0, 0, Math.PI, 0, 1.62, 10, 0, 0, -1, 20, out);
    expect(out.part).toBe('head');
    expect(out.t).toBeCloseTo(10 - 0.115, 2);
    intersectArchetype('zombie', 0, 0, 0, Math.PI, 0, 1.2, 10, 0, 0, -1, 20, out);
    expect(out.part).toBe('torso');
    // Robot at yaw π faces +Z: its camera (local −Z) is on the shooter's side…
    intersectArchetype('robot', 0, 0, 0, Math.PI, 0, 1.38, 10, 0, 0, -1, 20, out);
    expect(out.part).toBe('sensor');
    const facing = out.t;
    // …turned away (yaw 0) the camera sits behind its mount, 24 cm further.
    intersectArchetype('robot', 0, 0, 0, 0, 0, 1.38, 10, 0, 0, -1, 20, out);
    expect(out.part).toBe('sensor');
    expect(out.t - facing).toBeCloseTo(0.24, 3);
    intersectArchetype('robot', 0, 0, 0, 0, 0, 1.0, 10, 0, 0, -1, 20, out);
    expect(out.part).toBe('chassis');
    intersectArchetype('plant', 0, 0, 0, 0, 0, 0.7, 10, 0, 0, -1, 20, out);
    expect(out.part).toBe('bulb');
    intersectArchetype('animal', 0, 0, 0, 0, 0, 0.6, -10, 0, 0, 1, 20, out);
    expect(out.part).toBe('head');
    intersectArchetype('zombie', 0, 0, 0, 0, 5, 1.6, 10, 0, 0, -1, 20, out); // clean miss (broad phase)
    expect(out.part).toBeNull();
    for (const race of RACES) expect(HITBOXES[race].length).toBeGreaterThan(0);
  });
});

describe('damage by race and part', () => {
  it('headshots devastate zombies; limbs barely matter', () => {
    expect(damageTo('zombie', 40, 'ballistic', 'head')).toBe(160);
    expect(damageTo('zombie', 40, 'ballistic', 'arm')).toBeCloseTo(14);
    expect(damageTo('zombie', 40, 'ballistic', 'head')).toBeGreaterThanOrEqual(
      VULNERABILITY.zombie.maxHealth,
    );
  });

  it('robots: armour vs bullets, cameras fragile, EMP lethal', () => {
    expect(damageTo('robot', 40, 'ballistic', 'chassis')).toBe(20);
    expect(damageTo('robot', 40, 'ballistic', 'sensor')).toBe(60);
    expect(damageTo('robot', 100, 'emp', null)).toBeGreaterThan(VULNERABILITY.robot.maxHealth);
  });

  it('plants burn; light burns zombies; unknown parts default to 1', () => {
    expect(damageTo('plant', 10, 'fire', null)).toBe(40);
    expect(damageTo('plant', 40, 'ballistic', 'bulb')).toBe(50);
    expect(damageTo('zombie', 5, 'light', null)).toBe(15);
    expect(damageTo('robot', 10, 'light', null)).toBe(0);
    expect(damageTo('animal', 10, 'ballistic', 'sensor')).toBe(10);
  });

  it('race index round trip', () => {
    for (const r of RACES) expect(raceAt(raceIndex(r))).toBe(r);
    expect(raceAt(99)).toBe('zombie');
  });
});
