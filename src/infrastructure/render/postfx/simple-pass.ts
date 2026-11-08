import type * as THREE from 'three';
import type { EffectParams } from '../../../domain/bodycam/effects';
import { postMaterial, uniform, type Tex } from '../gl/fullscreen';
import { GLSL_COMMON } from '../gl/shader-lib';
import type { EffectPass, FrameInfo, PassContext, PassIO, PostEffectId } from './types';

/** Uniforms every simple LDR pass gets for free. */
export interface BaseUniforms {
  readonly tInput: THREE.Uniform<Tex>;
  readonly uResolution: THREE.Uniform<THREE.Vector2>;
  readonly uTime: THREE.Uniform<number>;
  readonly uFrame: THREE.Uniform<number>;
}

export const BASE_UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D tInput; uniform vec2 uResolution; uniform float uTime; uniform float uFrame;
in vec2 vUv; out vec4 outColor;
`;

/**
 * Builds a single-shader chain pass. `body` is the fragment shader after the
 * shared header; `update` copies params/frame into the pass's own uniforms.
 */
export function simpleChainPass<Id extends PostEffectId, U extends Record<string, THREE.Uniform>>(
  id: Id,
  ctx: PassContext,
  extra: U,
  body: string,
  update: (u: U, params: EffectParams<Id>, frame: FrameInfo, io: PassIO) => void,
  reads: readonly string[] = [],
): EffectPass<Id> {
  const base = {
    tInput: uniform<Tex>(null),
    uResolution: uniform<THREE.Vector2>(ctx.resolution),
    uTime: uniform(0),
    uFrame: uniform(0),
  };
  const mat = postMaterial(GLSL_COMMON + BASE_UNIFORMS_GLSL + body, { ...base, ...extra });
  return {
    id,
    kind: 'chain',
    reads,
    format: 'ldr',
    render(renderer, io, params, frame) {
      base.tInput.value = io.input;
      base.uTime.value = frame.time;
      base.uFrame.value = frame.frozen ? 0 : frame.frame;
      update(extra, params, frame, io);
      ctx.quad.render(renderer, mat, io.target);
    },
    dispose() {
      mat.dispose();
    },
  };
}
