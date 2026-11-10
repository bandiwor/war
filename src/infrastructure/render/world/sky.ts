import * as THREE from 'three';

/**
 * Sky dome for the open world: a zenith-to-horizon gradient, the afterglow
 * around the set sun, and fog that swallows the horizon. Follows the camera;
 * drawn first, without depth writes, so geometry always covers it.
 */
const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // on the far plane
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uGlow;
uniform vec3 uFogColor;
uniform float uFog;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -0.1, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(max(up, 0.0), 0.45));
  float toward = max(dot(d, uSunDir), 0.0);
  sky += uGlow * pow(toward, 6.0) * (1.0 - smoothstep(0.0, 0.35, up));
  // Fog hides the horizon and, when thick, the whole sky.
  float haze = mix(1.0 - smoothstep(-0.05, 0.3, up), 1.0, uFog);
  gl_FragColor = vec4(mix(sky, uFogColor, clamp(haze, 0.0, 1.0)), 1.0);
}`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uGlow: { value: new THREE.Color() },
    uFogColor: { value: new THREE.Color() },
    uFog: { value: 0 },
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  follow(camera: THREE.Vector3): void {
    this.mesh.position.copy(camera);
    this.mesh.updateMatrixWorld();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const m = this.mesh.material;
    if (!Array.isArray(m)) m.dispose();
  }
}
