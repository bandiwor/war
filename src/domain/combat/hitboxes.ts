import { cos, sin } from '../math/dmath';
import type { BodyPart, Race } from './races';

/**
 * Hitbox archetypes (local space: +Y up, facing −Z, origin at the feet) and
 * exact ray/segment intersection. Spheres and capsules for organic bodies,
 * boxes for robot chassis. Pure; property-tested against brute force.
 */
export type HitShape =
  | {
      readonly kind: 'sphere';
      readonly part: BodyPart;
      readonly c: readonly [number, number, number];
      readonly r: number;
    }
  | {
      readonly kind: 'capsule';
      readonly part: BodyPart;
      readonly a: readonly [number, number, number];
      readonly b: readonly [number, number, number];
      readonly r: number;
    }
  | {
      readonly kind: 'box';
      readonly part: BodyPart;
      readonly c: readonly [number, number, number];
      readonly half: readonly [number, number, number];
    };

export const HITBOXES: Readonly<Record<Race, readonly HitShape[]>> = {
  zombie: [
    { kind: 'sphere', part: 'head', c: [0, 1.62, 0], r: 0.115 },
    { kind: 'capsule', part: 'torso', a: [0, 1.0, 0], b: [0, 1.42, 0], r: 0.19 },
    { kind: 'capsule', part: 'arm', a: [-0.24, 1.42, 0], b: [-0.3, 0.85, -0.08], r: 0.055 },
    { kind: 'capsule', part: 'arm', a: [0.24, 1.42, 0], b: [0.3, 0.85, -0.08], r: 0.055 },
    { kind: 'capsule', part: 'leg', a: [-0.1, 0.95, 0], b: [-0.11, 0.08, 0], r: 0.075 },
    { kind: 'capsule', part: 'leg', a: [0.1, 0.95, 0], b: [0.11, 0.08, 0], r: 0.075 },
  ],
  robot: [
    { kind: 'sphere', part: 'sensor', c: [0, 1.38, -0.12], r: 0.09 },
    { kind: 'box', part: 'chassis', c: [0, 0.95, 0], half: [0.32, 0.32, 0.38] },
    { kind: 'capsule', part: 'leg', a: [-0.25, 0.65, 0], b: [-0.3, 0.05, 0], r: 0.06 },
    { kind: 'capsule', part: 'leg', a: [0.25, 0.65, 0], b: [0.3, 0.05, 0], r: 0.06 },
  ],
  plant: [
    { kind: 'sphere', part: 'bulb', c: [0, 0.7, 0], r: 0.3 },
    { kind: 'capsule', part: 'stem', a: [0, 0, 0], b: [0, 1.4, -0.1], r: 0.08 },
    { kind: 'sphere', part: 'head', c: [0, 1.55, -0.15], r: 0.22 },
  ],
  animal: [
    { kind: 'capsule', part: 'torso', a: [0, 0.62, 0.45], b: [0, 0.62, -0.4], r: 0.26 },
    { kind: 'sphere', part: 'head', c: [0, 0.58, -0.75], r: 0.17 },
    { kind: 'capsule', part: 'leg', a: [-0.15, 0.45, -0.3], b: [-0.15, 0, -0.3], r: 0.05 },
    { kind: 'capsule', part: 'leg', a: [0.15, 0.45, -0.3], b: [0.15, 0, -0.3], r: 0.05 },
    { kind: 'capsule', part: 'leg', a: [-0.15, 0.45, 0.35], b: [-0.15, 0, 0.35], r: 0.05 },
    { kind: 'capsule', part: 'leg', a: [0.15, 0.45, 0.35], b: [0.15, 0, 0.35], r: 0.05 },
  ],
};

/** Bounding sphere radius & centre height of each archetype (broad-phase reject). */
export function archetypeBounds(race: Race): { readonly y: number; readonly r: number } {
  switch (race) {
    case 'zombie':
      return { y: 0.9, r: 1.0 };
    case 'robot':
      return { y: 0.75, r: 0.9 };
    case 'plant':
      return { y: 0.85, r: 1.0 };
    case 'animal':
      return { y: 0.5, r: 1.0 };
  }
}

/** Ray–sphere: smallest t in [0, maxT] or −1. Direction need not be unit (t in its units). */
export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  maxT: number,
): number {
  const mx = ox - cx;
  const my = oy - cy;
  const mz = oz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0; // starts inside
  if (b > 0) return -1;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= maxT ? t : -1;
}

