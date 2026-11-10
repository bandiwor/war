import * as THREE from 'three';
import type { RenderView } from '../../../application/scenes/sandbox';
import { windVector } from '../../../domain/world/environment';
import { FRAME_BUDGETS } from '../budgets';
import type { QualitySettings } from '../quality';
import type { Flashlight } from '../scene/flashlight';
import { PropLibrary } from '../scene/prop-library';
import type { SceneRig } from '../scene/scene-rig';
import type { MaterialLibrary } from '../textures/material-library';
import { ChunkRenderer } from './chunk-renderer';
import type { ChunkMeshSource } from './chunk-source';
import { LightPool } from './light-pool';
import { Rain } from './rain';
import { WorldLighting } from './world-lighting';
import { ChunkOverlay } from './chunk-overlay';

export interface WorldRigOptions {
  readonly materials: MaterialLibrary;
  readonly quality: QualitySettings;
  readonly seed: number;
  readonly source: ChunkMeshSource;
  readonly clock: () => number;
  /** Where the camera starts: chunks around it are loaded before the first frame. */
  readonly start: readonly [number, number];
}

/**
 * The streamed open world: chunks around the camera, a pooled set of real
 * lights, the sky, fog and rain from the simulation's clock and weather.
 */
export class WorldRig implements SceneRig {
  readonly scene = new THREE.Scene();
  readonly chunks: ChunkRenderer;
  readonly pool: LightPool;
  readonly lighting: WorldLighting;
  readonly rain: Rain;
  wetness = 0;
  private overlay: ChunkOverlay | null = null;
  private readonly props: PropLibrary;
  private readonly wind = { x: 0, z: 0 };
  private readonly flash = {
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    on: false,
  };

  private constructor(o: WorldRigOptions) {
    this.props = new PropLibrary(o.materials, o.seed);
    this.lighting = new WorldLighting(this.scene);
    this.chunks = new ChunkRenderer(
      o.source,
      o.materials,
      this.props,
      {
        radius: o.quality.viewChunks,
        detailRadius: o.quality.detailChunks,
        budgetMs: FRAME_BUDGETS.streaming,
        maxInFlight: 3,
      },
      o.clock,
    );
    this.pool = new LightPool(o.quality.lightPool);
    this.rain = new Rain(o.quality.rainDrops, o.seed);
    this.scene.add(this.chunks.group, this.pool.group, this.rain.mesh);
  }

  static async create(o: WorldRigOptions): Promise<WorldRig> {
    const rig = new WorldRig(o);
    await rig.chunks.preload(o.start[0], o.start[1], o.quality.viewChunks);
    return rig;
  }

  /** Every material the world can show, for shader warm-up (zones not yet streamed in included). */
  warmupObjects(
    materials: MaterialLibrary,
    ids: readonly Parameters<MaterialLibrary['get']>[0][],
  ): THREE.Object3D {
    const group = new THREE.Group();
    const box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    for (const id of ids) group.add(new THREE.Mesh(box, materials.get(id)));
    for (const kind of ['barrel', 'crate', 'lampPost', 'fungus', 'tree', 'rock'] as const) {
      for (const part of this.props.parts(kind, kind === 'tree' ? 'bark' : 'concrete')) {
        const m = new THREE.InstancedMesh(part.geometry, part.material, 1);
        group.add(m);
      }
    }
    group.position.set(0, -1000, 0);
    return group;
  }

  update(
    view: RenderView,
    camera: THREE.PerspectiveCamera,
    time: number,
    flashlight: Flashlight,
  ): void {
    const env = view.env;
    this.lighting.update(env, camera.position);
    this.chunks.update(camera.position.x, camera.position.z);
    this.pool.update(this.chunks.lights, camera.position, time);
    windVector(env.weather, this.wind);
    this.flash.position.copy(flashlight.light.position);
    this.flash.direction.copy(flashlight.direction);
    this.flash.on = flashlight.light.visible;
    this.rain.update(
      env.weather.rain,
      time,
      camera.position,
      this.wind.x,
      this.wind.z,
      this.lighting.light,
      this.flash,
    );
    // Droplets build up on the lens in rain; looking down shelters it a little.
    this.wetness = env.weather.rain * (0.75 + 0.25 * Math.max(0, Math.sin(view.pitch + 0.3)));
  }

  /** Debug: chunk squares on the ground (green = solid in the simulation, amber = drawn only). */
  setChunkOverlay(enabled: boolean): void {
    if (enabled && this.overlay === null) {
      this.overlay = new ChunkOverlay();
      this.scene.add(this.overlay.lines);
    } else if (!enabled && this.overlay !== null) {
      this.scene.remove(this.overlay.lines);
      this.overlay.dispose();
      this.overlay = null;
    }
  }

  refreshChunkOverlay(solid: (cx: number, cz: number) => boolean): void {
    this.overlay?.rebuild(this.chunks.loadedKeys(), solid);
  }

  dispose(): void {
    this.setChunkOverlay(false);
    this.chunks.dispose();
    this.pool.dispose();
    this.rain.dispose();
    this.lighting.dispose();
    this.props.dispose();
  }
}
