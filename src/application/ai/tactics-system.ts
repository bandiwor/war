import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import { actionIndex } from '../../domain/ai/utility';
import { atan2, clamp, cos, sin, TAU, wrapAngle } from '../../domain/math/dmath';
import { MOBS, mobAt, type MobId } from '../../domain/mobs/registry';
import { Hazard, Target } from '../combat/components';
import type { PhysicsPort, Point, RayHit } from '../physics/ports';
import type { SimContext } from '../simulation';
import { DEAD_ACTION, Mob, PlayerVitals } from './components';
import type { AiRuntime } from './runtime';
import { newPlayerState, spawnMob, type PlayerProbe, type PlayerState } from './systems';

/** Robot tactics constants (ADR-0013). */
export const ROBOT = {
  /** Flashlight beam strength in the lens, distance and angle that overload a camera. */
  blindBeam: 0.5,
  blindRange: 10,
  blindFacing: 0.5,
  blindSeconds: 3,
  /** Seconds before called reinforcements arrive, and where (from the player). */
  callDelay: 4,
  callMin: 18,
  callMax: 30,
  /** Fear a hit adds to a robot that takes cover (it decays at 0.15/s). */
  fearPerHit: 0.45,
  /** Radio interference reach (m). */
  emiRange: 14,
  /** Rays per tick spent looking for cover. */
  coverRays: 12,
} as const;

const CHASE = actionIndex('chase');
const INVESTIGATE = actionIndex('investigate');
const FLEE = actionIndex('flee');

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: dense rows hold live entity ids
  return raw as EntityId;
}

interface CallQueue {
  due: number[];
  kind: MobId[];
  count: number[];
}

/**
 * The robots: cameras that a flashlight can blind and a flare can lure, a
 * network that shares every sighting, tactics (flanking positions, cover
 * when hurt or under fire, reinforcements called in) and the radio noise
 * that disturbs the bodycam. Runs between perception and decision (the
 * network, blinding, lures) and again after decisions (tactical goals).
 */
export function networkSystem(ai: AiRuntime, player: PlayerProbe): System<SimContext> {
  const p = newPlayerState();
  return {
    name: 'ai.network',
    after: ['ai.perceive'],
    before: ['ai.decide'],
    run(ctx) {
      const world = ctx.world;
      const mob = world.store(Mob);
      if (mob.size === 0 || !player(world, p)) return;
      const t = world.store(Target);
      const f = mob.fields;
      const hazards = world.tryStore(Hazard);
      for (let row = 0; row < mob.size; row++) {
        const spec = MOBS[mobAt(f.kind[row] ?? 0) ?? 'shambler'];
        if (spec.race !== 'robot' || f.action[row] === DEAD_ACTION) continue;
        const tr = t.rowOf(entity(mob.dense[row] ?? 0));
        if (tr < 0) continue;
        const mx = t.fields.x[tr] ?? 0;
        const mz = t.fields.z[tr] ?? 0;
        const yaw = t.fields.yaw[tr] ?? 0;
        // Blinding: the flashlight straight into the lens, close up, overloads the camera.
        f.blind[row] = Math.max(0, (f.blind[row] ?? 0) - ctx.dt);
        const dx = p.x - mx;
        const dz = p.z - mz;
        const d = Math.sqrt(dx * dx + dz * dz);
        const lookingAtYou = Math.abs(wrapAngle(atan2(-dx, -dz) - yaw)) < ROBOT.blindFacing;
        if (d < ROBOT.blindRange && lookingAtYou && ai.lights.beamAt(mx, mz) > ROBOT.blindBeam) {
          f.blind[row] = ROBOT.blindSeconds;
        }
        if ((f.blind[row] ?? 0) > 0) {
          f.sensing[row] = 0; // a blind camera sees nothing
          continue;
        }
        // Robots take cover when hit: fear stands in for "under fire".
        f.fear[row] = Math.max(0, (f.fear[row] ?? 0) - 0.15 * ctx.dt);
        if ((f.hitTime[row] ?? 99) <= ctx.dt + 1e-9 && spec.tactics.cover)
          f.fear[row] = clamp((f.fear[row] ?? 0) + ROBOT.fearPerHit, 0, 1);
        // Deception: a lit flare in its camera's view draws a robot that is not tracking you.
        const eyes = spec.senses.sight;
        if (hazards !== null && eyes !== null && f.sensing[row] !== 1) {
          for (let h = 0; h < hazards.size; h++) {
            if (hazards.fields.kind[h] !== 0 || (hazards.fields.remaining[h] ?? 0) <= 0) continue;
            const hx = (hazards.fields.x[h] ?? 0) - mx;
            const hz = (hazards.fields.z[h] ?? 0) - mz;
            const hd = Math.sqrt(hx * hx + hz * hz);
            if (hd > eyes.range || hd < 1) continue;
            if (Math.abs(wrapAngle(atan2(-hx, -hz) - yaw)) > (eyes.fovDeg * Math.PI) / 360)
              continue;
            f.hasLast[row] = 1;
            f.lastX[row] = hazards.fields.x[h] ?? 0;
            f.lastZ[row] = hazards.fields.z[h] ?? 0;
            f.sinceSensed[row] = 0;
            f.searchLeft[row] = 0;
            f.awareness[row] = Math.max(f.awareness[row] ?? 0, 0.7);
            break;
          }
        }
        // The network: whoever sees you tells every robot in range.
        if (spec.tactics.network <= 0 || f.sensing[row] !== 1) continue;
        f.informed[row] = 0;
        const range = spec.tactics.network;
        for (let other = 0; other < mob.size; other++) {
          if (other === row || f.sensing[other] === 1 || f.action[other] === DEAD_ACTION) continue;
          const os = MOBS[mobAt(f.kind[other] ?? 0) ?? 'shambler'];
          if (os.race !== 'robot' || os.tactics.network <= 0) continue;
          const otr = t.rowOf(entity(mob.dense[other] ?? 0));
          if (otr < 0) continue;
          const ox = (t.fields.x[otr] ?? 0) - mx;
          const oz = (t.fields.z[otr] ?? 0) - mz;
          if (ox * ox + oz * oz > range * range) continue;
          f.hasLast[other] = 1;
          f.lastX[other] = p.x;
          f.lastZ[other] = p.z;
          f.sinceSensed[other] = 0;
          f.searchLeft[other] = 0;
          f.informed[other] = 1;
          f.awareness[other] = Math.max(f.awareness[other] ?? 0, 0.75);
        }
      }
    },
  };
}

