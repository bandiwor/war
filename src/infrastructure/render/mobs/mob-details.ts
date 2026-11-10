import * as THREE from 'three';
import { Rng } from '../../../domain/math/prng';
import { PLANT_SYSTEMS, growPlant, type LSystemSpec } from '../../../domain/procgen/lsystem';
import type { Form } from '../../../domain/mobs/registry';
import { mergeOrThrow } from '../scene/geometry';

/**
 * Race details on top of the hitbox bodies (stage 7, per the lore): what
 * makes a shambler read as a dead man overgrown with fungus, a sentry as
 * a wheeled camera with red tally lights, a flytrap as jaws on a stem. The
 * details carry no hitboxes (bullets test the archetype shapes), so they
 * stay slim and close to the body. Everything is built in code and seeded,
 * per mob kind, once.
 */
export type DetailMaterial = 'body' | 'cloth' | 'fungus' | 'dark' | 'bone' | 'signal' | 'glow';

export interface Detail {
  /** The bone it rides on (extra bones below are added to the rig). */
  readonly bone: string;
  /** Geometry in archetype space (absolute, like the hitboxes). */
  readonly geometry: THREE.BufferGeometry;
  readonly material: DetailMaterial;
}

/** Extra bones some forms need: the flytrap's upper jaw, the animals' tails. */
export const FORM_BONES: Readonly<
  Partial<
    Record<
      Form,
      readonly { name: string; pivot: readonly [number, number, number]; parent: string }[]
    >
  >
> = {
  flytrap: [{ name: 'jaw', pivot: [0, 1.58, 0.02], parent: 'head' }],
  wolf: [{ name: 'tail', pivot: [0, 0.7, 0.62], parent: 'torso' }],
  boar: [{ name: 'tail', pivot: [0, 0.7, 0.66], parent: 'torso' }],
};

type V3 = readonly [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

function between(a: V3, b: V3, r0: number, r1 = r0, sides = 6): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = Math.max(0.001, va.distanceTo(vb));
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, vb.clone().sub(va).normalize()));
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return flat(g);
}

function ball(c: V3, r: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.translate(c[0], c[1], c[2]);
  return flat(g);
}

/** A cone at `at` pointing along `dir` (tusks, teeth, ears, snouts). */
function cone(at: V3, dir: V3, r: number, h: number, sides = 6): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, sides, 1);
  g.translate(0, h / 2, 0);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize()),
  );
  g.translate(at[0], at[1], at[2]);
  return flat(g);
}

/** Polyhedra are already non-indexed; everything else is flattened for merging. */
function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index === null ? g : g.toNonIndexed();
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeOrThrow(parts.map(flat));
}

/** Lumpy blob (a fungal growth): icosphere with seeded radial jitter, flattened on its base. */
function growth(rng: Rng, c: V3, r: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + 0.5 * rng.nextFloat();
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.translate(c[0], c[1], c[2]);
  return flat(g);
}

/** A torn sleeve of cloth: an open tube whose hem and surface are jagged. */
function rag(rng: Rng, y0: number, y1: number, r: number, x: number, z = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r * 1.08, y1 - y0, 12, 3, true);
  const p = g.getAttribute('position');
  const half = (y1 - y0) / 2;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + 0.06 * (rng.nextFloat() - 0.5);
    let y = p.getY(i);
    if (y < -half + 1e-6) y += (y1 - y0) * 0.45 * rng.nextFloat(); // torn hem
    p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k);
  }
  g.translate(x, (y0 + y1) / 2, z);
  return flat(g);
}

/** An L-system plant as tapered cylinders (and its buds), placed at `at`, scaled and turned. */
function lPlant(
  spec: LSystemSpec,
  seed: number,
  at: V3,
  scale: number,
  yaw: number,
  tilt = 0,
): { stems: THREE.BufferGeometry; buds: THREE.BufferGeometry | null } {
  const plant = growPlant(spec, seed);
  const m = new THREE.Matrix4()
    .makeTranslation(at[0], at[1], at[2])
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .multiply(new THREE.Matrix4().makeRotationX(tilt))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  const stems = merge(
    plant.segments.slice(0, 160).map((s) => between(s.a, s.b, s.r0, s.r1, 4).applyMatrix4(m)),
  );
  const buds =
    plant.leaves.length === 0
      ? null
      : merge(plant.leaves.slice(0, 40).map((l) => ball(l, 0.025, 0).applyMatrix4(m)));
  return { stems, buds };
}

