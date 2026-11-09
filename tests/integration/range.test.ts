import { describe, expect, it } from 'vitest';
import { Ammo, Hazard, Projectile, Rocket, Target } from '../../src/application/combat/components';
import {
  activeWeaponId,
  aimOffset,
  resetTargets,
} from '../../src/application/combat/combat-systems';
import { createEmptyWorld } from '../../src/application/scenes/empty-world';
import { Pose, createSandbox, type Sandbox } from '../../src/application/scenes/sandbox';
import { BODY_PARTS, RACES, VULNERABILITY } from '../../src/domain/combat/races';
import { seed } from '../../src/domain/core/brand';
import type { HitEvent } from '../../src/domain/events/bus';
import type { InputCommand } from '../../src/domain/input/commands';
import { RANGE } from '../../src/domain/world/range-layout';
import { WEAPON_IDS, type WeaponId } from '../../src/domain/weapons/registry';
import { newPhysics } from '../fixtures/physics';

const slot = (id: WeaponId): number => WEAPON_IDS.indexOf(id);

function range(): Sandbox {
  return createSandbox(seed(7), newPhysics(), { kind: 'range' });
}

interface Log {
  hits: HitEvent[];
  shots: number;
  impacts: number;
  explosions: number;
}

function step(sb: Sandbox, cmds: InputCommand[] = [], log?: Log): void {
  sb.simulation.step(cmds);
  if (log === undefined) return;
  const e = sb.simulation.events;
  for (let i = 0; i < e.hit.size; i++) {
    const h = e.hit.at(i);
    if (h) log.hits.push({ ...h });
  }
  log.shots += e.shot.size;
  log.impacts += e.impact.size;
  log.explosions += e.explosion.size;
}

function run(sb: Sandbox, ticks: number, log?: Log, first: InputCommand[] = []): void {
  for (let i = 0; i < ticks; i++) step(sb, i === 0 ? first : [], log);
}

const newLog = (): Log => ({ hits: [], shots: 0, impacts: 0, explosions: 0 });

/** Look so the sight line points at world point (x, y, z). */
function aimAt(sb: Sandbox, x: number, y: number, z: number): InputCommand {
  const p = sb.simulation.world.store(Pose);
  const r = p.rowOf(sb.player);
  const ex = p.fields.x[r] ?? 0;
  const ey = (p.fields.y[r] ?? 0) + (p.fields.eye[r] ?? 0);
  const ez = p.fields.z[r] ?? 0;
  const yaw = Math.atan2(-(x - ex), -(z - ez));
  const pitch = Math.atan2(y - ey, Math.hypot(x - ex, z - ez));
  return {
    type: 'look',
    yaw: yaw - (p.fields.yaw[r] ?? 0),
    pitch: pitch - (p.fields.pitch[r] ?? 0),
  };
}

/** Select a weapon and wait until it is drawn and recoil has settled. */
function equip(sb: Sandbox, id: WeaponId): void {
  run(sb, 90, undefined, [{ type: 'select', slot: slot(id) }]);
}

function fire(sb: Sandbox, log: Log, aim: InputCommand, ads = true, settle = 60): void {
  step(
    sb,
    [aim, ...(ads ? [{ type: 'action' as const, action: 'aim' as const, pressed: true }] : [])],
    log,
  );
  step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
  step(sb, [{ type: 'action', action: 'fire', pressed: false }], log);
  run(sb, settle, log);
}

const laneX = (race: (typeof RACES)[number]): number => RANGE.laneX[RACES.indexOf(race)] ?? 0;

