import { Mob } from '../ai/components';
import { MOBS, mobAt } from '../../domain/mobs/registry';
import { RACES, VULNERABILITY, damageTo, raceAt, raceIndex } from '../../domain/combat/races';
import { BODY_PARTS } from '../../domain/combat/races';
import { intersectArchetype, archetypeBounds, type HitResult } from '../../domain/combat/hitboxes';
import { at, type ComponentStore } from '../../domain/ecs/component';
import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import type { World } from '../../domain/ecs/world';
import { actionBit } from '../../domain/input/commands';
import {
  aimVector,
  integrate,
  integrateRocket,
  sampleCone,
  zeroElevation,
  falloffFactor,
  type ProjectileState,
  type Vec3Mut,
} from '../../domain/weapons/ballistics';
import {
  AMMO,
  WEAPONS,
  WEAPON_IDS,
  weaponAt,
  weaponIndex,
  type AmmoId,
  type Firearm,
  type Melee,
  type Throwable,
  type Weapon,
  type WeaponId,
} from '../../domain/weapons/registry';
import {
  WeaponEvent,
  createWeaponOutput,
  createWeaponState,
  drawWeapon,
  tickWeapon,
  type ReloadStage,
  type WeaponInput,
  type WeaponPhase,
  type WeaponState,
} from '../../domain/weapons/weapon-state';
import type { TargetPiece } from '../../domain/world/street-layout';
import type { PhysicsPort, Point, RayHit } from '../physics/ports';
import { PlayerIntent, SelectIntent } from '../scenes/empty-world';
import type { SimContext } from '../simulation';
import {
  Ammo,
  Hazard,
  Loadout,
  Projectile,
  SLOT_FIELDS,
  Target,
  Rocket,
  Thrown,
  WeaponItem,
} from './components';

const PHASES: readonly WeaponPhase[] = [
  'ready',
  'cycling',
  'reloading',
  'jammed',
  'clearing',
  'drawing',
  'swinging',
];
const STAGES: readonly ReloadStage[] = ['magOut', 'magIn', 'chamber', 'shell'];
const FIRE = actionBit('fire');
const AIM = actionBit('aim');
const RELOAD = actionBit('reload');
const FIRE_MODE = actionBit('fireMode');
const NEXT = actionBit('nextWeapon');
const PREV = actionBit('prevWeapon');
const DEG = Math.PI / 180;
/** Projectiles are dropped after this long (they're far away or stopped). */
const MAX_PROJECTILE_AGE = 4;
const RANGE_RESPAWN_SECONDS = 4;

// ---------------------------------------------------------------------------
// Encoding between the SoA WeaponItem row and the pure WeaponState record.

function decode(
  store: ComponentStore<typeof WeaponItem.schema>,
  row: number,
  s: WeaponState,
): void {
  const f = store.fields;
  s.phase = PHASES[at(f.phase, row)] ?? 'ready';
  s.stage = STAGES[at(f.stage, row)] ?? 'magOut';
  s.timer = at(f.timer, row);
  s.mag = at(f.mag, row);
  s.chambered = f.chambered[row] === 1;
  s.wear = at(f.wear, row);
  s.bloomDeg = at(f.bloom, row);
  s.recoilPitch = at(f.recoilPitch, row);
  s.recoilYaw = at(f.recoilYaw, row);
  s.patternIndex = at(f.pattern, row);
  s.sinceShot = at(f.sinceShot, row);
  s.cooldown = at(f.cooldown, row);
  s.fireModeIndex = at(f.mode, row);
  s.burstLeft = at(f.burstLeft, row);
  s.swing = at(f.swing, row);
  s.wasEmpty = f.wasEmpty[row] === 1;
}

function encode(
  store: ComponentStore<typeof WeaponItem.schema>,
  row: number,
  s: WeaponState,
): void {
  const f = store.fields;
  f.phase[row] = PHASES.indexOf(s.phase);
  f.stage[row] = STAGES.indexOf(s.stage);
  f.timer[row] = s.timer;
  f.mag[row] = s.mag;
  f.chambered[row] = s.chambered ? 1 : 0;
  f.wear[row] = s.wear;
  f.bloom[row] = s.bloomDeg;
  f.recoilPitch[row] = s.recoilPitch;
  f.recoilYaw[row] = s.recoilYaw;
  f.pattern[row] = s.patternIndex;
  f.sinceShot[row] = s.sinceShot;
  f.cooldown[row] = s.cooldown;
  f.mode[row] = s.fireModeIndex;
  f.burstLeft[row] = s.burstLeft;
  f.swing[row] = s.swing;
  f.wasEmpty[row] = s.wasEmpty ? 1 : 0;
}

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: these u32 columns only store handles returned by World.spawn
  return raw as EntityId;
}

// ---------------------------------------------------------------------------
// Ammo bookkeeping.

export type ReserveKey =
  'r9x19' | 'r556' | 'r762' | 'r12ga' | 'frag' | 'emp' | 'flare' | 'molotov' | 'rpg';
const AMMO_FIELD: Readonly<Record<AmmoId, ReserveKey>> = {
  '9x19': 'r9x19',
  '5.56x45': 'r556',
  '7.62x51': 'r762',
  '12ga-buck': 'r12ga',
  pg7v: 'rpg',
};

