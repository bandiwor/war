import { type ComponentStore } from '../../domain/ecs/component';
import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import type { World } from '../../domain/ecs/world';
import {
  hearingStrength,
  NOISE,
  proximityStrength,
  sightStrength,
  stepAwareness,
  targetLight,
} from '../../domain/ai/perception';
import {
  ACTION_COUNT,
  actionIndex,
  createUtilityInputs,
  pickAction,
  scoreActions,
} from '../../domain/ai/utility';
import { raceIndex, VULNERABILITY } from '../../domain/combat/races';
import { atan2, clamp, cos, sin, TAU, wrapAngle } from '../../domain/math/dmath';
import {
  MOBS,
  MOB_IDS,
  isMobId,
  mobAt,
  mobIndex,
  utilityWeights,
  type MobId,
  type MobSpec,
} from '../../domain/mobs/registry';
import {
  createWeather,
  daylight,
  nightness,
  perceptionScale,
  sunElevation,
  type Weather,
} from '../../domain/world/environment';
import { hubAt } from '../../domain/world/world-map';
import { Target } from '../combat/components';
import type { PhysicsPort, Point, RayHit } from '../physics/ports';
import type { SimContext } from '../simulation';
import { Environment } from '../world/environment-system';
import {
  DEAD_ACTION,
  Mob,
  PLAYER_MAX_HEALTH,
  PlayerVitals,
  RESPAWN_SECONDS,
  SCORE_FIELDS,
} from './components';
import { AI_BUDGET, MAX_PATH_POINTS, type AiRuntime, type MobPath } from './runtime';

/** What the AI needs to know about the player each tick (filled by the scene). */
export interface PlayerState {
  x: number;
  y: number;
  z: number;
  eyeY: number;
  flashlight: boolean;
  /** False while down (dead, waiting to respawn): mobs lose interest. */
  alive: boolean;
}

export type PlayerProbe = (world: World, out: PlayerState) => boolean;

const IDLE = actionIndex('idle');
const WANDER = actionIndex('wander');
const INVESTIGATE = actionIndex('investigate');
const CHASE = actionIndex('chase');
const ATTACK = actionIndex('attack');
const SEARCH = actionIndex('search');
const FLEE = actionIndex('flee');
const HOME = actionIndex('home');

/** Seconds a corpse stays before the spawner clears it; seconds out of range before despawn. */
export const CORPSE_SECONDS = 25;
export const FAR_SECONDS = 8;
export const DESPAWN_DISTANCE = 80;

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: dense rows hold live entity ids
  return raw as EntityId;
}

function specOf(mob: ComponentStore<typeof Mob.schema>, row: number): MobSpec {
  return MOBS[mobAt(mob.fields.kind[row] ?? 0) ?? 'shambler'];
}

/** The environment as perception sees it (fixed clear night in scenes without a clock). */
interface Senses {
  light: number;
  sight: number;
  hearing: number;
  night: number;
}

const scale = { sight: 1, hearing: 1 };

function readSenses(world: World, flashlight: boolean, weather: Weather, out: Senses): Senses {
  const env = world.tryStore(Environment);
  let L = 0;
  weather.fog = 0;
  weather.rain = 0;
  weather.wind = 0.35;
  out.night = 1;
  if (env !== null && env.size > 0) {
    const f = env.fields;
    const e = sunElevation(f.timeOfDay[0] ?? 0);
    L = daylight(e);
    out.night = nightness(e);
    weather.fog = f.fog[0] ?? 0;
    weather.rain = f.rain[0] ?? 0;
    weather.wind = f.wind[0] ?? 0;
  }
  const p = perceptionScale(weather, L, scale);
  out.light = targetLight(flashlight, L);
  out.sight = p.sight / Math.max(0.2, 0.2 + 0.8 * L); // fog part only: darkness is applied per eye
  out.hearing = p.hearing;
  return out;
}

/**
 * Creates a mob of `id` at (x, z) on the nav floor. Returns its entity.
 * Used by the spawner, the `spawn` command and tests.
 */
export function spawnMob(
  world: World,
  ai: AiRuntime,
  id: MobId,
  x: number,
  z: number,
  yaw: number,
): EntityId {
  const spec = MOBS[id];
  const e = world.spawn();
  const t = world.store(Target);
  const tr = t.add(e);
  const y = ai.nav.floorAt(x, z);
  const hp = VULNERABILITY[spec.race].maxHealth * spec.healthScale;
  t.fields.x[tr] = x;
  t.fields.y[tr] = y;
  t.fields.z[tr] = z;
  t.fields.yaw[tr] = yaw;
  t.fields.race[tr] = raceIndex(spec.race);
  t.fields.health[tr] = hp;
  t.fields.maxHealth[tr] = hp;
  t.fields.lastPart[tr] = -1;
  const m = world.store(Mob);
  const r = m.add(e);
  const f = m.fields;
  f.kind[r] = mobIndex(id);
  f.prevX[r] = x;
  f.prevY[r] = y;
  f.prevZ[r] = z;
  f.prevYaw[r] = yaw;
  f.homeX[r] = x;
  f.homeZ[r] = z;
  f.action[r] = IDLE;
  f.attackTime[r] = 99;
  f.hitTime[r] = 99;
  ai.stats.spawned++;
  return e;
}