/**
 * Tactical goals after the utility decisions: flanking positions for
 * engaged robots, cover for those that flee, reinforcement calls. Also the
 * radio interference the player's bodycam picks up.
 */
export function tacticsSystem(
  ai: AiRuntime,
  player: PlayerProbe,
  playerEntity: EntityId,
  physics: PhysicsPort,
): System<SimContext> {
  const p = newPlayerState();
  const engaged: number[] = [];
  const calls: CallQueue = { due: [], kind: [], count: [] };
  const origin: Point = { x: 0, y: 0, z: 0 };
  const dir: Point = { x: 0, y: 0, z: 0 };
  const hit: RayHit = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
  /** True when the player cannot see (x, z): something solid in between. */
  const hidden = (x: number, z: number): boolean => {
    origin.x = p.x;
    origin.y = p.eyeY;
    origin.z = p.z;
    const dx = x - p.x;
    const dy = 1 - p.eyeY + ai.nav.floorAt(x, z);
    const dz = z - p.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return false;
    dir.x = dx / len;
    dir.y = dy / len;
    dir.z = dz / len;
    return physics.raycast(origin, dir, len, hit) && hit.distance < len - 0.4;
  };
  return {
    name: 'ai.tactics',
    after: ['ai.decide'],
    before: ['ai.move'],
    run(ctx) {
      const world = ctx.world;
      const mob = world.store(Mob);
      if (!player(world, p)) return;
      const t = world.store(Target);
      const f = mob.fields;
      let emi = 0;
      engaged.length = 0;
      let cx = 0;
      let cz = 0;
      let rays = 0;
      for (let row = 0; row < mob.size; row++) {
        const spec = MOBS[mobAt(f.kind[row] ?? 0) ?? 'shambler'];
        if (spec.race !== 'robot' || f.action[row] === DEAD_ACTION) continue;
        const tr = t.rowOf(entity(mob.dense[row] ?? 0));
        if (tr < 0) continue;
        const mx = t.fields.x[tr] ?? 0;
        const mz = t.fields.z[tr] ?? 0;
        const d = Math.sqrt((p.x - mx) * (p.x - mx) + (p.z - mz) * (p.z - mz));
        emi = Math.max(
          emi,
          clamp(1 - d / ROBOT.emiRange, 0, 1) * ((f.blind[row] ?? 0) > 0 ? 1 : 0.8),
        );
        // Reinforcements: the first robot to see you calls for help, once.
        if (
          spec.tactics.reinforce > 0 &&
          f.sensing[row] === 1 &&
          f.called[row] !== 1 &&
          f.informed[row] !== 1
        ) {
          f.called[row] = 1;
          calls.due.push(ctx.tick + Math.round(ROBOT.callDelay / ctx.dt));
          calls.kind.push(mobAt(f.kind[row] ?? 0) ?? 'sentry');
          calls.count.push(spec.tactics.reinforce);
          const ev = ctx.events.mobRanged.emit();
          ev.kind = 5;
          ev.mob = f.kind[row] ?? 0;
          ev.x = mx;
          ev.y = t.fields.y[tr] ?? 0;
          ev.z = mz;
          ev.tx = p.x;
          ev.ty = p.eyeY;
          ev.tz = p.z;
          ev.hit = false;
        }
        const action = f.action[row] ?? 0;
        if (
          action === CHASE &&
          spec.tactics.flank &&
          (f.sensing[row] === 1 || f.hasLast[row] === 1)
        ) {
          engaged.push(row);
          cx += mx;
          cz += mz;
        }
        // Cover: a robot that flees heads for a spot out of your line of sight.
        if (action === FLEE && spec.tactics.cover && rays < ROBOT.coverRays) {
          const gx = f.goalX[row] ?? mx;
          const gz = f.goalZ[row] ?? mz;
          if (f.hasGoal[row] === 1 && hidden(gx, gz)) {
            rays++;
            continue; // its goal is already good cover
          }
          rays++;
          let best = Infinity;
          for (let k = 0; k < 8 && rays < ROBOT.coverRays; k++) {
            for (const r of COVER_RINGS) {
              const a = (k / 8) * TAU;
              const x = mx + sin(a) * r;
              const z = mz + cos(a) * r;
              if (!ai.nav.walkableAt(x, z)) continue;
              rays++;
              if (!hidden(x, z)) continue;
              const away = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
              const cost = r * 2 - Math.sqrt(away) * 0.5;
              if (cost < best) {
                best = cost;
                f.goalX[row] = x;
                f.goalZ[row] = z;
                f.hasGoal[row] = 1;
              }
              break;
            }
          }
        }
      }
      // Flanking: engaged robots spread around the target, each taking its own angle.
      const n = engaged.length;
      if (n === 1) {
        const row = engaged[0] ?? 0;
        if (f.hasGoal[row] === 2) f.hasGoal[row] = 0; // alone again: straight at the target
      }
      if (n > 1) {
        cx /= n;
        cz /= n;
        const base = atan2(cx - p.x, cz - p.z);
        for (let k = 0; k < n; k++) {
          const row = engaged[k] ?? 0;
          const spec = MOBS[mobAt(f.kind[row] ?? 0) ?? 'shambler'];
          const standoff = spec.ranged?.kind === 'laser' ? spec.ranged.range * 0.6 : 1.2;
          const a = base + (k - (n - 1) / 2) * 1.2;
          let gx = p.x + sin(a) * standoff;
          let gz = p.z + cos(a) * standoff;
          if (!ai.nav.walkableAt(gx, gz)) {
            gx = p.x + sin(a) * standoff * 0.5;
            gz = p.z + cos(a) * standoff * 0.5;
          }
          f.goalX[row] = gx;
          f.goalZ[row] = gz;
          f.hasGoal[row] = 2; // 2 = a tactical position (chase follows it instead of the player)
        }
      }
      // Reinforcements arrive out of sight.
      for (let i = calls.due.length - 1; i >= 0; i--) {
        if ((calls.due[i] ?? 0) > ctx.tick) continue;
        const kind = calls.kind[i] ?? 'sentry';
        const count = calls.count[i] ?? 0;
        calls.due.splice(i, 1);
        calls.kind.splice(i, 1);
        calls.count.splice(i, 1);
        reinforce(ctx, ai, p, kind, count, hidden);
      }
      const vitals = world.store(PlayerVitals);
      const vr = vitals.rowOf(playerEntity);
      if (vr >= 0) vitals.fields.emi[vr] = emi;
    },
  };
}