/** Which Ammo column feeds a weapon (null = needs none). */
export function reserveKey(id: WeaponId, w: Weapon): ReserveKey | null {
  switch (w.kind) {
    case 'firearm':
      return AMMO_FIELD[w.ammo];
    case 'throwable':
      return id === 'frag' || id === 'emp' || id === 'flare' || id === 'molotov' ? id : null;
    case 'melee':
      return null;
  }
}

export interface LoadoutOptions {
  readonly infinite: boolean;
  readonly startSlot: number;
}

/** Gives the player one of every registry weapon (slot = registry order, keys 1–9, 0) and ammo. */
export function giveLoadout(world: World, player: EntityId, o: LoadoutOptions): void {
  const loadout = world.store(Loadout);
  const lrow = loadout.add(player);
  const items = world.store(WeaponItem);
  WEAPON_IDS.slice(0, SLOT_FIELDS.length).forEach((id, slot) => {
    const e = world.spawn();
    const row = items.add(e);
    items.fields.weapon[row] = weaponIndex(id);
    items.fields.owner[row] = player;
    encode(items, row, createWeaponState(WEAPONS[id]));
    const field = SLOT_FIELDS[slot];
    if (field !== undefined) loadout.fields[field][lrow] = e;
  });
  loadout.fields.active[lrow] = o.startSlot;
  const ammo = world.store(Ammo);
  const arow = ammo.add(player);
  const a = ammo.fields;
  a.r9x19[arow] = 51;
  a.r556[arow] = 120;
  a.r762[arow] = 25;
  a.r12ga[arow] = 30;
  a.frag[arow] = 3;
  a.emp[arow] = 2;
  a.flare[arow] = 4;
  a.molotov[arow] = 2;
  a.rpg[arow] = 3;
  a.infinite[arow] = o.infinite ? 1 : 0;
}

export function spawnTargets(world: World, targets: readonly TargetPiece[]): void {
  const store = world.store(Target);
  for (const t of targets) {
    const e = world.spawn();
    const row = store.add(e);
    const f = store.fields;
    f.x[row] = t.position[0];
    f.y[row] = t.position[1];
    f.z[row] = t.position[2];
    f.yaw[row] = t.yaw;
    f.race[row] = raceIndex(t.race);
    f.maxHealth[row] = VULNERABILITY[t.race].maxHealth;
    f.health[row] = VULNERABILITY[t.race].maxHealth;
    f.lastPart[row] = -1;
  }
}

/** Row of the active weapon in the WeaponItem store, or −1 (allocation-free: called every tick). */
export function activeItemRow(world: World, player: EntityId): number {
  const loadout = world.tryStore(Loadout);
  if (loadout === null) return -1;
  const lrow = loadout.rowOf(player);
  if (lrow < 0) return -1;
  const field = SLOT_FIELDS[at(loadout.fields.active, lrow)];
  if (field === undefined) return -1;
  return world.store(WeaponItem).rowOf(entity(at(loadout.fields[field], lrow)));
}

/** Active weapon id, or null. */
export function activeWeaponId(world: World, player: EntityId): WeaponId | null {
  const row = activeItemRow(world, player);
  return row < 0 ? null : (weaponAt(at(world.store(WeaponItem).fields.weapon, row)) ?? null);
}

/** Recoil offset of the active weapon in radians (applied on top of the player's aim). */
export function aimOffset(
  world: World,
  player: EntityId,
  out: { pitch: number; yaw: number },
): void {
  out.pitch = 0;
  out.yaw = 0;
  const row = activeItemRow(world, player);
  if (row < 0) return;
  const f = world.store(WeaponItem).fields;
  out.pitch = at(f.recoilPitch, row) * DEG;
  out.yaw = -at(f.recoilYaw, row) * DEG; // yaw right = negative yaw (yaw 0 looks down −Z)
}

// ---------------------------------------------------------------------------
// Systems.

export function weaponSelectSystem(player: EntityId): System<SimContext> {
  return {
    name: 'weapons.select',
    after: ['input.intent'],
    run(ctx) {
      const loadout = ctx.world.store(Loadout);
      const lrow = loadout.rowOf(player);
      const irow = ctx.world.store(PlayerIntent).rowOf(player);
      if (lrow < 0 || irow < 0) return;
      const pressed = at(ctx.world.store(PlayerIntent).fields.pressed, irow);
      const select = ctx.world.tryStore(SelectIntent);
      const srow = select === null ? -1 : select.rowOf(player);
      const current = at(loadout.fields.active, lrow);
      let target = select !== null && srow >= 0 ? at(select.fields.slot, srow) : -1;
      const step = (pressed & NEXT) !== 0 ? 1 : (pressed & PREV) !== 0 ? -1 : 0;
      if (step !== 0) {
        for (let k = 1; k <= SLOT_FIELDS.length; k++) {
          const slot = (current + step * k + SLOT_FIELDS.length * 2) % SLOT_FIELDS.length;
          const field = SLOT_FIELDS[slot];
          if (field !== undefined && at(loadout.fields[field], lrow) !== 0) {
            target = slot;
            break;
          }
        }
      }
      if (target < 0 || target === current) return;
      const field = SLOT_FIELDS[target];
      if (field === undefined || at(loadout.fields[field], lrow) === 0) return;
      loadout.fields.active[lrow] = target;
      const itemRow = activeItemRow(ctx.world, player);
      if (itemRow < 0) return;
      const items = ctx.world.store(WeaponItem);
      const id = weaponAt(at(items.fields.weapon, itemRow));
      if (id === undefined) return;
      const s = createWeaponState(WEAPONS[id]);
      decode(items, itemRow, s);
      drawWeapon(s, WEAPONS[id]);
      encode(items, itemRow, s);
    },
  };
}

