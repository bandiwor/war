import * as THREE from 'three';
import type { RenderView } from '../../../application/scenes/sandbox';

/**
 * Places the camera like a chest-mounted body camera: lower than the eyes,
 * following torso yaw and most of the aim pitch, with procedural shake from
 * breathing and footsteps (the `cameraShake` effect). Also measures angular
 * velocity for rolling shutter, motion blur and compression.
 */
export interface ShakeParams {
  breathing: number;
  footsteps: number;
  roll: number;
}

/** Eye height minus chest mount height. */
const CHEST_DROP = 0.3;
const STEP_LENGTH = 0.75;

export class BodycamRig {
  yawVelocity = 0;
  pitchVelocity = 0;
  /** 0..1 combined motion estimate. */
  motion = 0;
  private lastYaw = Number.NaN;
  private lastPitch = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  update(view: RenderView, shake: ShakeParams | null, time: number, dt: number): void {
    const breathRate = 0.28 + 0.25 * view.stimulus.fear;
    const b = shake ? shake.breathing : 0;
    const f = shake ? shake.footsteps : 0;
    const r = shake ? shake.roll : 0;
    const walk = Math.min(1, view.speed / 3.6);
    const phase = (view.stride / STEP_LENGTH) * Math.PI;

    const breathY = Math.sin(time * Math.PI * 2 * breathRate) * 0.006 * b;
    const breathPitch = Math.sin(time * Math.PI * 2 * breathRate + 0.6) * 0.004 * b;
    const stepBob = (Math.abs(Math.sin(phase)) - 0.6) * 0.035 * walk * f;
    const stepSway = Math.sin(phase) * 0.018 * walk * f;
    const stepRoll = Math.sin(phase) * 0.012 * walk * r + Math.sin(time * 0.7) * 0.003 * r;
    const stepYaw = Math.sin(phase) * 0.006 * walk * f;

    const yaw = view.yaw + stepYaw;
    const pitch = view.pitch * 0.9 + breathPitch + stepBob * 0.15;
    this.euler.set(pitch, yaw, stepRoll);
    this.camera.quaternion.setFromEuler(this.euler);
    const right = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    this.camera.position.set(
      view.x + right * stepSway,
      view.y - CHEST_DROP + breathY + stepBob,
      view.z + rightZ * stepSway,
    );
    this.camera.updateMatrixWorld();

    if (Number.isNaN(this.lastYaw) || dt <= 0 || dt > 0.5) {
      this.yawVelocity = 0;
      this.pitchVelocity = 0;
    } else {
      // Light smoothing: raw per-frame deltas are noisy at high frame rates.
      this.yawVelocity += ((yaw - this.lastYaw) / dt - this.yawVelocity) * 0.5;
      this.pitchVelocity += ((pitch - this.lastPitch) / dt - this.pitchVelocity) * 0.5;
    }
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.motion = Math.min(
      1,
      Math.abs(this.yawVelocity) * 0.35 + Math.abs(this.pitchVelocity) * 0.25 + walk * 0.25,
    );
  }
}
