import * as THREE from 'three';
import { postMaterial, uniform, type Tex } from '../../gl/fullscreen';
import { GLSL_COMMON } from '../../gl/shader-lib';
import type { EffectPass, PassContext } from '../types';

/**
 * Physically-flavoured bloom: soft-knee threshold on the exposed image, then a
 * dual-filter mip pyramid (13-tap down, tent up). Produces an aux 'bloom'
 * texture consumed by tonemap, overexposure halation and lens dirt.
 */
export function createBloom(ctx: PassContext): EffectPass<'bloom'> {
  const levels = ctx.quality.bloomLevels;
  const make = (): THREE.WebGLRenderTarget =>
    new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  const down = Array.from({ length: levels }, make);
  const up = Array.from({ length: levels - 1 }, make);

  const pre = {
    tInput: uniform<Tex>(null),
    tExposure: uniform<Tex>(null),
    uHasExposure: uniform(0),
    uThreshold: uniform(1),
    uKnee: uniform(0.5),
  };
  const preMat = postMaterial(
    GLSL_COMMON +
      /* glsl */ `
    uniform sampler2D tInput; uniform sampler2D tExposure; uniform float uHasExposure, uThreshold, uKnee;
    in vec2 vUv; out vec4 outColor;
    void main() {
      float exposure = uHasExposure > 0.5 ? texelFetch(tExposure, ivec2(0), 0).r : 1.0;
      vec3 c = texture(tInput, vUv).rgb * exposure;
      float br = max(c.r, max(c.g, c.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
      outColor = vec4(min(c * contrib, vec3(64.0)), 1.0);
    }`,
    pre,
  );
  const dn = { tInput: uniform<Tex>(null), uTexel: uniform(new THREE.Vector2()) };
  const downMat = postMaterial(
    /* glsl */ `
    precision highp float;
    uniform sampler2D tInput; uniform vec2 uTexel; in vec2 vUv; out vec4 outColor;
    vec3 s(vec2 o) { return texture(tInput, vUv + o * uTexel).rgb; }
    void main() {
      vec3 c = s(vec2(0)) * 0.125;
      c += (s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1))) * 0.125;
      c += (s(vec2(-2, -2)) + s(vec2(2, -2)) + s(vec2(-2, 2)) + s(vec2(2, 2))) * 0.03125;
      c += (s(vec2(-2, 0)) + s(vec2(2, 0)) + s(vec2(0, -2)) + s(vec2(0, 2))) * 0.0625;
      outColor = vec4(c, 1.0);
    }`,
    dn,
  );
  const upU = {
    tLow: uniform<Tex>(null),
    tHigh: uniform<Tex>(null),
    uTexel: uniform(new THREE.Vector2()),
    uRadius: uniform(0.8),
  };
  const upMat = postMaterial(
    /* glsl */ `
    precision highp float;
    uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uTexel; uniform float uRadius;
    in vec2 vUv; out vec4 outColor;
    vec3 s(vec2 o) { return texture(tLow, vUv + o * uTexel).rgb; }
    void main() {
      vec3 t = s(vec2(0)) * 4.0 + (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(0, 1))) * 2.0
             + s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1));
      outColor = vec4(texture(tHigh, vUv).rgb + t / 16.0 * uRadius, 1.0);
    }`,
    upU,
  );

  let w = 1;
  let h = 1;
  return {
    id: 'bloom',
    kind: 'aux',
    reads: ['exposure'],
    produces: 'bloom',
    format: 'own',
    render(renderer, io, params) {
      const exposure = io.aux['exposure'] ?? null;
      pre.tInput.value = io.input;
      pre.tExposure.value = exposure;
      pre.uHasExposure.value = exposure === null ? 0 : 1;
      pre.uThreshold.value = params.threshold;
      pre.uKnee.value = params.knee;
      const first = down[0];
      if (first === undefined) return;
      ctx.quad.render(renderer, preMat, first);
      for (let i = 1; i < down.length; i++) {
        const src = down[i - 1];
        const dst = down[i];
        if (src === undefined || dst === undefined) continue;
        dn.tInput.value = src.texture;
        dn.uTexel.value.set(1 / src.width, 1 / src.height);
        ctx.quad.render(renderer, downMat, dst);
      }
      let low: THREE.WebGLRenderTarget | undefined = down[down.length - 1];
      for (let i = up.length - 1; i >= 0; i--) {
        const high = down[i];
        const dst = up[i];
        if (low === undefined || high === undefined || dst === undefined) continue;
        upU.tLow.value = low.texture;
        upU.tHigh.value = high.texture;
        upU.uTexel.value.set(1 / low.width, 1 / low.height);
        upU.uRadius.value = params.radius;
        ctx.quad.render(renderer, upMat, dst);
        low = dst;
      }
    },
    output: () => up[0]?.texture ?? down[0]?.texture ?? null,
    resize(width, height) {
      w = Math.max(1, width >> 1);
      h = Math.max(1, height >> 1);
      down.forEach((t, i) => {
        t.setSize(Math.max(1, w >> i), Math.max(1, h >> i));
      });
      up.forEach((t, i) => {
        t.setSize(Math.max(1, w >> i), Math.max(1, h >> i));
      });
    },
    dispose() {
      for (const t of [...down, ...up]) t.dispose();
      for (const m of [preMat, downMat, upMat]) m.dispose();
    },
  };
}