function zombie(rng: Rng, growths: number): Detail[] {
  const d: Detail[] = [];
  // Clothing: a torn shirt, torn trouser legs (each mob kind its own tatters).
  d.push({ bone: 'torso', geometry: rag(rng, 0.98, 1.46, 0.205, 0), material: 'cloth' });
  for (const [bone, x] of [
    ['legL', -0.1],
    ['legR', 0.1],
  ] as const)
    d.push({ bone, geometry: rag(rng, 0.45, 0.95, 0.088, x), material: 'cloth' });
  // Fungal growths: on the shoulders, the back, the skull; bioluminescent.
  const spots: [string, V3][] = [
    ['torso', [-0.17, 1.42, 0.06]],
    ['torso', [0.12, 1.3, 0.16]],
    ['torso', [0.02, 1.15, 0.18]],
    ['head', [0.07, 1.7, 0.06]],
    ['head', [-0.08, 1.6, 0.08]],
    ['armL', [-0.27, 1.2, 0.0]],
    ['torso', [0.18, 1.4, 0.04]],
    ['armR', [0.29, 1.05, -0.03]],
    ['legL', [-0.12, 0.6, 0.06]],
  ];
  const n = Math.min(spots.length, growths);
  const byBone = new Map<string, THREE.BufferGeometry[]>();
  for (let i = 0; i < n; i++) {
    const [bone, c] = spots[i] ?? ['torso', [0, 1.2, 0.15]];
    const list = byBone.get(bone) ?? [];
    list.push(growth(rng, c, 0.04 + 0.035 * rng.nextFloat()));
    // A cluster: one or two satellites.
    if (rng.nextFloat() > 0.4)
      list.push(
        growth(rng, [c[0] + 0.04 * (rng.nextFloat() - 0.5), c[1] + 0.04, c[2] + 0.02], 0.025),
      );
    byBone.set(bone, list);
  }
  for (const [bone, list] of byBone) d.push({ bone, geometry: merge(list), material: 'fungus' });
  return d;
}

/** Lens hood, tally lights, an antenna: every robot. */
function robotCommon(): Detail[] {
  const ring = new THREE.TorusGeometry(0.1, 0.022, 6, 16);
  ring.translate(0, 1.38, -0.17);
  return [
    { bone: 'head', geometry: flat(ring), material: 'dark' },
    {
      bone: 'head',
      geometry: between([0, 1.38, -0.05], [0, 1.38, 0.12], 0.08, 0.07, 10),
      material: 'dark',
    },
    // Red indicators on the chassis front and the antenna tip.
    {
      bone: 'torso',
      geometry: merge([
        ball([-0.2, 1.12, -0.385], 0.022, 0),
        ball([-0.13, 1.12, -0.385], 0.022, 0),
        ball([0.08, 1.38 - 0.02, 0.25], 0.03, 0),
      ]),
      material: 'signal',
    },
    {
      bone: 'torso',
      geometry: between([0.08, 1.27, 0.25], [0.08, 1.6, 0.25], 0.008),
      material: 'dark',
    },
    { bone: 'torso', geometry: ball([0.08, 1.62, 0.25], 0.02, 0), material: 'signal' },
  ];
}

function wheels(): Detail[] {
  const d: Detail[] = [];
  for (const [bone, x] of [
    ['legL', -0.3],
    ['legR', 0.3],
  ] as const) {
    const w = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16);
    w.rotateZ(Math.PI / 2);
    w.translate(x * 1.15, 0.2, 0);
    const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8);
    hub.rotateZ(Math.PI / 2);
    hub.translate(x * 1.15, 0.2, 0);
    d.push({ bone, geometry: merge([flat(w)]), material: 'dark' });
    d.push({ bone, geometry: flat(hub), material: 'body' });
  }
  return d;
}

/** Four more spindly legs, jointed at a high knee, swinging with the main pair. */
function spider(): Detail[] {
  const d: Detail[] = [];
  for (const [bone, side] of [
    ['legL', -1],
    ['legR', 1],
  ] as const) {
    const parts: THREE.BufferGeometry[] = [];
    for (const z of [-0.32, 0.32]) {
      const hip: V3 = [0.3 * side, 0.85, z];
      const knee: V3 = [0.62 * side, 1.15, z * 1.5];
      const foot: V3 = [0.75 * side, 0.02, z * 1.9];
      parts.push(between(hip, knee, 0.035), between(knee, foot, 0.03, 0.012), ball(knee, 0.045, 0));
    }
    d.push({ bone, geometry: merge(parts), material: 'dark' });
  }
  return d;
}

function flytrap(rng: Rng): Detail[] {
  const d: Detail[] = [];
  // Jaws: a lower and an upper shell around the head, teeth along both rims.
  const shell = (upper: boolean): THREE.BufferGeometry => {
    const g = new THREE.SphereGeometry(
      0.25,
      14,
      6,
      0,
      Math.PI * 2,
      upper ? 0 : Math.PI / 2,
      Math.PI / 2,
    );
    g.scale(1, 0.75, 1.15);
    g.translate(0, 1.55, -0.15);
    return flat(g);
  };
  const teeth = (upper: boolean): THREE.BufferGeometry => {
    const list: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const at: V3 = [Math.sin(a) * 0.24, 1.55, -0.15 + Math.cos(a) * 0.28];
      list.push(cone(at, [Math.sin(a) * 0.3, upper ? -1 : 1, Math.cos(a) * 0.3], 0.012, 0.07, 4));
    }
    return merge(list);
  };
  d.push({ bone: 'head', geometry: shell(false), material: 'body' });
  d.push({ bone: 'head', geometry: teeth(false), material: 'bone' });
  d.push({ bone: 'jaw', geometry: shell(true), material: 'body' });
  d.push({ bone: 'jaw', geometry: teeth(true), material: 'bone' });
  // Bioluminescent vines (L-systems) climbing around the base of the stem.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rng.nextFloat();
    const v = lPlant(
      PLANT_SYSTEMS.vine,
      31 + k,
      [Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2],
      0.9,
      a,
      0.25,
    );
    d.push({ bone: 'hips', geometry: v.stems, material: 'body' });
    if (v.buds !== null) d.push({ bone: 'hips', geometry: v.buds, material: 'glow' });
  }
  return d;
}

