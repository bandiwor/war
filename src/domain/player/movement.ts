import { clamp, cos, sin } from '../math/dmath';
import type { PlayerTuning } from './tuning';

/**
 * Pure first-person motor: input + state → desired displacement, then
 * reconciliation with what the physics allowed. No physics engine here; the
 * application feeds back collision results. Deterministic (dmath only).
 */
export interface MotorInput {
  forward: number;
  strafe: number;
  yaw: number;
  sprint: boolean;
  crouch: boolean;
  jumpPressed: boolean;
}

export interface MotorState {
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  /** 0 = standing, 1 = fully crouched. */
  crouch: number;
  stamina: number;
  /** Set by the physics step when standing up is blocked by a ceiling. */
  ceilingBlocked: boolean;
  /** Seconds airborne. */
  airTime: number;
}

export interface MotorOutput {
  dx: number;
  dy: number;
  dz: number;
  jumped: boolean;
  sprinting: boolean;
  /** Desired capsule height this tick (crouch blend). */
  height: number;
}

export function createMotorState(): MotorState {
  return {
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: false,
    crouch: 0,
    stamina: 1,
    ceilingBlocked: false,
    airTime: 0,
  };
}

export function createMotorOutput(): MotorOutput {
  return { dx: 0, dy: 0, dz: 0, jumped: false, sprinting: false, height: 0 };
}

/**
 * Vertical push while grounded. Zero on purpose: the physics adapter's
 * snap-to-ground keeps the character on slopes and steps down, and any
 * downward push into the floor makes Rapier's collide-and-slide stall for a
 * tick (measured) and suppresses autostep up curbs.
 */
export const GROUND_STICK = 0;

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

export function capsuleHeight(t: PlayerTuning, crouch: number): number {
  return t.standHeight + (t.crouchHeight - t.standHeight) * crouch;
}

export function eyeHeight(t: PlayerTuning, crouch: number): number {
  return capsuleHeight(t, crouch) - t.eyeFromTop;
}

export function stepMotor(
  s: MotorState,
  input: MotorInput,
  t: PlayerTuning,
  dt: number,
  out: MotorOutput,
): MotorOutput {
  // Crouch blend; standing up waits while a ceiling blocks it.
  const wantCrouch = input.crouch || s.ceilingBlocked;
  s.crouch = approach(s.crouch, wantCrouch ? 1 : 0, dt / t.crouchTransitionSeconds);

  // Wish direction in world space (yaw 0 looks down -Z).
  let f = clamp(input.forward, -1, 1);
  let r = clamp(input.strafe, -1, 1);
  const len = Math.sqrt(f * f + r * r);
  if (len > 1) {
    f /= len;
    r /= len;
  }
  const sprinting =
    input.sprint && f > 0 && s.grounded && s.crouch < 0.5 && s.stamina > t.staminaMinToSprint;
  const base = sprinting ? t.sprintSpeed : t.walkSpeed + (t.crouchSpeed - t.walkSpeed) * s.crouch;
  const fwdSpeed = f >= 0 ? base * f : base * f * t.backpedalFactor;
  const sideSpeed = base * r * t.strafeFactor;
  const sy = sin(input.yaw);
  const cy = cos(input.yaw);
  const wishX = -sy * fwdSpeed + cy * sideSpeed;
  const wishZ = -cy * fwdSpeed - sy * sideSpeed;

  if (s.grounded) {
    const hasInput = len > 0.01;
    const rate = (hasInput ? t.groundAccel : t.groundFriction) * dt * Math.max(base, 1);
    s.vx = approach(s.vx, wishX, rate);
    s.vz = approach(s.vz, wishZ, rate);
  } else {
    s.vx = approach(s.vx, wishX, t.airAccel * dt);
    s.vz = approach(s.vz, wishZ, t.airAccel * dt);
  }

  out.jumped = false;
  if (input.jumpPressed && s.grounded && s.crouch < 0.5 && s.stamina >= t.staminaJumpCost) {
    s.vy = t.jumpSpeed;
    s.stamina -= t.staminaJumpCost;
    s.grounded = false;
    out.jumped = true;
  }

  if (s.grounded) {
    s.vy = 0;
    s.airTime = 0;
  } else {
    s.vy -= t.gravity * dt;
    s.airTime += dt;
  }

  if (sprinting) s.stamina = Math.max(0, s.stamina - t.staminaSprintDrain * dt);
  else s.stamina = Math.min(1, s.stamina + t.staminaRegen * dt);

  out.dx = s.vx * dt;
  out.dz = s.vz * dt;
  out.dy = s.grounded ? -GROUND_STICK : s.vy * dt;
  out.sprinting = sprinting;
  out.height = capsuleHeight(t, s.crouch);
  return out;
}

export interface MotorFeedback {
  /** Movement the physics actually applied. */
  dx: number;
  dy: number;
  dz: number;
  grounded: boolean;
  /** Whether the capsule could take the requested height. */
  heightApplied: boolean;
}

export interface Landing {
  landed: boolean;
  /** Downward speed at touchdown, m/s. */
  impactSpeed: number;
}

/**
 * Reconciles motor velocity with the physics result: walls kill velocity
 * into them, ceilings stop upward motion, touchdown reports impact speed.
 */
export function applyFeedback(
  s: MotorState,
  fb: MotorFeedback,
  desiredDy: number,
  dt: number,
  out: Landing,
): Landing {
  // Horizontal velocity follows what actually happened (no speed build-up against walls).
  s.vx = fb.dx / dt;
  s.vz = fb.dz / dt;
  if (!s.grounded && s.vy > 0 && fb.dy < desiredDy - 1e-4) s.vy = 0; // bumped the ceiling
  out.landed = !s.grounded && fb.grounded && s.vy <= 0;
  out.impactSpeed = out.landed ? -s.vy : 0;
  if (fb.grounded && s.vy <= 0) {
    s.vy = 0;
    s.airTime = 0;
  }
  s.grounded = fb.grounded && s.vy <= 0;
  s.ceilingBlocked = !fb.heightApplied;
  return out;
}
