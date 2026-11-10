import * as THREE from 'three';
import {
  chunkCoord,
  chunkKey,
  chunkRing,
  chunksAround,
  chunkX,
  chunkZ,
  type ChunkKey,
} from '../../../domain/world/chunks';
import { inWorld } from '../../../domain/world/world-map';
import { Ring } from '../ring';
import type { PropLibrary } from '../scene/prop-library';
import type { MaterialLibrary } from '../textures/material-library';
import type { ChunkMesh } from './chunk-mesher';
import type { ChunkMeshSource } from './chunk-source';
import type { PoolCandidate } from './light-pool';

/**
 * Render-side chunk streaming around the camera. Generation and meshing run
 * in workers; the main thread only wraps arrays in GPU buffers, and does so
 * inside a per-frame time budget (the frame budgets in budgets.ts):
 *
 *  - requests: nearest missing chunks first, a few in flight at a time;
 *  - attach: arrived chunks are added while the next one is expected to fit
 *    in the frame's streaming budget (a running average of attach cost), at
 *    least one per frame so streaming never starves;
 *  - detach: chunks beyond `radius + 1` rings are disposed, one per frame;
 *  - LOD: small props are drawn only within `detailRadius` rings.
 */
export interface ChunkRenderSettings {
  readonly radius: number;
  readonly detailRadius: number;
  /** Main-thread milliseconds per frame for attaching/detaching chunks. */
  readonly budgetMs: number;
  readonly maxInFlight: number;
}

interface LoadedChunk {
  readonly key: ChunkKey;
  readonly cx: number;
  readonly cz: number;
  readonly root: THREE.Group;
  readonly detail: THREE.Group;
  readonly geometries: THREE.BufferGeometry[];
  readonly lights: readonly PoolCandidate[];
}

export class ChunkRenderer {
  readonly group = new THREE.Group();
  /** Lights of every attached chunk, for the light pool. Rebuilt on attach/detach only. */
  lights: PoolCandidate[] = [];
  /** Main-thread streaming cost per frame (ms), for the budget checks. */
  readonly frameMs = new Ring();
  maxFrameMs = 0;
  /** Running average cost of one attach (ms): decides whether another fits this frame. */
  attachMs = 0.25;
  attachedTotal = 0;
  detachedTotal = 0;

  private readonly chunks = new Map<ChunkKey, LoadedChunk>();
  private readonly requested = new Set<ChunkKey>();
  private readonly arrived: ChunkMesh[] = [];
  private readonly wanted: ChunkKey[] = [];
  private readonly emissiveMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  private cx = Number.NaN;
  private cz = Number.NaN;
  private disposed = false;

