import { postMaterial, uniform, type Tex } from '../../gl/fullscreen';
import { GLSL_COMMON } from '../../gl/shader-lib';
import { MANUAL_EXPOSURE, type EffectPass, type PassContext } from '../types';

/**
 * Small-sensor saturation: exposed values past `clip` bleach towards white
 * (channels saturate unevenly, then desaturate), plus red-tinted halation
 * around strong highlights, as when the flashlight hits a wall up close.
 */
export function createOverexposure(ctx: PassContext): EffectPass<'overexposure'> {
  const u = {
    tInput: uniform<Tex>(null),
    tExposure: uniform<Tex>(null),
    tBloom: uniform<Tex>(null),
    uHasExposure: uniform(0),
    uHasBloom: uniform(0),
    uClip: uniform(2),
    uDesat: uniform(0.8),
    uHalation: uniform(0.3),
    uManualExposure: uniform(MANUAL_EXPOSURE),
  };
  const mat = postMaterial(
    GLSL_COMMON +
      /* glsl */ `
    uniform sampler2D tInput; uniform sampler2D tExposure; uniform sampler2D tBloom;
    uniform float uHasExposure, uHasBloom, uClip, uDesat, uHalation, uManualExposure;
    in vec2 vUv; out vec4 outColor;
    void main() {
      float e = uHasExposure > 0.5 ? texelFetch(tExposure, ivec2(0), 0).r : uManualExposure;
      vec3 c = texture(tInput, vUv).rgb * e;
      // Per-channel sensor saturation: hues shift (orange lamps go yellow-white),
      // then fully blown areas become a flat, featureless white disc.
      float peak = max(c.r, max(c.g, c.b));
      vec3 clipped = min(c, vec3(uClip));
      float over = smoothstep(uClip * 0.6, uClip, peak);
      vec3 blown = mix(clipped, vec3(uClip), over * uDesat);
      if (uHasBloom > 0.5) {
        vec3 b = texture(tBloom, vUv).rgb;
        blown += vec3(1.0, 0.35, 0.2) * luma(b) * uHalation;
      }
      outColor = vec4(blown / e, 1.0);
    }`,
    u,
  );
  return {
    id: 'overexposure',
    kind: 'chain',
    reads: ['exposure', 'bloom'],
    format: 'hdr',
    render(renderer, io, params) {
      const exposure = io.aux['exposure'] ?? null;
      const bloom = io.aux['bloom'] ?? null;
      u.tInput.value = io.input;
      u.tExposure.value = exposure;
      u.tBloom.value = bloom;
      u.uHasExposure.value = exposure === null ? 0 : 1;
      u.uHasBloom.value = bloom === null ? 0 : 1;
      u.uClip.value = params.clip;
      u.uDesat.value = params.desaturate;
      u.uHalation.value = params.halation;
      ctx.quad.render(renderer, mat, io.target);
    },
    dispose() {
      mat.dispose();
    },
  };
}
