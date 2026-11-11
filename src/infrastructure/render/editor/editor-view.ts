import * as THREE from 'three';
import type { LevelIssue } from '../../../domain/level/checks';
import { levelToLayout } from '../../../domain/level/compile';
import { levelBounds, type Level } from '../../../domain/level/level';
import { MOBS } from '../../../domain/mobs/registry';
import type { EntityRef } from '../../../domain/level/editor';
import { anchorOf, listOf } from '../../../domain/level/editor';
import { buildMobModel, disposeMobModel, poseMob, type MobModel } from '../mobs/mob-models';
import { buildStreetScene, animateStreet, type StreetScene } from '../scene/street-scene';
import type { MaterialLibrary } from '../textures/material-library';

/**
 * The editor's viewport (stage 9): the level built by the game's own scene
 * builder with the game's baked materials and lights, the placed mobs as
 * their real models, and overlays for what the game does not draw (spawn,
 * patrol paths, spawn zones, story objects, check issues, the selection and
 * the brush). An orbit camera; "work" light for building, "night" to see
 * the level lit only by its own lamps (the bodycam look is "play from here").
 */
export type LightMode = 'work' | 'night';

const RACE_COLORS = {
  zombie: 0x7fbf6a,
  robot: 0xff4030,
  plant: 0x40e0b0,
  animal: 0xd0a060,
} as const;

