import type { Seed } from '../core/brand';
import { Rng } from '../math/prng';
import type { MaterialId } from '../procgen/materials';
import type { ZoneId } from '../audio/zones';
import type { Race } from '../combat/races';

/**
 * Authored-structure + procedural-detail layout of the stage-1 test street:
 * an abandoned city block at night. Pure data, consumed by the renderer now
 * and by physics (colliders) and AI (navmesh) in later stages.
 * Units: metres, Y up, the street runs along Z.
 */
export type Vec3 = readonly [number, number, number];

export interface BoxPiece {
  readonly material: MaterialId;
  readonly center: Vec3;
  readonly size: Vec3;
  readonly yaw: number;
  /** Probability-free tag for collision/nav: 'static' blocks movement. */
  readonly solid: boolean;
}

export type PropKind = 'barrel' | 'crate' | 'lampPost' | 'fungus';

export interface PropPiece {
  readonly kind: PropKind;
  readonly material: MaterialId;
  readonly position: Vec3;
  readonly yaw: number;
  readonly scale: number;
}

export type LightKind = 'sodiumLamp' | 'emergencyBeacon' | 'bioluminescence' | 'window';

export interface LightPiece {
  readonly kind: LightKind;
  readonly position: Vec3;
  /** Linear RGB. */
  readonly color: Vec3;
  readonly intensity: number;
  readonly range: number;
  /** 0 = steady, 1 = badly flickering. */
  readonly flicker: number;
}

/** Invisible collision-only walls (street ends, alley backs). */
export interface BlockerPiece {
  readonly center: Vec3;
  readonly size: Vec3;
}

/** Axis-aligned XZ region belonging to a world zone (soundscape, later spawns and weather). */
export interface ZoneVolume {
  readonly zone: ZoneId;
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
}

/** A shootable dummy/mob placeholder of a given race (range targets; real mobs come in stage 6). */
export interface TargetPiece {
  readonly race: Race;
  readonly position: Vec3;
  readonly yaw: number;
}

/** Layout of any playable area (street, range…). Consumed by render, physics, audio and spawns. */
export interface StreetLayout {
  readonly kind: 'street' | 'range';
  readonly targets: readonly TargetPiece[];
  readonly zones: readonly ZoneVolume[];
  readonly boxes: readonly BoxPiece[];
  readonly blockers: readonly BlockerPiece[];
  readonly props: readonly PropPiece[];
  readonly lights: readonly LightPiece[];
  /** Feet position and facing of the player start. */
  readonly spawn: { readonly position: Vec3; readonly yaw: number };
  /** Walkable XZ rectangle: [minX, minZ, maxX, maxZ]. */
  readonly walkBounds: readonly [number, number, number, number];
}

export const STREET = {
  length: 120,
  roadHalfWidth: 6,
  sidewalkWidth: 3,
  curbHeight: 0.15,
} as const;