export interface FireDeps {
  readonly player: EntityId;
  readonly physics: PhysicsPort;
  /** Eye position and aim, read from the pose after movement this tick. */
  readonly eye: (
    world: World,
    out: { x: number; y: number; z: number; yaw: number; pitch: number; speed: number },
  ) => boolean;
  /** Stamina hook for melee (returns false if too tired). */
  readonly spendStamina: (world: World, amount: number) => boolean;
}

export function weaponFireSystem(deps: FireDeps): System<SimContext> {
  const state = createWeaponState(WEAPONS.pistol);
  const out = createWeaponOutput();
  const input: WeaponInput = {
    trigger: false,
    triggerPressed: false,
    reloadPressed: false,
    fireModePressed: false,
    aiming: false,
    moving: 0,
    reserve: 0,
  };
  const eye = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0 };
  const aim: Vec3Mut = { x: 0, y: 0, z: 0 };
  const dir: Vec3Mut = { x: 0, y: 0, z: 0 };
  const pellet: Vec3Mut = { x: 0, y: 0, z: 0 };
  const zero = new Map<WeaponId, number>();
  const zeroFor = (id: WeaponId, w: Firearm): number => {
    let z = zero.get(id);
    if (z === undefined) {
      const motor = w.projectile.kind === 'rocket' ? w.projectile : undefined;
      z = zeroElevation(w.zeroMeters, w.sightHeight, w.muzzleVelocity, AMMO[w.ammo].dragK, motor);
      zero.set(id, z);
    }
    return z;
  };
  const melee = meleeSweep(deps.physics);

  return {
    name: 'weapons.fire',
    after: ['player.pose'],
    run(ctx) {
      const { world } = ctx;
      const itemRow = activeItemRow(world, deps.player);
      const irow = world.store(PlayerIntent).rowOf(deps.player);
      if (itemRow < 0 || irow < 0 || !deps.eye(world, eye)) return;
      const items = world.store(WeaponItem);
      const id = weaponAt(at(items.fields.weapon, itemRow));
      if (id === undefined) return;
      const w = WEAPONS[id];
      const intent = world.store(PlayerIntent).fields;
      const buttons = at(intent.buttons, irow);
      const pressed = at(intent.pressed, irow);
      const ammo = world.store(Ammo);
      const arow = ammo.rowOf(deps.player);
      const key = reserveKey(id, w);
      const infinite = arow >= 0 && ammo.fields.infinite[arow] === 1;
      input.trigger = (buttons & FIRE) !== 0;
      input.triggerPressed = (pressed & FIRE) !== 0;
      input.reloadPressed = (pressed & RELOAD) !== 0;
      input.fireModePressed = (pressed & FIRE_MODE) !== 0;
      input.aiming = (buttons & AIM) !== 0;
      input.moving = Math.min(1, eye.speed / 3.6);
      input.reserve = infinite ? 9999 : key === null || arow < 0 ? 0 : at(ammo.fields[key], arow);

      decode(items, itemRow, state);
      tickWeapon(state, w, input, ctx.rng.get('weapons'), ctx.dt, out);
      encode(items, itemRow, state);
      if (!infinite && key !== null && arow >= 0 && out.reserveDelta !== 0) {
        ammo.fields[key][arow] = Math.max(0, at(ammo.fields[key], arow) - out.reserveDelta);
      }
      if (out.events !== 0) {
        const fx = ctx.events.weaponFx.emit();
        fx.weapon = weaponIndex(id);
        fx.flags = out.events;
      }

      if (out.events & WeaponEvent.SHOT && w.kind === 'firearm') {
        aimVector(eye.yaw, eye.pitch + zeroFor(id, w), aim);
        const rng = ctx.rng.get('weapons');
        sampleCone(aim.x, aim.y, aim.z, out.spreadRad, rng, dir);
        const bore = eye.y - w.sightHeight;
        if (w.projectile.kind === 'rocket')
          spawnRocket(world, eye.x, bore, eye.z, dir, w, weaponIndex(id));
        for (let p = 0; p < w.pellets && w.projectile.kind === 'bullet'; p++) {
          if (w.pellets > 1) sampleCone(dir.x, dir.y, dir.z, w.pelletSpreadDeg * DEG, rng, pellet);
          else {
            pellet.x = dir.x;
            pellet.y = dir.y;
            pellet.z = dir.z;
          }
          spawnProjectile(world, eye.x, bore, eye.z, pellet, w, weaponIndex(id));
        }
        const shot = ctx.events.shot.emit();
        shot.x = eye.x;
        shot.y = bore;
        shot.z = eye.z;
        shot.dx = dir.x;
        shot.dy = dir.y;
        shot.dz = dir.z;
        shot.weapon = weaponIndex(id);
        shot.suppressed = false;
      }
      if (
        out.events & WeaponEvent.SWING &&
        w.kind === 'melee' &&
        !deps.spendStamina(world, w.staminaCost)
      ) {
        // Too exhausted: the swing still happens but lands weakly (handled by impact scaling below).
      }
      if (out.events & WeaponEvent.MELEE_IMPACT && w.kind === 'melee')
        melee(ctx, eye, w, weaponIndex(id));
      if (out.events & WeaponEvent.THROW && w.kind === 'throwable') {
        aimVector(eye.yaw, eye.pitch + 0.12, aim); // natural upward release angle
        spawnThrown(world, eye.x, eye.y - 0.1, eye.z, aim, w, weaponIndex(id));
      }
    },
  };
}

