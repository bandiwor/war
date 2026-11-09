import { defineComponent } from '../../domain/ecs/component';

/** ECS data for combat. All of it is part of the simulation state (hashed, replayed). */

/** Carried weapons: entity handles per slot (0 = empty) and the active slot. */
export const Loadout = defineComponent('Loadout', {
  active: 'u8',
  s0: 'u32',
  s1: 'u32',
  s2: 'u32',
  s3: 'u32',
  s4: 'u32',
  s5: 'u32',
  s6: 'u32',
  s7: 'u32',
  s8: 'u32',
  s9: 'u32',
  s10: 'u32',
});
export const SLOT_FIELDS = [
  's0',
  's1',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  's8',
  's9',
  's10',
] as const;

/** Ammunition and consumables carried. `infinite` = debug range. */
export const Ammo = defineComponent('Ammo', {
  r9x19: 'u16',
  r556: 'u16',
  r762: 'u16',
  r12ga: 'u16',
  frag: 'u16',
  emp: 'u16',
  flare: 'u16',
  molotov: 'u16',
  rpg: 'u16',
  infinite: 'u8',
});

/** One carried weapon (WeaponState in SoA form). */
export const WeaponItem = defineComponent('WeaponItem', {
  weapon: 'u8',
  owner: 'u32',
  phase: 'u8',
  stage: 'u8',
  timer: 'f64',
  mag: 'u16',
  chambered: 'u8',
  wear: 'f64',
  bloom: 'f64',
  recoilPitch: 'f64',
  recoilYaw: 'f64',
  pattern: 'u16',
  sinceShot: 'f64',
  cooldown: 'f64',
  mode: 'u8',
  burstLeft: 'u8',
  swing: 'f64',
  wasEmpty: 'u8',
});

/** A bullet or pellet in flight. */
export const Projectile = defineComponent('Projectile', {
  x: 'f64',
  y: 'f64',
  z: 'f64',
  vx: 'f64',
  vy: 'f64',
  vz: 'f64',
  /** Launch point and line, to report drop at impact. */
  ox: 'f64',
  oy: 'f64',
  oz: 'f64',
  ldx: 'f64',
  ldy: 'f64',
  ldz: 'f64',
  weapon: 'u8',
  damage: 'f64',
  travelled: 'f64',
  age: 'f64',
});

/** A rocket in flight (self-propelled, explodes on impact). */
export const Rocket = defineComponent('Rocket', {
  x: 'f64',
  y: 'f64',
  z: 'f64',
  vx: 'f64',
  vy: 'f64',
  vz: 'f64',
  weapon: 'u8',
  age: 'f64',
  travelled: 'f64',
});

/** A thrown grenade/flare/bottle. */
export const Thrown = defineComponent('Thrown', {
  x: 'f64',
  y: 'f64',
  z: 'f64',
  vx: 'f64',
  vy: 'f64',
  vz: 'f64',
  weapon: 'u8',
  fuse: 'f64',
  resting: 'u8',
});

/** Lingering area effect: 0 = flare light, 1 = fire. */
export const Hazard = defineComponent('Hazard', {
  x: 'f64',
  y: 'f64',
  z: 'f64',
  kind: 'u8',
  radius: 'f64',
  remaining: 'f64',
  dps: 'f64',
});

/** Shootable dummy (range) / mob body placeholder. */
export const Target = defineComponent('Target', {
  x: 'f64',
  y: 'f64',
  z: 'f64',
  yaw: 'f64',
  race: 'u8',
  health: 'f64',
  maxHealth: 'f64',
  hits: 'u16',
  lastPart: 'i32',
  /** Seconds since death (respawns on the range). */
  dead: 'f64',
});