export class EditorView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  /** Orbit camera: target on the ground, yaw/pitch, distance. */
  readonly orbit = { x: 0, z: 0, yaw: 0.6, pitch: 0.9, dist: 60 };
  lightMode: LightMode = 'work';
  private street: StreetScene | null = null;
  private layoutKey = '';
  private readonly overlays = new THREE.Group();
  private readonly work = new THREE.Group();
  private readonly mobModels: MobModel[] = [];
  private readonly ray = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  readonly brush = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false, transparent: true }),
  );
  private time = 0;
  /** Counters for tests. */
  readonly stats = { rebuilds: 0, markers: 0, mobs: 0 };

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly materials: MaterialLibrary,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(30, 60, 20);
    this.work.add(new THREE.HemisphereLight(0xc8d4e0, 0x30302a, 1.6), sun);
    this.brush.renderOrder = 30;
    this.brush.visible = false;
  }

  get scene(): THREE.Scene | null {
    return this.street?.scene ?? null;
  }

  /** Rebuilds what changed: the static scene when the layout changed, overlays always. */
  setLevel(level: Level, selection: EntityRef | null, issues: readonly LevelIssue[]): void {
    const layout = levelToLayout(level);
    const key = JSON.stringify([layout.boxes, layout.props, layout.lights, level.seed]);
    if (key !== this.layoutKey || this.street === null) {
      this.street?.dispose();
      this.street = buildStreetScene(layout, this.materials, level.seed);
      this.street.scene.fog = null;
      this.street.scene.add(this.overlays, this.work);
      this.layoutKey = key;
      this.stats.rebuilds++;
    }
    this.buildOverlays(level, selection, issues);
  }

  private buildOverlays(
    level: Level,
    selection: EntityRef | null,
    issues: readonly LevelIssue[],
  ): void {
    for (const c of [...this.overlays.children]) {
      this.overlays.remove(c);
      c.traverse((o) => {
        // Mob models share their geometry per kind: only the overlay meshes own theirs.
        if (o.userData['owned'] !== true) return;
        const g: unknown = Reflect.get(o, 'geometry');
        if (g instanceof THREE.BufferGeometry) g.dispose();
      });
    }
    for (const m of this.mobModels) disposeMobModel(m);
    this.mobModels.length = 0;
    const line = (
      pts: readonly (readonly [number, number])[],
      color: number,
      y = 0.25,
      loop = false,
    ): void => {
      const g = new THREE.BufferGeometry().setFromPoints(
        pts.map(([x, z]) => new THREE.Vector3(x, y, z)),
      );
      const mat = new THREE.LineBasicMaterial({ color, depthTest: false, toneMapped: false });
      const l = loop ? new THREE.LineLoop(g, mat) : new THREE.Line(g, mat);
      l.renderOrder = 20;
      l.userData['owned'] = true;
      this.overlays.add(l);
    };
    const marker = (x: number, z: number, color: number, h = 1.2, r = 0.35): void => {
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(r, h, 4).rotateX(Math.PI).translate(0, h / 2 + 0.1, 0),
        new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      );
      m.position.set(x, 0, z);
      m.userData['owned'] = true;
      this.overlays.add(m);
    };
    let markers = 0;
    // Bounds and spawn.
    const [x0, z0, x1, z1] = levelBounds(level);
    line(
      [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ],
      0x5a6a78,
      0.05,
      true,
    );
    const [sx, sz] = level.spawn.at;
    marker(sx, sz, 0x40a0ff, 1.8, 0.45);
    line(
      [
        [sx, sz],
        [sx - Math.sin(level.spawn.yaw) * 2.5, sz - Math.cos(level.spawn.yaw) * 2.5],
      ],
      0x40a0ff,
      0.3,
    );
    markers++;
    // Mobs: their real models, posed idle.
    for (const m of level.mobs) {
      const model = buildMobModel(m.mob);
      model.root.position.set(m.at[0], 0, m.at[1]);
      model.root.rotation.y = m.yaw;
      poseMob(model, { anim: 'idle', time: 0, phase: 0, alert: 0 });
      this.overlays.add(model.root);
      this.mobModels.push(model);
      marker(m.at[0], m.at[1], RACE_COLORS[MOBS[m.mob].race], 0.4, 0.2);
      markers++;
    }
    for (const p of level.patrols) {
      line(p.points, 0x50c0ff, 0.3, p.loop);
      for (const [px, pz] of p.points) marker(px, pz, 0x50c0ff, 0.3, 0.15);
      markers++;
    }
    for (const z of level.spawnZones) {
      line(
        [
          [z.min[0], z.min[1]],
          [z.max[0], z.min[1]],
          [z.max[0], z.max[1]],
          [z.min[0], z.max[1]],
        ],
        0xd0a060,
        0.2,
        true,
      );
      markers++;
    }
    for (const l of level.lights) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(...l.color), toneMapped: false }),
      );
      s.position.set(l.at[0], l.at[1], l.at[2]);
      s.userData['owned'] = true;
      this.overlays.add(s);
      markers++;
    }
    for (const i of level.story?.interactables ?? []) {
      const d = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.4),
        new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }),
      );
      d.position.set(i.at[0], 1, i.at[2]);
      d.userData['owned'] = true;
      this.overlays.add(d);
      const ring: [number, number][] = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        ring.push([i.at[0] + Math.sin(a) * i.radius, i.at[2] + Math.cos(a) * i.radius]);
      }
      line(ring, 0xffb347, 0.08, true);
      markers++;
    }
    for (const issue of issues) {
      if (issue.at === null) continue;
      marker(issue.at[0], issue.at[1], issue.severity === 'error' ? 0xff2020 : 0xffd020, 3, 0.3);
    }
    if (selection !== null) {
      const e =
        selection.collection === 'interactables' && level.story === null
          ? undefined
          : listOf(level, selection.collection).find((x) => x.id === selection.id);
      if (e !== undefined) {
        const [ax, az] = anchorOf(selection.collection, e);
        const ring: [number, number][] = [];
        for (let k = 0; k < 32; k++) {
          const a = (k / 32) * Math.PI * 2;
          ring.push([ax + Math.sin(a) * 1.2, az + Math.cos(a) * 1.2]);
        }
        line(ring, 0xffffff, 0.12, true);
      }
    }
    this.overlays.add(this.brush);
    this.stats.markers = markers;
    this.stats.mobs = this.mobModels.length;
  }

  /** World (x, z) on the ground under a canvas point, or null. */
  groundAt(clientX: number, clientY: number): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, hit) === null ? null : [hit.x, hit.z];
  }

  setBrush(x: number, z: number, radius: number, visible: boolean): void {
    this.brush.visible = visible;
    this.brush.position.set(x, 0.1, z);
    this.brush.scale.setScalar(Math.max(0.2, radius));
  }

  render(dt: number): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
    const o = this.orbit;
    o.pitch = Math.max(0.15, Math.min(1.5, o.pitch));
    o.dist = Math.max(4, Math.min(220, o.dist));
    this.camera.position.set(
      o.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
      Math.sin(o.pitch) * o.dist,
      o.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist,
    );
    this.camera.lookAt(o.x, 0, o.z);
    this.time += dt;
    if (this.street === null) return;
    this.work.visible = this.lightMode === 'work';
    animateStreet(this.street, this.time);
    this.renderer.render(this.street.scene, this.camera);
  }

  dispose(): void {
    this.street?.dispose();
    for (const m of this.mobModels) disposeMobModel(m);
    this.renderer.dispose();
  }
}
