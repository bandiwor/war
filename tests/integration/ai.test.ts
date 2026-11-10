import { describe, expect, it, onTestFinished } from 'vitest';
import { Mob, PlayerVitals, DEAD_ACTION } from '../../src/application/ai/components';
import { spawnMob } from '../../src/application/ai/systems';
import { Target } from '../../src/application/combat/components';
import { ReplayRecorder, playReplay } from '../../src/application/replay/replay';
import {
  createRenderView,
  createSandbox,
  readRenderView,
  WORLD_POPULATION,
  type Sandbox,
} from '../../src/application/scenes/sandbox';
import { UTILITY_ACTIONS } from '../../src/domain/ai/utility';
import { seed } from '../../src/domain/core/brand';
import type { EntityId } from '../../src/domain/ecs/entity';
import type { InputCommand } from '../../src/domain/input/commands';
import { MOBS, mobAt, type MobId } from '../../src/domain/mobs/registry';
import { hotPatch } from '../../src/domain/core/hot-patch';
import type { StreetLayout } from '../../src/domain/world/street-layout';
import { hubAt } from '../../src/domain/world/world-map';
import { newPhysics } from '../fixtures/physics';

/**
 * Stage-6 AI scenarios: deterministic, so every expectation below is exact
 * for the given seed and replayable.
 */
const ARENA: StreetLayout = {
  kind: 'street',
  targets: [],
  zones: [{ zone: 'researchComplex', min: [-40, -40], max: [40, 40] }],
  boxes: [
    { material: 'concrete', center: [0, -0.2, 0], size: [60, 0.4, 60], yaw: 0, solid: true },
    // The corner: a wall along z ∈ [−10, 10] at x = 0.
    { material: 'brick', center: [0, 1.5, 0], size: [1, 3, 20], yaw: 0, solid: true },
  ],
  blockers: [
    { center: [-30.5, 5, 0], size: [1, 10, 62] },
    { center: [30.5, 5, 0], size: [1, 10, 62] },
    { center: [0, 5, -30.5], size: [62, 10, 1] },
    { center: [0, 5, 30.5], size: [62, 10, 1] },
  ],
  props: [],
  lights: [],
  spawn: { position: [-20, 0, 0], yaw: 0 },
  walkBounds: [-29, -29, 29, 29],
};

function arena(s = 1): Sandbox {
  return createSandbox(seed(s), newPhysics(), { layout: ARENA });
}

function run(sb: Sandbox, ticks: number, first: InputCommand[] = []): void {
  for (let i = 0; i < ticks; i++) sb.simulation.step(i === 0 ? first : []);
}

/** Yaw that makes a body at (x, z) face (tx, tz) (forward is −Z rotated by yaw). */
const facing = (x: number, z: number, tx: number, tz: number): number =>
  Math.atan2(-(tx - x), -(tz - z));

function state(sb: Sandbox, e: EntityId) {
  const w = sb.simulation.world;
  const m = w.store(Mob);
  const r = m.rowOf(e);
  const t = w.store(Target);
  const tr = t.rowOf(e);
  const action = m.fields.action[r] ?? 0;
  return {
    action: action === DEAD_ACTION ? 'dead' : (UTILITY_ACTIONS[action] ?? '?'),
    x: t.fields.x[tr] ?? 0,
    z: t.fields.z[tr] ?? 0,
    awareness: m.fields.awareness[r] ?? 0,
    sensing: m.fields.sensing[r] === 1,
    hasLast: m.fields.hasLast[r] === 1,
    searchLeft: m.fields.searchLeft[r] ?? 0,
    health: t.fields.health[tr] ?? 0,
  };
}

const at = (x: number, z: number): InputCommand => ({ type: 'teleport', x, y: 0.05, z });

function place(
  sb: Sandbox,
  id: MobId,
  x: number,
  z: number,
  faceX: number,
  faceZ: number,
): EntityId {
  return spawnMob(sb.simulation.world, sb.ai, id, x, z, facing(x, z, faceX, faceZ));
}

function flashlightOff(sb: Sandbox): void {
  sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: true }]);
  sb.simulation.step([{ type: 'action', action: 'flashlight', pressed: false }]);
  expect(readRenderView(sb, 1, createRenderView()).flashlightOn).toBe(false);
}

