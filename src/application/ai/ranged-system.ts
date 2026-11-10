import type { ComponentStore } from '../../domain/ecs/component';
import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import { actionBit } from '../../domain/input/commands';
import { atan2, clamp, cos, sin, wrapAngle } from '../../domain/math/dmath';
import { MOBS, mobAt } from '../../domain/mobs/registry';
import { Target } from '../combat/components';
import type { PhysicsPort, Point, RayHit } from '../physics/ports';
import { PlayerIntent } from '../scenes/empty-world';
import type { SimContext } from '../simulation';
import { ACID, Acid, DEAD_ACTION, Mob, PlayerVitals } from './components';
import { AI_BUDGET, type AiRuntime } from './runtime';
import { newPlayerState, type PlayerProbe, type PlayerState } from './systems';

/** A leap's flight time (s), apex height (m) and how close it must land to latch on. */
export const LEAP = { seconds: 0.45, apex: 0.9, latch: 1.6 } as const;
/** Struggle needed to tear clinging plants off: ~3.5 rad of thrashing, jumps and shoves. */
export const SHAKE_OFF = 3.5;
/** How long a thrown-off plant lies stunned (s). */
export const THROWN_STUN = 2;
const LASER_FACING = 0.45; // rad either side of its camera's axis

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: dense rows hold live entity ids
  return raw as EntityId;
}

function damagePlayer(world: SimContext['world'], player: EntityId, amount: number): boolean {
  const vitals = world.store(PlayerVitals);
  const vr = vitals.rowOf(player);
  if (vr < 0 || vitals.fields.god[vr] === 1 || (vitals.fields.down[vr] ?? 0) > 0) return false;
  const v = vitals.fields;
  v.health[vr] = Math.max(0, (v.health[vr] ?? 0) - amount);
  v.hurt[vr] = clamp((v.hurt[vr] ?? 0) + amount / 40, 0, 1);
  return true;
}

/**
 * Ranged attacks, as reflexes beside the utility AI's choices: a robot's
 * laser (needs its camera on you, a clear line and to be facing you), a
 * flytrap's acid spit (lobbed: no line needed, lands where you stood), a
 * creeper's leap (it may latch on). Also the leap's flight and stun timers.
 */
export function rangedSystem(
  ai: AiRuntime,
  player: PlayerProbe,
  playerEntity: EntityId,
  physics: PhysicsPort,
): System<SimContext> {
  const p = newPlayerState();
  const origin: Point = { x: 0, y: 0, z: 0 };
  const dir: Point = { x: 0, y: 0, z: 0 };
  const hit: RayHit = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
  return {
    name: 'ai.ranged',
    after: ['ai.move'],
    before: ['ai.attack'],
    run(ctx) {
      const world = ctx.world;
      const mob = world.store(Mob);
      if (mob.size === 0 || !player(world, p)) return;
      const t = world.store(Target);
      const f = mob.fields;
      for (let row = 0; row < mob.size; row++) {
        const tr = t.rowOf(entity(mob.dense[row] ?? 0));
        if (tr < 0) continue;
        f.stun[row] = Math.max(0, (f.stun[row] ?? 0) - ctx.dt);
        if ((f.action[row] ?? 0) === DEAD_ACTION || (t.fields.health[tr] ?? 0) <= 0) {
          f.leap[row] = -1;
          continue;
        }
        const spec = MOBS[mobAt(f.kind[row] ?? 0) ?? 'shambler'];
        const ranged = spec.ranged;
        if (ranged === null) continue;
        f.rangedCooldown[row] = Math.max(0, (f.rangedCooldown[row] ?? 0) - ctx.dt);
        if ((f.leap[row] ?? -1) >= 0) {
          flyLeap(ctx, ai, mob, t, row, tr, p, world, playerEntity);
          continue;
        }
        if (f.attached[row] === 1 || (f.stun[row] ?? 0) > 0 || (f.blind[row] ?? 0) > 0) continue;
        if (f.sensing[row] !== 1 || !p.alive || (f.rangedCooldown[row] ?? 0) > 0) continue;
        const mx = t.fields.x[tr] ?? 0;
        const mz = t.fields.z[tr] ?? 0;
        const dx = p.x - mx;
        const dz = p.z - mz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < ranged.minRange || d > ranged.range || d > AI_BUDGET.farLod) continue;
        const my = (t.fields.y[tr] ?? 0) + spec.body.eyeHeight * spec.body.scale;
        const ev = (kind: number, hitPlayer: boolean): void => {
          const e = ctx.events.mobRanged.emit();
          e.kind = kind;
          e.mob = f.kind[row] ?? 0;
          e.x = mx;
          e.y = my;
          e.z = mz;
          e.tx = p.x;
          e.ty = p.eyeY - 0.3;
          e.tz = p.z;
          e.hit = hitPlayer;
        };
        if (ranged.kind === 'laser') {
          if (!laserReady(t, tr, dx, dz)) continue;
          origin.x = mx;
          origin.y = my;
          origin.z = mz;
          const dy = p.eyeY - 0.3 - my;
          const len = Math.sqrt(d * d + dy * dy);
          dir.x = dx / len;
          dir.y = dy / len;
          dir.z = dz / len;
          if (physics.raycast(origin, dir, len, hit) && hit.distance < len - 0.3) continue; // no clear shot
          f.rangedCooldown[row] = ranged.cooldown;
          f.attackTime[row] = 0;
          ev(0, damagePlayer(world, playerEntity, ranged.damage));
        } else if (ranged.kind === 'spit') {
          f.rangedCooldown[row] = ranged.cooldown;
          f.attackTime[row] = 0;
          spawnAcid(world, p, ranged.damage);
          ev(1, false);
        } else {
          const action = f.action[row] ?? 0;
          if (action !== 3 && action !== 4) continue; // leaps only while hunting (chase/attack)
          f.rangedCooldown[row] = ranged.cooldown;
          f.leap[row] = 0;
          f.leapFromX[row] = mx;
          f.leapFromZ[row] = mz;
          f.leapX[row] = p.x;
          f.leapZ[row] = p.z;
          f.attackTime[row] = 0;
          ev(2, false);
        }
      }
    },
  };
}

