import { clamp, cos, sin, TAU } from '../math/dmath';
import type { Rng } from '../math/prng';

/**
 * Point-mass exterior ballistics: gravity plus quadratic drag
 * a = g − k·|v|·v, integrated with the RK2 midpoint method in substeps.
 * Midpoint is exact for constant acceleration (the drag-free case matches
 * the analytic parabola) and second-order accurate with drag.
 * Deterministic: only + − × ÷ √ and dmath.
 */
export const GRAVITY = 9.81;

export interface Vec3Mut {
  x: number;
  y: number;
  z: number;
}

export interface ProjectileState {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
}

export function speed(s: ProjectileState): number {
  return Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
}

/** Advances `s` by `dt` in `substeps` midpoint steps. Allocation-free. */
export function integrate(
  s: ProjectileState,
  dragK: number,
  dt: number,
  substeps = 4,
  gravity = GRAVITY,
): void {
  const h = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    const v0 = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    const ax0 = -dragK * v0 * s.vx;
    const ay0 = -gravity - dragK * v0 * s.vy;
    const az0 = -dragK * v0 * s.vz;
    const mx = s.vx + ax0 * (h / 2);
    const my = s.vy + ay0 * (h / 2);
    const mz = s.vz + az0 * (h / 2);
    const vm = Math.sqrt(mx * mx + my * my + mz * mz);
    const axm = -dragK * vm * mx;
    const aym = -gravity - dragK * vm * my;
    const azm = -dragK * vm * mz;
    s.px += mx * h;
    s.py += my * h;
    s.pz += mz * h;
    s.vx += axm * h;
    s.vy += aym * h;
    s.vz += azm * h;
  }
}

/** Rocket sustainer: constant acceleration along the flight direction during [ignite, burnout). */
export interface Motor {
  readonly thrust: number;
  readonly ignite: number;
  readonly burnout: number;
}

/**
 * One simulation tick of a rocket of age `age`: thrust along the velocity
 * (semi-implicit), then drag and gravity. The simulation and the zeroing
 * code both call this with the same dt, so sights match flight exactly.
 */
export function integrateRocket(
  s: ProjectileState,
  dragK: number,
  motor: Motor,
  age: number,
  dt: number,
): void {
  if (age >= motor.ignite && age < motor.burnout) {
    const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    if (v > 1e-9) {
      const k = (motor.thrust * dt) / v;
      s.vx += s.vx * k;
      s.vy += s.vy * k;
      s.vz += s.vz * k;
    }
  }
  integrate(s, dragK, dt, 4);
}

export interface FlightSample {
  /** Downrange distance (horizontal), height relative to the muzzle, time, speed. */
  range: number;
  height: number;
  time: number;
  speed: number;
}

/**
 * Flies a shot horizontally along +X from the origin at `elevation`
 * radians until `range` metres downrange; returns the state there
 * (linearly interpolated within the last step).
 */
export function flyTo(
  range: number,
  muzzleVelocity: number,
  elevation: number,
  dragK: number,
  dt = 1 / 600,
  motor?: Motor,
): FlightSample {
  const s: ProjectileState = {
    px: 0,
    py: 0,
    pz: 0,
    vx: muzzleVelocity * cos(elevation),
    vy: muzzleVelocity * sin(elevation),
    vz: 0,
  };
  let t = 0;
  for (let i = 0; i < 1e6; i++) {
    const prevX = s.px;
    const prevY = s.py;
    const prevV = speed(s);
    if (motor === undefined) integrate(s, dragK, dt, 1);
    else integrateRocket(s, dragK, motor, t, dt);
    t += dt;
    if (s.px >= range) {
      const f = (range - prevX) / (s.px - prevX);
      return {
        range,
        height: prevY + (s.py - prevY) * f,
        time: t - dt + dt * f,
        speed: prevV + (speed(s) - prevV) * f,
      };
    }
    if (s.vx <= 0) break;
  }
  throw new Error(`Projectile never reached ${String(range)} m`);
}

/**
 * Bore elevation (radians) so the trajectory, starting `sightHeight` below
 * the line of sight, crosses it again at `zero` metres (the usual zeroing).
 * Bisection: robust and deterministic.
 */
export function zeroElevation(
  zero: number,
  sightHeight: number,
  muzzleVelocity: number,
  dragK: number,
  motor?: Motor,
): number {
  let lo = 0;
  let hi = 0.05; // ~2.9°: far above anything a firearm needs
  // Rockets are flown at the simulation tick so the zero matches in-game flight.
  const dt = motor === undefined ? 1 / 600 : 1 / 60;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const h = flyTo(zero, muzzleVelocity, mid, dragK, dt, motor).height;
    if (h < sightHeight) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** MOA → radians (1 MOA = 1/60 degree). */
export function moaToRad(moa: number): number {
  return (moa / 60) * (Math.PI / 180);
}

export function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Deterministic direction inside a cone of full angle `coneRad` around the
 * unit vector (dx, dy, dz): uniform over the disk of angular offsets.
 */
export function sampleCone(
  dx: number,
  dy: number,
  dz: number,
  coneRad: number,
  rng: Rng,
  out: Vec3Mut,
): Vec3Mut {
  const half = coneRad / 2;
  const r = half * Math.sqrt(rng.nextFloat());
  const theta = rng.nextFloat() * TAU;
  const ox = r * cos(theta);
  const oy = r * sin(theta);
  // Orthonormal basis around d: right = normalize(d × up), up' = right × d.
  let rx = dz;
  const ry = 0;
  let rz = -dx;
  let rl = Math.sqrt(rx * rx + rz * rz);
  if (rl < 1e-9) {
    rx = 1;
    rz = 0;
    rl = 1;
  }
  rx /= rl;
  rz /= rl;
  const ux = ry * dz - rz * dy;
  const uy = rz * dx - rx * dz;
  const uz = rx * dy - ry * dx;
  // Small-angle rotation: d + tan(offset) components, renormalised.
  const tx = dx + rx * ox + ux * oy;
  const ty = dy + ry * ox + uy * oy;
  const tz = dz + rz * ox + uz * oy;
  const l = Math.sqrt(tx * tx + ty * ty + tz * tz);
  out.x = tx / l;
  out.y = ty / l;
  out.z = tz / l;
  return out;
}

/** Unit aim vector for yaw/pitch (yaw 0 looks down −Z, pitch up positive). */
export function aimVector(yaw: number, pitch: number, out: Vec3Mut): Vec3Mut {
  const cp = cos(pitch);
  out.x = -sin(yaw) * cp;
  out.y = sin(clamp(pitch, -1.57, 1.57));
  out.z = -cos(yaw) * cp;
  return out;
}

/** Damage multiplier from distance travelled (linear between start and end). */
export function falloffFactor(distance: number, start: number, end: number, min: number): number {
  if (distance <= start) return 1;
  if (distance >= end) return min;
  return 1 + ((min - 1) * (distance - start)) / (end - start);
}
