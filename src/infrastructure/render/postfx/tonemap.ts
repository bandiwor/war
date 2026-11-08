import { postMaterial, uniform, type FullscreenQuad, type Tex } from '../gl/fullscreen';
import { GLSL_COMMON } from '../gl/shader-lib';
import type * as THREE from 'three';

/**
 * Core HDR → display transform (not a toggleable effect): exposure, bloom
 * composite, filmic curve, and the shared grade of the whole game: cold
 * shadows and mids, warm highlights preserved (emergency light accents), a
 * restricted palette via mild desaturation. Outputs sRGB-encoded values.
 */
export interface TonemapParams {
  manualExposure: number;
  bloomIntensity: number;
}

export class TonemapPass {
  private readonly u = {
    tInput: uniform<Tex>(null),
    tExposure: uniform<Tex>(null),
    tBloom: uniform<Tex>(null),
    uHasExposure: uniform(0),
    uHasBloom: uniform(0),
    uManual: uniform(1),
    uBloom: uniform(0.8),
  };
  private readonly mat: THREE.ShaderMaterial;

  constructor(private readonly quad: FullscreenQuad) {
    this.mat = postMaterial(
      GLSL_COMMON +
        /* glsl */ `
      uniform sampler2D tInput; uniform sampler2D tExposure; uniform sampler2D tBloom;
      uniform float uHasExposure, uHasBloom, uManual, uBloom;
      in vec2 vUv; out vec4 outColor;
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        float e = uHasExposure > 0.5 ? texelFetch(tExposure, ivec2(0), 0).r : uManual;
        vec3 c = texture(tInput, vUv).rgb * e;
        if (uHasBloom > 0.5) c += texture(tBloom, vUv).rgb * uBloom;
        c = aces(c);
        // Grade: desaturate, cool the shadows/mids, keep warm highlights.
        float l = luma(c);
        c = mix(vec3(l), c, 0.78);
        float shadow = 1.0 - smoothstep(0.0, 0.45, l);
        c *= mix(vec3(1.0), vec3(0.86, 0.95, 1.12), shadow);
        c += vec3(0.004, 0.007, 0.012) * shadow; // lifted, slightly blue blacks
        outColor = vec4(toSrgb(clamp(c, 0.0, 1.0)), 1.0);
      }`,
      this.u,
    );
  }

  render(
    renderer: THREE.WebGLRenderer,
    input: THREE.Texture,
    exposure: THREE.Texture | null,
    bloom: THREE.Texture | null,
    params: TonemapParams,
    target: THREE.WebGLRenderTarget | null,
  ): void {
    const u = this.u;
    u.tInput.value = input;
    u.tExposure.value = exposure;
    u.tBloom.value = bloom;
    u.uHasExposure.value = exposure === null ? 0 : 1;
    u.uHasBloom.value = bloom === null ? 0 : 1;
    u.uManual.value = params.manualExposure;
    u.uBloom.value = params.bloomIntensity;
    this.quad.render(renderer, this.mat, target);
  }

  dispose(): void {
    this.mat.dispose();
  }
}
