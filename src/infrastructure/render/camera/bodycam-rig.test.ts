import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRenderView } from '../../../application/scenes/sandbox';
import { BodycamRig } from './bodycam-rig';

const view = () => Object.assign(createRenderView(), { x: 1, y: 1.7, z: 2, yaw: 0, pitch: 0 });

describe('BodycamRig', () => {
  it('mounts at chest height facing the view yaw, without shake', () => {
    const rig = new BodycamRig(new THREE.PerspectiveCamera());
    rig.update(view(), null, 3, 1 / 60);
    expect(rig.camera.position.toArray()).toEqual([1, 1.4, 2]);
    const dir = rig.camera.getWorldDirection(new THREE.Vector3());
    expect(dir.z).toBeCloseTo(-1);
    expect(rig.yawVelocity).toBe(0);
  });

  it('measures angular velocity and motion', () => {
    const rig = new BodycamRig(new THREE.PerspectiveCamera());
    const v = view();
    rig.update(v, null, 0, 1 / 60);
    v.yaw = 0.05;
    rig.update(v, null, 1 / 60, 1 / 60);
    expect(rig.yawVelocity).toBeCloseTo(1.5); // half of 3 rad/s after smoothing
    expect(rig.motion).toBeGreaterThan(0.4);
    rig.update(v, null, 2, 5); // huge gap: velocities reset
    expect(rig.yawVelocity).toBe(0);
  });

  it('shakes with breathing at rest and footsteps when walking', () => {
    const still = new BodycamRig(new THREE.PerspectiveCamera());
    const shake = { breathing: 1, footsteps: 1, roll: 1 };
    still.update(view(), shake, 0.9, 1 / 60);
    expect(still.camera.position.y).not.toBe(1.4);
    const walking = new BodycamRig(new THREE.PerspectiveCamera());
    const v = Object.assign(view(), { speed: 3.6, stride: 0.37 });
    walking.update(v, shake, 0.9, 1 / 60);
    expect(Math.abs(walking.camera.position.x - 1)).toBeGreaterThan(0.005);
  });
});