/** The camera is pointing at the target (lasers fire along the camera's axis). */
function laserReady(
  t: ComponentStore<typeof Target.schema>,
  tr: number,
  dx: number,
  dz: number,
): boolean {
  const facing = wrapAngle(atan2(-dx, -dz) - (t.fields.yaw[tr] ?? 0));
  return Math.abs(facing) < LASER_FACING;
}

function spawnAcid(world: SimContext['world'], p: PlayerState, damage: number): void {
  const e = world.spawn();
  const acid = world.store(Acid);
  const r = acid.add(e);
  const a = acid.fields;
  a.x[r] = p.x;
  a.y[r] = p.y;
  a.z[r] = p.z;
  a.radius[r] = ACID.radius;
  a.remaining[r] = ACID.seconds;
  a.dps[r] = damage;
  a.flight[r] = ACID.flight;
}

function flyLeap(
  ctx: SimContext,
  ai: AiRuntime,
  mob: ComponentStore<typeof Mob.schema>,
  t: ComponentStore<typeof Target.schema>,
  row: number,
  tr: number,
  p: PlayerState,
  world: SimContext['world'],
  playerEntity: EntityId,
): void {
  const f = mob.fields;
  const k = Math.min(1, ((f.leap[row] ?? 0) + ctx.dt) / LEAP.seconds);
  f.leap[row] = k * LEAP.seconds;
  const sx = f.leapFromX[row] ?? 0;
  const sz = f.leapFromZ[row] ?? 0;
  const ex = f.leapX[row] ?? 0;
  const ez = f.leapZ[row] ?? 0;
  const x = sx + (ex - sx) * k;
  const z = sz + (ez - sz) * k;
  t.fields.x[tr] = x;
  t.fields.z[tr] = z;
  t.fields.y[tr] = ai.nav.floorAt(x, z) + 4 * LEAP.apex * k * (1 - k);
  t.fields.yaw[tr] = atan2(-(ex - sx), -(ez - sz));
  if (k < 1) return;
  f.leap[row] = -1;
  t.fields.y[tr] = ai.nav.floorAt(x, z);
  const dx = p.x - x;
  const dz = p.z - z;
  if (p.alive && dx * dx + dz * dz < LEAP.latch * LEAP.latch) {
    f.attached[row] = 1;
    const ev = ctx.events.mobRanged.emit();
    ev.kind = 3;
    ev.mob = f.kind[row] ?? 0;
    ev.x = x;
    ev.y = t.fields.y[tr] ?? 0;
    ev.z = z;
    ev.tx = p.x;
    ev.ty = p.eyeY;
    ev.tz = p.z;
    ev.hit = damagePlayer(world, playerEntity, 2);
  }
}

/**
 * Plants clinging to the player: they ride along, hurt every second, and are
 * torn off by struggling (thrashing the view around, jumping, shoving with
 * `use`). Thrown off, they lie stunned; dead ones simply drop.
 */
