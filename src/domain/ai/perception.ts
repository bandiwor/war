import { clamp, cos, sin } from '../math/dmath';

/**
 * Senses as pure geometry: how strongly (0..1) a mob perceives its target
 * this moment. Line of sight is the caller's job (a physics ray).
 */

/** Light falling on the target 0..1: its own flashlight, then the sky. */
export function targetLight(flashlightOn: boolean, daylight: number): number {
  return clamp((flashlightOn ? 1 : 0) + daylight, 0, 1);
}

export interface SightSpec {
  readonly range: number;
  readonly fovDeg: number;
  readonly needsLight: number;
}

/**
 * Sight: inside the view cone and within a range that shrinks in the dark
 * (for light-dependent eyes) and in fog (`envSight` from the weather).
 * Strength falls off linearly toward the edge of that range.
 */
export function sightStrength(
  spec: SightSpec,
  mx: number,
  mz: number,
  yaw: number,
  tx: number,
  tz: number,
  light: number,
  envSight: number,
): number {
  const dx = tx - mx;
  const dz = tz - mz;
  const d = Math.sqrt(dx * dx + dz * dz);
  const visibility = 1 - spec.needsLight + spec.needsLight * clamp(light, 0, 1);
  const range = spec.range * visibility * clamp(0.35 + 0.65 * envSight, 0, 1);
  if (d > range || range <= 0) return 0;
  if (d > 1e-6 && spec.fovDeg < 360) {
    // Forward is −Z rotated by yaw (the hitbox/body convention).
    const fx = -sin(yaw);
    const fz = -cos(yaw);
    const cosAngle = (dx * fx + dz * fz) / d;
    const half = (spec.fovDeg * Math.PI) / 360;
    if (cosAngle < cos(half)) return 0;
  }
  return 1 - d / range;
}

/** Hearing: a noise heard within its radius × the mob's ears × the weather's masking. */
export function hearingStrength(
  hearing: number,
  noiseRadius: number,
  distance: number,
  envHearing: number,
): number {
  const r = noiseRadius * hearing * envHearing;
  if (r <= 0 || distance > r) return 0;
  return 1 - distance / r;
}

/** Proximity (scent): through walls and darkness, but short. */
export function proximityStrength(radius: number, distance: number): number {
  if (radius <= 0 || distance > radius) return 0;
  return 1 - distance / radius;
}

/** Awareness rises with what is sensed and fades over `forget` seconds without it. */
export function stepAwareness(
  awareness: number,
  strength: number,
  dt: number,
  forget: number,
): number {
  if (strength > 0) return clamp(awareness + strength * 4 * dt + 0.02, 0, 1);
  const next = awareness - dt / Math.max(0.1, forget);
  return next < 1e-9 ? 0 : clamp(next, 0, 1);
}

/** Rough hearing radii (m) of non-footstep noises. */
export const NOISE = { gunshot: 110, suppressedShot: 22, explosion: 220 } as const;