describe('sight (robots: cameras that need light)', () => {
  it('sees a lit player in its cone and chases; an unlit one at night stays unseen', () => {
    const lit = arena();
    run(lit, 2, [at(-20, 15)]);
    const a = place(lit, 'sentry', -20, -5, -20, 15);
    run(lit, 60);
    expect(state(lit, a).sensing).toBe(true);
    expect(state(lit, a).action).toBe('chase');

    const dark = arena();
    run(dark, 2, [at(-20, 15)]);
    flashlightOff(dark);
    const b = place(dark, 'sentry', -20, -5, -20, 15);
    run(dark, 120);
    expect(state(dark, b).sensing).toBe(false);
    expect(state(dark, b).action).not.toBe('chase');
  });

  it('does not see behind itself', () => {
    const sb = arena();
    run(sb, 2, [at(-20, 15)]);
    const m = place(sb, 'sentry', -20, 5, -20, -20); // facing away
    run(sb, 60);
    expect(state(sb, m).sensing).toBe(false);
  });

  it('loses the player behind a corner, goes to the last known position, searches ~10 s, then gives up', () => {
    // A lone robot: no reinforcements (they would keep it informed over the network).
    const savedTactics = { ...MOBS.sentry.tactics };
    hotPatch(MOBS.sentry.tactics, { ...savedTactics, reinforce: 0 });
    onTestFinished(() => {
      hotPatch(MOBS.sentry.tactics, savedTactics);
    });
    const sb = arena();
    run(sb, 2, [at(-6, 12)]);
    const m = place(sb, 'sentry', -6, -8, -6, 12);
    run(sb, 30);
    expect(state(sb, m).sensing).toBe(true);
    // Step behind the wall (x > 0): out of sight.
    run(sb, 1, [at(8, 0)]);
    let searchStart = -1;
    let gaveUp = -1;
    for (let t = 0; t < 60 * 40; t++) {
      sb.simulation.step();
      const s = state(sb, m);
      if (s.sensing) break;
      if (searchStart < 0 && s.searchLeft > 0) searchStart = t;
      if (searchStart >= 0 && !s.hasLast) {
        gaveUp = t;
        break;
      }
    }
    expect(searchStart).toBeGreaterThan(0);
    const searched = (gaveUp - searchStart) / 60;
    expect(searched).toBeGreaterThan(MOBS.sentry.memory.search - 0.5);
    expect(searched).toBeLessThan(MOBS.sentry.memory.search + 0.5);
    // Its last known position was where the player was last seen, on the near side of the wall.
    expect(state(sb, m).x).toBeLessThan(0);
  });
});

describe('hearing and proximity', () => {
  it('a gunshot behind a wall brings a wolf to investigate; it was not seeing anything', () => {
    const sb = arena(3);
    run(sb, 2, [at(10, 0)]);
    flashlightOff(sb);
    const wolf = place(sb, 'wolf', -12, 0, -25, 0); // other side of the wall, looking away
    run(sb, 30);
    expect(state(sb, wolf).hasLast).toBe(false);
    const fire: InputCommand[] = [{ type: 'action', action: 'fire', pressed: true }];
    run(sb, 1, fire);
    run(sb, 1, [{ type: 'action', action: 'fire', pressed: false }]);
    expect(state(sb, wolf).hasLast).toBe(true);
    run(sb, 30);
    expect(['investigate', 'chase']).toContain(state(sb, wolf).action);
    // It paths around the wall (~31 m at an investigating trot) to where the shot came from.
    run(sb, 60 * 16);
    const s = state(sb, wolf);
    expect(s.x).toBeGreaterThan(0);
    expect(Math.hypot(s.x - 10, s.z)).toBeLessThan(8);
  });
});