export function clingSystem(
  ai: AiRuntime,
  player: PlayerProbe,
  playerEntity: EntityId,
): System<SimContext> {
  const p = newPlayerState();
  const JUMP = actionBit('jump');
  const USE = actionBit('use');
  return {
    name: 'ai.cling',
    after: ['ai.ranged'],
    before: ['ai.attack'],
    run(ctx) {
      const world = ctx.world;
      const vitals = world.store(PlayerVitals);
      const vr = vitals.rowOf(playerEntity);
      if (vr < 0 || !player(world, p)) return;
      const v = vitals.fields;
      // Struggle: how hard the player thrashes this tick.
      const intent = world.store(PlayerIntent);
      const ir = intent.rowOf(playerEntity);
      const yaw = ir < 0 ? 0 : (intent.fields.yaw[ir] ?? 0);
      const pitch = ir < 0 ? 0 : (intent.fields.pitch[ir] ?? 0);
      const pressed = ir < 0 ? 0 : (intent.fields.pressed[ir] ?? 0);
      let struggle = Math.max(0, (v.struggle[vr] ?? 0) - 0.6 * ctx.dt);
      if ((v.clinging[vr] ?? 0) > 0) {
        struggle +=
          Math.abs(wrapAngle(yaw - (v.lastYaw[vr] ?? yaw))) +
          Math.abs(pitch - (v.lastPitch[vr] ?? pitch));
        if ((pressed & JUMP) !== 0) struggle += 0.8;
        if ((pressed & USE) !== 0) struggle += 0.5;
      } else struggle = 0;
      v.lastYaw[vr] = yaw;
      v.lastPitch[vr] = pitch;

      const mob = world.store(Mob);
      const t = world.store(Target);
      const f = mob.fields;
      let clinging = 0;
      let slot = 0;
      const shake = struggle >= SHAKE_OFF || !p.alive;
      for (let row = 0; row < mob.size; row++) {
        if (f.attached[row] !== 1) continue;
        const tr = t.rowOf(entity(mob.dense[row] ?? 0));
        if (tr < 0 || (t.fields.health[tr] ?? 0) <= 0 || f.action[row] === DEAD_ACTION) {
          f.attached[row] = 0; // dead plants drop off
          continue;
        }
        // Each clinging plant has its own spot around the player's back and shoulders.
        const a = yaw + Math.PI + (slot - 0.5) * 1.1;
        slot++;
        if (shake) {
          const ox = p.x - sin(a) * 2.2;
          const oz = p.z - cos(a) * 2.2;
          const nx = ai.nav.walkableAt(ox, oz) ? ox : p.x;
          const nz = ai.nav.walkableAt(ox, oz) ? oz : p.z;
          t.fields.x[tr] = nx;
          t.fields.z[tr] = nz;
          t.fields.y[tr] = ai.nav.floorAt(nx, nz);
          t.fields.health[tr] = Math.max(1, (t.fields.health[tr] ?? 0) - 12);
          f.attached[row] = 0;
          f.stun[row] = THROWN_STUN;
          f.rangedCooldown[row] = Math.max(f.rangedCooldown[row] ?? 0, 3);
          const ev = ctx.events.mobRanged.emit();
          ev.kind = 4;
          ev.mob = f.kind[row] ?? 0;
          ev.x = nx;
          ev.y = t.fields.y[tr] ?? 0;
          ev.z = nz;
          ev.tx = p.x;
          ev.ty = p.eyeY;
          ev.tz = p.z;
          ev.hit = false;
          continue;
        }
        clinging++;
        t.fields.x[tr] = p.x - sin(a) * 0.45;
        t.fields.z[tr] = p.z - cos(a) * 0.45;
        t.fields.y[tr] = p.y + 0.6;
        t.fields.yaw[tr] = a + Math.PI;
        const spec = MOBS[mobAt(f.kind[row] ?? 0) ?? 'shambler'];
        damagePlayer(world, playerEntity, (spec.ranged?.damage ?? 0) * ctx.dt);
      }
      v.clinging[vr] = clinging;
      v.struggle[vr] = shake ? 0 : struggle;
    },
  };
}

/** Acid pools: the glob flies, lands, and burns whoever stands in it until it soaks away. */
export function acidSystem(player: PlayerProbe, playerEntity: EntityId): System<SimContext> {
  const p = newPlayerState();
  const gone: EntityId[] = [];
  return {
    name: 'ai.acid',
    after: ['ai.cling'],
    run(ctx) {
      const world = ctx.world;
      const acid = world.store(Acid);
      if (acid.size === 0 || !player(world, p)) return;
      const a = acid.fields;
      gone.length = 0;
      for (let r = 0; r < acid.size; r++) {
        const flight = a.flight[r] ?? 0;
        if (flight > 0) {
          a.flight[r] = flight - ctx.dt;
          continue;
        }
        const left = (a.remaining[r] ?? 0) - ctx.dt;
        a.remaining[r] = left;
        if (left <= 0) {
          gone.push(entity(acid.dense[r] ?? 0));
          continue;
        }
        const dx = p.x - (a.x[r] ?? 0);
        const dz = p.z - (a.z[r] ?? 0);
        const rad = a.radius[r] ?? 0;
        if (dx * dx + dz * dz < rad * rad && p.y - (a.y[r] ?? 0) < 0.6)
          damagePlayer(world, playerEntity, (a.dps[r] ?? 0) * ctx.dt);
      }
      for (const e of gone) world.despawn(e);
    },
  };
}
