import * as THREE from 'three';
import { HITBOXES, type HitShape } from '../../../domain/combat/hitboxes';
import type { Race } from '../../../domain/combat/races';
import { MOBS, type AnimationId, type MobId } from '../../../domain/mobs/registry';
import { FORM_BONES, mobDetails, type DetailMaterial } from './mob-details';

/**
 * Placeholder mob models, built in code from each race's hitbox archetype so
 * what you see is what you hit. Parts hang on named pivots ("bones") that a
 * procedural animator swings: walk/run cycles, attack lunges, hit flinches,
 * death falls. Stage 7 dresses them per race (`mob-details.ts`): clothing
 * and fungus, wheels and spider legs with tally lights, jaws and L-system
 * vines, snouts, tusks and tails.
 */
export interface MobModel {
  readonly id: MobId;
  readonly root: THREE.Group;
  /** Pivot per bone name (hips, head, armL, legR, …). */
  readonly bones: ReadonlyMap<string, THREE.Object3D>;
  readonly materials: readonly THREE.Material[];
  /** Tally lights / sensor (robots) and bioluminescence (plants, fungus): pulsed per frame. */
  readonly signal: THREE.MeshStandardMaterial;
  readonly fungus: THREE.MeshStandardMaterial;
  /** Rest rotations, restored before each pose. */
  readonly rest: ReadonlyMap<string, THREE.Euler>;
}

/** Where each hitbox part hangs and the pivot it swings around (archetype space). */
interface BoneSpec {
  readonly name: string;
  readonly pivot: readonly [number, number, number];
  readonly parent: string;
}

const RIGS: Readonly<Record<Race, readonly BoneSpec[]>> = {
  zombie: [
    { name: 'hips', pivot: [0, 0.95, 0], parent: 'root' },
    { name: 'torso', pivot: [0, 1.0, 0], parent: 'hips' },
    { name: 'head', pivot: [0, 1.5, 0], parent: 'torso' },
    { name: 'armL', pivot: [-0.24, 1.42, 0], parent: 'torso' },
    { name: 'armR', pivot: [0.24, 1.42, 0], parent: 'torso' },
    { name: 'legL', pivot: [-0.1, 0.95, 0], parent: 'hips' },
    { name: 'legR', pivot: [0.1, 0.95, 0], parent: 'hips' },
  ],
  robot: [
    { name: 'hips', pivot: [0, 0.65, 0], parent: 'root' },
    { name: 'torso', pivot: [0, 0.65, 0], parent: 'hips' },
    { name: 'head', pivot: [0, 1.25, 0], parent: 'torso' },
    { name: 'legL', pivot: [-0.25, 0.65, 0], parent: 'hips' },
    { name: 'legR', pivot: [0.25, 0.65, 0], parent: 'hips' },
  ],
  plant: [
    { name: 'hips', pivot: [0, 0, 0], parent: 'root' },
    { name: 'torso', pivot: [0, 0.4, 0], parent: 'hips' },
    { name: 'head', pivot: [0, 1.35, -0.1], parent: 'torso' },
  ],
  animal: [
    { name: 'hips', pivot: [0, 0.62, 0], parent: 'root' },
    { name: 'torso', pivot: [0, 0.62, 0], parent: 'hips' },
    { name: 'head', pivot: [0, 0.62, -0.55], parent: 'torso' },
    { name: 'legFL', pivot: [-0.15, 0.45, -0.3], parent: 'torso' },
    { name: 'legFR', pivot: [0.15, 0.45, -0.3], parent: 'torso' },
    { name: 'legBL', pivot: [-0.15, 0.45, 0.35], parent: 'torso' },
    { name: 'legBR', pivot: [0.15, 0.45, 0.35], parent: 'torso' },
  ],
};

/** Which bone carries hitbox shape `i` of each archetype (same order as HITBOXES). */
const SHAPE_BONE: Readonly<Record<Race, readonly string[]>> = {
  zombie: ['head', 'torso', 'armL', 'armR', 'legL', 'legR'],
  robot: ['head', 'torso', 'legL', 'legR'],
  plant: ['torso', 'torso', 'head'],
  animal: ['torso', 'head', 'legFL', 'legFR', 'legBL', 'legBR'],
};