function spawnProjectile(
  world: World,
  x: number,
  y: number,
  z: number,
  d: Vec3Mut,
  w: Firearm,
  weapon: number,
): void {
  const store = world.store(Projectile);
  const e = world.spawn();
  const row = store.add(e);
  const f = store.fields;
  f.x[row] = x;
  f.y[row] = y;
  f.z[row] = z;
  f.ox[row] = x;
  f.oy[row] = y;
  f.oz[row] = z;
  f.ldx[row] = d.x;
  f.ldy[row] = d.y;
  f.ldz[row] = d.z;
  f.vx[row] = d.x * w.muzzleVelocity;
  f.vy[row] = d.y * w.muzzleVelocity;
  f.vz[row] = d.z * w.muzzleVelocity;
  f.weapon[row] = weapon;
  f.damage[row] = w.damage;
}

function spawnRocket(
  world: World,
  x: number,
  y: number,
  z: number,
  d: Vec3Mut,
  w: Firearm,
  weapon: number,
): void {
  const store = world.store(Rocket);
  const row = store.add(world.spawn());
  const f = store.fields;
  f.x[row] = x;
  f.y[row] = y;
  f.z[row] = z;
  f.vx[row] = d.x * w.muzzleVelocity;
  f.vy[row] = d.y * w.muzzleVelocity;
  f.vz[row] = d.z * w.muzzleVelocity;
  f.weapon[row] = weapon;
}

function spawnThrown(
  world: World,
  x: number,
  y: number,
  z: number,
  d: Vec3Mut,
  w: Throwable,
  weapon: number,
): void {
  const store = world.store(Thrown);
  const e = world.spawn();
  const row = store.add(e);
  const f = store.fields;
  f.x[row] = x;
  f.y[row] = y;
  f.z[row] = z;
  f.vx[row] = d.x * w.throwSpeed;
  f.vy[row] = d.y * w.throwSpeed;
  f.vz[row] = d.z * w.throwSpeed;
  f.weapon[row] = weapon;
  f.fuse[row] = w.fuseSeconds ?? 99;
}

interface TargetHit {
  row: number;
  t: number;
  part: number;
}

/** Nearest living target hit along a segment (origin + t·dir, t ≤ maxT), written into `best`. */
function nearestTarget(
  targets: ComponentStore<typeof Target.schema>,
  mobs: ComponentStore<typeof Mob.schema> | null,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  scratch: HitResult,
  best: TargetHit,
): TargetHit {
  best.row = -1;
  best.t = maxT;
  best.part = -1;
  const f = targets.fields;
  for (let row = 0; row < targets.size; row++) {
    if (at(f.health, row) <= 0) continue;
    const mrow = mobs === null ? -1 : mobs.rowOf(entity(targets.dense[row] ?? 0));
    const scale =
      mobs === null || mrow < 0
        ? 1
        : MOBS[mobAt(at(mobs.fields.kind, mrow)) ?? 'shambler'].body.scale;
    intersectArchetype(
      raceAt(at(f.race, row)),
      at(f.x, row),
      at(f.y, row),
      at(f.z, row),
      at(f.yaw, row),
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      best.t,
      scratch,
      scale,
    );
    if (scratch.t >= 0 && scratch.t < best.t) {
      best.row = row;
      best.t = scratch.t;
      best.part = scratch.part === null ? -1 : BODY_PARTS.indexOf(scratch.part);
    }
  }
  return best;
}

/** Applies damage to a target row and emits a hit event. */
function damageTarget(
  ctx: SimContext,
  targets: ComponentStore<typeof Target.schema>,
  row: number,
  amount: number,
  part: number,
  x: number,
  y: number,
  z: number,
  weapon: number,
  distance: number,
  drop: number,
  time: number,
): void {
  const f = targets.fields;
  const before = at(f.health, row);
  if (before <= 0 || amount <= 0) return;
  f.health[row] = Math.max(0, before - amount);
  f.hits[row] = at(f.hits, row) + 1;
  f.lastPart[row] = part;
  const e = ctx.events.hit.emit();
  e.x = x;
  e.y = y;
  e.z = z;
  e.target = targets.dense[row] ?? 0;
  e.race = at(f.race, row);
  e.part = part;
  e.damage = amount;
  e.killed = before > 0 && at(f.health, row) <= 0;
  e.distance = distance;
  e.drop = drop;
  e.time = time;
  e.weapon = weapon;
}

function emitImpact(
  ctx: SimContext,
  x: number,
  y: number,
  z: number,
  hit: RayHit,
  energy: number,
): void {
  if (hit.surface === null) return;
  const e = ctx.events.impact.emit();
  e.x = x;
  e.y = y;
  e.z = z;
  e.nx = hit.nx;
  e.ny = hit.ny;
  e.nz = hit.nz;
  e.surface = hit.surface;
  e.energy = energy;
}

const SWEEP_OFFSETS: readonly number[] = [0, 0.21, -0.21];