describe('shooting range (stage 4 acceptance, simulation side)', () => {
  it('spawns the 24 race dummies and an infinite-ammo carbine in hand', () => {
    const sb = range();
    run(sb, 60);
    const targets = sb.simulation.world.store(Target);
    expect(targets.size).toBe(RACES.length * RANGE.distances.length);
    expect(activeWeaponId(sb.simulation.world, sb.player)).toBe('carbine');
    expect(sb.simulation.world.store(Ammo).fields.infinite[0]).toBe(1);
  });

  it('rifle headshot on a zombie at 100 m kills; the hit reports distance, drop and flight time', () => {
    const sb = range();
    equip(sb, 'rifle');
    const log = newLog();
    fire(sb, log, aimAt(sb, laneX('zombie'), 1.62, 100));
    const h = log.hits[0];
    expect(log.shots).toBe(1);
    expect(h).toBeDefined();
    expect(BODY_PARTS[h?.part ?? -1]).toBe('head');
    expect(h?.killed).toBe(true);
    expect(h?.distance).toBeCloseTo(100, -1);
    expect(h?.time).toBeGreaterThan(0.1);
    expect(h?.time).toBeLessThan(0.14);
  });

  it('bullet drop below the bore line at 300 m is physically right (≈ g·t²/2)', () => {
    const sb = range();
    equip(sb, 'rifle');
    const log = newLog();
    // The robot lane at 300 m: the diagonal sight line from the centre crosses no nearer dummy.
    // Zeroed at 100 m, the .308 lands ~0.45 m low at 300 m: hold over, like a real shooter.
    fire(sb, log, aimAt(sb, laneX('robot'), 0.95 + 0.45, 300));
    const h = log.hits[0];
    expect(h?.distance).toBeCloseTo(300, -1);
    expect(h).toBeDefined();
    // Drag also opposes the vertical velocity, so a real bullet falls a little less than
    // g·t²/2 over the same flight time.
    const t = h?.time ?? 0;
    const vacuum = (9.81 * t * t) / 2;
    expect(h?.drop).toBeGreaterThan(vacuum * 0.85);
    expect(h?.drop).toBeLessThan(vacuum);
    expect(h?.drop).toBeGreaterThan(0.5);
  });

  it('robots shrug off bullets to the chassis but not to the camera', () => {
    const sb = range();
    equip(sb, 'rifle');
    const log = newLog();
    fire(sb, log, aimAt(sb, laneX('robot'), 1.0, 25));
    fire(sb, log, aimAt(sb, laneX('robot'), 1.38, 50), true, 90);
    const [chassis, sensor] = log.hits;
    expect(BODY_PARTS[chassis?.part ?? -1]).toBe('chassis');
    expect(BODY_PARTS[sensor?.part ?? -1]).toBe('sensor');
    expect(sensor?.damage ?? 0).toBeGreaterThan((chassis?.damage ?? 0) * 2);
  });

  it('shotgun at 10 m lands several pellets', () => {
    const sb = range();
    equip(sb, 'shotgun');
    const log = newLog();
    fire(sb, log, aimAt(sb, laneX('animal'), 0.6, 10), false);
    expect(log.hits.length).toBeGreaterThanOrEqual(3);
    expect(log.hits.length + log.impacts).toBe(9);
  });

  it('EMP charge wrecks robots and leaves zombies untouched; flares burn zombies; molotovs burn plants', () => {
    const sb = range();
    const targets = sb.simulation.world.store(Target);
    const health = (race: (typeof RACES)[number], d: number): number => {
      for (let r = 0; r < targets.size; r++) {
        if (targets.fields.race[r] === RACES.indexOf(race) && targets.fields.z[r] === d)
          return targets.fields.health[r] ?? 0;
      }
      return -1;
    };
    const log = newLog();
    // Throw an EMP at the 10 m robot (throws release upward, so aim low and short).
    equip(sb, 'emp');
    step(sb, [aimAt(sb, laneX('robot'), 0, 6)], log);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
    run(sb, 240, log, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(log.explosions).toBeGreaterThanOrEqual(1);
    expect(health('robot', 10)).toBeLessThan(VULNERABILITY.robot.maxHealth * 0.5);
    expect(health('zombie', 10)).toBe(VULNERABILITY.zombie.maxHealth);

    resetTargets(sb.simulation.world);
    equip(sb, 'flare');
    step(sb, [aimAt(sb, laneX('zombie'), 0, 10)], log);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
    run(sb, 600, log, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(health('zombie', 10)).toBeLessThan(VULNERABILITY.zombie.maxHealth);
    expect(health('robot', 10)).toBe(VULNERABILITY.robot.maxHealth);

    resetTargets(sb.simulation.world);
    equip(sb, 'molotov');
    // Lob it: aiming 1.5 m above the eyes, a 12 m/s throw comes down through the bulb at 10 m.
    step(sb, [aimAt(sb, laneX('plant'), 3.2, 10)], log);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
    run(sb, 300, log, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(health('plant', 10)).toBeLessThan(VULNERABILITY.plant.maxHealth * 0.5);
  });

  it('frag grenade: radial damage with falloff', () => {
    const sb = range();
    equip(sb, 'frag');
    const log = newLog();
    step(sb, [aimAt(sb, laneX('zombie'), 0, 25)], log);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
    run(sb, 300, log, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(log.explosions).toBe(1);
    expect(log.hits.some((h) => h.part === -1)).toBe(true);
  });

  it('dead dummies stand back up on the range', () => {
    const sb = range();
    equip(sb, 'rifle');
    const log = newLog();
    fire(sb, log, aimAt(sb, laneX('zombie'), 1.62, 25));
    expect(log.hits[0]?.killed).toBe(true);
    run(sb, 60 * 5);
    const t = sb.simulation.world.store(Target);
    for (let r = 0; r < t.size; r++) expect(t.fields.health[r]).toBe(t.fields.maxHealth[r]);
  });

  it('is deterministic: the same session gives the same state hash', () => {
    const session = (): string => {
      const sb = range();
      equip(sb, 'carbine');
      const log = newLog();
      step(sb, [{ type: 'action', action: 'fireMode', pressed: true }]);
      step(sb, [{ type: 'action', action: 'fireMode', pressed: false }, aimAt(sb, 2, 1.2, 50)]);
      step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
      run(sb, 90, log, []);
      step(sb, [{ type: 'action', action: 'fire', pressed: false }], log);
      return sb.simulation.stateHash();
    };
    expect(session()).toBe(session());
  });
});

describe('RPG-7', () => {
  const health = (sb: Sandbox, race: (typeof RACES)[number], d: number): number => {
    const t = sb.simulation.world.store(Target);
    for (let r = 0; r < t.size; r++)
      if (t.fields.race[r] === RACES.indexOf(race) && t.fields.z[r] === d)
        return t.fields.health[r] ?? 0;
    return -1;
  };

  it('a direct hit destroys the 50 m robot; the rocket flies ~0.3 s and explodes', () => {
    const sb = range();
    equip(sb, 'rpg7');
    const log = newLog();
    fire(sb, log, aimAt(sb, laneX('robot'), 0.95, 50), true, 120);
    expect(log.shots).toBe(1);
    expect(log.explosions).toBe(1);
    const direct = log.hits.find((h) => h.part !== -1);
    expect(BODY_PARTS[direct?.part ?? -1]).toBe('chassis');
    expect(direct?.killed).toBe(true);
    expect(direct?.time).toBeGreaterThan(0.2);
    expect(direct?.time).toBeLessThan(0.45);
    expect(sb.simulation.world.store(Rocket).size).toBe(0);
  });

  it('splash reaches the next lane: a hit on the 25 m zombie also scorches the robot 4 m away', () => {
    const sb = range();
    equip(sb, 'rpg7');
    const log = newLog();
    fire(sb, log, aimAt(sb, laneX('zombie'), 1.2, 25), true, 120);
    expect(log.explosions).toBe(1);
    expect(health(sb, 'zombie', 25)).toBe(0);
    expect(health(sb, 'robot', 25)).toBeLessThan(VULNERABILITY.robot.maxHealth);
    expect(health(sb, 'robot', 25)).toBeGreaterThan(VULNERABILITY.robot.maxHealth * 0.8);
    expect(health(sb, 'plant', 25)).toBe(VULNERABILITY.plant.maxHealth); // 8 m away: out of the 5 m radius
  });

  it('inside the arming distance the rocket is a dud', () => {
    const sb = range();
    equip(sb, 'rpg7');
    const log = newLog();
    fire(sb, log, aimAt(sb, 0, 0.7, 1.2), false, 60); // the bench, 1 m away
    expect(log.shots).toBe(1);
    expect(log.explosions).toBe(0);
    expect(log.impacts).toBe(1);
  });

  it('fired into the sky it self-destructs at 4.5 s', () => {
    const sb = range();
    equip(sb, 'rpg7');
    const log = newLog();
    step(sb, [{ type: 'look', yaw: 0, pitch: 0.9 }], log);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
    run(sb, 60 * 4, log, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(log.explosions).toBe(0);
    run(sb, 60, log);
    expect(log.explosions).toBe(1);
  });

  it('street loadout carries three rockets after the one in the tube', () => {
    const sb = createSandbox(seed(1), newPhysics());
    expect(sb.simulation.world.store(Ammo).fields.rpg[0]).toBe(3);
  });
});

describe('combat edge cases', () => {
  it('next/previous weapon cycles through the loadout', () => {
    const sb = range();
    run(sb, 60);
    step(sb, [{ type: 'action', action: 'nextWeapon', pressed: true }]);
    step(sb, [{ type: 'action', action: 'nextWeapon', pressed: false }]);
    expect(activeWeaponId(sb.simulation.world, sb.player)).toBe('rifle');
    step(sb, [{ type: 'action', action: 'prevWeapon', pressed: true }]);
    step(sb, [{ type: 'action', action: 'prevWeapon', pressed: false }]);
    step(sb, [{ type: 'action', action: 'prevWeapon', pressed: true }]);
    expect(activeWeaponId(sb.simulation.world, sb.player)).toBe('shotgun');
    step(sb, [{ type: 'select', slot: 1 }]); // already selected: no-op
    expect(activeWeaponId(sb.simulation.world, sb.player)).toBe('shotgun');
  });

  it('a knife swing into a wall makes an impact, not a hit', () => {
    const sb = range();
    equip(sb, 'knife');
    // The bench is 1.2 m ahead at waist height.
    const log = newLog();
    step(sb, [aimAt(sb, 0, 0.8, 1.2)], log);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
    run(sb, 40, log, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(log.hits).toHaveLength(0);
    expect(log.impacts).toBeGreaterThanOrEqual(1);
  });

  it('fires burn out; bullets fired at the sky age out without hitting anything', () => {
    const sb = range();
    equip(sb, 'molotov');
    step(sb, [aimAt(sb, 0, 0, 5)]);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }]);
    run(sb, 120, undefined, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(sb.simulation.world.store(Hazard).size).toBe(1);
    run(sb, 60 * 10);
    expect(sb.simulation.world.store(Hazard).size).toBe(0);

    equip(sb, 'carbine');
    const log = newLog();
    step(sb, [{ type: 'look', yaw: 0, pitch: 1.4 }], log);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
    step(sb, [{ type: 'action', action: 'fire', pressed: false }], log);
    expect(sb.simulation.world.store(Projectile).size).toBe(1);
    run(sb, 60 * 5, log);
    expect(sb.simulation.world.store(Projectile).size).toBe(0);
    expect(log.hits.length + log.impacts).toBe(0);
  });

  it('combat helpers are safe in scenes without weapons', () => {
    const empty = createEmptyWorld(seed(1));
    const off = { pitch: 9, yaw: 9 };
    aimOffset(empty.simulation.world, empty.player, off);
    expect(off).toEqual({ pitch: 0, yaw: 0 });
    expect(activeWeaponId(empty.simulation.world, empty.player)).toBeNull();
    expect(() => {
      resetTargets(empty.simulation.world);
    }).not.toThrow();
  });
});

describe('street sandbox: limited ammo and melee', () => {
  it('pistol: 17+1, the reserve pays for reloads', () => {
    const sb = createSandbox(seed(1), newPhysics());
    run(sb, 60);
    const ammo = sb.simulation.world.store(Ammo);
    const before = ammo.fields.r9x19[0] ?? 0;
    const log = newLog();
    for (let i = 0; i < 18; i++) {
      step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
      run(sb, 10, log, [{ type: 'action', action: 'fire', pressed: false }]);
    }
    expect(log.shots).toBe(18);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }], log); // dry fire
    step(sb, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(log.shots).toBe(18);
    run(sb, 180, log, [{ type: 'action', action: 'reload', pressed: true }]);
    expect(ammo.fields.r9x19[0]).toBe(before - 17);
  });

  it("knife hits the zombie dummy at arm's length", () => {
    const sb = createSandbox(seed(1), newPhysics());
    const t = sb.simulation.world.store(Target);
    let zr = -1;
    for (let r = 0; r < t.size; r++) if (t.fields.race[r] === RACES.indexOf('zombie')) zr = r;
    expect(zr).toBeGreaterThanOrEqual(0);
    const log = newLog();
    equip(sb, 'knife');
    // Walk to it: aim at the dummy and walk forward until close.
    const zx = t.fields.x[zr] ?? 0;
    const zz = t.fields.z[zr] ?? 0;
    step(sb, [aimAt(sb, zx, 1.2, zz), { type: 'move', forward: 1, strafe: 0 }]);
    for (let i = 0; i < 60 * 60; i++) {
      const p = sb.simulation.world.store(Pose);
      const dist = Math.hypot((p.fields.x[0] ?? 0) - zx, (p.fields.z[0] ?? 0) - zz);
      if (dist < 1.1) break;
      step(sb, i % 30 === 0 ? [aimAt(sb, zx, 1.2, zz)] : []);
    }
    step(sb, [{ type: 'move', forward: 0, strafe: 0 }, aimAt(sb, zx, 1.2, zz)]);
    step(sb, [{ type: 'action', action: 'fire', pressed: true }], log);
    run(sb, 40, log, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(log.hits.length).toBe(1);
    expect(log.hits[0]?.damage).toBeGreaterThan(10);
  });
});
