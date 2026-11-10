import * as THREE from 'three';

/**
 * Rain: streaks animated entirely on the GPU. Each drop has a fixed random
 * offset; the vertex shader moves it with time and the wind and wraps it in
 * a box around the camera, anchored to the world (drops do not swim with the
 * player). Heavier rain draws more of the same buffer; nothing is updated
 * on the CPU besides a few uniforms. Drops catch the flashlight beam.
 */
const VERT = /* glsl */ `
attribute vec3 aSeed;
attribute float aTail;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uLength;
uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
uniform float uFlash;
varying float vLight;
varying float vFade;
void main() {
  vec3 p = aSeed * uBox + uVel * uTime;
  p = mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox + uCam;
  p -= normalize(uVel) * uLength * aTail;
  vec3 toDrop = p - uFlashPos;
  float d = length(toDrop);
  float cone = smoothstep(0.86, 0.97, dot(toDrop / max(d, 1e-3), uFlashDir));
  vLight = uFlash * cone * 0.5 / (1.0 + d * d * 0.12);
  float near = length(p - uCam);
  // Fade at the box edge (no popping) and right at the lens (no blinding streaks).
  vFade = (1.0 - smoothstep(0.35, 0.5, length((p - uCam).xz) / uBox.x)) * smoothstep(0.8, 2.5, near) * (1.0 - aTail * 0.8);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAmbient;
varying float vLight;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor * (vLight + uAmbient) * vFade, 1.0);
}`;

export class Rain {
  readonly mesh: THREE.LineSegments;
  readonly uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(26, 16, 26) },
    uVel: { value: new THREE.Vector3(0, -9, 0) },
    uLength: { value: 0.55 },
    uFlashPos: { value: new THREE.Vector3() },
    uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
    uFlash: { value: 0 },
    uColor: { value: new THREE.Color(0.3, 0.33, 0.38) },
    uAmbient: { value: 0.05 },
  };
  private readonly geometry: THREE.BufferGeometry;

  constructor(
    private readonly maxDrops: number,
    seed: number,
  ) {
    const seeds = new Float32Array(maxDrops * 2 * 3);
    const tails = new Float32Array(maxDrops * 2);
    // Deterministic per seed (looks identical in visual tests); render-only, not simulation.
    let s = seed >>> 0 || 1;
    const next = (): number => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < maxDrops; i++) {
      const x = next();
      const y = next();
      const z = next();
      for (let k = 0; k < 2; k++) {
        seeds.set([x, y, z], (i * 2 + k) * 3);
        tails[i * 2 + k] = k;
      }
    }
    this.geometry = new THREE.BufferGeometry();
    // Positions are computed in the shader; the attribute only sizes the draw.
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(maxDrops * 2 * 3), 3),
    );
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.geometry.setAttribute('aTail', new THREE.BufferAttribute(tails, 1));
    this.geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.mesh = new THREE.LineSegments(this.geometry, material);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;
  }

  /** `intensity` 0..1; wind in m/s; ambient = sky light 0..1. */
  update(
    intensity: number,
    time: number,
    camera: THREE.Vector3,
    windX: number,
    windZ: number,
    ambient: number,
    flash: { position: THREE.Vector3; direction: THREE.Vector3; on: boolean },
  ): void {
    const drops = Math.floor(this.maxDrops * Math.min(1, Math.max(0, intensity)));
    this.geometry.setDrawRange(0, drops * 2);
    this.mesh.visible = drops > 0;
    const u = this.uniforms;
    u.uTime.value = time % 1000;
    u.uCam.value.copy(camera);
    u.uVel.value.set(windX * 0.6, -9 - 2 * intensity, windZ * 0.6);
    u.uFlashPos.value.copy(flash.position);
    u.uFlashDir.value.copy(flash.direction);
    u.uFlash.value = flash.on ? 1 : 0;
    u.uAmbient.value = 0.004 + 0.08 * ambient;
  }

  dispose(): void {
    this.geometry.dispose();
    const m = this.mesh.material;
    if (!Array.isArray(m)) m.dispose();
  }
}
