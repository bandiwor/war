import { describe, expect, it } from 'vitest';
import { ALARM, PHEROMONE, PREY, PheromoneField } from './pheromone';
import { StateHasher } from '../math/hash';

function openField(wall: (x: number, z: number) => boolean = () => false): PheromoneField {
  const f = new PheromoneField();
  f.follow(0, 0);
  f.refreshMask(1, (x, z) => !wall(x, z));
  return f;
}

describe('pheromone field', () => {
  it('diffusion conserves mass; only decay removes it', () => {
    const f = openField();
    f.deposit(PREY, 0, 0, 10);
    const start = f.total(PREY);
    expect(start).toBeCloseTo(10 / (PHEROMONE.cell * PHEROMONE.cell), 6); // per m² of the cell
    const dt = 1 / 15;
    f.step(dt);
    expect(f.total(PREY)).toBeCloseTo(start * (1 - PHEROMONE.preyDecay * dt), 4);
    for (let i = 0; i < 30; i++) f.step(dt);
    expect(f.at(PREY, 0, 0)).toBeLessThan(start);
    expect(f.at(PREY, 5, 0)).toBeGreaterThan(0);
  });

  it('walls stop the scent', () => {
    // A wall filling the cells whose centre is at x = 5 (x ∈ [4, 6)).
    const f = openField((x) => x === 5);
    f.deposit(PREY, 0, 0, 10);
    for (let i = 0; i < 120; i++) f.step(1 / 15);
    expect(f.at(PREY, 2, 0)).toBeGreaterThan(0);
    expect(f.at(PREY, 4.5, 0)).toBe(0);
    expect(f.at(PREY, 7, 0)).toBe(0);
  });

  it('uphill points toward the source, and says when nothing is higher', () => {
    const f = openField();
    f.deposit(PREY, 10, 0, 50);
    for (let i = 0; i < 60; i++) f.step(1 / 15);
    const out = { x: 0, z: 0 };
    expect(f.uphill(4, 0, 0.6, out)).toBeGreaterThan(0);
    expect(out.x).toBeGreaterThan(4);
    expect(f.uphill(10.5, 0.5, 0.6, out)).toBe(-1);
    // Waypoints are cell centres.
    expect([out.x % 2, out.z % 2]).toEqual([1, 1]);
  });

  it('alarm decays faster than prey scent and counts partly toward the smell', () => {
    const f = openField();
    f.deposit(PREY, 0, 0, 1);
    f.deposit(ALARM, 0, 0, 1);
    for (let i = 0; i < 60; i++) f.step(1 / 15);
    expect(f.total(ALARM)).toBeLessThan(f.total(PREY));
    expect(f.smell(0, 0, 0)).toBe(f.at(PREY, 0, 0));
  });

  it('recentres around the player, keeping what overlaps', () => {
    const f = openField();
    f.deposit(PREY, 5, 5, 3);
    const v = f.at(PREY, 5, 5);
    expect(f.follow(10, 10)).toBe(false); // within the slack
    expect(f.follow(40, 0)).toBe(true);
    expect(f.follow(40, 0)).toBe(false);
    expect(f.at(PREY, 5, 5)).toBe(v);
    f.follow(200, 200);
    expect(f.total(PREY)).toBe(0);
  });

  it('is deterministic and hashes its state', () => {
    const run = (): string => {
      const f = openField((x, z) => x === 7 && z > -5);
      for (let t = 0; t < 200; t++) {
        f.deposit(PREY, Math.sin(t * 0.1) * 8, t * 0.05, 0.5);
        if (t % 4 === 0) f.step(4 / 60);
      }
      const h = new StateHasher();
      f.hashInto(h);
      return h.digest();
    };
    expect(run()).toBe(run());
  });
});
