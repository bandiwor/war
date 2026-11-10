import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEnvironmentView } from '../../../application/world/environment-system';
import { WorldLighting } from './world-lighting';

function at(hour: number, fog = 0, rain = 0): WorldLighting {
  const scene = new THREE.Scene();
  const l = new WorldLighting(scene);
  const env = createEnvironmentView();
  env.active = true;
  env.timeOfDay = hour * 3600;
  env.weather.fog = fog;
  env.weather.rain = rain;
  l.update(env, new THREE.Vector3(10, 1.7, 5));
  return l;
}

describe('world lighting', () => {
  it('full night on a clear evening is exactly the stage-1 street look', () => {
    const l = at(23);
    expect(l.fog.density).toBeCloseTo(0.034, 9);
    expect(l.fog.color.getHex()).toBe(new THREE.Color(0x05070b).getHex());
    expect(l.hemi.intensity).toBeCloseTo(0.06, 9);
    expect(l.direct.intensity).toBeCloseTo(0.05, 9);
  });

  it('dusk is brighter than night, with the sun below the horizon lighting nothing directly', () => {
    const dusk = at(18.9);
    const night = at(22);
    expect(dusk.light).toBeGreaterThan(night.light);
    expect(dusk.hemi.intensity).toBeGreaterThan(night.hemi.intensity);
    expect(dusk.direct.intensity).toBeLessThan(0.1); // moonlight only once the sun is down
    const day = at(15);
    expect(day.direct.intensity).toBeGreaterThan(1);
  });

  it('fog thickens with the weather and the sky follows the camera', () => {
    expect(at(22, 1).fog.density).toBeGreaterThan(at(22, 0).fog.density * 2);
    expect(at(22, 0, 1).fog.density).toBeGreaterThan(at(22, 0, 0).fog.density);
    expect(at(22).sky.mesh.position.toArray()).toEqual([10, 1.7, 5]);
  });
});
