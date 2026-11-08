import { postMaterial, uniform, type Tex } from '../../gl/fullscreen';
import * as THREE from 'three';
import type { EffectPass, PassContext } from '../types';

/**
 * Camera motion blur by depth reprojection: reconstruct each pixel's world
 * position, project it with last frame's view-projection, blur along the
 * screen-space delta. Covers the dominant bodycam case (fast turns).
 */
export function createMotionBlur(ctx: PassContext): EffectPass<'motionBlur'> {
  const samples = ctx.quality.motionBlurSamples;
  const u = {
    tInput: uniform<Tex>(null),
    tDepth: uniform<Tex>(null),
    uInvViewProj: uniform(new THREE.Matrix4()),
    uPrevViewProj: uniform(new THREE.Matrix4()),
    uShutter: uniform(0.5),
    uMaxPixels: uniform(40),
    uResolution: uniform(new THREE.Vector2(1, 1)),
  };
  const mat = postMaterial(
    /* glsl */ `
    precision highp float;
    #define SAMPLES ${String(samples)}
    uniform sampler2D tInput; uniform sampler2D tDepth;
    uniform mat4 uInvViewProj; uniform mat4 uPrevViewProj;
    uniform float uShutter, uMaxPixels; uniform vec2 uResolution;
    in vec2 vUv; out vec4 outColor;
    void main() {
      float d = texture(tDepth, vUv).r;
      vec4 world = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      world /= world.w;
      vec4 prev = uPrevViewProj * world;
      vec2 prevUv = prev.xy / prev.w * 0.5 + 0.5;
      vec2 vel = (vUv - prevUv) * uShutter;
      float lenPx = length(vel * uResolution);
      if (lenPx > uMaxPixels) vel *= uMaxPixels / lenPx;
      if (lenPx < 0.5) { outColor = texture(tInput, vUv); return; }
      vec3 acc = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        float t = float(i) / float(SAMPLES - 1) - 0.5;
        acc += texture(tInput, vUv + vel * t).rgb;
      }
      outColor = vec4(acc / float(SAMPLES), 1.0);
    }`,
    u,
  );
  return {
    id: 'motionBlur',
    kind: 'chain',
    reads: [],
    format: 'hdr',
    render(renderer, io, params, frame) {
      u.tInput.value = io.input;
      u.tDepth.value = frame.depth;
      u.uInvViewProj.value.copy(frame.invViewProj);
      u.uPrevViewProj.value.copy(frame.prevViewProj);
      u.uShutter.value = params.shutter;
      u.uMaxPixels.value = params.maxPixels;
      u.uResolution.value.set(frame.width, frame.height);
      ctx.quad.render(renderer, mat, io.target);
    },
    dispose() {
      mat.dispose();
    },
  };
}