  constructor(
    private readonly source: ChunkMeshSource,
    private readonly materials: MaterialLibrary,
    private readonly props: PropLibrary,
    private readonly settings: ChunkRenderSettings,
    private readonly clock: () => number,
  ) {
    this.group.name = 'world-chunks';
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  get pendingCount(): number {
    return this.requested.size + this.arrived.length;
  }

  isLoaded(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  loadedKeys(): IterableIterator<ChunkKey> {
    return this.chunks.keys();
  }

  /** Loads and attaches everything within `radius` (boot: before shader warm-up). */
  async preload(x: number, z: number, radius: number): Promise<void> {
    const keys = chunksAround(chunkCoord(x), chunkCoord(z), radius, [], inWorld);
    const meshes = await Promise.all(
      keys.filter((k) => !this.chunks.has(k)).map((k) => this.source.request(chunkX(k), chunkZ(k))),
    );
    for (const m of meshes) this.attach(m);
  }

  /** Call every frame with the camera position. */
  update(x: number, z: number): void {
    const t0 = this.clock();
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    if (cx !== this.cx || cz !== this.cz) {
      this.cx = cx;
      this.cz = cz;
      chunksAround(cx, cz, this.settings.radius, this.wanted, inWorld);
      for (const c of this.chunks.values()) {
        c.detail.visible = chunkRing(c.cx, c.cz, cx, cz) <= this.settings.detailRadius;
      }
    }
    this.request();
    const attached = this.attachArrived(t0);
    // Disposing frees GPU buffers: only when this frame has room left (it can always wait).
    if (attached === 0 || this.clock() - t0 + this.attachMs <= this.settings.budgetMs)
      this.detachFar();
    const ms = this.clock() - t0;
    this.frameMs.push(ms);
    if (ms > this.maxFrameMs) this.maxFrameMs = ms;
  }

  private request(): void {
    for (const key of this.wanted) {
      if (this.requested.size >= this.settings.maxInFlight) return;
      if (this.chunks.has(key) || this.requested.has(key)) continue;
      this.requested.add(key);
      this.source.request(chunkX(key), chunkZ(key)).then(
        (mesh) => {
          this.requested.delete(key);
          if (!this.disposed) this.arrived.push(mesh);
        },
        () => {
          this.requested.delete(key);
        },
      );
    }
  }

  private attachArrived(t0: number): number {
    let attached = 0;
    while (this.arrived.length > 0) {
      if (attached > 0 && this.clock() - t0 + this.attachMs > this.settings.budgetMs)
        return attached;
      // Nearest first: the player walks into the closest gap.
      let best = 0;
      let bestRing = Infinity;
      for (let i = 0; i < this.arrived.length; i++) {
        const m = this.arrived[i];
        if (m === undefined) continue;
        const r = chunkRing(m.cx, m.cz, this.cx, this.cz);
        if (r < bestRing) {
          bestRing = r;
          best = i;
        }
      }
      const [mesh] = this.arrived.splice(best, 1);
      if (mesh === undefined) return attached;
      // Arrived too late: the camera moved on.
      if (bestRing > this.settings.radius || this.chunks.has(chunkKey(mesh.cx, mesh.cz))) continue;
      const a0 = this.clock();
      this.attach(mesh);
      this.attachMs += (this.clock() - a0 - this.attachMs) * 0.2;
      attached++;
    }
    return attached;
  }

  private detachFar(): void {
    for (const c of this.chunks.values()) {
      if (chunkRing(c.cx, c.cz, this.cx, this.cz) > this.settings.radius + 1) {
        this.detach(c);
        return; // one per frame
      }
    }
  }

  private attach(m: ChunkMesh): void {
    const key = chunkKey(m.cx, m.cz);
    const root = new THREE.Group();
    root.name = `chunk:${String(m.cx)},${String(m.cz)}`;
    root.matrixAutoUpdate = false;
    const detail = new THREE.Group();
    detail.matrixAutoUpdate = false;
    root.add(detail);
    const sphere = new THREE.Sphere(
      new THREE.Vector3(m.bounds[0], m.bounds[1], m.bounds[2]),
      m.bounds[3],
    );
    const geometries: THREE.BufferGeometry[] = [];

    for (const a of m.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
      g.setIndex(new THREE.BufferAttribute(a.index, 1));
      g.boundingSphere = sphere.clone();
      geometries.push(g);
      const mesh = new THREE.Mesh(g, this.materials.get(a.material));
      mesh.name = `static:${a.material}`;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    for (const inst of m.instances) {
      const count = inst.matrices.length / 16;
      for (const part of this.props.parts(inst.kind, inst.material)) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
        mesh.instanceMatrix = new THREE.InstancedBufferAttribute(inst.matrices, 16);
        mesh.boundingSphere = sphere.clone();
        mesh.name = `props:${inst.kind}:${inst.material}`;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = part.castShadow;
        mesh.receiveShadow = true;
        (inst.detail ? detail : root).add(mesh);
      }
    }
    if (m.emissive !== null) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.emissive.position, 3));
      g.setAttribute('color', new THREE.BufferAttribute(m.emissive.color, 3));
      g.setIndex(new THREE.BufferAttribute(m.emissive.index, 1));
      g.boundingSphere = sphere.clone();
      geometries.push(g);
      const mesh = new THREE.Mesh(g, this.emissiveMaterial);
      mesh.name = 'emissive';
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
    detail.visible = chunkRing(m.cx, m.cz, this.cx, this.cz) <= this.settings.detailRadius;
    root.updateMatrixWorld(true);
    this.group.add(root);
    const lights = m.lights.map((piece, i) => ({
      piece,
      phase: (((m.cx * 73856093) ^ (m.cz * 19349663) ^ (i * 83492791)) % 1000) * 0.0161,
    }));
    this.chunks.set(key, { key, cx: m.cx, cz: m.cz, root, detail, geometries, lights });
    this.rebuildLights();
    this.attachedTotal++;
  }

  private detach(c: LoadedChunk): void {
    this.group.remove(c.root);
    for (const g of c.geometries) g.dispose();
    c.root.traverse((o) => {
      // Instance matrices live on the InstancedMesh; geometry and materials are shared.
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.chunks.delete(c.key);
    this.rebuildLights();
    this.detachedTotal++;
  }

  private rebuildLights(): void {
    const out: PoolCandidate[] = [];
    for (const c of this.chunks.values()) for (const l of c.lights) out.push(l);
    this.lights = out;
  }

  dispose(): void {
    this.disposed = true;
    for (const c of [...this.chunks.values()]) this.detach(c);
    this.emissiveMaterial.dispose();
    this.source.dispose();
  }
}