describe('fighting', () => {
  it('attacks in reach; god mode stops the damage; zero health goes down and respawns', () => {
    const sb = arena();
    run(sb, 2, [at(-10, 0)]);
    const zombie = place(sb, 'shambler', -10, -1.2, -10, 0);
    const v = (): { health: number; down: boolean; deaths: number } =>
      readRenderView(sb, 1, createRenderView()).vitals;
    run(sb, 120);
    expect(state(sb, zombie).action).toBe('attack');
    expect(v().health).toBeLessThan(100);
    run(sb, 1, [
      { type: 'cheat', key: 'heal', on: true },
      { type: 'cheat', key: 'god', on: true },
    ]);
    run(sb, 180);
    expect(v().health).toBe(100);
    run(sb, 1, [{ type: 'cheat', key: 'god', on: false }]);
    run(sb, 60 * 15);
    expect(v().deaths).toBeGreaterThanOrEqual(1);
    // Respawned at the layout's start, healthy.
    const view = readRenderView(sb, 1, createRenderView());
    expect(
      Math.hypot(view.x - ARENA.spawn.position[0], view.z - ARENA.spawn.position[2]),
    ).toBeLessThan(6);
  });

  it('a rooted flytrap never moves but bites what comes within reach', () => {
    const sb = arena();
    run(sb, 2, [at(-10, 0)]);
    const trap = place(sb, 'flytrap', -10, -2, -10, 0);
    run(sb, 240);
    const s = state(sb, trap);
    expect([s.x, s.z]).toEqual([-10, -2]);
    expect(sb.ai.stats.attacks).toBeGreaterThan(0);
  });

  it('being shot alerts a mob to the shooter; a badly hurt wolf flees', () => {
    const sb = arena(4);
    run(sb, 2, [at(-20, 0)]);
    const wolf = place(sb, 'wolf', -20, 12, -20, 30);
    const t = sb.simulation.world.store(Target);
    const tr = t.rowOf(wolf);
    t.fields.health[tr] = (t.fields.maxHealth[tr] ?? 0) * 0.1;
    t.fields.hits[tr] = (t.fields.hits[tr] ?? 0) + 1;
    run(sb, 30);
    expect(state(sb, wolf).awareness).toBeGreaterThan(0.5);
    expect(state(sb, wolf).action).toBe('flee');
    const before = Math.hypot(state(sb, wolf).x + 20, state(sb, wolf).z);
    run(sb, 120);
    expect(Math.hypot(state(sb, wolf).x + 20, state(sb, wolf).z)).toBeGreaterThan(before + 3);
  });

  it('dead mobs stop thinking', () => {
    const sb = arena();
    run(sb, 2, [at(-10, 0)]);
    const z = place(sb, 'shambler', -10, -5, -10, 0);
    const t = sb.simulation.world.store(Target);
    t.fields.health[t.rowOf(z)] = 0;
    run(sb, 30);
    expect(state(sb, z).action).toBe('dead');
  });
});

describe('navigation', () => {
  it('spawn commands put any registry mob on walkable ground and nowhere else', () => {
    const sb = arena();
    run(sb, 1, [
      { type: 'spawn', mob: 'boar', x: -15, z: 10, yaw: 0 },
      { type: 'spawn', mob: 'boar', x: 0, z: 0, yaw: 0 }, // inside the wall
      { type: 'spawn', mob: 'dragon', x: -15, z: 12, yaw: 0 },
    ]);
    expect(sb.simulation.world.store(Mob).size).toBe(1);
  });
});

describe('memory, home and edge cases', () => {
  it('a mob without a search time forgets as soon as it reaches the last known position', () => {
    // Registry edits go through the same in-place patch as dev hot reload.
    const saved = { ...MOBS.wolf.memory };
    hotPatch(MOBS.wolf.memory, { ...saved, search: 0 });
    try {
      const sb = arena(6);
      run(sb, 2, [at(10, 0)]);
      flashlightOff(sb);
      const wolf = place(sb, 'wolf', -12, 0, -25, 0);
      run(sb, 1, [{ type: 'action', action: 'fire', pressed: true }]);
      run(sb, 1, [{ type: 'action', action: 'fire', pressed: false }]);
      run(sb, 1, [at(-20, 25)]); // leave before it arrives
      let forgot = false;
      for (let t = 0; t < 60 * 30 && !forgot; t++) {
        sb.simulation.step();
        forgot = !state(sb, wolf).hasLast && !state(sb, wolf).sensing;
      }
      expect(forgot).toBe(true);
    } finally {
      hotPatch(MOBS.wolf.memory, saved);
    }
  });

  it('goes home when calm and far from where it spawned', () => {
    const sb = arena();
    run(sb, 2, [at(-25, -25)]);
    flashlightOff(sb);
    const boar = place(sb, 'boar', -15, 20, -15, 25);
    const m = sb.simulation.world.store(Mob);
    const r = m.rowOf(boar);
    m.fields.homeX[r] = 15;
    m.fields.homeZ[r] = 20;
    run(sb, 60 * 3);
    expect(state(sb, boar).action).toBe('home');
    // Home brings it back within its roam radius, where it wanders again.
    run(sb, 60 * 20);
    expect(Math.hypot(state(sb, boar).x - 15, state(sb, boar).z - 20)).toBeLessThan(
      MOBS.boar.temperament.roam + 1,
    );
  });

  it('a far noise beyond the path window is approached in a straight line, sliding along walls', () => {
    const sb = createSandbox(seed(7), newPhysics(), {
      layout: {
        ...ARENA,
        boxes: [
          {
            material: 'concrete',
            center: [0, -0.2, 0],
            size: [140, 0.4, 140],
            yaw: 0,
            solid: true,
          },
        ],
        blockers: [],
      },
    });
    run(sb, 2, [at(0, 0)]);
    flashlightOff(sb);
    const wolf = place(sb, 'wolf', 0, 60, 0, 70);
    run(sb, 1, [{ type: 'action', action: 'fire', pressed: true }]);
    run(sb, 1, [{ type: 'action', action: 'fire', pressed: false }]);
    run(sb, 60 * 4);
    expect(state(sb, wolf).z).toBeLessThan(56);
  });

  it('noclip flies through walls; heal restores health', () => {
    const sb = arena();
    run(sb, 2, [at(-5, 0)]);
    // Face +X (through the wall at x = 0) and fly.
    run(sb, 1, [
      { type: 'look', yaw: -Math.PI / 2, pitch: 0 },
      { type: 'cheat', key: 'noclip', on: true },
    ]);
    run(sb, 90, [{ type: 'move', forward: 1, strafe: 0 }]);
    const v = readRenderView(sb, 1, createRenderView());
    expect(v.x).toBeGreaterThan(2);
    expect(v.vitals.noclip).toBe(true);
    run(sb, 1, [
      { type: 'cheat', key: 'noclip', on: false },
      { type: 'move', forward: 0, strafe: 0 },
    ]);
    const vit = sb.simulation.world.store(PlayerVitals);
    vit.fields.health[vit.rowOf(sb.player)] = 10;
    run(sb, 1, [{ type: 'cheat', key: 'heal', on: true }]);
    expect(readRenderView(sb, 1, createRenderView()).vitals.health).toBe(100);
  });

  it('explosions are heard from far away', () => {
    const sb = createSandbox(seed(8), newPhysics(), { kind: 'range' });
    run(sb, 2, [{ type: 'select', slot: 10 }]); // the RPG-7
    run(sb, 120);
    const wolf = place(sb, 'wolf', 0, 30, 0, 60);
    expect(state(sb, wolf).hasLast).toBe(false);
    run(sb, 1, [{ type: 'action', action: 'fire', pressed: true }]);
    run(sb, 1, [{ type: 'action', action: 'fire', pressed: false }]);
    run(sb, 240);
    expect(state(sb, wolf).hasLast).toBe(true);
  });
});

