import { expect } from 'vitest';
import { DEAD_ACTION, Mob } from '../../src/application/ai/components';
import { spawnMob } from '../../src/application/ai/systems';
import { Target } from '../../src/application/combat/components';
import {
  createRenderView,
  createSandbox,
  readRenderView,
  type Sandbox,
} from '../../src/application/scenes/sandbox';
import { UTILITY_ACTIONS } from '../../src/domain/ai/utility';
import { seed } from '../../src/domain/core/brand';
import type { EntityId } from '../../src/domain/ecs/entity';
import type { InputCommand } from '../../src/domain/input/commands';
import type { MobId } from '../../src/domain/mobs/registry';
import type { LightPiece, StreetLayout } from '../../src/domain/world/street-layout';
import { newPhysics } from './physics';

/**
 * The AI scenario arena: a 60 m square floor, a 20 m wall along x = 0
 * (z ∈ [−10, 10]) to hide behind, invisible walls around. Optional lamps.
 */
export function arenaLayout(lights: readonly LightPiece[] = []): StreetLayout {
  return {
    kind: 'street',
    targets: [],
    zones: [{ zone: 'researchComplex', min: [-40, -40], max: [40, 40] }],
    boxes: [
      { material: 'concrete', center: [0, -0.2, 0], size: [60, 0.4, 60], yaw: 0, solid: true },
      { material: 'brick', center: [0, 1.5, 0], size: [1, 3, 20], yaw: 0, solid: true },
    ],
    blockers: [
      { center: [-30.5, 5, 0], size: [1, 10, 62] },
      { center: [30.5, 5, 0], size: [1, 10, 62] },
      { center: [0, 5, -30.5], size: [62, 10, 1] },
      { center: [0, 5, 30.5], size: [62, 10, 1] },
    ],
    props: [],
    lights,
    spawn: { position: [-20, 0, 0], yaw: 0 },
    walkBounds: [-29, -29, 29, 29],
  };
}

export const ARENA = arenaLayout();

/** A lit sodium lamp at (x, z): its pool lights ~10 m of ground. */
export function lamp(x: number, z: number): LightPiece {
  return {
    kind: 'sodiumLamp',
    position: [x, 6, z],
    color: [1, 0.55, 0.18],
    intensity: 60,
    range: 22,
    flicker: 0,
  };
}

export function arena(s = 1, layout: StreetLayout = ARENA): Sandbox {
  return createSandbox(seed(s), newPhysics(), { layout });
}

export function run(sb: Sandbox, ticks: number, first: InputCommand[] = []): void {
  for (let i = 0; i < ticks; i++) sb.simulation.step(i === 0 ? first : []);
}

/** Yaw that makes a body at (x, z) face (tx, tz) (forward is −Z rotated by yaw). */
export const facing = (x: number, z: number, tx: number, tz: number): number =>
  Math.atan2(-(tx - x), -(tz - z));

export const at = (x: number, z: number): InputCommand => ({ type: 'teleport', x, y: 0.05, z });

export function place(
  sb: Sandbox,
  id: MobId,
  x: number,
  z: number,
  faceX: number,
  faceZ: number,
): EntityId {
  return spawnMob(sb.simulation.world, sb.ai, id, x, z, facing(x, z, faceX, faceZ));
}

/** Turns a mob to face (x, z). */
export function face(sb: Sandbox, e: EntityId, x: number, z: number): void {
  const t = sb.simulation.world.store(Target);
  const r = t.rowOf(e);
  t.fields.yaw[r] = facing(t.fields.x[r] ?? 0, t.fields.z[r] ?? 0, x, z);
}

/** A bullet's worth of hit: the mob is hurt and knows where it came from. */
export function hit(sb: Sandbox, e: EntityId, damage: number): void {
  const t = sb.simulation.world.store(Target);
  const r = t.rowOf(e);
  t.fields.health[r] = Math.max(1, (t.fields.health[r] ?? 0) - damage);
  t.fields.hits[r] = (t.fields.hits[r] ?? 0) + 1;
}

export function state(sb: Sandbox, e: EntityId) {
  const w = sb.simulation.world;
  const m = w.store(Mob);
  const r = m.rowOf(e);
  const t = w.store(Target);
  const tr = t.rowOf(e);
  const action = m.fields.action[r] ?? 0;
  const f = m.fields;
  return {
    action: action === DEAD_ACTION ? 'dead' : (UTILITY_ACTIONS[action] ?? '?'),
    x: t.fields.x[tr] ?? 0,
    z: t.fields.z[tr] ?? 0,
    yaw: t.fields.yaw[tr] ?? 0,
    awareness: f.awareness[r] ?? 0,
    sensing: f.sensing[r] === 1,
    hasLast: f.hasLast[r] === 1,
    searchLeft: f.searchLeft[r] ?? 0,
    health: t.fields.health[tr] ?? 0,
    light: f.light[r] ?? 0,
    hunger: f.hunger[r] ?? 0,
    fear: f.fear[r] ?? 0,
    blind: f.blind[r] ?? 0,
    attached: f.attached[r] === 1,
    informed: f.informed[r] === 1,
    stun: f.stun[r] ?? 0,
  };
}

export function player(sb: Sandbox) {
  return readRenderView(sb, 1, createRenderView());
}

/** Invulnerable player: scenarios observe behaviour without the player dying and respawning. */
export function god(sb: Sandbox): void {
  sb.simulation.step([{ type: 'cheat', key: 'god', on: true }]);
}

export function flashlightOff(sb: Sandbox): void {
  sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: true }]);
  sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: false }]);
  expect(player(sb).flashlightOn).toBe(false);
}

export function flashlightToggle(sb: Sandbox): void {
  sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: true }]);
  sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: false }]);
}

/**
 * Walks the player along straight segments at `speed` m/s by teleporting a
 * little each tick (a continuous scent trail, independent of the motor).
 */
export function walk(
  sb: Sandbox,
  points: readonly (readonly [number, number])[],
  speed = 1.5,
  onTick: () => void = () => undefined,
): void {
  const step = speed / 60;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1] ?? [0, 0];
    const [bx, bz] = points[i] ?? [0, 0];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) {
      sb.simulation.step([at(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)]);
      onTick();
    }
  }
}

/** Turns the player to face (tx, tz) from where they stand. */
export function lookAt(sb: Sandbox, tx: number, tz: number): void {
  const v = player(sb);
  const want = facing(v.x, v.z, tx, tz);
  let d = want - v.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  sb.simulation.step([{ type: 'look', yaw: d, pitch: -v.pitch }]);
}
