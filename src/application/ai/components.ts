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
});

export const SCORE_FIELDS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;
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
});

export const PLAYER_MAX_HEALTH = 100;
export const RESPAWN_SECONDS = 3;
