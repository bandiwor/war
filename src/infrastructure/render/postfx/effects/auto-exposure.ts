import * as THREE from 'three';
import { GLSL_COMMON } from '../../gl/shader-lib';
import { postMaterial, uniform, type Tex } from '../../gl/fullscreen';
import type { EffectPass, PassContext } from '../types';

/**
 * Lagged auto exposure like a cheap body camera: center-weighted log-average
 * luminance, reduced on the GPU to 1x1, then exponentially adapted towards the
 * target. Asymmetric speeds: the sensor recovers from darkness slower than it
 * clamps down on bright light, so you get the classic blown-out-then-recover.
 * Output texel: R = exposure multiplier, G = average luminance.
 */
const LUM_SIZE = 64;

function halfFloatTarget(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
}

export function createAutoExposure(ctx: PassContext): EffectPass<'autoExposure'> {
  const lum = halfFloatTarget(LUM_SIZE);
  const reduce = [halfFloatTarget(16), halfFloatTarget(4), halfFloatTarget(1)];
  const adapted = [halfFloatTarget(1), halfFloatTarget(1)];
  let current = 0;
  let reset = true;

  const lumU = { tInput: uniform<Tex>(null) };
  const lumMat = postMaterial(
    GLSL_COMMON +
      /* glsl */ `
    uniform sampler2D tInput; in vec2 vUv; out vec4 outColor;
    void main() {
      vec3 c = texture(tInput, vUv).rgb;
      float w = 1.0 - 0.75 * smoothstep(0.1, 0.7, length(vUv - 0.5));
      outColor = vec4(log(max(luma(c), 1e-4)) * w, w, 0.0, 1.0);
    }`,
    lumU,
  );
  const redU = { tInput: uniform<Tex>(null) };
  const reduceMat = postMaterial(
    /* glsl */ `
    precision highp float;
    uniform sampler2D tInput; in vec2 vUv; out vec4 outColor;
    void main() {
      vec2 sum = vec2(0.0);
      ivec2 base = ivec2(gl_FragCoord.xy) * 4;
      for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) sum += texelFetch(tInput, base + ivec2(x, y), 0).rg;
      outColor = vec4(sum, 0.0, 1.0);
    }`,
    redU,
  );
  const ad = {
    tAvg: uniform<Tex>(null),
    tPrev: uniform<Tex>(null),
    uDt: uniform(0),
    uKey: uniform(0.18),
    uUp: uniform(1),
    uDown: uniform(1),
    uMin: uniform(0.1),
    uMax: uniform(10),
    uReset: uniform(1),
  };
  const adaptMat = postMaterial(
    /* glsl */ `
    precision highp float;
    uniform sampler2D tAvg; uniform sampler2D tPrev;
    uniform float uDt, uKey, uUp, uDown, uMin, uMax, uReset;
    in vec2 vUv; out vec4 outColor;
    void main() {
      vec2 s = texelFetch(tAvg, ivec2(0), 0).rg;
      float avgLum = exp(s.x / max(s.y, 1e-4));
      float target = clamp(uKey / max(avgLum, 1e-4), uMin, uMax);
      float prev = texelFetch(tPrev, ivec2(0), 0).r;
      float speed = target > prev ? uUp : uDown;
      float e = uReset > 0.5 ? target : mix(prev, target, 1.0 - exp(-uDt * speed));
      outColor = vec4(e, avgLum, target, 1.0);
    }`,
    ad,
  );

  return {
    id: 'autoExposure',
    kind: 'aux',
    reads: [],
    produces: 'exposure',
    format: 'own',
    render(renderer, io, params, frame) {
      if (io.input === null) return;
      lumU.tInput.value = io.input;
      ctx.quad.render(renderer, lumMat, lum);
      let src = lum;
      for (const dst of reduce) {
        redU.tInput.value = src.texture;
        ctx.quad.render(renderer, reduceMat, dst);
        src = dst;
      }
      const prev = adapted[current] ?? lum;
      current = 1 - current;
      const next = adapted[current] ?? lum;
      ad.tAvg.value = src.texture;
      ad.tPrev.value = prev.texture;
      ad.uDt.value = frame.dt;
      ad.uKey.value = params.key;
      ad.uUp.value = params.speedUp;
      ad.uDown.value = params.speedDown;
      ad.uMin.value = params.minExposure;
      ad.uMax.value = params.maxExposure;
      ad.uReset.value = reset || frame.frozen ? 1 : 0;
      ctx.quad.render(renderer, adaptMat, next);
      reset = false;
    },
    output: () => adapted[current]?.texture ?? null,
    resize() {
      reset = true;
    },
    dispose() {
      for (const t of [lum, ...reduce, ...adapted]) t.dispose();
      for (const m of [lumMat, reduceMat, adaptMat]) m.dispose();
    },
  };
}
