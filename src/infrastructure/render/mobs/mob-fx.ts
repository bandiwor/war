import * as THREE from 'three';
import { ACID, Acid } from '../../../application/ai/components';
import type { Sandbox } from '../../../application/scenes/sandbox';
import type { MobRangedEvent } from '../../../domain/events/bus';

/**
 * The races' ranged attacks on screen: a robot's laser (a hot red line
 * that fades in a blink), a flytrap's acid glob lobbed in an arc, and the
 * sizzling green pools it leaves (read from the simulation's Acid entities,
 * so what burns you is what you see). Pooled; nothing allocates per frame.
 */
const BEAMS = 6;
const GLOBS = 8;
const POOLS = 16;

interface Beam {
  readonly mesh: THREE.Mesh;
  life: number;
}

interface Glob {
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  t: number;
  alive: boolean;
}

export class MobFx {
  readonly group = new THREE.Group();
  private readonly beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xff3020,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly beams: Beam[] = [];
  private readonly globs: Glob[] = [];
  private readonly globMesh: THREE.InstancedMesh;
  private readonly poolMesh: THREE.InstancedMesh;
  private readonly globMaterial = new THREE.MeshStandardMaterial({
    color: 0x6a8f20,
    emissive: 0x4f7a10,
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });
  private readonly poolMaterial = new THREE.MeshStandardMaterial({
    color: 0x3c5a12,
    emissive: 0x5a9a14,
    emissiveIntensity: 0.8,
    roughness: 0.1,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  private readonly dummy = new THREE.Object3D();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  private time = 0;
  /** Counters for tests and the debug HUD. */
  readonly stats = { lasers: 0, globs: 0, pools: 0 };

  constructor(private readonly sandbox: Sandbox) {
    this.group.name = 'mob-fx';
    const beamGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
    beamGeo.translate(0, 0.5, 0);
    for (let i = 0; i < BEAMS; i++) {
      const mesh = new THREE.Mesh(beamGeo, this.beamMaterial);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.beams.push({ mesh, life: 0 });
    }
    for (let i = 0; i < GLOBS; i++)
      this.globs.push({ from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, alive: false });
    this.globMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.09, 1),
      this.globMaterial,
      GLOBS,
    );
    this.globMesh.count = 0;
    this.globMesh.frustumCulled = false;
    const disc = new THREE.CircleGeometry(1, 20);
    disc.rotateX(-Math.PI / 2);
    this.poolMesh = new THREE.InstancedMesh(disc, this.poolMaterial, POOLS);
    this.poolMesh.count = 0;
    this.poolMesh.frustumCulled = false;
    this.group.add(this.globMesh, this.poolMesh);
  }

  ranged(e: MobRangedEvent): void {
    if (e.kind === 0) {
      const beam = this.beams.find((b) => b.life <= 0) ?? this.beams[0];
      if (beam === undefined) return;
      this.dir.set(e.tx - e.x, e.ty - e.y, e.tz - e.z);
      const len = this.dir.length();
      beam.mesh.position.set(e.x, e.y, e.z);
      beam.mesh.quaternion.setFromUnitVectors(this.up, this.dir.normalize());
      beam.mesh.scale.set(1, Math.max(0.01, len), 1);
      beam.mesh.visible = true;
      beam.life = 0.12;
      this.stats.lasers++;
    } else if (e.kind === 1) {
      const glob = this.globs.find((g) => !g.alive) ?? this.globs[0];
      if (glob === undefined) return;
      glob.from.set(e.x, e.y, e.z);
      glob.to.set(e.tx, e.ty, e.tz);
      glob.t = 0;
      glob.alive = true;
      this.stats.globs++;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      b.mesh.visible = b.life > 0;
      // Thick and white-hot at first, then a thin red afterimage.
      const k = Math.max(0, b.life / 0.12);
      b.mesh.scale.x = b.mesh.scale.z = 0.5 + 1.5 * k;
    }
    this.beamMaterial.opacity = 0.9;
    let n = 0;
    for (const g of this.globs) {
      if (!g.alive) continue;
      g.t += dt / ACID.flight;
      if (g.t >= 1) {
        g.alive = false;
        continue;
      }
      // A lobbed arc: up to a third of the distance in height.
      const arc = 4 * g.t * (1 - g.t) * Math.max(0.6, g.from.distanceTo(g.to) / 3);
      this.dummy.position.lerpVectors(g.from, g.to, g.t);
      this.dummy.position.y += arc;
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.globMesh.setMatrixAt(n++, this.dummy.matrix);
    }
    this.globMesh.count = n;
    this.globMesh.instanceMatrix.needsUpdate = true;
    this.updatePools();
  }

  private updatePools(): void {
    const acid = this.sandbox.simulation.world.tryStore(Acid);
    let n = 0;
    if (acid !== null) {
      const a = acid.fields;
      for (let r = 0; r < acid.size && n < POOLS; r++) {
        if ((a.flight[r] ?? 0) > 0) continue;
        const left = (a.remaining[r] ?? 0) / ACID.seconds;
        // Spreads in the first moment, then shrinks as it soaks in; it bubbles.
        const radius =
          (a.radius[r] ?? 1) *
          Math.min(1, (1 - left) * 8 + 0.2) *
          (0.6 + 0.4 * left) *
          (1 + 0.03 * Math.sin(this.time * 9 + r));
        this.dummy.position.set(a.x[r] ?? 0, (a.y[r] ?? 0) + 0.02, a.z[r] ?? 0);
        this.dummy.rotation.set(0, r * 1.7, 0);
        this.dummy.scale.set(radius, 1, radius * 0.85);
        this.dummy.updateMatrix();
        this.poolMesh.setMatrixAt(n++, this.dummy.matrix);
      }
    }
    this.poolMesh.count = n;
    this.poolMesh.instanceMatrix.needsUpdate = true;
    this.stats.pools = n;
  }

  dispose(): void {
    this.beamMaterial.dispose();
    this.globMaterial.dispose();
    this.poolMaterial.dispose();
    this.globMesh.geometry.dispose();
    this.poolMesh.geometry.dispose();
    this.beams[0]?.mesh.geometry.dispose();
  }
}