function creeper(rng: Rng): Detail[] {
  const d: Detail[] = [];
  // Root-legs: splayed, kinked at a knee, gripping the ground.
  const roots: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3 * rng.nextFloat();
    const s = Math.sin(a);
    const c = Math.cos(a);
    const top: V3 = [s * 0.18, 0.6, c * 0.18];
    const knee: V3 = [s * 0.5, 0.55, c * 0.5];
    const foot: V3 = [s * 0.65, 0.0, c * 0.65];
    roots.push(between(top, knee, 0.045, 0.035, 5), between(knee, foot, 0.035, 0.01, 5));
  }
  d.push({ bone: 'hips', geometry: merge(roots), material: 'body' });
  // Tendrils (L-system) around its maw, with glowing buds.
  const t = lPlant(PLANT_SYSTEMS.tendril, 47, [0, 1.6, -0.15], 0.8, 0, -0.4);
  d.push({ bone: 'head', geometry: t.stems, material: 'body' });
  if (t.buds !== null) d.push({ bone: 'head', geometry: t.buds, material: 'glow' });
  return d;
}

function wolf(): Detail[] {
  return [
    {
      bone: 'head',
      geometry: between([0, 0.58, -0.82], [0, 0.52, -1.02], 0.075, 0.05, 8),
      material: 'body',
    },
    { bone: 'head', geometry: ball([0, 0.52, -1.03], 0.03, 0), material: 'dark' },
    {
      bone: 'head',
      geometry: merge([
        cone([-0.08, 0.7, -0.72], [-0.3, 1, 0.2], 0.04, 0.12, 4),
        cone([0.08, 0.7, -0.72], [0.3, 1, 0.2], 0.04, 0.12, 4),
      ]),
      material: 'body',
    },
    // Ruff on the neck and shoulders.
    { bone: 'torso', geometry: ball([0, 0.68, -0.4], 0.27, 1), material: 'body' },
    {
      bone: 'tail',
      geometry: between([0, 0.7, 0.62], [0, 0.45, 1.0], 0.06, 0.03, 6),
      material: 'body',
    },
    // Hocks: the backward-bent ankle that makes a dog's leg a dog's leg.
    {
      bone: 'legBL',
      geometry: between([-0.15, 0.22, 0.42], [-0.15, 0.05, 0.33], 0.04),
      material: 'body',
    },
    {
      bone: 'legBR',
      geometry: between([0.15, 0.22, 0.42], [0.15, 0.05, 0.33], 0.04),
      material: 'body',
    },
  ];
}

function boar(): Detail[] {
  const disc = new THREE.CylinderGeometry(0.08, 0.1, 0.08, 10);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, 0.52, -0.92);
  const ridge = new THREE.BoxGeometry(0.06, 0.1, 0.8);
  ridge.translate(0, 0.9, -0.05);
  return [
    {
      bone: 'head',
      geometry: between([0, 0.56, -0.8], [0, 0.52, -0.9], 0.12, 0.1, 8),
      material: 'body',
    },
    { bone: 'head', geometry: flat(disc), material: 'dark' },
    {
      bone: 'head',
      geometry: merge([
        cone([-0.08, 0.48, -0.86], [-0.3, 1, -0.4], 0.02, 0.13, 5),
        cone([0.08, 0.48, -0.86], [0.3, 1, -0.4], 0.02, 0.13, 5),
      ]),
      material: 'bone',
    },
    { bone: 'torso', geometry: flat(ridge), material: 'dark' },
    { bone: 'torso', geometry: ball([0, 0.68, -0.25], 0.3, 1), material: 'body' },
    { bone: 'tail', geometry: between([0, 0.7, 0.66], [0, 0.55, 0.8], 0.02), material: 'dark' },
  ];
}

const cache = new Map<string, readonly Detail[]>();

/** The details of a mob kind (built once, shared by every model of it). */
export function mobDetails(id: string, form: Form): readonly Detail[] {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  let seed = 0;
  for (const ch of id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
  const rng = Rng.fromSeed(seed >>> 0);
  let d: Detail[];
  switch (form) {
    case 'humanoid':
      d = zombie(rng, id === 'lurcher' ? 4 : 9);
      break;
    case 'wheels':
      d = [...robotCommon(), ...wheels()];
      break;
    case 'spider':
      d = [...robotCommon(), ...spider()];
      break;
    case 'flytrap':
      d = flytrap(rng);
      break;
    case 'creeper':
      d = creeper(rng);
      break;
    case 'wolf':
      d = wolf();
      break;
    case 'boar':
      d = boar();
      break;
  }
  cache.set(id, d);
  return d;
}