function meleeSweep(
  physics: PhysicsPort,
): (
  ctx: SimContext,
  eye: { x: number; y: number; z: number; yaw: number; pitch: number },
  w: Melee,
  weapon: number,
) => void {
  const scratch: HitResult = { t: -1, part: null };
  const best: TargetHit = { row: -1, t: 0, part: -1 };
  const hit: RayHit = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
  const dir: Vec3Mut = { x: 0, y: 0, z: 0 };
  const origin: Point = { x: 0, y: 0, z: 0 };
  return (ctx, eye, w, weapon) => {
    const targets = ctx.world.store(Target);
    origin.x = eye.x;
    origin.y = eye.y - 0.25;
    origin.z = eye.z;
    // Three rays: straight and ±12° — a swing covers an arc.
    for (const offset of SWEEP_OFFSETS) {
      aimVector(eye.yaw + offset, eye.pitch, dir);
      const wall = physics.raycast(origin, dir, w.reach, hit) ? hit.distance : w.reach;
      nearestTarget(
        targets,
        ctx.world.tryStore(Mob),
        origin.x,
        origin.y,
        origin.z,
        dir.x,
        dir.y,
        dir.z,
        wall,
        scratch,
        best,
      );
      if (best.row >= 0) {
        const race = raceAt(at(targets.fields.race, best.row));
        const part = BODY_PARTS[best.part] ?? null;
        damageTarget(
          ctx,
          targets,
          best.row,
          damageTo(race, w.damage, w.damageType, part),
          best.part,
          origin.x + dir.x * best.t,
          origin.y + dir.y * best.t,
          origin.z + dir.z * best.t,
          weapon,
          best.t,
          0,
          0,
        );
        return;
      }
      if (wall < w.reach) {
        emitImpact(
          ctx,
          origin.x + dir.x * wall,
          origin.y + dir.y * wall,
          origin.z + dir.z * wall,
          hit,
          0.6,
        );
        return;
      }
    }
  };
}

export function projectileSystem(physics: PhysicsPort): System<SimContext> {
  const s: ProjectileState = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 };
  const scratch: HitResult = { t: -1, part: null };
  const best: TargetHit = { row: -1, t: 0, part: -1 };
  const hit: RayHit = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
  const origin: Point = { x: 0, y: 0, z: 0 };
  const dir: Point = { x: 0, y: 0, z: 0 };
  const doomed: EntityId[] = [];
  return {
    name: 'projectiles.step',
    after: ['weapons.fire'],
    run(ctx) {
      const store = ctx.world.store(Projectile);
      const targets = ctx.world.store(Target);
      const f = store.fields;
      doomed.length = 0;
      for (let row = 0; row < store.size; row++) {
        const weaponId = weaponAt(at(f.weapon, row));
        const w = weaponId === undefined ? undefined : WEAPONS[weaponId];
        if (w?.kind !== 'firearm') {
          doomed.push(entity(store.dense[row] ?? 0));
          continue;
        }
        s.px = at(f.x, row);
        s.py = at(f.y, row);
        s.pz = at(f.z, row);
        s.vx = at(f.vx, row);
        s.vy = at(f.vy, row);
        s.vz = at(f.vz, row);
        integrate(s, AMMO[w.ammo].dragK, ctx.dt, 4);
        const sx = s.px - at(f.x, row);
        const sy = s.py - at(f.y, row);
        const sz = s.pz - at(f.z, row);
        const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
        const age = at(f.age, row) + ctx.dt;
        if (len > 1e-6) {
          origin.x = at(f.x, row);
          origin.y = at(f.y, row);
          origin.z = at(f.z, row);
          dir.x = sx / len;
          dir.y = sy / len;
          dir.z = sz / len;
          const wall = physics.raycast(origin, dir, len, hit) ? hit.distance : len;
          nearestTarget(
            targets,
            ctx.world.tryStore(Mob),
            origin.x,
            origin.y,
            origin.z,
            dir.x,
            dir.y,
            dir.z,
            wall,
            scratch,
            best,
          );
          const travelled = at(f.travelled, row);
          if (best.row >= 0 || wall < len) {
            const t = best.row >= 0 ? best.t : wall;
            const hx = origin.x + dir.x * t;
            const hy = origin.y + dir.y * t;
            const hz = origin.z + dir.z * t;
            const distance = travelled + t;
            const time = age - ctx.dt + (t / len) * ctx.dt;
            if (best.row >= 0) {
              const race = raceAt(at(targets.fields.race, best.row));
              const base =
                at(f.damage, row) *
                falloffFactor(distance, w.falloff.start, w.falloff.end, w.falloff.min);
              damageTarget(
                ctx,
                targets,
                best.row,
                damageTo(race, base, 'ballistic', BODY_PARTS[best.part] ?? null),
                best.part,
                hx,
                hy,
                hz,
                at(f.weapon, row),
                distance,
                dropBelowLine(f, row, hx, hy, hz),
                time,
              );
            } else {
              emitImpact(ctx, hx, hy, hz, hit, w.pellets > 1 ? 0.4 : 1);
            }
            doomed.push(entity(store.dense[row] ?? 0));
            continue;
          }
          f.travelled[row] = travelled + len;
        }
        f.x[row] = s.px;
        f.y[row] = s.py;
        f.z[row] = s.pz;
        f.vx[row] = s.vx;
        f.vy[row] = s.vy;
        f.vz[row] = s.vz;
        f.age[row] = age;
        if (age > MAX_PROJECTILE_AGE || s.py < -50) doomed.push(entity(store.dense[row] ?? 0));
      }
      for (const e of doomed) ctx.world.despawn(e);
    },
  };
}

