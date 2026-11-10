import { defineComponent } from '../../domain/ecs/component';

/**
 * A mob's AI state. Its body (position, yaw, health, hitboxes) is the
 * combat `Target` component, so weapons hit mobs with no AI knowledge.
 */
export const Mob = defineComponent('Mob', {
  /** Index into MOB_IDS. */
  kind: 'u16',
  prevX: 'f64',
  prevY: 'f64',
  prevZ: 'f64',
  prevYaw: 'f64',
  /** Horizontal speed this tick (m/s): drives walk/run animation. */
  speed: 'f64',
  homeX: 'f64',
  homeZ: 'f64',
  /** Index into UTILITY_ACTIONS; 255 = dead. */
  action: 'u8',
  actionTime: 'f64',
  /** 0..1 certainty that the target is there. */
  awareness: 'f64',
  sensing: 'u8',
  hasLast: 'u8',
  lastX: 'f64',
  lastZ: 'f64',
  sinceSensed: 'f64',
  searchLeft: 'f64',
  attackCooldown: 'f64',
  /** Seconds since the last attack started (animation), large when idle. */
  attackTime: 'f64',
  /** Target hits already reacted to. */
  seenHits: 'u16',
  hitTime: 'f64',
  /** Current movement goal and whether it is valid. */
  goalX: 'f64',
  goalZ: 'f64',
  hasGoal: 'u8',
  replan: 'f64',
  /** Seconds spent far from the player (despawn timer). */
  farTime: 'f64',
  /** Last utility scores (weighted), for the debug inspector. */
  s0: 'f32',
  s1: 'f32',
  s2: 'f32',
  s3: 'f32',
  s4: 'f32',
  s5: 'f32',
  s6: 'f32',
  s7: 'f32',
  s8: 'f32',
  // --- Stage 7: race state ---------------------------------------------------
  /** Light on the mob 0..1 (lamps, sky, the flashlight's beam). */
  light: 'f32',
  /** Animals: hunger and fear 0..1. */
  hunger: 'f32',
  fear: 'f32',
  /** Spawn group: packmates share it (0 = none). */
  pack: 'u32',
  /** Packmates within reach (courage). */
  packmates: 'u8',
  /** Robots: seconds of camera blindness left (flashlight in the lens). */
  blind: 'f32',
  /** Robots: the last sighting came over the network rather than its own camera. */
  informed: 'u8',
  /** Robots: reinforcements already called. */
  called: 'u8',
  /** Ranged attack cooldown (s). */
  rangedCooldown: 'f32',
  /** Leap in flight: seconds since take-off (−1 = not leaping) and landing point. */
  leap: 'f32',
  leapX: 'f64',
  leapZ: 'f64',
  leapFromX: 'f64',
  leapFromZ: 'f64',
  /** Creepers: clinging to the player. */
  attached: 'u8',
  /** Seconds stunned (thrown off, blinded hard). */
  stun: 'f32',
  /** Robots: recent hits, for retreating under fire. */
  underFire: 'f32',
  /** Aggression after drives (hunger, pack, provocation, territory, night, fear). */
  aggression: 'f32',
});

export const SCORE_FIELDS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const;
export const DEAD_ACTION = 255;

/** The player's body as mobs see it: health, debug cheats, and what threatens them. */
export const PlayerVitals = defineComponent('PlayerVitals', {
  health: 'f64',
  maxHealth: 'f64',
  /** Recent damage 0..1, decaying (drives the bodycam damage look). */
  hurt: 'f64',
  /** 0..1: how close and aware the nearest hostile is (fear, music-less tension). */
  threat: 'f64',
  /** Seconds left lying down before respawn (0 = up). */
  down: 'f64',
  deaths: 'u16',
  god: 'u8',
  noclip: 'u8',
  /** Robots' radio interference at the player 0..1 (disturbs the bodycam). */
  emi: 'f64',
  /** Creepers clinging on, and how hard the player has struggled to tear them off. */
  clinging: 'u8',
  struggle: 'f64',
  lastYaw: 'f64',
  lastPitch: 'f64',
});

export const PLAYER_MAX_HEALTH = 100;
export const RESPAWN_SECONDS = 3;

/** A pool of plant acid on the ground: burns the player while they stand in it. */
export const Acid = defineComponent('Acid', {
  x: 'f64',
  y: 'f64',
  z: 'f64',
  radius: 'f32',
  remaining: 'f32',
  dps: 'f32',
  /** Seconds until it lands (the glob is still in the air). */
  flight: 'f32',
});

export const ACID = { radius: 1.4, seconds: 5, flight: 0.55 } as const;