export function despawnMob(world: World, ai: AiRuntime, e: EntityId): void {
  world.despawn(e);
  ai.forget(e);
  ai.stats.despawned++;
}

interface PerceptionScratch {
  rays: number;
  readonly origin: Point;
  readonly dir: Point;
  readonly hit: RayHit;
}

/** One mob's senses this tick (split out so V8 inlines its maths: no boxed numbers). */
function perceiveMob(
  ctx: SimContext,
  ai: AiRuntime,
  physics: PhysicsPort,
  mob: ComponentStore<typeof Mob.schema>,
  t: ComponentStore<typeof Target.schema>,
  row: number,
  p: PlayerState,
  senses: Senses,
  work: PerceptionScratch,
): void {
  const f = mob.fields;
  const ev = ctx.events;
  const { origin, dir, hit } = work;
  const e = entity(mob.dense[row] ?? 0);
  const tr = t.rowOf(e);
  if (tr < 0 || (t.fields.health[tr] ?? 0) <= 0) return;
  const spec = specOf(mob, row);
  const mx = t.fields.x[tr] ?? 0;
  const mz = t.fields.z[tr] ?? 0;
  const dx = p.x - mx;
  const dz = p.z - mz;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > AI_BUDGET.farLod) return;
  let strength = 0;
  // Sudden events (a hit, a noise) alert at once; steady senses build awareness over time.
  let alert = 0;

  // Being shot tells a mob exactly where the shooter is.
  const hits = t.fields.hits[tr] ?? 0;
  if (hits !== (f.seenHits[row] ?? 0)) {
    f.seenHits[row] = hits;
    f.hitTime[row] = 0;
    if (p.alive) {
      strength = 1;
      alert = 1;
    }
  }
  // Hearing: every noise this tick.
  const ears = spec.senses.hearing;
  if (ears !== null && p.alive) {
    for (let i = 0; i < ev.footstep.size; i++) {
      const n = ev.footstep.at(i);
      if (n !== undefined)
        strength = Math.max(strength, hearingStrength(ears, n.noiseRadius, dist, senses.hearing));
    }
    for (let i = 0; i < ev.land.size; i++) {
      const n = ev.land.at(i);
      if (n !== undefined)
        strength = Math.max(strength, hearingStrength(ears, n.noiseRadius, dist, senses.hearing));
    }
    for (let i = 0; i < ev.shot.size; i++) {
      const n = ev.shot.at(i);
      const r = n?.suppressed === true ? NOISE.suppressedShot : NOISE.gunshot;
      if (n !== undefined)
        strength = Math.max(strength, hearingStrength(ears, r, dist, senses.hearing));
    }
    for (let i = 0; i < ev.explosion.size; i++) {
      const n = ev.explosion.at(i);
      const d =
        n === undefined ? Infinity : Math.sqrt((n.x - mx) * (n.x - mx) + (n.z - mz) * (n.z - mz));
      strength = Math.max(strength, hearingStrength(ears, NOISE.explosion, d, senses.hearing));
    }
  }
  alert = Math.max(alert, strength * 0.9);
  // Sight and proximity: time-sliced.
  const period = dist < AI_BUDGET.nearLod ? 4 : 16;
  const due = (ctx.tick + row) % period === 0;
  let sensed = (f.sensing[row] ?? 0) === 1 && !due;
  if (due && p.alive) {
    sensed = false;
    const nose = spec.senses.proximity;
    if (nose !== null) {
      const s = proximityStrength(nose, dist);
      if (s > 0) {
        sensed = true;
        strength = Math.max(strength, s);
      }
    }
    const eyes = spec.senses.sight;
    if (eyes !== null) {
      const s = sightStrength(
        eyes,
        mx,
        mz,
        t.fields.yaw[tr] ?? 0,
        p.x,
        p.z,
        senses.light,
        senses.sight,
      );
      if (s > 0 && work.rays < AI_BUDGET.sightRays) {
        work.rays++;
        ai.stats.rays++;
        origin.x = mx;
        origin.y = (t.fields.y[tr] ?? 0) + spec.body.eyeHeight * spec.body.scale;
        origin.z = mz;
        const dy = p.eyeY - origin.y;
        const len = Math.sqrt(dist * dist + dy * dy);
        dir.x = dx / len;
        dir.y = dy / len;
        dir.z = dz / len;
        if (!physics.raycast(origin, dir, len, hit) || hit.distance >= len - 0.3) {
          sensed = true;
          strength = Math.max(strength, s);
        }
      }
    }
  }
  if (!p.alive) sensed = false;
  f.sensing[row] = sensed ? 1 : 0;
  if (strength > 0) {
    f.hasLast[row] = 1;
    f.lastX[row] = p.x;
    f.lastZ[row] = p.z;
    f.sinceSensed[row] = 0;
    f.searchLeft[row] = 0;
  } else {
    f.sinceSensed[row] = (f.sinceSensed[row] ?? 0) + ctx.dt;
  }
  f.awareness[row] = Math.max(
    alert,
    stepAwareness(f.awareness[row] ?? 0, strength, ctx.dt, spec.memory.forget),
  );
  f.hitTime[row] = (f.hitTime[row] ?? 0) + ctx.dt;
}

