import * as THREE from 'three';
import type { RenderView } from '../../../application/scenes/sandbox';
import { WEAPONS, WEAPON_IDS, type WeaponId } from '../../../domain/weapons/registry';
import { WeaponEvent } from '../../../domain/weapons/weapon-state';
import { solveTwoBone, type V3 } from './ik';
import { WeaponModelLibrary, muzzleFlashTexture, type WeaponModel } from './weapon-models';

/**
 * First-person weapon and arms, rendered in their own pass after the world
 * (depth cleared) so the gun never clips into walls. Everything is in
 * camera space: a rig copies the camera transform each frame. All motion is
 * procedural: sway, bob, recoil spring, ADS, reload/cycle/jam/draw/swing.
 */
const UPPER_ARM = 0.31;
const FOREARM = 0.29;
const SHOULDER_R: V3 = [0.2, -0.3, 0.12];
const SHOULDER_L: V3 = [-0.2, -0.3, 0.12];

import { stepSpring, type Spring } from './spring';

export class Viewmodel {
  readonly scene = new THREE.Scene();
  private readonly rig = new THREE.Object3D();
  private readonly holder = new THREE.Object3D();
  private readonly library = new WeaponModelLibrary();
  private current: { id: WeaponId; model: WeaponModel } | null = null;
  private readonly arms: { upper: THREE.Mesh; fore: THREE.Mesh; hand: THREE.Mesh }[] = [];
  private readonly armMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.9 });
  private readonly gloveMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.8 });
  private readonly armGeo = new THREE.CylinderGeometry(0.045, 0.04, 1, 10);
  private readonly handGeo = new THREE.BoxGeometry(0.06, 0.05, 0.1);
  private readonly flashTex = muzzleFlashTexture();
  private readonly flash: THREE.Mesh;
  readonly flashLight = new THREE.PointLight(0xffb066, 0, 6, 2);
  private readonly fill = new THREE.PointLight(0xdfe6ff, 0, 3, 2);
  private flashTime = 0;
  private ads = 0;
  private sprint = 0;
  private readonly kick: Spring = { pos: 0, vel: 0 };
  private readonly kickRot: Spring = { pos: 0, vel: 0 };
  private readonly swayYaw: Spring = { pos: 0, vel: 0 };
  private readonly swayPitch: Spring = { pos: 0, vel: 0 };
  private lastYaw = Number.NaN;
  private lastPitch = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  readonly muzzleWorld = new THREE.Vector3();
  readonly ejectionWorld = new THREE.Vector3();
  readonly rightWorld = new THREE.Vector3();

  constructor() {
    this.scene.add(this.rig);
    this.rig.add(this.holder);
    // Lit like the world: faint night ambient plus the chest flashlight's spill
    // (auto exposure runs up to 9× in the dark, so these stay physically small).
    this.scene.add(new THREE.HemisphereLight(0x223044, 0x050505, 0.05));
    this.rig.add(this.fill);
    this.fill.position.set(0.1, 0.1, -0.2);
    this.rig.add(this.flashLight);
    for (let i = 0; i < 2; i++) {
      const upper = new THREE.Mesh(this.armGeo, this.armMat);
      const fore = new THREE.Mesh(this.armGeo, this.armMat);
      const hand = new THREE.Mesh(this.handGeo, this.gloveMat);
      this.rig.add(upper, fore, hand);
      this.arms.push({ upper, fore, hand });
    }
    const flashMat = new THREE.MeshBasicMaterial({
      map: this.flashTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: new THREE.Color(6, 5, 4),
    });
    const flashGeo = new THREE.PlaneGeometry(0.22, 0.22);
    this.flash = new THREE.Mesh(flashGeo, flashMat);
    const cross = new THREE.Mesh(flashGeo, flashMat);
    cross.rotation.y = Math.PI / 2;
    this.flash.add(cross);
    this.flash.visible = false;
    this.holder.add(this.flash);
  }

  /** Feed weapon mechanics events (from the simulation) for one-shot animations. */
  onWeaponEvent(flags: number, weapon: number): void {
    const id = WEAPON_IDS[weapon];
    if (id === undefined) return;
    if (flags & WeaponEvent.SHOT) {
      const w = WEAPONS[id];
      const strength = w.kind === 'firearm' ? (w.recoil.pattern[0]?.[0] ?? 1) : 1;
      this.kick.vel += 0.9 + strength * 0.35;
      this.kickRot.vel += 2 + strength * 1.6;
      this.flashTime = 0.045;
      this.flash.rotation.z = (weapon * 1.7 + this.flashTime * 997) % Math.PI;
    }
    if (flags & (WeaponEvent.SWING | WeaponEvent.THROW)) this.kickRot.vel -= 3;
  }

  update(camera: THREE.Camera, view: RenderView, dt: number, flashlightOn: boolean): void {
    this.rig.position.copy(camera.position);
    this.rig.quaternion.copy(camera.quaternion);
    this.rig.updateMatrixWorld();
    this.fill.intensity = flashlightOn ? 0.12 : 0.01;

    const wv = view.weapon;
    if (wv.id === null) {
      this.holder.visible = false;
      for (const a of this.arms) for (const m of [a.upper, a.fore, a.hand]) m.visible = false;
      return;
    }
    // Through a magnified optic the weapon itself is out of view.
    const held = WEAPONS[wv.id];
    const scoped = held.kind === 'firearm' && held.adsZoom > 2;
    this.holder.visible = !(wv.aiming && this.ads > 0.6 && scoped);
    if (this.current?.id !== wv.id) this.equip(wv.id);
    const cur = this.current;
    if (cur === null) return;
    const w = WEAPONS[wv.id];

    // Smoothed stances.
    const k = 1 - Math.exp(-dt * 12);
    this.ads += ((wv.aiming && wv.phase !== 'reloading' ? 1 : 0) - this.ads) * k;
    this.sprint +=
      ((view.speed > 2.8 && !wv.aiming ? 1 : 0) - this.sprint) * (1 - Math.exp(-dt * 6));

    // Sway: lag behind camera rotation.
    if (!Number.isNaN(this.lastYaw) && dt > 0) {
      this.swayYaw.vel += (view.yaw - this.lastYaw) * 6;
      this.swayPitch.vel += (view.pitch - this.lastPitch) * 6;
    }
    this.lastYaw = view.yaw;
    this.lastPitch = view.pitch;
    stepSpring(this.swayYaw, 90, 14, dt);
    stepSpring(this.swayPitch, 90, 14, dt);
    stepSpring(this.kick, 260, 22, dt);
    stepSpring(this.kickRot, 220, 20, dt);

    const sightH = w.kind === 'firearm' ? w.sightHeight : 0.03;
    const hip: V3 =
      w.kind === 'firearm'
        ? wv.id === 'pistol'
          ? [0.12, -0.2, -0.36]
          : [0.15, -0.21, -0.32]
        : w.kind === 'melee'
          ? [0.2, -0.24, -0.38]
          : [0.18, -0.2, -0.36];
    const aim: V3 = [0, -0.055 - sightH, -0.3];
    const bob =
      Math.sin((view.stride / 0.75) * Math.PI) * Math.min(1, view.speed / 3) * (1 - this.ads * 0.8);
    let x = hip[0] + (aim[0] - hip[0]) * this.ads + bob * 0.012;
    let y = hip[1] + (aim[1] - hip[1]) * this.ads - Math.abs(bob) * 0.01 - this.sprint * 0.06;
    let z = hip[2] + (aim[2] - hip[2]) * this.ads + this.kick.pos * 0.04;
    let rx = this.kickRot.pos * 0.035 + this.swayPitch.pos * 0.8 - this.sprint * 0.5;
    let ry = this.swayYaw.pos * 0.8 + this.sprint * 0.6;
    let rz = -bob * 0.03 - this.swayYaw.pos * 0.3;

    // Phase animations.
    const progress = (total: number): number =>
      total > 0 ? Math.min(1, Math.max(0, 1 - wv.timer / total)) : 1;
    switch (wv.phase) {
      case 'drawing': {
        const p = progress(w.drawSeconds);
        y -= (1 - p) * 0.35;
        rx -= (1 - p) * 0.9;
        break;
      }
      case 'reloading': {
        rz += 0.45;
        rx += 0.25;
        y -= 0.03;
        x -= 0.03;
        break;
      }
      case 'jammed':
        rz += 0.3;
        ry -= 0.2;
        break;
      case 'clearing': {
        rz += 0.5;
        x -= 0.04;
        break;
      }
      case 'swinging': {
        const s = wv.swing;
        const arc = Math.sin(s * Math.PI);
        ry += 1.4 * (0.5 - s);
        rx -= arc * 0.6;
        x -= arc * 0.18;
        z -= arc * 0.15;
        break;
      }
      case 'cycling':
      case 'ready':
        break;
    }
    this.holder.position.set(x, y, z);
    this.holder.rotation.set(rx, ry, rz, 'YXZ');

    // Moving parts.
    this.resetParts(cur.model);
    const mag = cur.model.parts.get('magazine') ?? [];
    const slide = [...(cur.model.parts.get('slide') ?? []), ...(cur.model.parts.get('bolt') ?? [])];
    const pump = cur.model.parts.get('pump') ?? [];
    // The rocket sits in the muzzle only while one is loaded (or being seated).
    const loaded = wv.chambered || (wv.phase === 'reloading' && wv.stage === 'chamber');
    for (const part of cur.model.parts.get('warhead') ?? []) part.visible = loaded;
    if (w.kind === 'firearm') {
      if (wv.phase === 'reloading' && !w.tubeFed) {
        const total =
          wv.stage === 'magOut'
            ? w.reload.tacticalSeconds * 0.45
            : wv.stage === 'magIn'
              ? w.reload.tacticalSeconds * 0.55
              : w.reload.emptySeconds * 0.25;
        const p = progress(total);
        const out = wv.stage === 'magOut' ? p : wv.stage === 'magIn' ? 1 - p : 0;
        for (const m of mag) {
          m.position.y -= out * 0.22;
          m.position.z -= out * 0.06;
          m.visible = !(wv.stage === 'magOut' && p > 0.95);
        }
        if (wv.stage === 'chamber')
          for (const s of slide) s.position.z -= Math.sin(p * Math.PI) * 0.06;
      }
      if (
        wv.phase === 'cycling' ||
        (wv.phase === 'reloading' && wv.stage === 'chamber' && w.tubeFed)
      ) {
        const p = progress(w.cycleSeconds);
        const stroke = Math.sin(p * Math.PI);
        for (const s of slide) s.position.z -= stroke * 0.08;
        for (const s of pump) s.position.z -= stroke * 0.1;
      }
      if (wv.phase === 'clearing') {
        const p = progress(w.wear.clearSeconds);
        for (const s of [...slide, ...pump])
          s.position.z -= Math.abs(Math.sin(p * Math.PI * 2)) * 0.07;
      }
      // Slide locks back on an empty gun.
      if (!wv.chambered && wv.mag === 0 && wv.phase === 'ready' && w.action === 'semiauto')
        for (const s of slide) s.position.z -= 0.035;
    }

    // Muzzle flash.
    this.flashTime -= dt;
    const muzzle = w.model.muzzle;
    // Models face +Z; the holder faces the camera's −Z (model group is turned 180°).
    this.flash.position.set(-muzzle[0], muzzle[1], -(muzzle[2] + 0.06));
    this.flash.visible = this.flashTime > 0;
    this.flash.scale.setScalar(0.8 + 0.6 * Math.max(0, this.flashTime) * 20);
    this.flashLight.intensity = this.flashTime > 0 ? 18 : 0;
    this.holder.updateMatrixWorld(true);
    cur.model.group.localToWorld(this.muzzleWorld.set(muzzle[0], muzzle[1], muzzle[2]));
    this.flashLight.position.copy(this.rig.worldToLocal(this.tmp2.copy(this.muzzleWorld)));
    const port = w.model.ejectionPort;
    cur.model.group.localToWorld(this.ejectionWorld.set(port[0], port[1], port[2]));
    this.rightWorld.set(1, 0, 0).applyQuaternion(camera.quaternion);

    // Arms: IK to grip and support points (single-handed for melee/throw).
    this.solveArm(0, SHOULDER_R, w.model.grip, [0.45, -0.6, 0.2]);
    if (w.kind === 'firearm' && !(wv.phase === 'reloading' && !w.tubeFed && wv.stage !== 'chamber'))
      this.solveArm(1, SHOULDER_L, w.model.support, [-0.45, -0.6, 0.1]);
    else this.solveArmRaw(1, SHOULDER_L, [-0.12, -0.42, -0.25], [-0.45, -0.6, 0.1]);
  }

  private resetParts(model: WeaponModel): void {
    for (const [obj, rest] of model.rest) {
      obj.position.copy(rest);
      obj.visible = true;
    }
  }

  /** Hand on a point given in weapon space. */
  private solveArm(
    i: number,
    shoulder: V3,
    anchor: readonly [number, number, number],
    pole: V3,
  ): void {
    this.tmp.set(anchor[0], anchor[1], anchor[2]);
    (this.current?.model.group ?? this.holder).localToWorld(this.tmp);
    this.rig.worldToLocal(this.tmp);
    this.solveArmRaw(i, shoulder, [this.tmp.x, this.tmp.y, this.tmp.z], pole);
  }

  private solveArmRaw(i: number, shoulder: V3, target: V3, pole: V3): void {
    const arm = this.arms[i];
    if (arm === undefined) return;
    const { elbow, hand } = solveTwoBone(shoulder, target, UPPER_ARM, FOREARM, pole);
    place(arm.upper, shoulder, elbow);
    place(arm.fore, elbow, hand);
    arm.hand.position.set(hand[0], hand[1], hand[2]);
    arm.hand.lookAt(this.tmp.set(elbow[0], elbow[1], elbow[2]).applyMatrix4(this.rig.matrixWorld));
    for (const m of [arm.upper, arm.fore, arm.hand]) m.visible = true;
  }

  private equip(id: WeaponId): void {
    if (this.current !== null) this.holder.remove(this.current.model.group);
    const model = this.library.get(id);
    model.group.rotation.y = Math.PI; // model +Z forward → camera −Z
    this.holder.add(model.group);
    this.current = { id, model };
  }

  dispose(): void {
    this.library.dispose();
    this.armGeo.dispose();
    this.handGeo.dispose();
    this.armMat.dispose();
    this.gloveMat.dispose();
    this.flashTex.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Positions a unit-height cylinder (local Y) between two rig-space points. */
function place(mesh: THREE.Mesh, a: V3, b: V3): void {
  tmpA.set(a[0], a[1], a[2]);
  tmpB.set(b[0], b[1], b[2]);
  const length = tmpA.distanceTo(tmpB);
  mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(UP, tmpB.sub(tmpA).normalize());
}