/** How far below the original launch line the bullet is (positive = below). */
function dropBelowLine(
  f: ComponentStore<typeof Projectile.schema>['fields'],
  row: number,
  x: number,
  y: number,
  z: number,
): number {
  const ox = at(f.ox, row);
  const oy = at(f.oy, row);
  const oz = at(f.oz, row);
  const lx = at(f.ldx, row);
  const ly = at(f.ldy, row);
  const lz = at(f.ldz, row);
  const along = (x - ox) * lx + (y - oy) * ly + (z - oz) * lz;
  return oy + ly * along - y;
}

export function thrownSystem(physics: PhysicsPort): System<SimContext> {
  const hit: RayHit = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
  const scratch: HitResult = { t: -1, part: null };
  const body: TargetHit = { row: -1, t: 0, part: -1 };
  const origin: Point = { x: 0, y: 0, z: 0 };
  const dir: Point = { x: 0, y: 0, z: 0 };
  const los: RayHit = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
  const doomed: EntityId[] = [];
  return {
    name: 'thrown.step',
    after: ['projectiles.step'],
    run(ctx) {
      const store = ctx.world.store(Thrown);
      const f = store.fields;
      doomed.length = 0;
      for (let row = 0; row < store.size; row++) {
        const id = weaponAt(at(f.weapon, row));
        const w = id === undefined ? undefined : WEAPONS[id];
        if (w?.kind !== 'throwable') {
          doomed.push(entity(store.dense[row] ?? 0));
          continue;
        }
        let detonate = false;
        if (f.resting[row] !== 1) {
          const vx = at(f.vx, row);
          const vy = at(f.vy, row) - 9.81 * ctx.dt;
          const vz = at(f.vz, row);
          const len = Math.sqrt(vx * vx + vy * vy + vz * vz) * ctx.dt;
          origin.x = at(f.x, row);
          origin.y = at(f.y, row);
          origin.z = at(f.z, row);
          dir.x = (vx * ctx.dt) / len;
          dir.y = (vy * ctx.dt) / len;
          dir.z = (vz * ctx.dt) / len;
          const wallHit = len > 1e-6 && physics.raycast(origin, dir, len, hit);
          // Bodies stop thrown objects too: bottles break on them, grenades bounce off.
          nearestTarget(
            ctx.world.store(Target),
            ctx.world.tryStore(Mob),
            origin.x,
            origin.y,
            origin.z,
            dir.x,
            dir.y,
            dir.z,
            wallHit ? hit.distance : len,
            scratch,
            body,
          );
          if (body.row >= 0) {
            f.x[row] = origin.x + dir.x * body.t;
            f.y[row] = origin.y + dir.y * body.t;
            f.z[row] = origin.z + dir.z * body.t;
            f.vx[row] = -vx * 0.2;
            f.vy[row] = Math.min(vy, 0) * 0.2;
            f.vz[row] = -vz * 0.2;
            if (w.fuseSeconds === null) detonate = true;
          } else if (wallHit) {
            f.x[row] = origin.x + dir.x * hit.distance + hit.nx * 0.03;
            f.y[row] = origin.y + dir.y * hit.distance + hit.ny * 0.03;
            f.z[row] = origin.z + dir.z * hit.distance + hit.nz * 0.03;
            if (w.fuseSeconds === null) detonate = true; // bottle shatters
            const dot = vx * hit.nx + vy * hit.ny + vz * hit.nz;
            const r = w.restitution;
            f.vx[row] = (vx - (1 + r) * dot * hit.nx) * 0.7;
            f.vy[row] = vy - (1 + r) * dot * hit.ny;
            f.vz[row] = (vz - (1 + r) * dot * hit.nz) * 0.7;
            const speed2 = at(f.vx, row) ** 2 + at(f.vy, row) ** 2 + at(f.vz, row) ** 2;
            if (hit.ny > 0.7 && speed2 < 0.6 * 0.6) f.resting[row] = 1;
            emitImpact(
              ctx,
              at(f.x, row),
              at(f.y, row),
              at(f.z, row),
              hit,
              Math.min(0.5, Math.sqrt(speed2) * 0.05),
            );
          } else {
            f.x[row] = origin.x + vx * ctx.dt;
            f.y[row] = origin.y + vy * ctx.dt;
            f.z[row] = origin.z + vz * ctx.dt;
            f.vy[row] = vy;
          }
        }
        f.fuse[row] = at(f.fuse, row) - ctx.dt;
        const fuseDone = at(f.fuse, row) <= 0;
        if (w.effect.type === 'flare') detonate = fuseDone && f.resting[row] === 1;
        else if (w.fuseSeconds !== null) detonate = detonate || fuseDone;
        if (at(f.y, row) < -50) {
          doomed.push(entity(store.dense[row] ?? 0));
          continue;
        }
        if (!detonate) continue;
        effect(
          ctx,
          physics,
          w,
          at(f.x, row),
          at(f.y, row),
          at(f.z, row),
          at(f.weapon, row),
          los,
          origin,
          dir,
        );
        doomed.push(entity(store.dense[row] ?? 0));
      }
      for (const e of doomed) ctx.world.despawn(e);
    },
  };
}

