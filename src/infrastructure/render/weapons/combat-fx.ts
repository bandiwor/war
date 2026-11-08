import * as THREE from 'three';
import { Hazard, Projectile, Target, Thrown } from '../../../application/combat/components';
import type { Sandbox } from '../../../application/scenes/sandbox';
import { HITBOXES } from '../../../domain/combat/hitboxes';
import { RACES, raceAt, type Race } from '../../../domain/combat/races';
import type { ExplosionEvent, HitEvent, ImpactEvent, ShotEvent } from '../../../domain/events/bus';
import { at } from '../../../domain/ecs/component';
import { AMMO, WEAPONS, weaponAt } from '../../../domain/weapons/registry';
import type { SurfaceId } from '../../../domain/world/surfaces';

/**
 * World-space combat effects (render-only, never fed back into the
 * simulation): ejected casings, bullet holes, sparks/dust, explosion
 * fireballs, flare and fire lights, thrown objects, target dummies and
 * debug bullet paths. Fixed-size pools: no allocation or shader recompile
 * when effects come and go (lights stay in the scene with zero intensity).
 */
const MAX_CASINGS = 64;
const MAX_DECALS = 256;
const MAX_PARTICLES = 160;
const MAX_PATHS = 24;

interface Casing {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  floorY: number;
  landed: boolean;
  shell: boolean;
}

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  spark: boolean;
}

/** Callback when a casing hits the ground (for the "tink" sound). */
export type CasingLandedHandler = (x: number, y: number, z: number, shell: boolean) => void;

export class CombatFx {
  readonly group = new THREE.Group();
  showPaths = false;
  private readonly casings: Casing[] = [];
  private readonly casingMesh: THREE.InstancedMesh;
  private readonly shellMesh: THREE.InstancedMesh;
  private readonly decals: THREE.InstancedMesh;
  private decalNext = 0;
  private readonly particles: Particle[] = [];
  private readonly sparkMesh: THREE.InstancedMesh;
  private readonly dustMesh: THREE.InstancedMesh;
  private readonly explosionLight = new THREE.PointLight(0xffa050, 0, 30, 2);
  private readonly fireball: THREE.Mesh;
  private fireballLife = 0;
  private fireballRadius = 1;
  private readonly hazardLights: THREE.PointLight[] = [];
  private readonly hazardMeshes: THREE.Mesh[] = [];
  private readonly thrownMeshes: THREE.Mesh[] = [];
  private readonly targetGroups = new Map<
    number,
    { group: THREE.Group; flash: number; fall: number; materials: THREE.MeshStandardMaterial[] }
  >();
  private readonly paths: THREE.LineSegments;
  private readonly pathPositions = new Float32Array(MAX_PATHS * 6);
  private pathNext = 0;
  private lastShot: ShotEvent | null = null;
  private readonly lastShotPos = new THREE.Vector3();
  private readonly dummy = new THREE.Object3D();
  private readonly disposables: { dispose(): void }[] = [];
  private time = 0;
  onCasingLanded: CasingLandedHandler | null = null;

