import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gradient2 } from '../../../domain/procgen/noise';

/**
 * Procedural geometry. All UVs are in metres so materials tile at their
 * physical scale regardless of object size.
 */

/** Box whose UVs are scaled to metres per face. */
export function meterBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const faceDims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = faceDims[face] ?? [1, 1];
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  return g;
}

/** Steel drum: lathe profile with two rolling hoops and a rim; UVs in metres. */
export function barrelGeometry(): THREE.BufferGeometry {
  const r = 0.29;
  const h = 0.88;
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r - 0.01, 0),
    new THREE.Vector2(r, 0.02),
  ];
  for (const y of [0.29, 0.59]) {
    profile.push(
      new THREE.Vector2(r, y - 0.02),
      new THREE.Vector2(r + 0.012, y),
      new THREE.Vector2(r, y + 0.02),
    );
  }
  profile.push(
    new THREE.Vector2(r, h - 0.02),
    new THREE.Vector2(r + 0.006, h),
    new THREE.Vector2(r - 0.02, h),
    new THREE.Vector2(r - 0.02, h - 0.015),
    new THREE.Vector2(0, h - 0.015),
  );
  const g = new THREE.LatheGeometry(profile, 24);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r, uv.getY(i) * h);
  g.computeVertexNormals();
  return g;
}

export function crateGeometry(): THREE.BufferGeometry {
  const g = meterBox(0.8, 0.8, 0.8);
  g.translate(0, 0.4, 0);
  return g;
}

/** Street lamp: pole, arm and head, merged; origin at the base. */
export function lampPostGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 6.4, 10, 1);
  pole.translate(0, 3.2, 0);
  const arm = meterBox(1.7, 0.08, 0.08);
  arm.translate(0.8, 6.3, 0);
  const head = meterBox(0.55, 0.14, 0.3);
  head.translate(1.6, 6.25, 0);
  const parts = [pole, arm, head].map((p) => p.toNonIndexed());
  return mergeOrThrow(parts);
}

/** mergeGeometries is typed non-null but returns null at runtime on incompatible attributes. */
export function mergeOrThrow(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged: unknown = mergeGeometries(parts);
  if (!isBufferGeometry(merged)) throw new Error('mergeGeometries failed: incompatible attributes');
  return merged;
}

function isBufferGeometry(v: unknown): v is THREE.BufferGeometry {
  return v instanceof THREE.BufferGeometry;
}

/** The glowing lamp bulb (emissive, separate material). */
export function lampBulbGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.4, 0.03, 0.2);
}

/** Fungus cap: icosphere displaced by tileable noise into a lumpy, flattened blob. */
export function fungusGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = gradient2(v.x * 2.3 + 10, v.z * 2.3 + v.y * 1.7 + 10, 64, seed);
    v.multiplyScalar(1 + 0.35 * n);
    v.y *= 0.55;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Scales a geometry's UVs so they are in metres for a part of size (su, sv). */
function scaleUv(g: THREE.BufferGeometry, su: number, sv: number): void {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/** Pine trunk, origin at the base (9 m, tapering). */
export function treeTrunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.07, 0.22, 9, 8, 4);
  g.translate(0, 4.5, 0);
  scaleUv(g, 2 * Math.PI * 0.15, 9);
  return g;
}

/** Conifer canopy: stacked ragged cones, displaced by tileable noise so tiers look like boughs. */
export function treeCanopyGeometry(seed: number): THREE.BufferGeometry {
  const tiers: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  for (let k = 0; k < 5; k++) {
    const radius = 2.4 * (1 - k / 5.5) + 0.25;
    const height = 2.6;
    const cone = new THREE.ConeGeometry(radius, height, 10, 2);
    cone.translate(0, 3.2 + k * 1.45 + height / 2, 0);
    const pos = cone.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = gradient2(v.x * 1.7 + k * 3.1, v.z * 1.7 + v.y * 0.9, 32, seed + k);
      const r = Math.hypot(v.x, v.z);
      if (r > 1e-3) {
        const s = 1 + 0.28 * n;
        v.x *= s;
        v.z *= s;
      }
      v.y += 0.25 * n;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    scaleUv(cone, 2 * Math.PI * radius, height);
    tiers.push(cone.toNonIndexed());
  }
  const merged = mergeOrThrow(tiers);
  for (const t of tiers) t.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Boulder: a lumpy, flattened icosphere sunk a little into the ground. */
export function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.9, 2);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = gradient2(v.x * 1.9 + 4, v.z * 1.9 + v.y * 1.3 + 4, 64, seed);
    v.multiplyScalar(1 + 0.3 * n);
    v.y = v.y * 0.6 + 0.35;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  scaleUv(g, 3, 1.5);
  g.computeVertexNormals();
  return g;
}
