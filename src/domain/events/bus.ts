import type { StoryNote } from '../story/engine';
import type { SurfaceId } from '../world/surfaces';

/**
 * Typed per-tick event channels. The simulation emits, outer layers
 * (audio, render, AI later) read after each tick; channels are cleared at the
 * start of the next tick. Records are pooled: `emit()` hands out a reused
 * object to fill, so steady-state emission allocates nothing.
 */
export class EventChannel<T> {
  private readonly pool: T[] = [];
  private count = 0;

  constructor(private readonly create: () => T) {}

  emit(): T {
    let item = this.pool[this.count];
    if (item === undefined) {
      item = this.create();
      this.pool.push(item);
    }
    this.count++;
    return item;
  }

  get size(): number {
    return this.count;
  }

  /** i-th event this tick; valid until the channel is cleared. */
  at(i: number): T | undefined {
    return i < this.count ? this.pool[i] : undefined;
  }

  clear(): void {
    this.count = 0;
  }
}

export interface FootstepEvent {
  x: number;
  y: number;
  z: number;
  surface: SurfaceId;
  /** 0..1 loudness from gait (crouch quiet, sprint loud). */
  intensity: number;
  /** AI hearing radius in metres (gait × surface loudness). */
  noiseRadius: number;
  foot: 0 | 1;
}

export interface LandEvent {
  x: number;
  y: number;
  z: number;
  surface: SurfaceId;
  impactSpeed: number;
  noiseRadius: number;
}

export interface JumpEvent {
  x: number;
  y: number;
  z: number;
  surface: SurfaceId;
}

export interface ShotEvent {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  /** Index into WEAPON_IDS. */
  weapon: number;
  suppressed: boolean;
}

export interface HitEvent {
  x: number;
  y: number;
  z: number;
  /** Target entity (packed id). */
  target: number;
  race: number;
  /** Index into BODY_PARTS, or −1 for area damage. */
  part: number;
  damage: number;
  killed: boolean;
  /** Distance the projectile travelled (m). */
  distance: number;
  /** Projectile drop below the launch line at impact (m); 0 for non-ballistic hits. */
  drop: number;
  /** Flight time (s). */
  time: number;
  weapon: number;
}

export interface ImpactEvent {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  surface: SurfaceId;
  /** 0..1 energy (bullet ≈ 1, pellet ≈ 0.4, melee ≈ 0.6). */
  energy: number;
}

export interface ExplosionEvent {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** 0 = frag, 1 = EMP, 2 = fire ignition, 3 = flare ignition. */
  kind: number;
}

/** Weapon mechanics for sound and animation (WeaponEvent bit flags). */
export interface WeaponFxEvent {
  weapon: number;
  flags: number;
}

/** A mob attacked the player (damage 0 when it did not land, e.g. god mode). */
export interface MobAttackEvent {
  x: number;
  y: number;
  z: number;
  /** Index into MOB_IDS. */
  kind: number;
  race: number;
  damage: number;
}

/** A mob's ranged attack: a laser shot, an acid spit, a leap (render and audio). */
export interface MobRangedEvent {
  /** 0 = laser, 1 = spit, 2 = leap, 3 = latched on, 4 = thrown off, 5 = called reinforcements. */
  kind: number;
  /** Index into MOB_IDS. */
  mob: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  /** It hit the player. */
  hit: boolean;
}

export const RANGED_KINDS = ['laser', 'spit', 'leap', 'latch', 'thrown', 'call'] as const;

/** Something the story did (quest, log found, radio line, chapter, ending). */
export interface StoryEvent {
  note: StoryNote;
}

const NO_NOTE: StoryNote = { kind: 'battery' };

export class GameEvents {
  readonly footstep = new EventChannel<FootstepEvent>(() => ({
    x: 0,
    y: 0,
    z: 0,
    surface: 'concrete',
    intensity: 0,
    noiseRadius: 0,
    foot: 0,
  }));
  readonly land = new EventChannel<LandEvent>(() => ({
    x: 0,
    y: 0,
    z: 0,
    surface: 'concrete',
    impactSpeed: 0,
    noiseRadius: 0,
  }));
  readonly jump = new EventChannel<JumpEvent>(() => ({ x: 0, y: 0, z: 0, surface: 'concrete' }));
  readonly shot = new EventChannel<ShotEvent>(() => ({
    x: 0,
    y: 0,
    z: 0,
    dx: 0,
    dy: 0,
    dz: 0,
    weapon: 0,
    suppressed: false,
  }));
  readonly hit = new EventChannel<HitEvent>(() => ({
    x: 0,
    y: 0,
    z: 0,
    target: 0,
    race: 0,
    part: -1,
    damage: 0,
    killed: false,
    distance: 0,
    drop: 0,
    time: 0,
    weapon: 0,
  }));
  readonly impact = new EventChannel<ImpactEvent>(() => ({
    x: 0,
    y: 0,
    z: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    surface: 'concrete',
    energy: 0,
  }));
  readonly explosion = new EventChannel<ExplosionEvent>(() => ({
    x: 0,
    y: 0,
    z: 0,
    radius: 0,
    kind: 0,
  }));
  readonly weaponFx = new EventChannel<WeaponFxEvent>(() => ({ weapon: 0, flags: 0 }));
  readonly mobRanged = new EventChannel<MobRangedEvent>(() => ({
    kind: 0,
    mob: 0,
    x: 0,
    y: 0,
    z: 0,
    tx: 0,
    ty: 0,
    tz: 0,
    hit: false,
  }));
  readonly mobAttack = new EventChannel<MobAttackEvent>(() => ({
    x: 0,
    y: 0,
    z: 0,
    kind: 0,
    race: 0,
    damage: 0,
  }));

  readonly story = new EventChannel<StoryEvent>(() => ({ note: NO_NOTE }));

  clear(): void {
    this.story.clear();
    this.footstep.clear();
    this.land.clear();
    this.jump.clear();
    this.shot.clear();
    this.hit.clear();
    this.impact.clear();
    this.explosion.clear();
    this.weaponFx.clear();
    this.mobAttack.clear();
    this.mobRanged.clear();
  }
}
