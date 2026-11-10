import * as THREE from 'three';
import type { EnvironmentView } from '../../../application/world/environment-system';
import { daylight, fogDensity, sunAzimuth, sunElevation } from '../../../domain/world/environment';
import { SkyDome } from './sky';

const DEG = Math.PI / 180;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Night values match the stage-1 street exactly, so full night looks the same everywhere.
const NIGHT_FOG = new THREE.Color(0x05070b);
const DUSK_HORIZON = new THREE.Color(1.6, 0.62, 0.26);
const MOON = new THREE.Color(0.55, 0.65, 0.95);
const LOW_SUN = new THREE.Color(1.0, 0.45, 0.2);
const HIGH_SUN = new THREE.Color(1.0, 0.95, 0.85);
const HEMI_NIGHT = new THREE.Color(0.12, 0.16, 0.24);
const HEMI_DAY = new THREE.Color(0.6, 0.7, 0.9);

/**
 * Sun/moon, sky light, sky dome and fog from the world clock and weather.
 * Values are scene-linear HDR; the bodycam auto-exposure adapts with its lag,
 * so dusk reads as a bright sky over darkening streets.
 */
export class WorldLighting {
  readonly sky = new SkyDome();
  readonly direct = new THREE.DirectionalLight(MOON, 0.05);
  readonly hemi = new THREE.HemisphereLight(HEMI_NIGHT, new THREE.Color(0.02, 0.02, 0.02), 0.06);
  readonly fog = new THREE.FogExp2(NIGHT_FOG.clone(), 0.034);
  /** Sky light 0..1 of the last update (rain brightness, debug). */
  light = 0;
  elevation = 0;
  private readonly horizon = new THREE.Color();
  private readonly tmp = new THREE.Color();

  constructor(scene: THREE.Scene) {
    scene.add(this.sky.mesh, this.direct, this.direct.target, this.hemi);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0x020306);
  }

  update(env: EnvironmentView, camera: THREE.Vector3): void {
    const e = sunElevation(env.timeOfDay);
    const az = sunAzimuth(env.timeOfDay);
    const L = daylight(e);
    const w = env.weather;
    this.light = L;
    this.elevation = e;
    const overcast = Math.min(1, 0.7 * w.fog + 0.6 * w.rain);

    // Sky dome, on the same scale as the sky light so exposure holds both sky and street.
    const hemiK = 0.06 + 0.8 * L * (1 - 0.4 * overcast);
    const u = this.sky.uniforms;
    this.horizon.copy(HEMI_NIGHT).lerp(HEMI_DAY, L);
    u.uZenith.value.copy(this.horizon).multiplyScalar(hemiK * 0.3);
    u.uHorizon.value.copy(this.horizon).multiplyScalar(hemiK * 0.22);
    const glow =
      smoothstep(-12 * DEG, 2 * DEG, e) * (1 - smoothstep(6 * DEG, 25 * DEG, e)) * (1 - overcast);
    u.uGlow.value.copy(DUSK_HORIZON).multiplyScalar(glow * hemiK * 0.6);
    u.uSunDir.value
      .set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e))
      .normalize();

    // Fog glows with the light that falls into it: the sky light (what lights the ground), plus a
    // little afterglow. At night this lands exactly on the stage-1 street's fog colour.
    this.tmp
      .copy(HEMI_NIGHT)
      .lerp(HEMI_DAY, L)
      .multiplyScalar(hemiK * 0.16);
    this.tmp.r += u.uGlow.value.r * 0.04;
    this.tmp.g += u.uGlow.value.g * 0.04;
    this.tmp.b += u.uGlow.value.b * 0.04;
    this.fog.color.copy(NIGHT_FOG).lerp(this.tmp, Math.min(1, L * 3));
    this.fog.density = fogDensity(w, L);
    u.uFogColor.value.copy(this.fog.color);
    u.uFog.value = Math.min(1, w.fog * 0.9 + w.rain * 0.3);
    this.sky.follow(camera);

    // Sun above the horizon, moon after it sets.
    const sunK = 2.5 * smoothstep(-1 * DEG, 8 * DEG, e) * (1 - 0.7 * overcast);
    if (sunK > 0.05) {
      this.direct.color.copy(LOW_SUN).lerp(HIGH_SUN, smoothstep(0, 20 * DEG, e));
      this.direct.intensity = sunK;
      this.direct.position.set(
        camera.x + Math.sin(az) * 60,
        camera.y + Math.max(5, Math.sin(e) * 60),
        camera.z - Math.cos(az) * 60,
      );
    } else {
      this.direct.color.copy(MOON);
      this.direct.intensity = 0.05 * (1 - 0.6 * overcast);
      this.direct.position.set(camera.x - 30, camera.y + 60, camera.z + 20);
    }
    this.direct.target.position.copy(camera);
    this.direct.target.updateMatrixWorld();

    this.hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, L);
    this.hemi.intensity = hemiK;
  }

  dispose(): void {
    this.sky.dispose();
    this.direct.dispose();
    this.hemi.dispose();
  }
}
