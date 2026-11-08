import { describe, expect, it } from 'vitest';
import {
  BATTERY_SECONDS,
  Flashlight,
  Motor,
  createRenderView,
  readRenderView,
  type Sandbox,
} from '../../src/application/scenes/sandbox';
import type { InputCommand } from '../../src/domain/input/commands';
import { PLAYER_TUNING as T } from '../../src/domain/player/tuning';
import type { SurfaceId } from '../../src/domain/world/surfaces';
import { STREET } from '../../src/domain/world/street-layout';
import { newSandbox } from '../fixtures/physics';

interface Run {
  footsteps: SurfaceId[];
  lands: number;
  jumps: number;
  maxY: number;
}

/** Steps the sandbox, collecting events after every tick like the game loop does. */
function run(
  sb: Sandbox,
  ticks: number,
  first: InputCommand[] = [],
  acc: Run = { footsteps: [], lands: 0, jumps: 0, maxY: -Infinity },
): Run {
  for (let i = 0; i < ticks; i++) {
    sb.simulation.step(i === 0 ? first : []);
    const ev = sb.simulation.events;
    for (let k = 0; k < ev.footstep.size; k++)
      acc.footsteps.push(ev.footstep.at(k)?.surface ?? 'water');
    acc.lands += ev.land.size;
    acc.jumps += ev.jump.size;
    acc.maxY = Math.max(acc.maxY, view(sb).y);
  }
  return acc;
}

const view = (sb: Sandbox) => readRenderView(sb, 1, createRenderView());
/** Turn to face +X (yaw -PI/2) from the spawn yaw. */
const faceEast = (sb: Sandbox): InputCommand => ({
  type: 'look',
  yaw: -Math.PI / 2 - sb.layout.spawn.yaw,
  pitch: 0,
});

describe('sandbox with physics', () => {
  it('spawns standing on the road with eyes at 1.7 m', () => {
    const sb = newSandbox();
    run(sb, 3);
    const v = view(sb);
    expect(v.y).toBeCloseTo(1.7, 1);
    expect(v.grounded).toBe(true);
    expect(v.flashlightOn).toBe(true);
  });

  it('walks forward at walking speed with footsteps on asphalt', () => {
    const sb = newSandbox();
    const z0 = view(sb).z;
    const r = run(sb, 180, [{ type: 'move', forward: 1, strafe: 0 }]);
    const v = view(sb);
    expect(v.z - z0).toBeGreaterThan(T.walkSpeed * 3 * 0.9);
    expect(v.speed).toBeCloseTo(T.walkSpeed, 2);
    expect(r.footsteps.length).toBeGreaterThanOrEqual(5);
    expect(new Set(r.footsteps)).toEqual(new Set(['asphalt']));
  });

  it('steps up the curb onto the concrete sidewalk and is stopped by facades/blockers', () => {
    const sb = newSandbox();
    const r = run(sb, 60 * 10, [faceEast(sb), { type: 'move', forward: 1, strafe: 0 }]);
    const v = view(sb);
    expect(v.y).toBeCloseTo(STREET.curbHeight + 1.7, 1);
    expect(v.x).toBeLessThan(STREET.roadHalfWidth + STREET.sidewalkWidth + 3);
    expect(r.footsteps).toContain('concrete');
    expect(r.footsteps).toContain('asphalt');
  });

  it('jumps about 45 cm and lands', () => {
    const sb = newSandbox();
    run(sb, 5);
    const ground = view(sb).y;
    const r = run(sb, 90, [{ type: 'action', action: 'jump', pressed: true }]);
    expect(r.jumps).toBe(1);
    expect(r.maxY - ground).toBeGreaterThan(0.35);
    expect(r.maxY - ground).toBeLessThan(0.55);
    expect(r.lands).toBe(1);
    expect(view(sb).grounded).toBe(true);
  });

  it('crouching lowers the eyes; sprinting drains stamina and moves faster', () => {
    const sb = newSandbox();
    run(sb, 30, [{ type: 'action', action: 'crouch', pressed: true }]);
    expect(view(sb).y).toBeCloseTo(T.crouchHeight - T.eyeFromTop, 1);
    run(sb, 30, [{ type: 'action', action: 'crouch', pressed: false }]);
    expect(view(sb).y).toBeCloseTo(1.7, 1);
    // 60 ticks: ~3 m of sprinting stays clear of the barrel standing in the road at z ≈ -49.4 (seed 1).
    run(sb, 60, [
      { type: 'action', action: 'sprint', pressed: true },
      { type: 'move', forward: 1, strafe: 0 },
    ]);
    const v = view(sb);
    expect(v.speed).toBeCloseTo(T.sprintSpeed, 1);
    expect(v.stamina).toBeLessThan(1);
  });

  it('toggles the flashlight on press edges; battery drains only while on; a dead battery switches it off', () => {
    const sb = newSandbox();
    const fl = sb.simulation.world.store(Flashlight);
    const row = fl.rowOf(sb.player);
    run(sb, 2, [{ type: 'action', action: 'flashlight', pressed: true }]);
    expect(fl.fields.on[row]).toBe(0);
    const battery = fl.fields.battery[row] ?? 0;
    run(sb, 600);
    expect(fl.fields.battery[row]).toBe(battery);
    sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: false }]);
    run(sb, 600, [{ type: 'action', action: 'flashlight', pressed: true }]);
    expect(fl.fields.on[row]).toBe(1);
    expect(fl.fields.battery[row]).toBeCloseTo(battery - 600 / 60 / BATTERY_SECONDS, 4);
    fl.fields.battery[row] = 1 / 60 / BATTERY_SECONDS;
    sb.simulation.step();
    expect(view(sb).flashlightOn).toBe(false);
  });

  it('interpolates between ticks', () => {
    const sb = newSandbox();
    run(sb, 20, [{ type: 'move', forward: 1, strafe: 0 }]);
    const a0 = readRenderView(sb, 0, createRenderView());
    const a1 = readRenderView(sb, 1, createRenderView());
    expect(readRenderView(sb, 0.5, createRenderView()).z).toBeCloseTo((a0.z + a1.z) / 2, 10);
  });

  it('same seed and inputs give the same state hash (including physics)', () => {
    const script: InputCommand[] = [
      { type: 'move', forward: 1, strafe: 0.4 },
      { type: 'look', yaw: 0.3, pitch: 0 },
    ];
    const a = newSandbox(5);
    const b = newSandbox(5);
    run(a, 300, script);
    run(b, 300, script);
    expect(a.simulation.stateHash()).toBe(b.simulation.stateHash());
    const motor = a.simulation.world.store(Motor);
    motor.fields.vx[motor.rowOf(a.player)] = 99; // ECS divergence is caught
    expect(a.simulation.stateHash()).not.toBe(b.simulation.stateHash());
  });

  it('systems tolerate a despawned player', () => {
    const sb = newSandbox();
    sb.simulation.world.despawn(sb.player);
    expect(() => run(sb, 3, [{ type: 'move', forward: 1, strafe: 0 }])).not.toThrow();
  });
});
