import { Simulation, type SimContext } from '../../src/application/simulation';
import type { Seed } from '../../src/domain/core/brand';
import { defineComponent } from '../../src/domain/ecs/component';
import type { EntityId } from '../../src/domain/ecs/entity';
import type { System } from '../../src/domain/ecs/schedule';
import { World } from '../../src/domain/ecs/world';
import { cos, sin } from '../../src/domain/math/dmath';

/**
 * Stress fixture: entities spawn, drift, decay and die driven by RNG streams.
 * Exercises allocator reuse, swap-remove, multiple stores and dmath, so any
 * hidden nondeterminism in the ECS shows up as a golden-hash mismatch.
 */
const Mote = defineComponent('Mote', { x: 'f64', y: 'f64', heading: 'f32', life: 'i32' });
const Glow = defineComponent('Glow', { level: 'u8' });

export function createChurnWorld(runSeed: Seed): Simulation {
  const world = new World();
  world.register(Mote);
  world.register(Glow);
  const doomed: EntityId[] = [];

  const spawn: System<SimContext> = {
    name: 'mote.spawn',
    run(ctx) {
      const rng = ctx.rng.get('mote.spawn');
      const n = rng.int(0, 3);
      for (let i = 0; i < n; i++) {
        const e = ctx.world.spawn();
        const m = ctx.world.store(Mote);
        const row = m.add(e);
        m.fields.x[row] = rng.range(-50, 50);
        m.fields.y[row] = rng.range(-50, 50);
        m.fields.heading[row] = rng.range(-3.14, 3.14);
        m.fields.life[row] = rng.int(10, 120);
        if (rng.chance(0.3)) {
          const g = ctx.world.store(Glow);
          g.fields.level[g.add(e)] = rng.int(0, 255);
        }
      }
    },
  };
  const drift: System<SimContext> = {
    name: 'mote.drift',
    after: ['mote.spawn'],
    run(ctx) {
      const m = ctx.world.store(Mote);
      const f = m.fields;
      const rng = ctx.rng.get('mote.drift');
      for (let row = 0; row < m.size; row++) {
        const h = (f.heading[row] ?? 0) + rng.range(-0.1, 0.1);
        f.heading[row] = h;
        f.x[row] = (f.x[row] ?? 0) + cos(h) * ctx.dt * 3;
        f.y[row] = (f.y[row] ?? 0) + sin(h) * ctx.dt * 3;
        f.life[row] = (f.life[row] ?? 0) - 1;
      }
    },
  };
  const reap: System<SimContext> = {
    name: 'mote.reap',
    after: ['mote.drift'],
    run(ctx) {
      const m = ctx.world.store(Mote);
      doomed.length = 0;
      for (let row = 0; row < m.size; row++) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- dense holds live packed handles
        if ((m.fields.life[row] ?? 0) <= 0) doomed.push((m.dense[row] ?? 0) as EntityId);
      }
      for (const e of doomed) ctx.world.despawn(e);
    },
  };
  return new Simulation({ seed: runSeed, tickRate: 60, world, systems: [reap, drift, spawn] });
}
