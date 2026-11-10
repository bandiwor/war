import type * as THREE from 'three';
import type { RenderView } from '../../../application/scenes/sandbox';
import type { StreetLayout } from '../../../domain/world/street-layout';
import type { MaterialLibrary } from '../textures/material-library';
import type { Flashlight } from './flashlight';
import type { SceneRig } from './scene-rig';
import { animateStreet, buildStreetScene, type StreetScene } from './street-scene';

/** The fixed stage-1 street (and the range): no clock, no weather. */
export class StreetRig implements SceneRig {
  readonly wetness = 0;
  private readonly street: StreetScene;

  constructor(layout: StreetLayout, materials: MaterialLibrary, seed: number) {
    this.street = buildStreetScene(layout, materials, seed);
  }

  get scene(): THREE.Scene {
    return this.street.scene;
  }

  update(
    _view: RenderView,
    _camera: THREE.PerspectiveCamera,
    time: number,
    _flashlight: Flashlight,
  ): void {
    animateStreet(this.street, time);
  }

  dispose(): void {
    this.street.dispose();
  }
}
