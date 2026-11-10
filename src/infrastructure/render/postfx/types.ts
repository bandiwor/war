import type * as THREE from 'three';
import type { EffectId, EffectParams } from '../../../domain/bodycam/effects';
import type { FullscreenQuad } from '../gl/fullscreen';
import type { ResourceFormat } from '../graph/render-graph';
import type { QualitySettings } from '../quality';

/** Exposure used when auto exposure is disabled (shared by every pass that applies exposure). */
export const MANUAL_EXPOSURE = 1.6;

/** Effects implemented as post passes (camera-stage effects live in the camera rig). */
export type PostEffectId = Exclude<EffectId, 'cameraShake'>;

/** OSD data, refreshed every frame by the presenter. */
export interface OsdState {
  simTime: number;
  battery: number;
  flashlightOn: boolean;
  signalLost: boolean;
  /** Recording live footage, or playing back a replay. */
  mode: 'rec' | 'play';
  /** In-world time of day (seconds since midnight) when the scene has a clock; else the incident start. */
  clock: number | null;
}

/** Per-frame values every pass may read. One instance, mutated each frame. */
export interface FrameInfo {
  /** Render clock in seconds (frozen in visual tests). */
  time: number;
  /** Render delta in seconds (huge in visual tests, so adaptation settles instantly). */
  dt: number;
  frame: number;
  /** Internal (scaled) render size. */
  width: number;
  height: number;
  /** Angular camera velocity in rad/s (rolling shutter, compression). */
  yawVelocity: number;
  pitchVelocity: number;
  /** 0..1 overall motion amount. */
  motion: number;
  /** Signal-loss envelope 0..1 and per-event seed. */
  signalLoss: number;
  signalSeed: number;
  fovY: number;
  aspect: number;
  depth: THREE.DepthTexture;
  invViewProj: THREE.Matrix4;
  prevViewProj: THREE.Matrix4;
  osd: OsdState;
  /** Visual-test mode: no time-based variation. */
  frozen: boolean;
}

export interface PassIO {
  readonly input: THREE.Texture | null;
  readonly aux: Readonly<Record<string, THREE.Texture | null>>;
  /** null = draw to the screen (canvas). */
  readonly target: THREE.WebGLRenderTarget | null;
}

export interface EffectPass<Id extends PostEffectId> {
  readonly id: Id;
  readonly kind: 'chain' | 'aux';
  /** Aux resources this pass reads ('exposure', 'bloom'). */
  readonly reads: readonly string[];
  /** Resource name for aux producers; chain passes get names from the pipeline. */
  readonly produces?: string;
  readonly format: ResourceFormat;
  render(
    renderer: THREE.WebGLRenderer,
    io: PassIO,
    params: EffectParams<Id>,
    frame: FrameInfo,
  ): void;
  /** Own output texture ('own' format passes). */
  output?(): THREE.Texture | null;
  resize?(width: number, height: number): void;
  dispose(): void;
}

export interface PassContext {
  readonly quad: FullscreenQuad;
  readonly quality: QualitySettings;
  /** Internal render resolution, shared and updated in place on resize. */
  readonly resolution: THREE.Vector2;
}

export type EffectFactories = {
  readonly [Id in PostEffectId]: (ctx: PassContext) => EffectPass<Id>;
};