const COVER_RINGS = [5, 8, 11] as const;

function reinforce(
  ctx: SimContext,
  ai: AiRuntime,
  p: PlayerState,
  kind: MobId,
  count: number,
  hidden: (x: number, z: number) => boolean,
): void {
  const rng = ctx.rng.get('ai.reinforce');
  let placed = 0;
  for (let tries = 0; tries < 24 && placed < count; tries++) {
    const a = rng.range(0, TAU);
    const r = rng.range(ROBOT.callMin, ROBOT.callMax);
    const x = p.x + sin(a) * r;
    const z = p.z + cos(a) * r;
    if (!ai.nav.walkableAt(x, z) || !hidden(x, z)) continue;
    const e = spawnMob(ctx.world, ai, kind, x, z, atan2(-(p.x - x), -(p.z - z)));
    const mob = ctx.world.store(Mob);
    const row = mob.rowOf(e);
    // They come knowing where you were.
    mob.fields.hasLast[row] = 1;
    mob.fields.lastX[row] = p.x;
    mob.fields.lastZ[row] = p.z;
    mob.fields.awareness[row] = 0.8;
    mob.fields.informed[row] = 1;
    mob.fields.called[row] = 1;
    mob.fields.action[row] = INVESTIGATE;
    placed++;
  }
}
