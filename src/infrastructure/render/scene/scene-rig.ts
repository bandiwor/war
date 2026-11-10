import type * as THREE from 'three';
import type { RenderView } from '../../../application/scenes/sandbox';
import type { Flashlight } from './flashlight';

/**
 * What the presenter draws: the hand-built street/range, or the streamed
 * open world. Each owns its Three.js scene and animates it per frame.
 */
export interface SceneRig {
  readonly scene: THREE.Scene;
  update(
    view: RenderView,
    camera: THREE.PerspectiveCamera,
    time: number,
    flashlight: Flashlight,
  ): void;
  /** Rain on the lens, 0..1 (wets the bodycam's droplets effect). */
  readonly wetness: number;
  dispose(): void;
}
