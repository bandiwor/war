import { describe, expect, it } from 'vitest';
import { seed } from '../../domain/core/brand';
import type { InputCommand } from '../../domain/input/commands';
import {
  BATTERY_SECONDS,
  Flashlight,
  Pose,
  SPRINT_SPEED,
  WALK_SPEED,
  createRenderView,
  createSandbox,
  readRenderView,
} from './sandbox';

const run = (
  sb: ReturnType<typeof createSandbox>,
  ticks: number,
  first: InputCommand[] = [],
): void => {
  sb.simulation.step(first);
  for (let i = 1; i < ticks; i++) sb.simulation.step();
};

describe('sandbox scene', () => {
  it('spawns the player at the layout spawn with the flashlight on', () => {
    const sb = createSandbox(seed(1));
    const view = readRenderView(sb, 1, createRenderView());
    expect([view.x, view.y, view.z]).toEqual([...sb.layout.spawn.position]);
    expect(view.yaw).toBe(sb.layout.spawn.yaw);
    expect(view.flashlightOn).toBe(true);
    expect(view.battery).toBe(1);
    expect(view.simTime).toBe(0);
  });

  it('walks forward along the view direction at walking speed', () => {
    const sb = createSandbox(seed(1));
    const start = readRenderView(sb, 1, createRenderView());
    run(sb, 60, [{ type: 'move', forward: 1, strafe: 0 }]);
    const v = readRenderView(sb, 1, createRenderView());
    // Spawn yaw is PI: forward is +Z.
    expect(v.z - start.z).toBeCloseTo(WALK_SPEED, 1);
    expect(Math.abs(v.x - start.x)).toBeLessThan(1e-6);
    expect(v.speed).toBeCloseTo(WALK_SPEED, 5);
    expect(v.stride).toBeCloseTo(WALK_SPEED, 1);
  });

  it('sprints only when moving forward, normalises diagonals', () => {
    const sb = createSandbox(seed(1));
    run(sb, 30, [
      { type: 'action', action: 'sprint', pressed: true },
      { type: 'move', forward: 1, strafe: 1 },
    ]);
    const v = readRenderView(sb, 1, createRenderView());
    expect(v.speed).toBeCloseTo(SPRINT_SPEED, 4);
    sb.simulation.step([{ type: 'move', forward: -1, strafe: 0 }]);
    expect(readRenderView(sb, 1, createRenderView()).speed).toBeCloseTo(WALK_SPEED, 4);
  });

  it('stays within walk bounds', () => {
    const sb = createSandbox(seed(1));
    run(sb, 60 * 60, [{ type: 'move', forward: -1, strafe: 0 }]);
    const v = readRenderView(sb, 1, createRenderView());
    expect(v.z).toBeGreaterThanOrEqual(sb.layout.walkBounds[1]);
  });

  it('interpolates between the previous and current tick', () => {
    const sb = createSandbox(seed(1));
    run(sb, 2, [{ type: 'move', forward: 1, strafe: 0 }]);
    const a0 = readRenderView(sb, 0, createRenderView());
    const a1 = readRenderView(sb, 1, createRenderView());
    const half = readRenderView(sb, 0.5, createRenderView());
    expect(half.z).toBeCloseTo((a0.z + a1.z) / 2, 10);
    expect(readRenderView(sb, 7, createRenderView()).z).toBe(a1.z); // alpha clamped
    expect(half.simTime).toBeCloseTo(1.5 / 60, 10);
  });

  it('toggles the flashlight on press edges and drains the battery only while on', () => {
    const sb = createSandbox(seed(1));
    const fl = sb.simulation.world.store(Flashlight);
    const row = fl.rowOf(sb.player);
    sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: true }]);
    expect(fl.fields.on[row]).toBe(0);
    sb.simulation.step(); // still held: no second toggle
    expect(fl.fields.on[row]).toBe(0);
    const battery = fl.fields.battery[row] ?? 0;
    run(sb, 600);
    expect(fl.fields.battery[row]).toBe(battery);
    sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: false }]);
    sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: true }]);
    expect(fl.fields.on[row]).toBe(1);
    run(sb, 600);
    expect(fl.fields.battery[row]).toBeCloseTo(battery - 600 / 60 / BATTERY_SECONDS, 4);
  });

  it('a dead battery switches the light off', () => {
    const sb = createSandbox(seed(1));
    const fl = sb.simulation.world.store(Flashlight);
    const row = fl.rowOf(sb.player);
    fl.fields.battery[row] = 1 / 60 / BATTERY_SECONDS;
    sb.simulation.step();
    expect(fl.fields.on[row]).toBe(0);
    expect(readRenderView(sb, 1, createRenderView()).flashlightOn).toBe(false);
  });

  it('systems tolerate a player without components', () => {
    const sb = createSandbox(seed(1));
    sb.simulation.world.despawn(sb.player);
    expect(() => {
      run(sb, 3, [{ type: 'move', forward: 1, strafe: 0 }]);
    }).not.toThrow();
    const v = readRenderView(sb, 1, createRenderView());
    expect(v.flashlightOn).toBe(false);
    expect(v.battery).toBe(0);
    expect(sb.simulation.world.store(Pose).size).toBe(0);
  });
});