/**
 * Perception and memory. Hearing reacts to this tick's noises for every mob;
 * sight and proximity are time-sliced (every 4 ticks near the player, 16 far,
 * frozen beyond the far LOD) and sight rays share a per-tick budget.
 */
export function perceptionSystem(
  ai: AiRuntime,
  player: PlayerProbe,
  physics: PhysicsPort,
): System<SimContext> {
  const p: PlayerState = { x: 0, y: 0, z: 0, eyeY: 0, flashlight: false, alive: true };
  const weather = createWeather();
  const senses: Senses = { light: 0, sight: 1, hearing: 1, night: 1 };
  const work: PerceptionScratch = {
    rays: 0,
    origin: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: 0 },
    hit: { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 },
  };
  return {
    name: 'ai.perceive',
    after: ['targets.step'],
    run(ctx) {
      const mob = ctx.world.store(Mob);
      if (mob.size === 0 || !player(ctx.world, p)) return;
      const t = ctx.world.store(Target);
      readSenses(ctx.world, p.flashlight, weather, senses);
      work.rays = 0;
      for (let row = 0; row < mob.size; row++)
        perceiveMob(ctx, ai, physics, mob, t, row, p, senses, work);
    },
  };
}

interface DecisionScratch {
  readonly inputs: ReturnType<typeof createUtilityInputs>;
  readonly scores: Float64Array;
  readonly weights: number[];
}