function shapeGeometry(h: HitShape): THREE.BufferGeometry {
  switch (h.kind) {
    case 'sphere': {
      const g = new THREE.SphereGeometry(h.r, 14, 10);
      g.translate(h.c[0], h.c[1], h.c[2]);
      return g;
    }
    case 'capsule': {
      const a = new THREE.Vector3(...h.a);
      const b = new THREE.Vector3(...h.b);
      const g = new THREE.CapsuleGeometry(h.r, Math.max(0.001, a.distanceTo(b)), 4, 10);
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          b.clone().sub(a).normalize(),
        ),
      );
      const mid = a.add(b).multiplyScalar(0.5);
      g.translate(mid.x, mid.y, mid.z);
      return g;
    }
    case 'box': {
      const g = new THREE.BoxGeometry(h.half[0] * 2, h.half[1] * 2, h.half[2] * 2);
      g.translate(h.c[0], h.c[1], h.c[2]);
      return g;
    }
  }
}

/** Geometry shared by every model of a race (built once). */
const geometryCache = new Map<Race, THREE.BufferGeometry[]>();

function raceGeometries(race: Race): THREE.BufferGeometry[] {
  let list = geometryCache.get(race);
  if (list === undefined) {
    list = HITBOXES[race].map(shapeGeometry);
    geometryCache.set(race, list);
  }
  return list;
}

