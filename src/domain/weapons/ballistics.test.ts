import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Rng } from '../math/prng';
import {
  AMMO,
  FirearmSchema,
  WEAPONS,
  WEAPON_IDS,
  WeaponSchema,
  isWeaponId,
  weapon,
  weaponAt,
  weaponIndex,
  type Firearm,
} from './registry';
import {
  GRAVITY,
  aimVector,
  degToRad,
  falloffFactor,
  flyTo,
  integrate,
  moaToRad,
  sampleCone,
  speed,
  zeroElevation,
  type ProjectileState,
  integrateRocket,
} from './ballistics';

const firearm = (id: 'pistol' | 'carbine' | 'rifle' | 'shotgun'): Firearm => {
  const w = WEAPONS[id];
  if (w.kind !== 'firearm') throw new Error(id);
  return w;
};

describe('weapon registry', () => {
  it('every weapon validates; ids round-trip', () => {
    for (const id of WEAPON_IDS) {
      expect(WeaponSchema.safeParse(weapon(id)).success).toBe(true);
      expect(weaponAt(weaponIndex(id))).toBe(id);
    }
    expect(isWeaponId('pistol')).toBe(true);
    expect(isWeaponId('railgun')).toBe(false);
    expect(FirearmSchema.safeParse({ ...firearm('pistol'), ammo: 'bogus' }).success).toBe(false);
  });
});

describe('integrator', () => {
  it('matches the analytic parabola exactly without drag', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 1000, noNaN: true }),
        fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        fc.double({ min: 0.05, max: 2, noNaN: true }),
        (v0, angle, t) => {
          const s: ProjectileState = {
            px: 0,
            py: 0,
            pz: 0,
            vx: v0 * Math.cos(angle),
            vy: v0 * Math.sin(angle),
            vz: 0,
          };
          const steps = Math.round(t * 60);
          for (let i = 0; i < steps; i++) integrate(s, 0, 1 / 60);
          const tt = steps / 60;
          expect(s.px).toBeCloseTo(v0 * Math.cos(angle) * tt, 6);
          expect(s.py).toBeCloseTo(v0 * Math.sin(angle) * tt - 0.5 * GRAVITY * tt * tt, 6);
        },
      ),
    );
  });

  it('matches the closed-form 1D quadratic-drag solution v = v0/(1 + k·v0·t) within 0.1%', () => {
    for (const [, ammo] of Object.entries(AMMO)) {
      const v0 = 800;
      const s: ProjectileState = { px: 0, py: 0, pz: 0, vx: v0, vy: 0, vz: 0 };
      for (let i = 0; i < 60; i++) integrate(s, ammo.dragK, 1 / 60, 4, 0);
      const expected = v0 / (1 + ammo.dragK * v0 * 1);
      expect(Math.abs(s.vx - expected) / expected).toBeLessThan(0.001);
      expect(s.px).toBeCloseTo(Math.log(1 + ammo.dragK * v0) / ammo.dragK, 0); // x(t) = ln(1+k v0 t)/k
    }
  });

  it('converges: 4 substeps per 60 Hz tick are within 2 mm of a 100x finer reference at 300 m', () => {
    const run = (dt: number, sub: number): ProjectileState => {
      const s: ProjectileState = { px: 0, py: 0, pz: 0, vx: 900, vy: 5, vz: 0 };
      while (s.px < 300) integrate(s, AMMO['5.56x45'].dragK, dt, sub);
      return s;
    };
    const coarse = run(1 / 60, 4);
    const fine = run(1 / 6000, 4);
    // Compare heights at the same downrange distance via flyTo-style interpolation tolerance.
    expect(Math.abs(coarse.py - fine.py)).toBeLessThan(0.15); // overshoot of different end points
    const a = flyTo(300, 900, 0.003, AMMO['5.56x45'].dragK, 1 / 240);
    const b = flyTo(300, 900, 0.003, AMMO['5.56x45'].dragK, 1 / 24000);
    expect(Math.abs(a.height - b.height)).toBeLessThan(0.002);
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(0.05);
  });

  it('is deterministic and allocation-free in shape (state mutated in place)', () => {
    const a: ProjectileState = { px: 1, py: 2, pz: 3, vx: 300, vy: 10, vz: -20 };
    const b = { ...a };
    integrate(a, 0.001, 0.016);
    integrate(b, 0.001, 0.016);
    expect(a).toEqual(b);
    expect(speed(a)).toBeLessThan(Math.hypot(300, 10, 20));
  });
});