/** One mob's memory upkeep and (when due) utility decision. */
function decideMob(
  ctx: SimContext,
  ai: AiRuntime,
  mob: ComponentStore<typeof Mob.schema>,
  t: ComponentStore<typeof Target.schema>,
  row: number,
  p: PlayerState,
  work: DecisionScratch,
): void {
  const f = mob.fields;
  const { inputs, scores, weights } = work;
  const wander = ctx.rng.get('ai.wander');
  const e = entity(mob.dense[row] ?? 0);
  const tr = t.rowOf(e);
  if (tr < 0) return;
  if ((t.fields.health[tr] ?? 0) <= 0) {
    if ((f.action[row] ?? 0) !== DEAD_ACTION) {
      f.action[row] = DEAD_ACTION;
      f.actionTime[row] = 0;
      f.hasGoal[row] = 0;
    }
    f.actionTime[row] = (f.actionTime[row] ?? 0) + ctx.dt;
    return;
  }
  f.actionTime[row] = (f.actionTime[row] ?? 0) + ctx.dt;
  f.attackCooldown[row] = Math.max(0, (f.attackCooldown[row] ?? 0) - ctx.dt);
  f.attackTime[row] = (f.attackTime[row] ?? 0) + ctx.dt;
  const spec = specOf(mob, row);
  const mx = t.fields.x[tr] ?? 0;
  const mz = t.fields.z[tr] ?? 0;
  const sensing = (f.sensing[row] ?? 0) === 1;
  const hasLast = (f.hasLast[row] ?? 0) === 1;
  const tx = sensing ? p.x : (f.lastX[row] ?? 0);
  const tz = sensing ? p.z : (f.lastZ[row] ?? 0);
  const dist = Math.sqrt((tx - mx) * (tx - mx) + (tz - mz) * (tz - mz));
  const toPlayer = Math.sqrt((p.x - mx) * (p.x - mx) + (p.z - mz) * (p.z - mz));
  if (toPlayer > AI_BUDGET.farLod) return;

  // Memory: arriving at the last known position starts the search; the search runs out.
  const current = f.action[row] ?? 0;
  if (
    hasLast &&
    !sensing &&
    current === INVESTIGATE &&
    dist < 1.5 &&
    (f.searchLeft[row] ?? 0) <= 0
  ) {
    f.searchLeft[row] = spec.memory.search;
    if (spec.memory.search <= 0) f.hasLast[row] = 0;
  }
  if ((f.searchLeft[row] ?? 0) > 0) {
    const left = (f.searchLeft[row] ?? 0) - ctx.dt;
    f.searchLeft[row] = left;
    if (left <= 0) {
      f.searchLeft[row] = 0;
      f.hasLast[row] = 0;
      f.awareness[row] = Math.min(f.awareness[row] ?? 0, 0.2);
    }
  }

  const period = toPlayer < AI_BUDGET.nearLod ? 10 : 30;
  const due = (ctx.tick + row * 3) % period === 0;
  const urgent =
    (sensing && current !== CHASE && current !== ATTACK && current !== FLEE) ||
    (f.hitTime[row] ?? 0) === ctx.dt;
  if (!due && !urgent && current !== DEAD_ACTION) return;

  inputs.awareness = f.awareness[row] ?? 0;
  inputs.sensing = sensing;
  inputs.hasLastKnown = (f.hasLast[row] ?? 0) === 1;
  inputs.distance = sensing || inputs.hasLastKnown ? dist : Infinity;
  inputs.attackRange = spec.attack.range * Math.max(1, spec.body.scale);
  inputs.attackReady = (f.attackCooldown[row] ?? 0) <= 0;
  inputs.mobile = spec.body.runSpeed > 0;
  inputs.health = (t.fields.health[tr] ?? 0) / Math.max(1, t.fields.maxHealth[tr] ?? 0);
  inputs.fleeBelow = spec.temperament.fleeBelow;
  inputs.aggression = spec.temperament.aggression;
  inputs.searchLeft = f.searchLeft[row] ?? 0;
  const hx = (f.homeX[row] ?? 0) - mx;
  const hz = (f.homeZ[row] ?? 0) - mz;
  inputs.homeDistance = Math.sqrt(hx * hx + hz * hz);
  inputs.roam = spec.temperament.roam;
  scoreActions(inputs, scores);
  utilityWeights(spec, weights);
  for (let a = 0; a < ACTION_COUNT; a++) {
    const field = SCORE_FIELDS[a];
    if (field !== undefined) f[field][row] = (scores[a] ?? 0) * (weights[a] ?? 0);
  }
  const next = pickAction(scores, weights, current);
  if (next !== current) {
    f.action[row] = next;
    f.actionTime[row] = 0;
    f.hasGoal[row] = 0;
  }
  // Goals that do not follow the target are picked here (deterministic rng stream).
  const action = f.action[row] ?? 0;
  if (
    (action === WANDER || action === SEARCH) &&
    ((f.hasGoal[row] ?? 0) === 0 || reached(f, row, mx, mz))
  ) {
    const cx = action === WANDER ? (f.homeX[row] ?? 0) : (f.lastX[row] ?? 0);
    const cz = action === WANDER ? (f.homeZ[row] ?? 0) : (f.lastZ[row] ?? 0);
    const radius = action === WANDER ? spec.temperament.roam : 4;
    for (let tries = 0; tries < 6; tries++) {
      const a = wander.range(0, TAU);
      const d = wander.range(radius * 0.3, radius);
      const gx = cx + sin(a) * d;
      const gz = cz + cos(a) * d;
      if (ai.nav.walkableAt(gx, gz)) {
        setGoal(f, row, gx, gz);
        break;
      }
    }
  } else if (action === HOME) {
    setGoal(f, row, f.homeX[row] ?? 0, f.homeZ[row] ?? 0);
  } else if (action === FLEE) {
    const away = atan2(mx - p.x, mz - p.z);
    for (let k = 0; k < 5; k++) {
      const a = away + (k % 2 === 0 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.6;
      const gx = mx + sin(a) * 15;
      const gz = mz + cos(a) * 15;
      if (ai.nav.walkableAt(gx, gz)) {
        setGoal(f, row, gx, gz);
        break;
      }
    }
  }
}

/** Utility decisions: every 10 ticks near the player (30 far), at once when something changes. */
export function decisionSystem(ai: AiRuntime, player: PlayerProbe): System<SimContext> {
  const p: PlayerState = { x: 0, y: 0, z: 0, eyeY: 0, flashlight: false, alive: true };
  const work: DecisionScratch = {
    inputs: createUtilityInputs(),
    scores: new Float64Array(ACTION_COUNT),
    weights: [],
  };
  return {
    name: 'ai.decide',
    after: ['ai.perceive'],
    run(ctx) {
      const mob = ctx.world.store(Mob);
      if (mob.size === 0 || !player(ctx.world, p)) return;
      const t = ctx.world.store(Target);
      for (let row = 0; row < mob.size; row++) decideMob(ctx, ai, mob, t, row, p, work);
    },
  };
}

function setGoal(
  f: ComponentStore<typeof Mob.schema>['fields'],
  row: number,
  x: number,
  z: number,
): void {
  f.goalX[row] = x;
  f.goalZ[row] = z;
  f.hasGoal[row] = 1;
  f.replan[row] = 0;
}

function reached(
  f: ComponentStore<typeof Mob.schema>['fields'],
  row: number,
  x: number,
  z: number,
): boolean {
  const dx = (f.goalX[row] ?? 0) - x;
  const dz = (f.goalZ[row] ?? 0) - z;
  return dx * dx + dz * dz < 1;
}

/** One mob's steering and movement this tick. */
function moveMob(
  ctx: SimContext,
  ai: AiRuntime,
  mob: ComponentStore<typeof Mob.schema>,
  t: ComponentStore<typeof Target.schema>,
  row: number,
  p: PlayerState,
  work: { budget: number },
): void {
  const f = mob.fields;
  const e = entity(mob.dense[row] ?? 0);
  const tr = t.rowOf(e);
  if (tr < 0) return;
  const tf = t.fields;
  const mx = tf.x[tr] ?? 0;
  const mz = tf.z[tr] ?? 0;
  f.prevX[row] = mx;
  f.prevY[row] = tf.y[tr] ?? 0;
  f.prevZ[row] = mz;
  f.prevYaw[row] = tf.yaw[tr] ?? 0;
  f.speed[row] = 0;
  const action = f.action[row] ?? 0;
  if (action === DEAD_ACTION) return;
  const ddx = p.x - mx;
  const ddz = p.z - mz;
  if (ddx * ddx + ddz * ddz > AI_BUDGET.farLod * AI_BUDGET.farLod) return;
  const spec = specOf(mob, row);
  const yaw = tf.yaw[tr] ?? 0;

  // Where to go, and how fast.
  let speed = 0;
  let gx = 0;
  let gz = 0;
  let face = false;
  if (action === CHASE) {
    gx = p.x;
    gz = p.z;
    speed = spec.body.runSpeed;
  } else if (action === INVESTIGATE) {
    gx = f.lastX[row] ?? 0;
    gz = f.lastZ[row] ?? 0;
    speed = spec.body.walkSpeed * 1.4;
  } else if (action === ATTACK) {
    face = true;
  } else if (action !== IDLE && (f.hasGoal[row] ?? 0) === 1) {
    gx = f.goalX[row] ?? 0;
    gz = f.goalZ[row] ?? 0;
    speed = action === FLEE ? spec.body.runSpeed : spec.body.walkSpeed;
  }

  let desired = yaw;
  if (face) {
    desired = atan2(-(p.x - mx), -(p.z - mz));
  } else if (speed > 0) {
    const path = ai.pathOf(e);
    const moved = (gx - path.goalX) * (gx - path.goalX) + (gz - path.goalZ) * (gz - path.goalZ);
    f.replan[row] = (f.replan[row] ?? 0) - ctx.dt;
    const stale = path.version !== ai.nav.version || moved > 2.25 || (f.replan[row] ?? 0) <= 0;
    const clear = stale && ai.nav.lineWalkable(mx, mz, gx, gz);
    if (stale && !clear && work.budget > 0) {
      work.budget -= plan(
        ai,
        path,
        mx,
        mz,
        gx,
        gz,
        Math.min(work.budget, AI_BUDGET.searchExpansions),
      );
      f.replan[row] = action === CHASE ? 0.75 : 2;
    } else if (clear) {
      // Clear line: no search needed.
      path.points[0] = gx;
      path.points[1] = gz;
      path.count = 1;
      path.next = 0;
      path.goalX = gx;
      path.goalZ = gz;
      path.version = ai.nav.version;
      f.replan[row] = 0.5;
    }
    // Next waypoint.
    while (path.next < path.count - 1) {
      const wx = (path.points[path.next * 2] ?? 0) - mx;
      const wz = (path.points[path.next * 2 + 1] ?? 0) - mz;
      if (wx * wx + wz * wz > 0.36) break;
      path.next++;
    }
    if (path.count > 0) {
      const wx = (path.points[path.next * 2] ?? mx) - mx;
      const wz = (path.points[path.next * 2 + 1] ?? mz) - mz;
      const d = Math.sqrt(wx * wx + wz * wz);
      if (d > 0.2) desired = atan2(-wx, -wz);
      else speed = 0;
      // Arrive gently on the final point.
      if (path.next === path.count - 1) speed = Math.min(speed, d * 2);
    } else {
      speed = 0;
    }
  }

  // Turn toward the desired heading, then move forward (slower while turning). Trig only when
  // something changes: these calls return boxed doubles when V8 does not inline them.
  let vx = 0;
  let vz = 0;
  if (desired !== yaw || speed > 0) {
    const diff = wrapAngle(desired - yaw);
    const maxTurn = spec.body.turnRate * ctx.dt;
    const newYaw = wrapAngle(yaw + Math.max(-maxTurn, Math.min(maxTurn, diff)));
    tf.yaw[tr] = newYaw;
    if (speed > 0) {
      const v = speed * Math.max(0, cos(diff));
      vx = -sin(newYaw) * v;
      vz = -cos(newYaw) * v;
    }
  }
  // Separation from other mobs.
  const r = spec.body.radius * spec.body.scale;
  const n = ai.hash.near(mx, mz, 2);
  for (let k = 0; k < n; k++) {
    const other = ai.hash.found[k] ?? -1;
    if (other === row || other < 0) continue;
    const d2 = ai.hash.foundD2[k] ?? 0;
    const minD = r + 0.4;
    if (d2 >= minD * minD || d2 < 1e-9) continue;
    const otr = t.rowOf(entity(mob.dense[other] ?? 0));
    if (otr < 0) continue;
    const d = Math.sqrt(d2);
    const push = (minD - d) / minD;
    vx += ((mx - (tf.x[otr] ?? 0)) / d) * push * 2;
    vz += ((mz - (tf.z[otr] ?? 0)) / d) * push * 2;
  }
  if (vx === 0 && vz === 0) return;
  // Slide along walls: try the full move, then each axis.
  const nx = mx + vx * ctx.dt;
  const nz = mz + vz * ctx.dt;
  let fx = mx;
  let fz = mz;
  if (ai.nav.walkableAt(nx, nz)) {
    fx = nx;
    fz = nz;
  } else if (ai.nav.walkableAt(nx, mz)) fx = nx;
  else if (ai.nav.walkableAt(mx, nz)) fz = nz;
  if (fx === mx && fz === mz) return;
  tf.x[tr] = fx;
  tf.z[tr] = fz;
  tf.y[tr] = ai.nav.floorAt(fx, fz);
  f.speed[row] = Math.sqrt((fx - mx) * (fx - mx) + (fz - mz) * (fz - mz)) / ctx.dt;
}

/**
 * Movement: path following on the nav grid (A* within a shared per-tick
 * expansion budget), separation from other mobs, turn-rate limits, wall
 * sliding, floor height. Chase and investigate track the target directly.
 */
export function movementSystem(ai: AiRuntime, player: PlayerProbe): System<SimContext> {
  const p: PlayerState = { x: 0, y: 0, z: 0, eyeY: 0, flashlight: false, alive: true };
  const work = { budget: 0 };
  return {
    name: 'ai.move',
    after: ['ai.decide'],
    run(ctx) {
      const mob = ctx.world.store(Mob);
      if (mob.size === 0 || !player(ctx.world, p)) return;
      const t = ctx.world.store(Target);
      // Spatial hash of mob positions (separation and later group queries).
      ai.hash.reset(mob.size);
      for (let row = 0; row < mob.size; row++) {
        const tr = t.rowOf(entity(mob.dense[row] ?? 0));
        ai.hash.insert(
          row,
          tr < 0 ? 1e9 : (t.fields.x[tr] ?? 0),
          tr < 0 ? 1e9 : (t.fields.z[tr] ?? 0),
        );
      }
      work.budget = AI_BUDGET.pathExpansions;
      for (let row = 0; row < mob.size; row++) moveMob(ctx, ai, mob, t, row, p, work);
    },
  };
}

/** Runs one A* search into `path`; returns the expansions spent. */
function plan(
  ai: AiRuntime,
  path: MobPath,
  sx: number,
  sz: number,
  gx: number,
  gz: number,
  budget: number,
): number {
  const r = ai.finder.find(
    ai.nav,
    sx,
    sz,
    gx,
    gz,
    budget,
    path.points,
    MAX_PATH_POINTS,
    ai.pathResult,
  );
  ai.stats.searches++;
  ai.stats.expansions += r.expansions;
  path.count = r.points;
  path.next = 0;
  path.goalX = gx;
  path.goalZ = gz;
  path.version = ai.nav.version;
  if (r.points === 0) {
    // No route (or out of the window): head straight for it and let wall sliding cope.
    path.points[0] = gx;
    path.points[1] = gz;
    path.count = 1;
  }
  return Math.max(1, r.expansions);
}

/** Attacks: in reach, facing, cooldown over → damage the player (unless god mode). */
export function attackSystem(
  ai: AiRuntime,
  player: PlayerProbe,
  playerEntity: EntityId,
): System<SimContext> {
  const p: PlayerState = { x: 0, y: 0, z: 0, eyeY: 0, flashlight: false, alive: true };
  return {
    name: 'ai.attack',
    after: ['ai.move'],
    run(ctx) {
      const mob = ctx.world.store(Mob);
      if (mob.size === 0 || !player(ctx.world, p) || !p.alive) return;
      const t = ctx.world.store(Target);
      const vitals = ctx.world.store(PlayerVitals);
      const vr = vitals.rowOf(playerEntity);
      const f = mob.fields;
      for (let row = 0; row < mob.size; row++) {
        if ((f.action[row] ?? 0) !== ATTACK || (f.attackCooldown[row] ?? 0) > 0) continue;
        const tr = t.rowOf(entity(mob.dense[row] ?? 0));
        if (tr < 0 || (t.fields.health[tr] ?? 0) <= 0) continue;
        const spec = specOf(mob, row);
        const mx = t.fields.x[tr] ?? 0;
        const mz = t.fields.z[tr] ?? 0;
        const dx = p.x - mx;
        const dz = p.z - mz;
        const d = Math.sqrt(dx * dx + dz * dz);
        const reach = spec.attack.range * Math.max(1, spec.body.scale);
        const facing = wrapAngle(atan2(-dx, -dz) - (t.fields.yaw[tr] ?? 0));
        if (d > reach || Math.abs(facing) > 1) continue;
        f.attackCooldown[row] = spec.attack.cooldown;
        f.attackTime[row] = 0;
        ai.stats.attacks++;
        const landed = vr >= 0 && vitals.fields.god[vr] !== 1;
        const ev = ctx.events.mobAttack.emit();
        ev.x = mx;
        ev.y = t.fields.y[tr] ?? 0;
        ev.z = mz;
        ev.kind = f.kind[row] ?? 0;
        ev.damage = landed ? spec.attack.damage : 0;
        ev.race = t.fields.race[tr] ?? 0;
        if (landed && vr >= 0) {
          const v = vitals.fields;
          v.health[vr] = Math.max(0, (v.health[vr] ?? 0) - spec.attack.damage);
          v.hurt[vr] = clamp((v.hurt[vr] ?? 0) + spec.attack.damage / 40, 0, 1);
        }
      }
    },
  };
}

/**
 * The player's vitals: damage look decay, threat from aware mobs nearby,
 * going down at zero health and respawning at the scene's start.
 */
export function vitalsSystem(
  playerEntity: EntityId,
  player: PlayerProbe,
  respawn: (ctx: SimContext) => void,
): System<SimContext> {
  const p: PlayerState = { x: 0, y: 0, z: 0, eyeY: 0, flashlight: false, alive: true };
  return {
    name: 'player.vitals',
    after: ['ai.attack'],
    run(ctx) {
      const vitals = ctx.world.store(PlayerVitals);
      const vr = vitals.rowOf(playerEntity);
      if (vr < 0) return;
      const v = vitals.fields;
      for (let i = 0; i < ctx.commands.length; i++) {
        const c = ctx.commands[i];
        if (c?.type !== 'cheat') continue;
        if (c.key === 'god') v.god[vr] = c.on ? 1 : 0;
        else if (c.key === 'noclip') v.noclip[vr] = c.on ? 1 : 0;
        else {
          v.health[vr] = v.maxHealth[vr] ?? 0;
          v.hurt[vr] = 0;
        }
      }
      v.hurt[vr] = Math.max(0, (v.hurt[vr] ?? 0) - ctx.dt * 0.5);
      // Threat: the nearest hostile that knows about you.
      let threat = 0;
      if (player(ctx.world, p)) {
        const mob = ctx.world.store(Mob);
        const t = ctx.world.store(Target);
        for (let row = 0; row < mob.size; row++) {
          const tr = t.rowOf(entity(mob.dense[row] ?? 0));
          if (tr < 0 || (t.fields.health[tr] ?? 0) <= 0) continue;
          const dx = (t.fields.x[tr] ?? 0) - p.x;
          const dz = (t.fields.z[tr] ?? 0) - p.z;
          const near = 1 - Math.sqrt(dx * dx + dz * dz) / 25;
          if (near > 0)
            threat = Math.max(threat, near * (0.3 + 0.7 * (mob.fields.awareness[row] ?? 0)));
        }
      }
      v.threat[vr] = threat;
      const down = v.down[vr] ?? 0;
      if (down > 0) {
        const left = down - ctx.dt;
        if (left <= 0) {
          v.down[vr] = 0;
          v.health[vr] = v.maxHealth[vr] ?? 0;
          v.hurt[vr] = 0;
          respawn(ctx);
        } else v.down[vr] = left;
      } else if ((v.health[vr] ?? 0) <= 0) {
        v.down[vr] = RESPAWN_SECONDS;
        v.deaths[vr] = (v.deaths[vr] ?? 0) + 1;
      }
    },
  };
}

export function addVitals(world: World, e: EntityId): void {
  const s = world.store(PlayerVitals);
  const r = s.add(e);
  s.fields.health[r] = PLAYER_MAX_HEALTH;
  s.fields.maxHealth[r] = PLAYER_MAX_HEALTH;
}

export interface SpawnerOptions {
  /** Keep this many living mobs around the player (0 = only commands spawn). */
  readonly population: number;
}

/**
 * Spawning and clean-up. `spawn` commands create any mob anywhere walkable.
 * With a population target (open world), groups appear 28–55 m from the
 * player, chosen by the registry's zone, weight and night preference.
 * Corpses and mobs left far behind (or on unloaded ground) are removed.
 */
export function spawnerSystem(
  ai: AiRuntime,
  player: PlayerProbe,
  options: SpawnerOptions,
): System<SimContext> {
  const p: PlayerState = { x: 0, y: 0, z: 0, eyeY: 0, flashlight: false, alive: true };
  const doomed: EntityId[] = [];
  const candidates: MobId[] = [];
  const weights: number[] = [];
  return {
    name: 'ai.spawn',
    after: ['player.vitals'],
    run(ctx) {
      const world = ctx.world;
      for (let i = 0; i < ctx.commands.length; i++) {
        const c = ctx.commands[i];
        if (c?.type !== 'spawn' || !isMobId(c.mob)) continue;
        if (!ai.nav.walkableAt(c.x, c.z)) continue;
        spawnMob(world, ai, c.mob, c.x, c.z, c.yaw);
      }
      if (!player(world, p)) return;
      const mob = world.store(Mob);
      const t = world.store(Target);
      if (ctx.tick % 30 !== 0) return;
      // Clean-up.
      doomed.length = 0;
      let alive = 0;
      for (let row = 0; row < mob.size; row++) {
        const e = entity(mob.dense[row] ?? 0);
        const tr = t.rowOf(e);
        if (tr < 0) continue;
        const x = t.fields.x[tr] ?? 0;
        const z = t.fields.z[tr] ?? 0;
        const dx = x - p.x;
        const dz = z - p.z;
        const far = dx * dx + dz * dz > DESPAWN_DISTANCE * DESPAWN_DISTANCE;
        const dead = (t.fields.health[tr] ?? 0) <= 0;
        mob.fields.farTime[row] = far ? (mob.fields.farTime[row] ?? 0) + 30 * ctx.dt : 0;
        const gone =
          (dead && (mob.fields.actionTime[row] ?? 0) > CORPSE_SECONDS) ||
          (options.population > 0 && (mob.fields.farTime[row] ?? 0) > FAR_SECONDS) ||
          !ai.nav.walkableAt(x, z);
        if (gone) doomed.push(e);
        else if (!dead) alive++;
      }
      for (const e of doomed) despawnMob(world, ai, e);
      if (options.population <= 0 || alive >= options.population) return;

      // One group per call, at a random walkable spot around the player.
      const rng = ctx.rng.get('ai.spawn');
      const env = world.tryStore(Environment);
      const night =
        env !== null && env.size > 0 ? nightness(sunElevation(env.fields.timeOfDay[0] ?? 0)) : 1;
      const a = rng.range(0, TAU);
      const d = rng.range(28, 55);
      const sx = p.x + sin(a) * d;
      const sz = p.z + cos(a) * d;
      if (!ai.nav.walkableAt(sx, sz)) return;
      const zone = hubAt(sx, sz).zone;
      candidates.length = 0;
      weights.length = 0;
      let total = 0;
      for (const id of MOB_IDS) {
        const s = MOBS[id].spawn;
        if (!s.zones.includes(zone)) continue;
        const w = s.weight * Math.max(0, 1 + s.night * (2 * night - 1));
        if (w <= 0) continue;
        candidates.push(id);
        weights.push(w);
        total += w;
      }
      if (total <= 0) return;
      let pick = rng.range(0, total);
      let id = candidates[0];
      for (let i = 0; i < candidates.length; i++) {
        pick -= weights[i] ?? 0;
        if (pick < 0) {
          id = candidates[i];
          break;
        }
      }
      if (id === undefined) return;
      const [lo, hi] = MOBS[id].spawn.group;
      const count = Math.min(rng.int(lo, Math.max(lo, hi)), options.population - alive);
      for (let k = 0; k < count; k++) {
        const ox = sx + (k === 0 ? 0 : rng.range(-3, 3));
        const oz = sz + (k === 0 ? 0 : rng.range(-3, 3));
        if (ai.nav.walkableAt(ox, oz))
          spawnMob(world, ai, id, ox, oz, rng.range(-Math.PI, Math.PI));
      }
    },
  };
}