function effect(
  ctx: SimContext,
  physics: PhysicsPort,
  w: Throwable,
  x: number,
  y: number,
  z: number,
  weapon: number,
  los: RayHit,
  origin: Point,
  dir: Point,
): void {
  const fx = w.effect;
  const ev = ctx.events.explosion.emit();
  ev.x = x;
  ev.y = y;
  ev.z = z;
  switch (fx.type) {
    case 'explosion': {
      ev.radius = fx.radius;
      ev.kind = fx.damageType === 'emp' ? 1 : 0;
      blast(ctx, physics, x, y, z, fx.radius, fx.damage, fx.damageType, weapon, los, origin, dir);
      return;
    }
    case 'flare':
    case 'fire': {
      ev.radius = fx.type === 'flare' ? fx.lightRadius : fx.radius;
      ev.kind = fx.type === 'flare' ? 3 : 2;
      const hazards = ctx.world.store(Hazard);
      const e = ctx.world.spawn();
      const row = hazards.add(e);
      const h = hazards.fields;
      h.x[row] = x;
      h.y[row] = y;
      h.z[row] = z;
      h.kind[row] = fx.type === 'flare' ? 0 : 1;
      h.radius[row] = ev.radius;
      h.remaining[row] = fx.seconds;
      h.dps[row] = fx.type === 'flare' ? fx.lightDps : fx.dps;
      return;
    }
  }
}

/** Radial blast damage with quadratic falloff; bodies behind cover take a quarter. */
function blast(
  ctx: SimContext,
  physics: PhysicsPort,
  x: number,
  y: number,
  z: number,
  radius: number,
  damage: number,
  type: 'explosive' | 'emp',
  weapon: number,
  los: RayHit,
  origin: Point,
  dir: Point,
): void {
  const targets = ctx.world.store(Target);
  const t = targets.fields;
  for (let row = 0; row < targets.size; row++) {
    const race = raceAt(at(t.race, row));
    const cy = at(t.y, row) + archetypeBounds(race).y;
    const dx = at(t.x, row) - x;
    const dy = cy - y;
    const dz = at(t.z, row) - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= radius) continue;
    // Cover matters: walls between blast and body absorb most of it.
    origin.x = x;
    origin.y = y + 0.1;
    origin.z = z;
    dir.x = dx / Math.max(d, 1e-6);
    dir.y = dy / Math.max(d, 1e-6);
    dir.z = dz / Math.max(d, 1e-6);
    const covered = d > 0.3 && physics.raycast(origin, dir, d - 0.3, los);
    const k = (1 - d / radius) ** 2 * (covered ? 0.25 : 1);
    damageTarget(
      ctx,
      targets,
      row,
      damageTo(race, damage * k, type, null),
      -1,
      at(t.x, row),
      cy,
      at(t.z, row),
      weapon,
      d,
      0,
      0,
    );
  }
}

/**
 * Rockets: thrust, drag and gravity each tick, then a swept test against the
 * world and bodies. A direct hit does the warhead's full damage; either way
 * an armed rocket explodes. Inside the arming distance it is a dud (the
 * real PG-7 fuze arms a few metres out, protecting the shooter).
 */
export function rocketSystem(physics: PhysicsPort): System<SimContext> {
  const s: ProjectileState = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 };
  const scratch: HitResult = { t: -1, part: null };
  const best: TargetHit = { row: -1, t: 0, part: -1 };
  const hit: RayHit = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
  const los: RayHit = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
  const origin: Point = { x: 0, y: 0, z: 0 };
  const dir: Point = { x: 0, y: 0, z: 0 };
  const doomed: EntityId[] = [];
  return {
    name: 'rockets.step',
    after: ['projectiles.step'],
    run(ctx) {
      const store = ctx.world.store(Rocket);
      const targets = ctx.world.store(Target);
      const f = store.fields;
      doomed.length = 0;
      for (let row = 0; row < store.size; row++) {
        const id = weaponAt(at(f.weapon, row));
        const w = id === undefined ? undefined : WEAPONS[id];
        if (w?.kind !== 'firearm' || w.projectile.kind !== 'rocket') {
          doomed.push(entity(store.dense[row] ?? 0));
          continue;
        }
        const spec = w.projectile;
        const x0 = at(f.x, row);
        const y0 = at(f.y, row);
        const z0 = at(f.z, row);
        s.px = x0;
        s.py = y0;
        s.pz = z0;
        s.vx = at(f.vx, row);
        s.vy = at(f.vy, row);
        s.vz = at(f.vz, row);
        const age = at(f.age, row);
        integrateRocket(s, AMMO[w.ammo].dragK, spec, age, ctx.dt);
        const sx = s.px - x0;
        const sy = s.py - y0;
        const sz = s.pz - z0;
        const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
        origin.x = x0;
        origin.y = y0;
        origin.z = z0;
        dir.x = sx / Math.max(len, 1e-9);
        dir.y = sy / Math.max(len, 1e-9);
        dir.z = sz / Math.max(len, 1e-9);
        const wall = physics.raycast(origin, dir, len, hit) ? hit.distance : len;
        nearestTarget(
          targets,
          ctx.world.tryStore(Mob),
          x0,
          y0,
          z0,
          dir.x,
          dir.y,
          dir.z,
          wall,
          scratch,
          best,
        );
        const travelled = at(f.travelled, row);
        const struck = best.row >= 0 || wall < len;
        if (struck || age + ctx.dt >= spec.fuseSeconds) {
          const t = best.row >= 0 ? best.t : wall;
          const hx = x0 + dir.x * t;
          const hy = y0 + dir.y * t;
          const hz = z0 + dir.z * t;
          const armed = travelled + t >= spec.armMeters;
          if (best.row >= 0) {
            const race = raceAt(at(targets.fields.race, best.row));
            // A dud still hits like a 2 kg club.
            const direct = armed ? w.damage : 25;
            damageTarget(
              ctx,
              targets,
              best.row,
              damageTo(race, direct, armed ? 'explosive' : 'blunt', BODY_PARTS[best.part] ?? null),
              best.part,
              hx,
              hy,
              hz,
              at(f.weapon, row),
              travelled + t,
              0,
              age + ctx.dt,
            );
          } else if (struck) {
            emitImpact(ctx, hx, hy, hz, hit, 1);
          }
          if (armed) {
            const ev = ctx.events.explosion.emit();
            // Back the blast centre off the surface so the wall it hit does not shadow it.
            ev.x = hx - dir.x * 0.15;
            ev.y = hy - dir.y * 0.15;
            ev.z = hz - dir.z * 0.15;
            ev.radius = spec.explosion.radius;
            ev.kind = spec.explosion.damageType === 'emp' ? 1 : 0;
            blast(
              ctx,
              physics,
              ev.x,
              ev.y,
              ev.z,
              spec.explosion.radius,
              spec.explosion.damage,
              spec.explosion.damageType,
              at(f.weapon, row),
              los,
              origin,
              dir,
            );
          }
          doomed.push(entity(store.dense[row] ?? 0));
          continue;
        }
        f.x[row] = s.px;
        f.y[row] = s.py;
        f.z[row] = s.pz;
        f.vx[row] = s.vx;
        f.vy[row] = s.vy;
        f.vz[row] = s.vz;
        f.age[row] = age + ctx.dt;
        f.travelled[row] = travelled + len;
      }
      for (const e of doomed) ctx.world.despawn(e);
    },
  };
}

