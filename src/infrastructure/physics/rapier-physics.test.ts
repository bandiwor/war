import { beforeAll, describe, expect, it } from 'vitest';
import { StateHasher } from '../../domain/math/hash';
import { RapierPhysics, createRapierPhysics, initRapier } from './rapier-physics';

beforeAll(async () => {
  await initRapier();
});

const move = { dx: 0, dy: 0, dz: 0, grounded: false };
const feet = { x: 0, y: 0, z: 0 };
const spec = {
  feet: [0, 0, 0] as const,
  radius: 0.3,
  height: 1.8,
  maxStepHeight: 0.35,
  maxSlopeDegrees: 45,
};

function flatWorld(): RapierPhysics {
  const p = RapierPhysics.create(1 / 60);
  p.addStaticBox([0, -0.05, 0], [40, 0.1, 40], 0, 'asphalt');
  return p;
}

function walk(
  p: RapierPhysics,
  id: ReturnType<RapierPhysics['createCharacter']>,
  dz: number,
  ticks: number,
): void {
  for (let i = 0; i < ticks; i++) {
    p.moveCharacter(id, 0, 0, dz, move);
    p.step();
  }
}

describe('RapierPhysics', () => {
  it('stands on the ground and reports its surface', () => {
    const p = flatWorld();
    const id = p.createCharacter(spec);
    walk(p, id, 0, 5);
    expect(move.grounded).toBe(true);
    expect(p.characterFeet(id, feet).y).toBeCloseTo(0, 1);
    expect(p.surfaceBelow(id)).toBe('asphalt');
  });

  it('steps up a 15 cm curb but not a 50 cm ledge', () => {
    const p = flatWorld();
    p.addStaticBox([0, 0.075, 5], [10, 0.15, 4], 0, 'concrete');
    p.addStaticBox([0, 0.25, 12], [10, 0.5, 4], 0, 'metal');
    const id = p.createCharacter(spec);
    walk(p, id, 0.025, 240);
    expect(p.characterFeet(id, feet).y).toBeCloseTo(0.15, 1);
    expect(p.surfaceBelow(id)).toBe('concrete');
    walk(p, id, 0.025, 400);
    expect(p.characterFeet(id, feet).z).toBeLessThan(10);
  });

  it('blocks standing up under a low ceiling, allows it in the open', () => {
    const p = flatWorld();
    p.addStaticBox([0, 1.55, 0], [4, 0.1, 4], 0, 'concrete'); // ceiling underside at 1.5 m
    const id = p.createCharacter({ ...spec, height: 1.2 });
    walk(p, id, 0, 2);
    expect(p.setCharacterHeight(id, 1.8)).toBe(false);
    expect(p.setCharacterHeight(id, 1.3)).toBe(true);
    expect(p.setCharacterHeight(id, 1.3)).toBe(true); // no-op
    expect(p.setCharacterHeight(id, 1.2)).toBe(true); // shrinking is always allowed
    walk(p, id, 0.05, 120); // out from under the ceiling
    expect(p.setCharacterHeight(id, 1.8)).toBe(true);
    expect(p.characterFeet(id, feet).y).toBeCloseTo(0, 1);
  });

  it('surfaceBelow is null in the air or over untagged blockers', () => {
    const p = flatWorld();
    const id = p.createCharacter({ ...spec, feet: [0, 3, 0] });
    p.step();
    expect(p.surfaceBelow(id)).toBeNull();
    const q = RapierPhysics.create(1 / 60);
    q.addStaticBox([0, -0.05, 0], [4, 0.1, 4], 0, null);
    q.addStaticCylinder([2, 0, 2], 1, 0.3, 'metal');
    const c = q.createCharacter(spec);
    q.step();
    expect(q.surfaceBelow(c)).toBeNull();
    // q now has two characters; `p` only one, so q's second id is unknown to p.
    const bogus = q.createCharacter(spec);
    expect(() => p.characterFeet(bogus, feet)).toThrow('Unknown character');
    q.dispose();
  });

  it('is deterministic: same calls, same snapshot hash; debug lines exist', async () => {
    const run = async (): Promise<string> => {
      const p = await createRapierPhysics(60);
      p.addStaticBox([0, -0.05, 0], [40, 0.1, 40], 0, 'asphalt');
      p.addStaticBox([1, 0.5, 3], [1, 1, 1], 0.4, 'wood');
      const id = p.createCharacter(spec);
      for (let i = 0; i < 300; i++) {
        p.moveCharacter(id, 0.004 * Math.sin(i * 0.1), -0.002, 0.02, move);
        p.step();
      }
      expect(p.debugLines().vertices.length).toBeGreaterThan(0);
      const h = new StateHasher();
      p.hashInto(h);
      return h.digest();
    };
    expect(await run()).toBe(await run());
  });
});
