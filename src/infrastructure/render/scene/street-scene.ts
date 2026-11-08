import * as THREE from 'three';
import type { MaterialId } from '../../../domain/procgen/materials';
import type { LightPiece, PropKind, StreetLayout } from '../../../domain/world/street-layout';
import type { MaterialLibrary } from '../textures/material-library';
import {
  mergeOrThrow,
  barrelGeometry,
  crateGeometry,
  fungusGeometry,
  lampBulbGeometry,
  lampPostGeometry,
  meterBox,
} from './geometry';

/**
 * Builds the Three.js scene for a street layout. Static boxes are merged per
 * material (one draw call each); props are instanced per (kind, material).
 * Lights follow the night palette: cold moon, sodium pools, red emergency
 * strobes, cyan bioluminescence.
 */
export interface AnimatedLight {
  readonly piece: LightPiece;
  readonly light: THREE.Light;
  readonly baseIntensity: number;
  readonly emissive: THREE.MeshStandardMaterial | null;
  readonly baseEmissive: number;
  readonly phase: number;
}

export interface StreetScene {
  readonly scene: THREE.Scene;
  readonly animated: readonly AnimatedLight[];
  readonly beacon: THREE.Object3D | null;
  readonly fungusMaterial: THREE.MeshStandardMaterial;
  dispose(): void;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function boxGeometryFor(
  center: readonly number[],
  size: readonly number[],
  yaw: number,
): THREE.BufferGeometry {
  const g = meterBox(size[0] ?? 1, size[1] ?? 1, size[2] ?? 1).toNonIndexed();
  g.rotateY(yaw);
  g.translate(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0);
  return g;
}

export function buildStreetScene(
  layout: StreetLayout,
  materials: MaterialLibrary,
  seed: number,
): StreetScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020306);
  scene.fog = new THREE.FogExp2(0x05070b, 0.034);
  const disposables: { dispose(): void }[] = [];

  // Static geometry merged per material.
  const byMaterial = new Map<MaterialId, THREE.BufferGeometry[]>();
  for (const b of layout.boxes) {
    const list = byMaterial.get(b.material) ?? [];
    list.push(boxGeometryFor(b.center, b.size, b.yaw));
    byMaterial.set(b.material, list);
  }
  for (const [id, geoms] of byMaterial) {
    const merged = mergeOrThrow(geoms);
    for (const g of geoms) g.dispose();
    disposables.push(merged);
    const mesh = new THREE.Mesh(merged, materials.get(id));
    mesh.name = `static:${id}`;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }

  // Instanced props.
  const geometryFor: Record<Exclude<PropKind, 'fungus'>, THREE.BufferGeometry> = {
    barrel: barrelGeometry(),
    crate: crateGeometry(),
    lampPost: lampPostGeometry(),
  };
  disposables.push(...Object.values(geometryFor));
  const groups = new Map<
    string,
    { kind: PropKind; material: MaterialId; items: StreetLayout['props'][number][] }
  >();
  for (const p of layout.props) {
    const key = `${p.kind}:${p.material}`;
    const group = groups.get(key) ?? { kind: p.kind, material: p.material, items: [] };
    group.items.push(p);
    groups.set(key, group);
  }
  const fungusMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b2a24,
    emissive: new THREE.Color(0.2, 1.0, 0.8),
    emissiveIntensity: 2.2,
    roughness: 0.35,
    metalness: 0,
  });
  const fungusGeom = fungusGeometry(seed);
  disposables.push(fungusMaterial, fungusGeom);
  for (const g of groups.values()) {
    const isFungus = g.kind === 'fungus';
    const geometry = g.kind === 'fungus' ? fungusGeom : geometryFor[g.kind];
    const mesh = new THREE.InstancedMesh(
      geometry,
      isFungus ? fungusMaterial : materials.get(g.material),
      g.items.length,
    );
    mesh.name = `props:${g.kind}:${g.material}`;
    g.items.forEach((p, i) => {
      tmpQuat.setFromAxisAngle(UP, p.yaw);
      tmpPos.set(p.position[0], p.position[1], p.position[2]);
      tmpScale.setScalar(p.scale);
      mesh.setMatrixAt(i, tmpMatrix.compose(tmpPos, tmpQuat, tmpScale));
    });
    mesh.castShadow = !isFungus;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  // Ambient: faint cold moonlight and sky bounce.
  const moon = new THREE.DirectionalLight(new THREE.Color(0.55, 0.65, 0.95), 0.05);
  moon.position.set(-30, 60, 20);
  scene.add(
    moon,
    new THREE.HemisphereLight(
      new THREE.Color(0.12, 0.16, 0.24),
      new THREE.Color(0.02, 0.02, 0.02),
      0.06,
    ),
  );

  const animated: AnimatedLight[] = [];
  let beacon: THREE.Object3D | null = null;
  let phase = 0;
  const bulbGeom = lampBulbGeometry();
  disposables.push(bulbGeom);

  for (const piece of layout.lights) {
    const color = new THREE.Color(piece.color[0], piece.color[1], piece.color[2]);
    phase += 1.618;
    switch (piece.kind) {
      case 'sodiumLamp': {
        const spot = new THREE.SpotLight(color, piece.intensity, piece.range, 1.05, 0.7, 2);
        spot.position.set(piece.position[0], piece.position[1], piece.position[2]);
        spot.target.position.set(piece.position[0], 0, piece.position[2]);
        scene.add(spot, spot.target);
        const bulbMat = new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: color,
          emissiveIntensity: 40,
        });
        disposables.push(bulbMat);
        const bulb = new THREE.Mesh(bulbGeom, bulbMat);
        bulb.position.set(piece.position[0], 6.165, piece.position[2]);
        scene.add(bulb);
        animated.push({
          piece,
          light: spot,
          baseIntensity: piece.intensity,
          emissive: bulbMat,
          baseEmissive: 40,
          phase,
        });
        break;
      }
      case 'emergencyBeacon': {
        const rig = new THREE.Object3D();
        rig.position.set(piece.position[0], piece.position[1], piece.position[2]);
        for (const dir of [1, -1]) {
          const spot = new THREE.SpotLight(color, piece.intensity, piece.range, 0.35, 0.5, 2);
          spot.position.set(0, 0.05, 0);
          spot.target.position.set(dir, -0.05, 0);
          rig.add(spot, spot.target);
        }
        const domeMat = new THREE.MeshStandardMaterial({
          color: 0x200000,
          emissive: color,
          emissiveIntensity: 25,
          roughness: 0.2,
        });
        const domeGeom = new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        disposables.push(domeMat, domeGeom);
        const dome = new THREE.Mesh(domeGeom, domeMat);
        dome.position.copy(rig.position);
        scene.add(rig, dome);
        const glow = new THREE.PointLight(color, piece.intensity * 0.06, 6, 2);
        glow.position.copy(rig.position);
        scene.add(glow);
        animated.push({
          piece,
          light: glow,
          baseIntensity: piece.intensity * 0.06,
          emissive: domeMat,
          baseEmissive: 25,
          phase,
        });
        beacon = rig;
        break;
      }
      case 'bioluminescence': {
        const p = new THREE.PointLight(color, piece.intensity, piece.range, 2);
        p.position.set(piece.position[0], piece.position[1], piece.position[2]);
        scene.add(p);
        animated.push({
          piece,
          light: p,
          baseIntensity: piece.intensity,
          emissive: null,
          baseEmissive: 0,
          phase,
        });
        break;
      }
      case 'window': {
        // Emissive pane only: interior spill would cost a light per window.
        const paneMat = new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: color,
          emissiveIntensity: piece.intensity * 2.5,
        });
        const paneGeom = new THREE.PlaneGeometry(1.1, 1.5);
        disposables.push(paneMat, paneGeom);
        const pane = new THREE.Mesh(paneGeom, paneMat);
        pane.position.set(piece.position[0], piece.position[1], piece.position[2]);
        pane.rotation.y = piece.position[0] < 0 ? Math.PI / 2 : -Math.PI / 2;
        scene.add(pane);
        if (piece.flicker > 0) {
          animated.push({
            piece,
            light: new THREE.PointLight(color, 0, 0.01),
            baseIntensity: 0,
            emissive: paneMat,
            baseEmissive: piece.intensity * 2.5,
            phase,
          });
        }
        break;
      }
    }
  }

  return {
    scene,
    animated,
    beacon,
    fungusMaterial,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Flicker model: mostly steady with occasional dips, deterministic in time. */
export function flickerAt(time: number, amount: number, phase: number): number {
  if (amount <= 0) return 1;
  const slow = Math.sin(time * 1.7 + phase) * 0.5 + 0.5;
  const fast = Math.sin(time * 23.0 + phase * 3.1) * Math.sin(time * 37.0 + phase);
  const dropout = Math.sin(time * 0.9 + phase * 7) > 1 - amount * 0.6 ? 0.05 : 1;
  return Math.max(0, Math.min(1.2, 1 - amount * 0.35 * slow + fast * amount * 0.25)) * dropout;
}

export function animateStreet(s: StreetScene, time: number): void {
  for (const a of s.animated) {
    let k = flickerAt(time, a.piece.flicker, a.phase);
    if (a.piece.kind === 'emergencyBeacon')
      k = 0.6 + 0.4 * Math.abs(Math.sin(time * Math.PI * 1.5));
    a.light.intensity = a.baseIntensity * k;
    if (a.emissive !== null) a.emissive.emissiveIntensity = a.baseEmissive * k;
  }
  if (s.beacon !== null) s.beacon.rotation.y = time * Math.PI * 2 * 0.75;
  s.fungusMaterial.emissiveIntensity = 2.2 * (0.8 + 0.2 * Math.sin(time * 0.8));
}