describe('open world population', () => {
  it('fills the world around the player with zone-appropriate mobs, deterministically', () => {
    const sb = createSandbox(seed(11), newPhysics(), { kind: 'world' });
    run(sb, 60 * 30, [{ type: 'teleport', x: -128, y: 0.05, z: 160 }]); // forest
    const w = sb.simulation.world;
    const mob = w.store(Mob);
    const t = w.store(Target);
    let alive = 0;
    for (let r = 0; r < mob.size; r++) {
      const e = mob.dense[r] ?? 0;
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test: dense rows hold entity ids
      const tr = t.rowOf(e as EntityId);
      if ((t.fields.health[tr] ?? 0) <= 0) continue;
      alive++;
      const id = mobAt(mob.fields.kind[r] ?? 0) ?? 'shambler';
      const zone = hubAt(t.fields.x[tr] ?? 0, t.fields.z[tr] ?? 0).zone;
      expect(MOBS[id].spawn.zones, `${id} spawned in ${zone}`).toContain(zone);
    }
    expect(alive).toBeGreaterThan(WORLD_POPULATION / 2);
    expect(alive).toBeLessThanOrEqual(WORLD_POPULATION);
    // Teleport far away: the old mobs are cleared.
    const spawnedBefore = sb.ai.stats.spawned;
    run(sb, 60 * 15, [{ type: 'teleport', x: 160, y: 0.05, z: -96 }]);
    expect(sb.ai.stats.despawned).toBeGreaterThan(0);
    expect(sb.ai.stats.spawned).toBeGreaterThan(spawnedBefore);
  });

  it('replays a session with mobs exactly', () => {
    const sb = createSandbox(seed(21), newPhysics(), { kind: 'world' });
    const rec = new ReplayRecorder('world', seed(21), 60, 300);
    const cmds: InputCommand[][] = Array.from({ length: 3000 }, () => []);
    cmds[0] = [{ type: 'move', forward: 1, strafe: 0 }];
    cmds[600] = [{ type: 'spawn', mob: 'sentry', x: -60, z: -14, yaw: 0 }];
    cmds[900] = [{ type: 'action', action: 'fire', pressed: true }];
    cmds[901] = [{ type: 'action', action: 'fire', pressed: false }];
    for (const c of cmds) {
      rec.record(sb.simulation.tick, c);
      sb.simulation.step(c);
      rec.afterStep(sb.simulation);
    }
    const r = playReplay(
      rec.finish(),
      (s) => createSandbox(s, newPhysics(), { kind: 'world' }).simulation,
    );
    expect(r.divergence).toBeNull();
    expect(sb.simulation.world.store(Mob).size).toBeGreaterThan(0);
    expect(sb.simulation.world.store(PlayerVitals).size).toBe(1);
  });
});
