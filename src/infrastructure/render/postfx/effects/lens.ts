import type * as THREE from 'three';
import { uniform } from '../../gl/fullscreen';
import { simpleChainPass } from '../simple-pass';
import type { EffectPass, PassContext } from '../types';

/** Wide-angle body-camera lens: barrel distortion with fill zoom, dark rim outside the image circle. */
export function createLensDistortion(ctx: PassContext): EffectPass<'lensDistortion'> {
  return simpleChainPass(
    'lensDistortion',
    ctx,
    { uStrength: uniform(0.3), uZoom: uniform(1.1) },
    /* glsl */ `
    uniform float uStrength, uZoom;
    void main() {
      float aspect = uResolution.x / uResolution.y;
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      float r2 = dot(p, p);
      p *= (1.0 + uStrength * r2 + 0.5 * uStrength * r2 * r2) / uZoom;
      vec2 uv = p / vec2(aspect, 1.0) + 0.5;
      vec2 edge = smoothstep(vec2(0.0), vec2(0.004), uv) * smoothstep(vec2(0.0), vec2(0.004), 1.0 - uv);
      outColor = vec4(texture(tInput, clamp(uv, 0.0, 1.0)).rgb * edge.x * edge.y, 1.0);
    }`,
    (u, p) => {
      u.uStrength.value = p.strength;
      u.uZoom.value = p.zoom;
    },
  );
}

/** Lateral chromatic aberration growing towards the frame edges. */
export function createChromaticAberration(ctx: PassContext): EffectPass<'chromaticAberration'> {
  return simpleChainPass(
    'chromaticAberration',
    ctx,
    { uAmount: uniform(0.004) },
    /* glsl */ `
    uniform float uAmount;
    void main() {
      vec2 d = vUv - 0.5;
      vec2 off = d * dot(d, d) * 4.0 * uAmount * 10.0;
      float r = texture(tInput, vUv + off).r;
      float g = texture(tInput, vUv).g;
      float b = texture(tInput, vUv - off).b;
      outColor = vec4(r, g, b, 1.0);
    }`,
    (u, p) => {
      u.uAmount.value = p.amount;
    },
  );
}

/**
 * Dirt smudges lit by bright sources (bloom scatter on a greasy lens) plus
 * water droplets that refract the image. Pattern is procedural and static,
 * like a real dirty lens.
 */
export function createLensDirt(ctx: PassContext): EffectPass<'lensDirt'> {
  return simpleChainPass(
    'lensDirt',
    ctx,
    {
      tBloom: uniform<THREE.Texture | null>(null),
      uHasBloom: uniform(0),
      uDirt: uniform(0.6),
      uDroplets: uniform(0.3),
      uRefraction: uniform(0.01),
    },
    /* glsl */ `
    uniform sampler2D tBloom; uniform float uHasBloom, uDirt, uDroplets, uRefraction;
    // Returns droplet normal offset in xy and coverage in z.
    vec3 droplet(vec2 uv) {
      float aspect = uResolution.x / uResolution.y;
      vec2 p = uv * vec2(aspect, 1.0) * 9.0;
      vec2 cell = floor(p);
      vec3 best = vec3(0.0);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(i, j);
        float present = step(1.0 - uDroplets, hash12(c, 31.0));
        vec2 center = c + vec2(hash12(c, 32.0), hash12(c, 33.0));
        float radius = mix(0.08, 0.38, hash12(c, 34.0));
        vec2 d = (p - center) / radius;
        float r = length(d);
        if (r < 1.0 && present > 0.5) {
          float h = sqrt(1.0 - r * r);
          best = vec3(d * (1.0 - h), smoothstep(1.0, 0.85, r));
        }
      }
      return best;
    }
    void main() {
      vec3 drop = uDroplets > 0.0 ? droplet(vUv) : vec3(0.0);
      vec2 uv = vUv - drop.xy * uRefraction * drop.z;
      vec3 c = texture(tInput, uv).rgb;
      c *= 1.0 - 0.25 * drop.z * smoothstep(0.4, 1.0, length(drop.xy)); // dark droplet rims
      if (uHasBloom > 0.5) {
        float smudge = fbm(vUv * vec2(3.0, 2.2), 101.0);
        float specks = smoothstep(0.82, 0.95, vnoise(vUv * 70.0, 102.0));
        float mask = smoothstep(0.45, 0.85, smudge) * 0.8 + specks * 0.6 + drop.z * 0.5;
        vec3 b = texture(tBloom, vUv).rgb;
        c += b / (1.0 + b) * mask * uDirt;
      }
      outColor = vec4(c, 1.0);
    }`,
    (u, p, _frame, io) => {
      const bloom = io.aux['bloom'] ?? null;
      u.tBloom.value = bloom;
      u.uHasBloom.value = bloom === null ? 0 : 1;
      u.uDirt.value = p.dirt;
      u.uDroplets.value = p.droplets;
      u.uRefraction.value = p.refraction;
    },
    ['bloom'],
  );
}

export function createVignette(ctx: PassContext): EffectPass<'vignette'> {
  return simpleChainPass(
    'vignette',
    ctx,
    { uAmount: uniform(0.5), uSoftness: uniform(0.5) },
    /* glsl */ `
    uniform float uAmount, uSoftness;
    void main() {
      float aspect = uResolution.x / uResolution.y;
      float d = length((vUv - 0.5) * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
      float v = smoothstep(1.05, 1.05 - uSoftness * 1.2, d);
      vec3 c = texture(tInput, vUv).rgb;
      outColor = vec4(c * mix(1.0, v, clamp(uAmount, 0.0, 1.0)) * (1.0 - max(uAmount - 1.0, 0.0) * (1.0 - v)), 1.0);
    }`,
    (u, p) => {
      u.uAmount.value = p.amount;
      u.uSoftness.value = p.softness;
    },
  );
}
