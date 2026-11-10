import type { ComponentStore } from '../../domain/ecs/component';
import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import { ALARM, PREY } from '../../domain/ai/pheromone';
import { MOBS, mobAt } from '../../domain/mobs/registry';
import { daylight, sunElevation } from '../../domain/world/environment';
import { Hazard, Target } from '../combat/components';
import type { SimContext } from '../simulation';
import { Environment } from '../world/environment-system';
import { Mob, PlayerVitals } from './components';
import { AI_BUDGET, type AiRuntime } from './runtime';
import { newPlayerState, type PlayerProbe } from './systems';

/** Scent the player lays down per second (running and bleeding leave more). */
export const PLAYER_SCENT = 8;
/** The pheromone field steps every this many ticks (15 Hz at 60 Hz). */
export const PHEROMONE_PERIOD = 4;
/** Alarm a zombie with prey lays down per second (× its registry `alarm`). */
export const ALARM_RATE = 12;

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: dense rows hold live entity ids
  return raw as EntityId;
}

/**
 * The world as mobs sense it, before perception runs: the light map (sky,
 * flashlight, lit flares; lamps are static) and the zombies' pheromone field
 * (the player's scent, zombies' alarm, diffusion, decay). The field only runs
 * while a pheromone-led mob is within the AI's range.
 */
export function senseWorldSystem(
  ai: AiRuntime,
  player: PlayerProbe,
  playerEntity: EntityId,
): System<SimContext> {
  const p = newPlayerState();
  return {
    name: 'ai.senseWorld',
    after: ['targets.step'],
    before: ['ai.perceive'],
    run(ctx) {
      const world = ctx.world;
      if (!player(world, p)) return;
      const lights = ai.lights;
      const env = world.tryStore(Environment);
      lights.sky =
        env !== null && env.size > 0 ? daylight(sunElevation(env.fields.timeOfDay[0] ?? 0)) : 0;
      lights.setFlashlight(p.flashlight && p.alive, Math.min(1, p.battery * 4), p.x, p.z, p.yaw);
      const hazards = world.tryStore(Hazard);
      lights.flareCount = 0;
      if (hazards !== null) {
        const h = hazards.fields;
        for (let r = 0; r < hazards.size && lights.flareCount < 16; r++) {
          if (h.kind[r] !== 0 || (h.remaining[r] ?? 0) <= 0) continue;
          const i = lights.flareCount++;
          lights.flares[i * 3] = h.x[r] ?? 0;
          lights.flares[i * 3 + 1] = h.z[r] ?? 0;
          lights.flares[i * 3 + 2] = Math.max(6, (h.radius[r] ?? 0) * 1.5);
        }
      }

      // Pheromones: only while a zombie is around to smell them.
      const mob = world.store(Mob);
      const t = world.store(Target);
      ai.pheromoneActive = anyPheromoneMob(mob, t, p.x, p.z);
      if (!ai.pheromoneActive) return;
      const field = ai.pheromone;
      field.follow(p.x, p.z);
      const nav = ai.nav;
      field.refreshMask(nav.version, (x, z) => nav.walkableAt(x, z));
      if (p.alive) {
        const vit = world.store(PlayerVitals);
        const vr = vit.rowOf(playerEntity);
        const bleeding = vr >= 0 ? 1 + 2 * (vit.fields.hurt[vr] ?? 0) : 1;
        const running = 1 + Math.min(1.5, p.speed / 3);
        field.deposit(PREY, p.x, p.z, PLAYER_SCENT * bleeding * running * ctx.dt);
      }
      // Zombies with prey in their nose lay down alarm: the trail others follow.
      const f = mob.fields;
      for (let row = 0; row < mob.size; row++) {
        const nose = MOBS[mobAt(f.kind[row] ?? 0) ?? 'shambler'].senses.pheromone;
        if (nose === null || nose.alarm <= 0 || (f.awareness[row] ?? 0) < 0.5) continue;
        const tr = t.rowOf(entity(mob.dense[row] ?? 0));
        if (tr < 0 || (t.fields.health[tr] ?? 0) <= 0) continue;
        field.deposit(
          ALARM,
          t.fields.x[tr] ?? 0,
          t.fields.z[tr] ?? 0,
          nose.alarm * ALARM_RATE * ctx.dt,
        );
      }
      if (ctx.tick % PHEROMONE_PERIOD === 0) field.step(PHEROMONE_PERIOD * ctx.dt);
    },
  };
}

function anyPheromoneMob(
  mob: ComponentStore<typeof Mob.schema>,
  t: ComponentStore<typeof Target.schema>,
  px: number,
  pz: number,
): boolean {
  const f = mob.fields;
  const far = AI_BUDGET.farLod * AI_BUDGET.farLod;
  for (let row = 0; row < mob.size; row++) {
    if (MOBS[mobAt(f.kind[row] ?? 0) ?? 'shambler'].senses.pheromone === null) continue;
    const tr = t.rowOf(entity(mob.dense[row] ?? 0));
    if (tr < 0) continue;
    const dx = (t.fields.x[tr] ?? 0) - px;
    const dz = (t.fields.z[tr] ?? 0) - pz;
    if (dx * dx + dz * dz < far) return true;
  }
  return false;
}