export function buildMobModel(id: MobId): MobModel {
  const spec = MOBS[id];
  const race = spec.race;
  const body = new THREE.MeshStandardMaterial({
    color: spec.look.color,
    roughness: race === 'robot' ? 0.45 : 0.8,
    metalness: race === 'robot' ? 0.8 : 0,
    emissive: race === 'plant' ? spec.look.emissive : 0x000000,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0x110000,
    emissive: spec.look.emissive,
    emissiveIntensity: race === 'robot' ? 3 : 0.6,
  });
  const root = new THREE.Group();
  root.name = `mob:${id}`;
  const bones = new Map<string, THREE.Object3D>([['root', root]]);
  const pivots = new Map<string, readonly [number, number, number]>([['root', [0, 0, 0]]]);
  for (const b of [...RIGS[race], ...(FORM_BONES[spec.look.form] ?? [])]) {
    const bone = new THREE.Object3D();
    bone.name = b.name;
    const parentPivot = pivots.get(b.parent) ?? [0, 0, 0];
    bone.position.set(
      b.pivot[0] - parentPivot[0],
      b.pivot[1] - parentPivot[1],
      b.pivot[2] - parentPivot[2],
    );
    (bones.get(b.parent) ?? root).add(bone);
    bones.set(b.name, bone);
    pivots.set(b.name, b.pivot);
  }
  const geoms = raceGeometries(race);
  HITBOXES[race].forEach((h, i) => {
    const boneName = SHAPE_BONE[race][i] ?? 'torso';
    const bone = bones.get(boneName) ?? root;
    const pivot = pivots.get(boneName) ?? [0, 0, 0];
    const lit = h.part === 'sensor' || h.part === 'bulb';
    const mesh = new THREE.Mesh(geoms[i], lit ? glow : body);
    // Geometry is in archetype space: offset by the bone's absolute pivot.
    mesh.position.set(-pivot[0], -pivot[1], -pivot[2]);
    mesh.castShadow = true;
    mesh.name = h.part;
    bone.add(mesh);
  });
  const tint = new THREE.Color(spec.look.color);
  const cloth = new THREE.MeshStandardMaterial({
    color: tint.clone().lerp(new THREE.Color(0x2a2c30), 0.6),
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const fungus = new THREE.MeshStandardMaterial({
    color: 0xb8b48a,
    roughness: 0.7,
    emissive: spec.look.emissive,
    emissiveIntensity: 0.9,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.6 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xd8cfb4, roughness: 0.5 });
  const signal = new THREE.MeshStandardMaterial({
    color: 0x220000,
    emissive: spec.look.emissive,
    emissiveIntensity: 3,
    toneMapped: race !== 'robot',
  });
  const mats: Readonly<Record<DetailMaterial, THREE.Material>> = {
    body,
    cloth,
    fungus,
    dark,
    bone: ivory,
    signal: race === 'robot' ? signal : glow,
    glow,
  };
  for (const det of mobDetails(id, spec.look.form)) {
    const bone = bones.get(det.bone) ?? root;
    const pivot = pivots.get(det.bone) ?? [0, 0, 0];
    const mesh = new THREE.Mesh(det.geometry, mats[det.material]);
    mesh.position.set(-pivot[0], -pivot[1], -pivot[2]);
    mesh.castShadow = det.material !== 'signal' && det.material !== 'glow';
    mesh.name = `detail:${det.material}`;
    bone.add(mesh);
  }
  root.scale.setScalar(spec.body.scale);
  const rest = new Map<string, THREE.Euler>();
  for (const [name, b] of bones) rest.set(name, b.rotation.clone());
  return {
    id,
    root,
    bones,
    materials: [body, glow, cloth, fungus, dark, ivory, signal],
    signal: race === 'robot' ? signal : glow,
    fungus,
    rest,
  };
}

export interface PoseInput {
  readonly anim: AnimationId;
  /** Seconds into the animation (attack, hit, die) or cycle phase source. */
  readonly time: number;
  /** Walk-cycle phase in radians (advances with distance travelled). */
  readonly phase: number;
  /** 0..1 how alert (head up, tension). */
  readonly alert: number;
}

function rot(model: MobModel, name: string, x: number, y = 0, z = 0): void {
  const b = model.bones.get(name);
  const r = model.rest.get(name);
  if (b === undefined || r === undefined) return;
  b.rotation.set(r.x + x, r.y + y, r.z + z);
}

/**
 * Sign convention: models face −Z, so a positive X rotation brings a hanging
 * limb forward and tips a part above its pivot backward.
 */
/** Applies one animation frame to a model's bones (procedural, allocation-free). */
export function poseMob(model: MobModel, input: PoseInput): void {
  const race = MOBS[model.id].race;
  const { anim, time, phase } = input;
  for (const [name, b] of model.bones) {
    const r = model.rest.get(name);
    if (r !== undefined && name !== 'root') b.rotation.copy(r);
  }
  model.root.rotation.x = 0;
  model.root.rotation.z = 0;
  model.root.position.y = 0;
  const breath = Math.sin(time * 2.1) * 0.03;
  const moving = anim === 'walk' || anim === 'run';
  const amp = anim === 'run' ? 0.9 : anim === 'walk' ? 0.45 : 0;
  const s = Math.sin(phase);
  const c = Math.cos(phase);

  switch (race) {
    case 'zombie':
      rot(model, 'torso', -0.25 - breath - (moving ? 0.1 : 0), 0, 0.08 * s * amp);
      rot(model, 'head', -0.2 + 0.15 * Math.sin(time * 0.7), 0.3 * Math.sin(time * 0.4), 0.25);
      rot(model, 'legL', s * amp);
      rot(model, 'legR', -s * amp);
      // Arms reach forward, swaying (the classic shamble).
      rot(model, 'armL', 1.1 + 0.2 * c * amp + breath, 0, 0.1);
      rot(model, 'armR', 1.2 - 0.2 * c * amp - breath, 0, -0.1);
      if (moving) model.root.position.y = Math.abs(s) * 0.04 * amp;
      break;
    case 'robot':
      rot(model, 'head', 0, 0.6 * Math.sin(time * 0.9) * (1 - input.alert), 0);
      rot(model, 'legL', s * amp * 0.8);
      rot(model, 'legR', -s * amp * 0.8);
      rot(model, 'torso', moving ? -0.08 * amp : 0, 0, 0.04 * s * amp);
      break;
    case 'plant':
      rot(
        model,
        'torso',
        0.12 * Math.sin(time * 0.8) + (moving ? 0.2 * s * amp : 0),
        0,
        0.1 * Math.sin(time * 0.6),
      );
      rot(model, 'head', -0.2 + 0.1 * Math.sin(time * 1.7), 0, 0);
      break;
    case 'animal':
      rot(model, 'legFL', s * amp);
      rot(model, 'legBR', s * amp);
      rot(model, 'legFR', -s * amp);
      rot(model, 'legBL', -s * amp);
      rot(model, 'torso', 0.04 * c * amp + breath * 0.5);
      rot(
        model,
        'head',
        (input.alert > 0.5 ? -0.25 : 0.15) + 0.1 * c * amp,
        0.2 * Math.sin(time * 0.5) * (1 - amp),
      );
      if (moving) model.root.position.y = Math.abs(c) * 0.05 * amp;
      break;
  }

  // Tails wag with the gait (and lash when alert); the flytrap's jaw breathes open.
  rot(model, 'tail', -0.3 + 0.15 * c * amp, 0.35 * Math.sin(time * (input.alert > 0.5 ? 9 : 2.5)));
  rot(model, 'jaw', -0.35 - 0.12 * Math.sin(time * 0.9));

  if (anim === 'attack') {
    // Wind up, strike, recover over ~0.6 s.
    const k =
      time < 0.2
        ? -time / 0.2
        : time < 0.35
          ? (time - 0.2) / 0.15
          : Math.max(0, 1 - (time - 0.35) / 0.3);
    switch (race) {
      case 'zombie':
        rot(model, 'armL', 1.6 + 0.6 * k);
        rot(model, 'armR', 1.6 + 0.6 * k);
        rot(model, 'torso', -0.25 - 0.35 * k);
        break;
      case 'robot':
        rot(model, 'torso', -0.35 * k);
        break;
      case 'plant':
        rot(model, 'torso', -0.7 * k);
        rot(model, 'head', -0.2 - 0.6 * k);
        // Jaws snap shut on the strike, gape on the wind-up.
        rot(model, 'jaw', k < 0 ? -0.6 : -0.35 * (1 - k));
        break;
      case 'animal':
        rot(model, 'torso', -0.2 * k);
        rot(model, 'head', -0.5 * k);
        rot(model, 'legFL', 0.8 * k);
        rot(model, 'legFR', 0.8 * k);
        break;
    }
  } else if (anim === 'hit') {
    const k = Math.max(0, 1 - time / 0.3);
    rot(model, 'torso', 0.35 * k);
    rot(model, 'head', 0.4 * k);
  } else if (anim === 'alert') {
    rot(model, 'head', -0.35, 0.5 * Math.sin(time * 6) * Math.max(0, 1 - time), 0);
  } else if (anim === 'die') {
    const k = Math.min(1, time / 0.8);
    const fall = k * k;
    if (race === 'animal') model.root.rotation.z = fall * 1.5;
    else model.root.rotation.x = -fall * 1.45;
    if (race === 'plant') rot(model, 'head', 0.8 * fall);
  }
}

/**
 * Lights per frame: a robot's tally lights blink (faster when hunting) and
 * its sensor sputters while blinded; plants' and fungus' glow breathes.
 */
export function signalMob(
  model: MobModel,
  time: number,
  alert: number,
  blind: number,
  dead: boolean,
): void {
  const race = MOBS[model.id].race;
  if (dead) {
    model.signal.emissiveIntensity = Math.max(0, model.signal.emissiveIntensity - 0.05);
    return;
  }
  if (race === 'robot') {
    const rate = alert > 0.5 ? 6 : 1.2;
    const blink = Math.sin(time * Math.PI * 2 * rate) > 0.2 ? 1 : 0.15;
    // Blinded: the sensor stutters (deterministic flicker from time).
    const glitch = blind > 0 ? (Math.sin(time * 91) * Math.sin(time * 37) > 0 ? 0.05 : 1.6) : 1;
    model.signal.emissiveIntensity = 3 * blink * glitch;
  } else {
    const breathe = 0.6 + 0.4 * Math.sin(time * (race === 'plant' ? 1.3 : 0.7));
    model.signal.emissiveIntensity = (race === 'plant' ? 1.2 : 0.6) * breathe;
    model.fungus.emissiveIntensity = 0.9 * breathe;
  }
}

export function disposeMobModel(m: MobModel): void {
  for (const mat of m.materials) mat.dispose();
}

/** Wireframe hitboxes of a mob (bestiary and debug): the shapes bullets test against. */
export function hitboxWireframe(id: MobId): THREE.Group {
  const spec = MOBS[id];
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x40ff60, toneMapped: false, depthTest: false });
  for (const g of raceGeometries(spec.race)) {
    const w = new THREE.LineSegments(new THREE.WireframeGeometry(g), mat);
    w.renderOrder = 10;
    group.add(w);
  }
  group.scale.setScalar(spec.body.scale);
  return group;
}