export function hazardSystem(): System<SimContext> {
  const doomed: EntityId[] = [];
  return {
    name: 'hazards.step',
    after: ['thrown.step'],
    run(ctx) {
      const hazards = ctx.world.store(Hazard);
      const targets = ctx.world.store(Target);
      const h = hazards.fields;
      const t = targets.fields;
      doomed.length = 0;
      for (let row = 0; row < hazards.size; row++) {
        const remaining = at(h.remaining, row) - ctx.dt;
        h.remaining[row] = remaining;
        if (remaining <= 0) {
          doomed.push(entity(hazards.dense[row] ?? 0));
          continue;
        }
        const r = at(h.radius, row);
        const type = h.kind[row] === 0 ? 'light' : 'fire';
        for (let tr = 0; tr < targets.size; tr++) {
          if (at(t.health, tr) <= 0) continue;
          const dx = at(t.x, tr) - at(h.x, row);
          const dz = at(t.z, tr) - at(h.z, row);
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > r) continue;
          // Light falls off with distance; fire is uniform inside its pool.
          const k = type === 'light' ? 1 - d / r : 1;
          const amount = damageTo(raceAt(at(t.race, tr)), at(h.dps, row) * k * ctx.dt, type, null);
          if (amount <= 0) continue;
          const before = at(t.health, tr);
          t.health[tr] = Math.max(0, before - amount);
          if (at(t.health, tr) <= 0) {
            const e = ctx.events.hit.emit();
            e.x = at(t.x, tr);
            e.y = at(t.y, tr) + 1;
            e.z = at(t.z, tr);
            e.target = targets.dense[tr] ?? 0;
            e.race = at(t.race, tr);
            e.part = -1;
            e.damage = amount;
            e.killed = true;
            e.distance = d;
            e.drop = 0;
            e.time = 0;
            e.weapon = 255;
          }
        }
      }
      for (const e of doomed) ctx.world.despawn(e);
    },
  };
}

/** Dead targets fall; on the range they stand back up after a few seconds. */
export function targetSystem(respawn: boolean): System<SimContext> {
  return {
    name: 'targets.step',
    after: ['hazards.step'],
    run(ctx) {
      const targets = ctx.world.store(Target);
      const mobs = ctx.world.tryStore(Mob);
      const t = targets.fields;
      for (let row = 0; row < targets.size; row++) {
        if (at(t.health, row) > 0) continue;
        // Mobs die for good (the spawner clears corpses); range dummies come back.
        if (mobs !== null && mobs.rowOf(entity(targets.dense[row] ?? 0)) >= 0) continue;
        const dead = at(t.dead, row) + ctx.dt;
        t.dead[row] = dead;
        if (respawn && dead >= RANGE_RESPAWN_SECONDS) {
          t.health[row] = at(t.maxHealth, row);
          t.dead[row] = 0;
        }
      }
    },
  };
}

/** Debug: restore every target. */
export function resetTargets(world: World): void {
  const targets = world.tryStore(Target);
  if (targets === null) return;
  for (let row = 0; row < targets.size; row++) {
    targets.fields.health[row] = at(targets.fields.maxHealth, row);
    targets.fields.dead[row] = 0;
    targets.fields.hits[row] = 0;
  }
}

export const RACE_COUNT = RACES.length;