  constructor(private readonly sandbox: Sandbox) {
    const brass = new THREE.MeshStandardMaterial({ color: 0xb8913f, metalness: 1, roughness: 0.3 });
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0x8a1a14,
      metalness: 0.1,
      roughness: 0.6,
    });
    const casingGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8);
    const shellGeo = new THREE.CylinderGeometry(0.0105, 0.0105, 0.07, 10);
    this.casingMesh = new THREE.InstancedMesh(casingGeo, brass, MAX_CASINGS);
    this.shellMesh = new THREE.InstancedMesh(shellGeo, shellMat, MAX_CASINGS);
    for (const m of [this.casingMesh, this.shellMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    for (let i = 0; i < MAX_CASINGS; i++) {
      this.casings.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        life: 0,
        floorY: 0,
        landed: false,
        shell: false,
      });
    }

    const holeTex = bulletHoleTexture();
    const decalMat = new THREE.MeshStandardMaterial({
      map: holeTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 0.9,
    });
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.group.add(this.decals);

    const sparkMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(8, 4, 1.2),
      toneMapped: false,
    });
    const dustMat = new THREE.MeshStandardMaterial({
      color: 0x777066,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      roughness: 1,
    });
    const particleGeo = new THREE.IcosahedronGeometry(1, 0);
    this.sparkMesh = new THREE.InstancedMesh(particleGeo, sparkMat, MAX_PARTICLES);
    this.dustMesh = new THREE.InstancedMesh(particleGeo, dustMat, MAX_PARTICLES);
    for (const m of [this.sparkMesh, this.dustMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    for (let i = 0; i < MAX_PARTICLES; i++)
      this.particles.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0.01,
        spark: false,
      });

    this.group.add(this.explosionLight);
    const fireMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(9, 4, 1),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.fireball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), fireMat);
    this.fireball.visible = false;
    this.group.add(this.fireball);

    const flareMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(14, 1.2, 0.6),
      toneMapped: false,
    });
    const flameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(6, 2.4, 0.5),
      toneMapped: false,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xff3020, 0, 16, 2);
      this.hazardLights.push(light);
      this.group.add(light);
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 8, 1, true), flameMat);
      mesh.visible = false;
      this.hazardMeshes.push(mesh);
      this.group.add(mesh);
    }
    const thrownGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8);
    const thrownMat = new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(thrownGeo, thrownMat);
      m.visible = false;
      this.thrownMeshes.push(m);
      this.group.add(m);
    }
    this.flareMat = flareMat;
    this.thrownMat = thrownMat;

    const pathGeo = new THREE.BufferGeometry();
    pathGeo.setAttribute('position', new THREE.BufferAttribute(this.pathPositions, 3));
    pathGeo.setDrawRange(0, 0);
    this.paths = new THREE.LineSegments(
      pathGeo,
      new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.5, 0.6), toneMapped: false }),
    );
    this.paths.frustumCulled = false;
    this.group.add(this.paths);

    this.disposables.push(
      brass,
      shellMat,
      casingGeo,
      shellGeo,
      holeTex,
      decalMat,
      decalGeo,
      sparkMat,
      dustMat,
      particleGeo,
      fireMat,
      flareMat,
      flameMat,
      thrownGeo,
      thrownMat,
      pathGeo,
    );
    this.buildTargets();
  }

  private readonly flareMat: THREE.MeshBasicMaterial;
  private readonly thrownMat: THREE.MeshStandardMaterial;

  // --- Event intake -----------------------------------------------------------

  shot(e: ShotEvent, ejection: THREE.Vector3, right: THREE.Vector3, playerFeetY: number): void {
    this.lastShot = e;
    this.lastShotPos.set(e.x, e.y, e.z);
    const id = weaponAt(e.weapon);
    const w = id === undefined ? undefined : WEAPONS[id];
    if (w?.kind !== 'firearm') return;
    // Pump/bolt guns eject when cycled; for simplicity eject on the shot for all.
    const c = this.casings.find((x) => !x.alive);
    if (c === undefined) return;
    c.alive = true;
    c.landed = false;
    c.shell = AMMO[w.ammo].casing.shell;
    c.pos.copy(ejection);
    c.vel
      .copy(right)
      .multiplyScalar(2.2 + Math.random())
      .add(new THREE.Vector3(0, 1.6 + Math.random() * 0.6, 0));
    c.spin.set(Math.random() * 30, Math.random() * 30, Math.random() * 30);
    c.life = 4;
    c.floorY = playerFeetY + 0.01;
  }

  impact(e: ImpactEvent): void {
    this.addDecal(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.surface, e.energy);
    const spark = e.surface === 'metal';
    const count = Math.round((spark ? 8 : 5) * Math.max(0.3, e.energy));
    for (let i = 0; i < count; i++) {
      const n = new THREE.Vector3(e.nx, e.ny, e.nz);
      const v = n
        .multiplyScalar(spark ? 3 : 1.2)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            Math.random() * 2,
            (Math.random() - 0.5) * 3,
          ),
        );
      this.spawnParticle(
        e.x,
        e.y,
        e.z,
        v,
        spark,
        spark ? 0.004 : 0.025 + Math.random() * 0.03,
        spark ? 0.25 : 0.7,
      );
    }
    this.pathTo(e.x, e.y, e.z);
  }

  hit(e: HitEvent): void {
    const t = this.targetGroups.get(e.target);
    if (t !== undefined) t.flash = 0.12;
    // Blood/debris mist; robots spark.
    const race: Race = raceAt(e.race);
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.5,
        (Math.random() - 0.5) * 2,
      );
      this.spawnParticle(e.x, e.y, e.z, v, race === 'robot', race === 'robot' ? 0.004 : 0.02, 0.4);
    }
    if (e.part !== -1) this.pathTo(e.x, e.y, e.z);
  }

  explosion(e: ExplosionEvent): void {
    if (e.kind === 2 || e.kind === 3) return; // fire / flare ignition: hazards render themselves
    const emp = e.kind === 1;
    this.explosionLight.color.set(emp ? 0x9fc8ff : 0xffa050);
    this.explosionLight.position.set(e.x, e.y + 0.5, e.z);
    this.explosionLight.intensity = emp ? 400 : 900;
    this.explosionLight.distance = e.radius * 4;
    this.fireball.position.set(e.x, e.y + 0.3, e.z);
    this.fireballLife = 0.45;
    this.fireballRadius = e.radius * 0.35;
    const mat = this.fireball.material;
    if (mat instanceof THREE.MeshBasicMaterial)
      mat.color.set(emp ? new THREE.Color(2, 4, 9) : new THREE.Color(9, 4, 1));
    for (let i = 0; i < 24; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        Math.random() * 8,
        (Math.random() - 0.5) * 12,
      );
      this.spawnParticle(e.x, e.y + 0.2, e.z, v, !emp, 0.01 + Math.random() * 0.03, 0.9);
    }
  }

  // --- Per-frame update -------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    this.updateCasings(dt);
    this.updateParticles(dt);
    this.updateExplosion(dt);
    this.updateHazards();
    this.updateThrown();
    this.updateTargets(dt);
    this.paths.visible = this.showPaths;
  }

  private updateCasings(dt: number): void {
    let nc = 0;
    let ns = 0;
    for (const c of this.casings) {
      if (!c.alive) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.alive = false;
        continue;
      }
      if (!c.landed || c.vel.lengthSq() > 0.01) {
        c.vel.y -= 9.81 * dt;
        c.pos.addScaledVector(c.vel, dt);
        c.rot.x += c.spin.x * dt;
        c.rot.y += c.spin.y * dt;
        c.rot.z += c.spin.z * dt;
        if (c.pos.y < c.floorY) {
          c.pos.y = c.floorY;
          if (!c.landed) this.onCasingLanded?.(c.pos.x, c.pos.y, c.pos.z, c.shell);
          c.landed = true;
          c.vel.y = -c.vel.y * 0.3;
          c.vel.x *= 0.5;
          c.vel.z *= 0.5;
          c.spin.multiplyScalar(0.5);
        }
      }
      this.dummy.position.copy(c.pos);
      this.dummy.rotation.copy(c.rot);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      if (c.shell) this.shellMesh.setMatrixAt(ns++, this.dummy.matrix);
      else this.casingMesh.setMatrixAt(nc++, this.dummy.matrix);
    }
    this.casingMesh.count = nc;
    this.shellMesh.count = ns;
    this.casingMesh.instanceMatrix.needsUpdate = true;
    this.shellMesh.instanceMatrix.needsUpdate = true;
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    v: THREE.Vector3,
    spark: boolean,
    size: number,
    life: number,
  ): void {
    const p = this.particles.find((q) => !q.alive);
    if (p === undefined) return;
    p.alive = true;
    p.pos.set(x, y, z);
    p.vel.copy(v);
    p.spark = spark;
    p.size = size;
    p.life = life;
    p.maxLife = life;
  }

  private updateParticles(dt: number): void {
    let ns = 0;
    let nd = 0;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vel.y -= (p.spark ? 9.81 : 1.5) * dt;
      p.vel.multiplyScalar(p.spark ? 0.99 : 0.95);
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.maxLife;
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(p.spark ? p.size : p.size * (2 - k));
      this.dummy.updateMatrix();
      if (p.spark) this.sparkMesh.setMatrixAt(ns++, this.dummy.matrix);
      else this.dustMesh.setMatrixAt(nd++, this.dummy.matrix);
    }
    this.sparkMesh.count = ns;
    this.dustMesh.count = nd;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    this.dustMesh.instanceMatrix.needsUpdate = true;
  }

  private updateExplosion(dt: number): void {
    this.explosionLight.intensity *= Math.exp(-dt * 14);
    if (this.explosionLight.intensity < 0.5) this.explosionLight.intensity = 0;
    this.fireballLife -= dt;
    this.fireball.visible = this.fireballLife > 0;
    if (this.fireballLife > 0) {
      const p = 1 - this.fireballLife / 0.45;
      this.fireball.scale.setScalar(this.fireballRadius * (0.3 + p));
      const mat = this.fireball.material;
      if (mat instanceof THREE.MeshBasicMaterial) mat.opacity = 1 - p;
    }
  }

  private updateHazards(): void {
    const store = this.sandbox.simulation.world.tryStore(Hazard);
    let used = 0;
    if (store !== null) {
      const f = store.fields;
      for (let row = 0; row < store.size && used < this.hazardLights.length; row++) {
        const light = this.hazardLights[used];
        const mesh = this.hazardMeshes[used];
        if (light === undefined || mesh === undefined) continue;
        const flare = f.kind[row] === 0;
        const remaining = at(f.remaining, row);
        const flicker =
          0.75 + 0.25 * Math.sin(this.time * 31 + row) * Math.sin(this.time * 17 + row * 3);
        light.color.set(flare ? 0xff2a18 : 0xff8a30);
        light.position.set(at(f.x, row), at(f.y, row) + (flare ? 0.15 : 0.5), at(f.z, row));
        light.intensity = (flare ? 60 : 90) * flicker * Math.min(1, remaining / 2);
        light.distance = at(f.radius, row) * (flare ? 1.6 : 4);
        mesh.visible = !flare;
        mesh.position.set(at(f.x, row), at(f.y, row) + 0.45, at(f.z, row));
        mesh.scale.set(at(f.radius, row) * 0.6, 1 + 0.3 * flicker, at(f.radius, row) * 0.6);
        used++;
      }
    }
    for (let i = used; i < this.hazardLights.length; i++) {
      const l = this.hazardLights[i];
      const m = this.hazardMeshes[i];
      if (l) l.intensity = 0;
      if (m) m.visible = false;
    }
  }

  private updateThrown(): void {
    const store = this.sandbox.simulation.world.tryStore(Thrown);
    let used = 0;
    if (store !== null) {
      const f = store.fields;
      for (let row = 0; row < store.size && used < this.thrownMeshes.length; row++) {
        const m = this.thrownMeshes[used++];
        if (m === undefined) continue;
        m.visible = true;
        m.position.set(at(f.x, row), at(f.y, row), at(f.z, row));
        m.rotation.set(this.time * 9, this.time * 5, 0);
        const id = weaponAt(at(f.weapon, row));
        const lit = id === 'flare' && at(f.fuse, row) <= 0;
        m.material = lit ? this.flareMat : this.thrownMat;
      }
    }
    for (let i = used; i < this.thrownMeshes.length; i++) {
      const m = this.thrownMeshes[i];
      if (m) m.visible = false;
    }
  }

  // --- Targets ----------------------------------------------------------------

  private buildTargets(): void {
    const store = this.sandbox.simulation.world.tryStore(Target);
    if (store === null) return;
    const looks: Readonly<Record<Race, { color: number; emissive: number; metal: number }>> = {
      zombie: { color: 0x5d5a4a, emissive: 0x000000, metal: 0 },
      robot: { color: 0x3a3f46, emissive: 0x000000, metal: 0.85 },
      plant: { color: 0x274a32, emissive: 0x0b3a2c, metal: 0 },
      animal: { color: 0x3a2a1e, emissive: 0x000000, metal: 0 },
    };
    for (let row = 0; row < store.size; row++) {
      const race = raceAt(at(store.fields.race, row));
      const look = looks[race];
      const mat = new THREE.MeshStandardMaterial({
        color: look.color,
        emissive: look.emissive,
        metalness: look.metal,
        roughness: 0.7,
      });
      const materials = [mat];
      const group = new THREE.Group();
      for (const h of HITBOXES[race]) {
        let geo: THREE.BufferGeometry;
        let m: THREE.Material = mat;
        if (h.kind === 'sphere') {
          geo = new THREE.SphereGeometry(h.r, 14, 10);
          geo.translate(h.c[0], h.c[1], h.c[2]);
          if (h.part === 'sensor') {
            const eye = new THREE.MeshStandardMaterial({
              color: 0x220000,
              emissive: 0xff1a10,
              emissiveIntensity: 2,
            });
            materials.push(eye);
            m = eye;
          }
          if (h.part === 'bulb') {
            const bulb = new THREE.MeshStandardMaterial({
              color: 0x1a3b2c,
              emissive: 0x30ffc0,
              emissiveIntensity: 0.15,
            });
            materials.push(bulb);
            m = bulb;
          }
        } else if (h.kind === 'capsule') {
          const a = new THREE.Vector3(...h.a);
          const b = new THREE.Vector3(...h.b);
          geo = new THREE.CapsuleGeometry(h.r, Math.max(0.001, a.distanceTo(b)), 4, 10);
          const q = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            b.clone().sub(a).normalize(),
          );
          geo.applyQuaternion(q);
          const mid = a.add(b).multiplyScalar(0.5);
          geo.translate(mid.x, mid.y, mid.z);
        } else {
          geo = new THREE.BoxGeometry(h.half[0] * 2, h.half[1] * 2, h.half[2] * 2);
          geo.translate(h.c[0], h.c[1], h.c[2]);
        }
        this.disposables.push(geo);
        group.add(new THREE.Mesh(geo, m));
      }
      group.position.set(at(store.fields.x, row), at(store.fields.y, row), at(store.fields.z, row));
      group.rotation.y = at(store.fields.yaw, row);
      this.group.add(group);
      this.disposables.push(...materials);
      this.targetGroups.set(store.dense[row] ?? 0, { group, flash: 0, fall: 0, materials });
    }
  }

  private updateTargets(dt: number): void {
    const store = this.sandbox.simulation.world.tryStore(Target);
    if (store === null) return;
    for (let row = 0; row < store.size; row++) {
      const t = this.targetGroups.get(store.dense[row] ?? 0);
      if (t === undefined) continue;
      const dead = at(store.fields.health, row) <= 0;
      t.fall += ((dead ? 1 : 0) - t.fall) * (1 - Math.exp(-dt * (dead ? 6 : 3)));
      t.group.rotation.set(-t.fall * 1.45, at(store.fields.yaw, row), 0, 'YXZ');
      t.flash = Math.max(0, t.flash - dt);
      const mat = t.materials[0];
      if (mat) mat.emissiveIntensity = t.flash > 0 ? 3 : 1;
      if (mat && t.flash > 0) mat.emissive.set(0x601010);
      else if (mat)
        mat.emissive.set(raceAt(at(store.fields.race, row)) === 'plant' ? 0x0b3a2c : 0x000000);
    }
  }

  // --- Decals & paths -----------------------------------------------------------

  private addDecal(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    surface: SurfaceId,
    energy: number,
  ): void {
    const size =
      (surface === 'metal' ? 0.025 : surface === 'wood' ? 0.035 : 0.05) * (0.6 + 0.6 * energy);
    this.dummy.position.set(x + nx * 0.003, y + ny * 0.003, z + nz * 0.003);
    this.dummy.lookAt(x + nx, y + ny, z + nz);
    this.dummy.rotateZ(Math.random() * Math.PI * 2);
    this.dummy.scale.set(size, size, size);
    this.dummy.updateMatrix();
    this.decals.setMatrixAt(this.decalNext, this.dummy.matrix);
    this.decalNext = (this.decalNext + 1) % MAX_DECALS;
    this.decals.count = Math.min(
      MAX_DECALS,
      Math.max(this.decals.count, this.decalNext === 0 ? MAX_DECALS : this.decalNext),
    );
    this.decals.instanceMatrix.needsUpdate = true;
  }

  private pathTo(x: number, y: number, z: number): void {
    if (this.lastShot === null) return;
    const i = this.pathNext * 6;
    this.pathPositions.set(
      [this.lastShotPos.x, this.lastShotPos.y, this.lastShotPos.z, x, y, z],
      i,
    );
    this.pathNext = (this.pathNext + 1) % MAX_PATHS;
    const g = this.paths.geometry;
    g.setDrawRange(
      0,
      Math.min(
        MAX_PATHS,
        Math.max(g.drawRange.count / 2, this.pathNext === 0 ? MAX_PATHS : this.pathNext),
      ) * 2,
    );
    const attr = g.getAttribute('position');
    attr.needsUpdate = true;
  }

  /**
   * Shader warm-up: make every pooled effect drawable for one compile pass
   * so the first shot, impact or explosion never stalls on shader compilation.
   */
  setWarmup(on: boolean): void {
    for (const m of [this.casingMesh, this.shellMesh, this.decals, this.sparkMesh, this.dustMesh])
      m.count = on ? 1 : 0;
    this.fireball.visible = on;
    for (const m of this.hazardMeshes) m.visible = on;
    for (const m of this.thrownMeshes) m.visible = on;
    this.paths.visible = on || this.showPaths;
  }

  /** Live projectile positions (debug). */
  projectileCount(): number {
    return this.sandbox.simulation.world.tryStore(Projectile)?.size ?? 0;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** Bullet hole: dark centre, fractured lighter rim, transparent outside. */
function bulletHoleTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.atan2(dy, dx);
      const jag = 0.08 * Math.sin(a * 7) + 0.05 * Math.sin(a * 13 + 1);
      const hole = r < 0.28 + jag * 0.5 ? 1 : 0;
      const chip = r < 0.7 + jag ? 1 - (r - 0.28) / 0.45 : 0;
      const i = (y * size + x) * 4;
      const c = hole ? 8 : 60;
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = Math.round(255 * Math.max(hole, Math.max(0, chip) * 0.55));
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export const RACE_LIST = RACES;