describe('real-world sanity (published ballistics, ±8%)', () => {
  it.each([
    ['5.56x45', 930, 300, 680],
    ['7.62x51', 850, 500, 600],
    ['9x19', 360, 50, 335],
    ['12ga-buck', 400, 50, 250],
  ] as const)('%s: %i m/s retains ≈%i m/s at %i m', (ammo, v0, range, retained) => {
    const r = flyTo(range, v0, 0.002, AMMO[ammo].dragK);
    expect(Math.abs(r.speed - retained) / retained).toBeLessThan(0.08);
  });

  it('carbine zeroed at 100 m: on the sight line at 100 m, ~20–45 cm low at 300 m', () => {
    const c = firearm('carbine');
    const el = zeroElevation(c.zeroMeters, c.sightHeight, c.muzzleVelocity, AMMO[c.ammo].dragK);
    expect(flyTo(100, c.muzzleVelocity, el, AMMO[c.ammo].dragK).height).toBeCloseTo(
      c.sightHeight,
      3,
    );
    const drop300 = flyTo(300, c.muzzleVelocity, el, AMMO[c.ammo].dragK).height - c.sightHeight;
    expect(drop300).toBeLessThan(-0.2);
    expect(drop300).toBeGreaterThan(-0.45);
  });

  it('time of flight to 300 m for 5.56 is ≈0.4 s; a pistol bullet drops more at 50 m than a rifle at 100 m', () => {
    expect(flyTo(300, 900, 0, AMMO['5.56x45'].dragK).time).toBeGreaterThan(0.36);
    expect(flyTo(300, 900, 0, AMMO['5.56x45'].dragK).time).toBeLessThan(0.44);
    expect(flyTo(50, 360, 0, AMMO['9x19'].dragK).height).toBeLessThan(
      flyTo(100, 840, 0, AMMO['7.62x51'].dragK).height,
    );
  });

  it('flyTo fails loudly for unreachable ranges', () => {
    expect(() => flyTo(2000, 100, -0.5, 0.01)).toThrow('never reached');
  });
});

describe('aim, spread and falloff', () => {
  it('aimVector: yaw 0 looks down −Z, unit length', () => {
    const v = aimVector(0, 0, { x: 0, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(0, 9);
    expect(v.z).toBeCloseTo(-1, 9);
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -1.5, max: 1.5, noNaN: true }),
        (y, p) => {
          const a = aimVector(y, p, { x: 0, y: 0, z: 0 });
          expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(1, 9);
        },
      ),
    );
  });

  it('cone samples stay inside the cone, fill it, and are deterministic', () => {
    const cone = degToRad(4);
    const rng = Rng.fromSeed(1);
    const out = { x: 0, y: 0, z: 0 };
    let maxAngle = 0;
    let insideHalfRadius = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      sampleCone(0, 0, -1, cone, rng, out);
      const angle = Math.acos(Math.min(1, -out.z));
      maxAngle = Math.max(maxAngle, angle);
      if (angle < cone / 4) insideHalfRadius++;
    }
    expect(maxAngle).toBeLessThanOrEqual(cone / 2 + 1e-4);
    expect(maxAngle).toBeGreaterThan((cone / 2) * 0.95);
    // Uniform over the disk: a quarter of samples within half the radius.
    expect(insideHalfRadius / n).toBeGreaterThan(0.22);
    expect(insideHalfRadius / n).toBeLessThan(0.28);
    const a = sampleCone(0.3, 0.1, -0.9, cone, Rng.fromSeed(9), { x: 0, y: 0, z: 0 });
    const b = sampleCone(0.3, 0.1, -0.9, cone, Rng.fromSeed(9), { x: 0, y: 0, z: 0 });
    expect(a).toEqual(b);
    const up = sampleCone(0, 1, 0, cone, rng, { x: 0, y: 0, z: 0 }); // degenerate basis
    expect(up.y).toBeGreaterThan(0.99);
  });

  it('MOA and degree conversions, falloff curve', () => {
    expect(moaToRad(60)).toBeCloseTo(degToRad(1), 12);
    expect(falloffFactor(10, 25, 60, 0.6)).toBe(1);
    expect(falloffFactor(100, 25, 60, 0.6)).toBe(0.6);
    expect(falloffFactor(42.5, 25, 60, 0.6)).toBeCloseTo(0.8);
  });
});

describe('RPG-7 rocket flight', () => {
  const w = WEAPONS.rpg7;
  if (w.kind !== 'firearm' || w.projectile.kind !== 'rocket')
    throw new Error('rpg7 must be a rocket launcher');
  const motor = w.projectile;
  const k = AMMO[w.ammo].dragK;

  it('leaves at 115 m/s, the sustainer takes it to ~295 m/s, then it coasts', () => {
    const s: ProjectileState = { px: 0, py: 0, pz: 0, vx: w.muzzleVelocity, vy: 0, vz: 0 };
    let peak = 0;
    let atIgnite = 0;
    for (let i = 0; i < 120; i++) {
      const age = i / 60;
      if (age < motor.ignite) atIgnite = speed(s);
      integrateRocket(s, k, motor, age, 1 / 60);
      peak = Math.max(peak, speed(s));
    }
    expect(atIgnite).toBeCloseTo(115, -1);
    expect(peak).toBeGreaterThan(270);
    expect(peak).toBeLessThan(320);
    expect(speed(s)).toBeLessThan(peak); // coasting after burnout
  });

  it('reaches 300 m in a little over a second; zeroed at 100 m it is on the sight line there', () => {
    const el = zeroElevation(w.zeroMeters, w.sightHeight, w.muzzleVelocity, k, motor);
    const at100 = flyTo(100, w.muzzleVelocity, el, k, 1 / 60, motor);
    expect(at100.height).toBeCloseTo(w.sightHeight, 2);
    const at300 = flyTo(300, w.muzzleVelocity, el, k, 1 / 60, motor);
    expect(at300.time).toBeGreaterThan(1.0);
    expect(at300.time).toBeLessThan(1.5);
    expect(at300.height).toBeLessThan(-1); // rockets drop a lot: hold over
  });

  it('a rocket at rest gets no thrust direction and just falls', () => {
    const s: ProjectileState = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 };
    integrateRocket(s, k, motor, 0.2, 1 / 60);
    expect(s.vx).toBe(0);
    expect(s.vy).toBeLessThan(0);
  });
});