/** Ray–capsule (segment a→b, radius r). */
export function rayCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
  maxT: number,
): number {
  // Infinite cylinder around the axis, clipped to the segment, plus the end spheres.
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const aox = ox - ax;
  const aoy = oy - ay;
  const aoz = oz - az;
  const abab = abx * abx + aby * aby + abz * abz;
  const abd = abx * dx + aby * dy + abz * dz;
  const abao = abx * aox + aby * aoy + abz * aoz;
  const dd = dx * dx + dy * dy + dz * dz;
  const dao = dx * aox + dy * aoy + dz * aoz;
  const aoao = aox * aox + aoy * aoy + aoz * aoz;
  const qa = abab * dd - abd * abd;
  const qb = abab * dao - abao * abd;
  const qc = abab * aoao - abao * abao - r * r * abab;
  // Origin already inside the capsule: closest point on the segment within r.
  const along = abab > 0 ? Math.max(0, Math.min(1, abao / abab)) : 0;
  const cx = aox - abx * along;
  const cy = aoy - aby * along;
  const cz = aoz - abz * along;
  if (cx * cx + cy * cy + cz * cz <= r * r) return 0;
  let best = -1;
  if (Math.abs(qa) > 1e-12) {
    const h = qb * qb - qa * qc;
    if (h >= 0) {
      const t = (-qb - Math.sqrt(h)) / qa;
      const y = abao + t * abd;
      if (y > 0 && y < abab && t >= 0 && t <= maxT) best = t;
    }
  }
  const s1 = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r, maxT);
  const s2 = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r, maxT);
  if (s1 >= 0 && (best < 0 || s1 < best)) best = s1;
  if (s2 >= 0 && (best < 0 || s2 < best)) best = s2;
  return best;
}

/** Ray–axis-aligned box (slab method). */
export function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  maxT: number,
): number {
  let tmin = 0;
  let tmax = maxT;
  const axes: [number, number, number, number][] = [
    [ox - cx, dx, hx, 0],
    [oy - cy, dy, hy, 0],
    [oz - cz, dz, hz, 0],
  ];
  for (const [o, d, h] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (o < -h || o > h) return -1;
      continue;
    }
    let t1 = (-h - o) / d;
    let t2 = (h - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export interface HitResult {
  t: number;
  part: BodyPart | null;
}

/**
 * Tests a world-space segment (origin + t·dir, t ∈ [0, maxT]) against a
 * target archetype standing at (x, y, z) with `yaw`. Returns the nearest hit.
 */
export function intersectArchetype(
  race: Race,
  x: number,
  y: number,
  z: number,
  yaw: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  out: HitResult,
  /** Size relative to the archetype (mobs of one race differ in size). */
  scale = 1,
): HitResult {
  out.t = -1;
  out.part = null;
  // Broad phase.
  const bounds = archetypeBounds(race);
  if (raySphere(ox, oy, oz, dx, dy, dz, x, y + bounds.y * scale, z, bounds.r * scale, maxT) < 0)
    return out;
  // Into local space (rotate by −yaw around Y; local −Z is the target's forward).
  const c = cos(-yaw);
  const s = sin(-yaw);
  // Scaling origin offset and direction alike keeps t in world units.
  const inv = 1 / scale;
  const px = (ox - x) * inv;
  const pz = (oz - z) * inv;
  const lox = px * c + pz * s;
  const loz = -px * s + pz * c;
  const loy = (oy - y) * inv;
  const ldx = (dx * c + dz * s) * inv;
  const ldz = (-dx * s + dz * c) * inv;
  const ldy = dy * inv;
  for (const h of HITBOXES[race]) {
    let t: number;
    switch (h.kind) {
      case 'sphere':
        t = raySphere(lox, loy, loz, ldx, ldy, ldz, h.c[0], h.c[1], h.c[2], h.r, maxT);
        break;
      case 'capsule':
        t = rayCapsule(
          lox,
          loy,
          loz,
          ldx,
          ldy,
          ldz,
          h.a[0],
          h.a[1],
          h.a[2],
          h.b[0],
          h.b[1],
          h.b[2],
          h.r,
          maxT,
        );
        break;
      case 'box':
        t = rayBox(
          lox,
          loy,
          loz,
          ldx,
          ldy,
          ldz,
          h.c[0],
          h.c[1],
          h.c[2],
          h.half[0],
          h.half[1],
          h.half[2],
          maxT,
        );
        break;
    }
    if (t >= 0 && (out.t < 0 || t < out.t)) {
      out.t = t;
      out.part = h.part;
    }
  }
  return out;
}
