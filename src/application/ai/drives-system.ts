import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import {
  FEAR_DECAY,
  effectiveAggression,
  fearFromHit,
  type DriveInputs,
} from '../../domain/ai/drives';
import { MOBS, mobAt } from '../../domain/mobs/registry';
import { nightness, sunElevation } from '../../domain/world/environment';
import { Target } from '../combat/components';
import type { SimContext } from '../simulation';
import { Environment } from '../world/environment-system';
import { DEAD_ACTION, Mob } from './components';
import { AI_BUDGET, type AiRuntime } from './runtime';
import { newPlayerState, type PlayerProbe } from './systems';

/** Packmates count when within this distance; sightings are shared within `PACK_CALL`. */
export const PACK_RANGE = 15;
export const PACK_CALL = 30;

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: dense rows hold live entity ids
  return raw as EntityId;
}

/**
 * Needs and emotions, between perception and decision (animals above all):
 * hunger grows, fear rises with wounds, gunfire close by, the flashlight
 * beam and lost packmates, then fades; packmates count and pass a sighting
 * on to each other; and everything comes together as the aggression the
 * utility AI uses. Mobs without drives keep their registry aggression.
 */
export function drivesSystem(ai: AiRuntime, player: PlayerProbe): System<SimContext> {
  const p = newPlayerState();
  const d: DriveInputs = {
    baseAggression: 0,
    hungerRate: 0,
    hunger: 0,
    pack: 0,
    packmates: 0,
    fear: 0,
    sinceHit: 99,
    territory: 0,
    targetFromHome: Infinity,
    night: 1,
  };
  return {
    name: 'ai.drives',
    after: ['ai.perceive'],
    before: ['ai.decide'],
    run(ctx) {
      const world = ctx.world;
      const mob = world.store(Mob);
      if (mob.size === 0 || !player(world, p)) return;
      const t = world.store(Target);
      const f = mob.fields;
      const env = world.tryStore(Environment);
      d.night =
        env !== null && env.size > 0 ? nightness(sunElevation(env.fields.timeOfDay[0] ?? 0)) : 1;
      // A gunshot close by frightens animals that have a fear response.
      const gunfire = ctx.events.shot.size > 0;

      for (let row = 0; row < mob.size; row++) {
        const spec = MOBS[mobAt(f.kind[row] ?? 0) ?? 'shambler'];
        const temper = spec.temperament;
        const tr = t.rowOf(entity(mob.dense[row] ?? 0));
        if (tr < 0 || (f.action[row] ?? 0) === DEAD_ACTION) continue;
        const mx = t.fields.x[tr] ?? 0;
        const mz = t.fields.z[tr] ?? 0;
        const dx = p.x - mx;
        const dz = p.z - mz;
        const toPlayer = Math.sqrt(dx * dx + dz * dz);
        if (toPlayer > AI_BUDGET.farLod) continue;
        const animal = temper.hunger > 0 || temper.pack > 0 || temper.territory > 0;
        if (!animal) {
          f.aggression[row] = temper.aggression;
          continue;
        }
        // Hunger grows (per minute in the registry).
        f.hunger[row] = Math.min(1, (f.hunger[row] ?? 0) + (temper.hunger / 60) * ctx.dt);
        // Fear: fades, then rises with what frightens it.
        let fear = Math.max(0, (f.fear[row] ?? 0) - FEAR_DECAY * ctx.dt);
        const hitTime = f.hitTime[row] ?? 99;
        const health = (t.fields.health[tr] ?? 0) / Math.max(1, t.fields.maxHealth[tr] ?? 1);
        if (hitTime <= ctx.dt + 1e-9) fear += fearFromHit(health);
        if (gunfire && toPlayer < 20) fear += 0.15;
        fear += ai.lights.beamAt(mx, mz) * temper.lightFear * 1.2 * ctx.dt;
        // Packmates: count, mourn the lost, share a sighting.
        let mates = 0;
        const pack = f.pack[row] ?? 0;
        if (pack > 0) {
          for (let other = 0; other < mob.size; other++) {
            if (other === row || f.pack[other] !== pack || f.action[other] === DEAD_ACTION)
              continue;
            const otr = t.rowOf(entity(mob.dense[other] ?? 0));
            if (otr < 0) continue;
            const ox = (t.fields.x[otr] ?? 0) - mx;
            const oz = (t.fields.z[otr] ?? 0) - mz;
            const d2 = ox * ox + oz * oz;
            if (d2 < PACK_RANGE * PACK_RANGE) mates++;
            // A packmate that senses the target tells the others (a howl, a bark).
            if (f.sensing[other] === 1 && f.sensing[row] !== 1 && d2 < PACK_CALL * PACK_CALL) {
              f.hasLast[row] = 1;
              f.lastX[row] = f.lastX[other] ?? p.x;
              f.lastZ[row] = f.lastZ[other] ?? p.z;
              f.sinceSensed[row] = 0;
              f.awareness[row] = Math.max(f.awareness[row] ?? 0, 0.6);
            }
          }
          const before = f.packmates[row] ?? 0;
          if (mates < before) fear += 0.3 * (before - mates);
        }
        f.packmates[row] = mates;
        fear = Math.min(1, fear);
        f.fear[row] = fear;

        d.baseAggression = temper.aggression;
        d.hungerRate = temper.hunger;
        d.hunger = f.hunger[row] ?? 0;
        d.pack = temper.pack;
        d.packmates = mates;
        d.fear = fear;
        d.sinceHit = hitTime;
        d.territory = temper.territory;
        const hx = (f.homeX[row] ?? 0) - p.x;
        const hz = (f.homeZ[row] ?? 0) - p.z;
        d.targetFromHome = Math.sqrt(hx * hx + hz * hz);
        f.aggression[row] = effectiveAggression(d);
      }
    },
  };
}