export function generateStreetLayout(seed: Seed): StreetLayout {
  const rng = Rng.stream(seed, 'layout.street');
  const boxes: BoxPiece[] = [];
  const props: PropPiece[] = [];
  const lights: LightPiece[] = [];
  const halfL = STREET.length / 2;
  const sideX = STREET.roadHalfWidth + STREET.sidewalkWidth;

  boxes.push({
    material: 'asphalt',
    center: [0, -0.05, 0],
    size: [STREET.roadHalfWidth * 2, 0.1, STREET.length],
    yaw: 0,
    solid: true,
  });
  for (const side of [-1, 1]) {
    const cx = side * (STREET.roadHalfWidth + STREET.sidewalkWidth / 2);
    boxes.push({
      material: 'concrete',
      center: [cx, STREET.curbHeight / 2 - 0.05, 0],
      size: [STREET.sidewalkWidth, STREET.curbHeight + 0.1, STREET.length],
      yaw: 0,
      solid: true,
    });
  }

  // Building facades along both sides with occasional alleys.
  for (const side of [-1, 1]) {
    let z = -halfL;
    while (z < halfL) {
      const width = rng.range(8, 16);
      const usable = Math.min(width, halfL - z);
      if (rng.chance(0.18) && usable > 4) {
        z += rng.range(3, 5); // alley gap
        continue;
      }
      const height = rng.range(7, 22);
      const depth = rng.range(8, 14);
      const material: MaterialId = rng.chance(0.55) ? 'brick' : 'concrete';
      boxes.push({
        material,
        center: [side * (sideX + depth / 2), height / 2, z + usable / 2],
        size: [depth, height, usable],
        yaw: 0,
        solid: true,
      });
      // Rare lit windows: someone left a light on, or the generator still runs.
      if (rng.chance(0.25)) {
        lights.push({
          kind: 'window',
          position: [
            side * (sideX - 0.05),
            rng.range(3, Math.min(height - 1, 10)),
            z + rng.range(1, usable - 1),
          ],
          color: [1.0, 0.62, 0.3],
          intensity: rng.range(0.8, 2),
          range: 6,
          flicker: rng.chance(0.4) ? rng.range(0.2, 0.7) : 0,
        });
      }
      z += usable;
    }
  }

  // Street lamps: most dead, a couple alive, one dying.
  for (let z = -halfL + 12, i = 0; z < halfL; z += 24, i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (STREET.roadHalfWidth + 0.6);
    props.push({
      kind: 'lampPost',
      material: 'paintedMetal',
      position: [x, STREET.curbHeight, z],
      yaw: side > 0 ? Math.PI : 0,
      scale: 1,
    });
    const state = rng.nextFloat();
    if (state < 0.45) {
      lights.push({
        kind: 'sodiumLamp',
        position: [x - side * 1.6, 6.2, z],
        color: [1.0, 0.55, 0.18],
        intensity: 60,
        range: 22,
        flicker: state < 0.12 ? 0.8 : 0.05,
      });
    }
  }

  // An emergency beacon on a barricade halfway down the street.
  const beaconZ = rng.range(-5, 15);
  for (let i = -2; i <= 2; i++) {
    boxes.push({
      material: 'paintedMetal',
      center: [i * 1.9, 0.5, beaconZ],
      size: [1.6, 1, 0.25],
      yaw: rng.range(-0.15, 0.15),
      solid: true,
    });
  }
  lights.push({
    kind: 'emergencyBeacon',
    position: [0.3, 1.25, beaconZ],
    color: [1.0, 0.08, 0.04],
    intensity: 40,
    range: 18,
    flicker: 0,
  });

  // Debris and props.
  for (let i = 0; i < 26; i++) {
    const kind: PropKind = rng.chance(0.55) ? 'barrel' : 'crate';
    const onSidewalk = rng.chance(0.6);
    const side = rng.chance(0.5) ? -1 : 1;
    const x = onSidewalk
      ? side * rng.range(STREET.roadHalfWidth + 0.8, sideX - 0.6)
      : rng.range(-STREET.roadHalfWidth + 1, STREET.roadHalfWidth - 1);
    const y = onSidewalk ? STREET.curbHeight : 0;
    const material: MaterialId =
      kind === 'crate' ? 'woodPlanks' : rng.chance(0.5) ? 'rustedMetal' : 'paintedMetal';
    props.push({
      kind,
      material,
      position: [x, y, rng.range(-halfL + 5, halfL - 5)],
      yaw: rng.range(-Math.PI, Math.PI),
      scale: rng.range(0.85, 1.15),
    });
  }

  // Wrecked cars as rusted box clusters.
  for (let i = 0; i < 4; i++) {
    const x = rng.range(-3.5, 3.5);
    const z = rng.range(-halfL + 15, halfL - 15);
    const yaw = rng.range(-0.6, 0.6);
    boxes.push({
      material: 'rustedMetal',
      center: [x, 0.55, z],
      size: [1.9, 0.8, 4.3],
      yaw,
      solid: true,
    });
    boxes.push({
      material: 'rustedMetal',
      center: [x, 1.2, z - 0.2],
      size: [1.7, 0.6, 2.2],
      yaw,
      solid: true,
    });
  }

  // Bioluminescent fungus clusters creeping out of the alleys and wall bases.
  for (let i = 0; i < 7; i++) {
    const side = rng.chance(0.5) ? -1 : 1;
    const x = side * (sideX - rng.range(0.2, 0.8));
    const z = rng.range(-halfL + 5, halfL - 5);
    const cluster = rng.int(3, 7);
    for (let j = 0; j < cluster; j++) {
      props.push({
        kind: 'fungus',
        material: 'concrete',
        position: [
          x + rng.range(-0.5, 0.5),
          STREET.curbHeight + rng.range(0, 1.4),
          z + rng.range(-1, 1),
        ],
        yaw: rng.range(-3, 3),
        scale: rng.range(0.12, 0.35),
      });
    }
    if (i < 4)
      lights.push({
        kind: 'bioluminescence',
        position: [x - side * 0.4, STREET.curbHeight + 0.6, z],
        color: [0.15, 1.0, 0.75],
        intensity: 2.5,
        range: 5,
        flicker: 0.15,
      });
  }

  const alleyDepth = 2.5;
  const blockers: BlockerPiece[] = [
    { center: [-(sideX + alleyDepth + 0.5), 5, 0], size: [1, 10, STREET.length + 4] },
    { center: [sideX + alleyDepth + 0.5, 5, 0], size: [1, 10, STREET.length + 4] },
    { center: [0, 5, -(halfL + 0.5)], size: [2 * (sideX + alleyDepth), 10, 1] },
    { center: [0, 5, halfL + 0.5], size: [2 * (sideX + alleyDepth), 10, 1] },
  ];

  // South of the barricade is the old residential city; north of it, the industrial yards.
  const zones: ZoneVolume[] = [
    { zone: 'abandonedCity', min: [-60, -halfL - 10], max: [60, beaconZ] },
    { zone: 'industrial', min: [-60, beaconZ], max: [60, halfL + 10] },
  ];

  // Placeholder bodies of each race (shootable dummies until mobs arrive in stage 6).
  const targets: TargetPiece[] = [
    { race: 'zombie', position: [1.5, 0, beaconZ - 3], yaw: 0 },
    { race: 'robot', position: [-2.5, 0, beaconZ + 18], yaw: 0.4 },
    { race: 'animal', position: [sideX + 1.2, 0, -30], yaw: -1.2 },
    { race: 'plant', position: [-(sideX - 0.6), STREET.curbHeight, -18], yaw: 1.5 },
  ];

  return {
    kind: 'street',
    targets,
    zones,
    boxes,
    blockers,
    props,
    lights,
    spawn: { position: [1.5, 0, -halfL + 4], yaw: Math.PI },
    walkBounds: [-sideX + 0.3, -halfL + 0.5, sideX - 0.3, halfL - 0.5],
  };
}

/** Distance from (x, z) to an XZ box (0 inside). */
function distanceToVolume(v: ZoneVolume, x: number, z: number): number {
  const dx = Math.max(v.min[0] - x, 0, x - v.max[0]);
  const dz = Math.max(v.min[1] - z, 0, z - v.max[1]);
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Zone weights at a point, cross-fading over `blend` metres around each
 * boundary, so walking across a border morphs the soundscape smoothly.
 */
export function zoneWeightsAt(
  layout: StreetLayout,
  x: number,
  z: number,
  blend = 8,
): Partial<Record<ZoneId, number>> {
  const out: Partial<Record<ZoneId, number>> = {};
  for (const v of layout.zones) {
    // Signed distance: negative inside, measured to the nearest edge.
    const inside = x >= v.min[0] && x <= v.max[0] && z >= v.min[1] && z <= v.max[1];
    const edge = inside
      ? -Math.min(x - v.min[0], v.max[0] - x, z - v.min[1], v.max[1] - z)
      : distanceToVolume(v, x, z);
    const w = Math.min(1, Math.max(0, 0.5 - edge / blend));
    if (w > 0) out[v.zone] = (out[v.zone] ?? 0) + w;
  }
  return out;
}
