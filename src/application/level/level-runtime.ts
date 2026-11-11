import type { World } from '../../domain/ecs/world';
import type { System } from '../../domain/ecs/schedule';
import type { MobPlacement, Patrol, SpawnZone } from '../../domain/level/level';
import { DEAD_ACTION, Mob } from '../ai/components';
import type { AiRuntime } from '../ai/runtime';
import { newPlayerState, spawnMob, type PlayerProbe } from '../ai/systems';
import type { SimContext } from '../simulation';

/**
 * What a level adds to a sandbox beyond its layout (stage 9): the mobs the
 * designer placed, their patrol paths, and spawn zones that keep a few mobs
 * of given kinds topped up. Deterministic: zone spawns draw from their own
 * rng stream.
 */
export interface LevelContent {
  readonly mobs: readonly MobPlacement[];
  readonly patrols: readonly Patrol[];
  readonly spawnZones: readonly SpawnZone[];
}

/** Zones refill this often (ticks) and never in the player's face. */
const ZONE_EVERY = 60;
const ZONE_MIN_DISTANCE = 12;

/** Patrol paths onto the AI runtime and the placed mobs into the world (before the first tick). */
export function installLevel(world: World, ai: AiRuntime, content: LevelContent): void {
  ai.patrols = content.patrols.map((p) => ({
    points: Float64Array.from(p.points.flat()),
    loop: p.loop,
  }));
  const index = new Map(content.patrols.map((p, i) => [p.id, i + 1]));
  for (const m of content.mobs) {
    const e = spawnMob(world, ai, m.mob, m.at[0], m.at[1], m.yaw);
    const mob = world.store(Mob);
    mob.fields.patrol[mob.rowOf(e)] = m.patrol === null ? 0 : (index.get(m.patrol) ?? 0);
  }
}

export function levelSpawnSystem(
  ai: AiRuntime,
  probe: PlayerProbe,
  zones: readonly SpawnZone[],
): System<SimContext> {
  const p = newPlayerState();
  const counts = new Int32Array(zones.length + 1);
  return {
    name: 'level.spawn',
    after: ['ai.spawn'],
    run(ctx) {
      if (zones.length === 0 || ctx.tick % ZONE_EVERY !== 0) return;
      const world = ctx.world;
      if (!probe(world, p)) return;
      const mob = world.store(Mob);
      counts.fill(0);
      for (let r = 0; r < mob.size; r++)
        if ((mob.fields.action[r] ?? 0) !== DEAD_ACTION) {
          const z = mob.fields.zone[r] ?? 0;
          counts[z] = (counts[z] ?? 0) + 1;
        }
      const rng = ctx.rng.get('level.spawn');
      zones.forEach((zone, i) => {
        if ((counts[i + 1] ?? 0) >= zone.population) return;
        // A few tries for a walkable spot out of the player's face.
        for (let t = 0; t < 6; t++) {
          const x = rng.range(zone.min[0], zone.max[0]);
          const z = rng.range(zone.min[1], zone.max[1]);
          const dx = x - p.x;
          const dz = z - p.z;
          if (!ai.nav.walkableAt(x, z) || dx * dx + dz * dz < ZONE_MIN_DISTANCE * ZONE_MIN_DISTANCE)
            continue;
          // The schema guarantees at least one mob per zone.
          const id = zone.mobs[rng.int(0, zone.mobs.length - 1)] ?? 'shambler';
          const e = spawnMob(world, ai, id, x, z, rng.range(-Math.PI, Math.PI));
          mob.fields.zone[mob.rowOf(e)] = i + 1;
          return;
        }
      });
    },
  };
}
