import type { Seed } from '../../domain/core/brand';
import { generateChunk } from '../../domain/world/chunk-gen';
import {
  chunkCoord,
  chunkKey,
  chunkRing,
  chunksAround,
  chunkX,
  chunkZ,
  type ChunkKey,
} from '../../domain/world/chunks';
import { inWorld } from '../../domain/world/world-map';
import type { ColliderId, PhysicsPort } from '../physics/ports';
import { buildStaticColliders } from '../physics/static-world';

/**
 * Streams static colliders around the player, deterministically.
 *
 * Streaming is driven by the simulated position at a given tick, never by
 * frame timing, so a replay loads and unloads exactly the same chunks on the
 * same ticks; the physics snapshot (and so the state hash) covers the result.
 *
 * - The player's chunk and its 8 neighbours are required: loaded at once, in
 *   the same tick, so a teleport never drops the player through the floor.
 * - The ring beyond is prefetched, `loadsPerTick` chunks per tick, nearest first.
 * - Chunks farther than `keepRadius` rings are unloaded, `unloadsPerTick` per tick
 *   (the gap between radii is hysteresis: walking along a border does not thrash).
 */
export const COLLIDER_STREAMING = {
  requiredRadius: 1,
  prefetchRadius: 2,
  keepRadius: 3,
  loadsPerTick: 1,
  unloadsPerTick: 2,
} as const;

export class ChunkColliders {
  private readonly loaded = new Map<ChunkKey, readonly ColliderId[]>();
  private readonly wanted: ChunkKey[] = [];
  private readonly drop: ChunkKey[] = [];
  private cx = Number.NaN;
  private cz = Number.NaN;
  /** False once everything wanted is loaded and nothing is left to unload. */
  private busy = true;
  loadsTotal = 0;
  unloadsTotal = 0;

  constructor(
    private readonly seed: Seed,
    private readonly physics: PhysicsPort,
  ) {}

  get loadedCount(): number {
    return this.loaded.size;
  }

  isLoaded(cx: number, cz: number): boolean {
    return this.loaded.has(chunkKey(cx, cz));
  }

  /** Keys of loaded chunks, in load order (debug overlay). */
  loadedKeys(): IterableIterator<ChunkKey> {
    return this.loaded.keys();
  }

  /** Loads everything within the prefetch radius now (scene creation). */
  loadAllAround(x: number, z: number): void {
    this.recenter(x, z);
    for (const key of this.wanted) this.load(key);
    this.busy = false;
  }

  /** Call once per tick with the player's feet. Allocation-free when there is nothing to do. */
  update(x: number, z: number): void {
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    if (cx !== this.cx || cz !== this.cz) this.recenter(x, z);
    if (!this.busy) return;

    let loads = 0;
    let pending = false;
    for (const key of this.wanted) {
      if (this.loaded.has(key)) continue;
      const required =
        chunkRing(chunkX(key), chunkZ(key), cx, cz) <= COLLIDER_STREAMING.requiredRadius;
      if (required || loads < COLLIDER_STREAMING.loadsPerTick) {
        this.load(key);
        if (!required) loads++;
      } else {
        pending = true;
      }
    }

    this.drop.length = 0;
    for (const key of this.loaded.keys()) {
      if (chunkRing(chunkX(key), chunkZ(key), cx, cz) > COLLIDER_STREAMING.keepRadius) {
        this.drop.push(key);
      }
    }
    for (let i = 0; i < this.drop.length; i++) {
      const key = this.drop[i];
      if (key === undefined) continue;
      if (i < COLLIDER_STREAMING.unloadsPerTick) this.unload(key);
      else pending = true;
    }
    this.busy = pending;
  }

  private recenter(x: number, z: number): void {
    this.cx = chunkCoord(x);
    this.cz = chunkCoord(z);
    chunksAround(this.cx, this.cz, COLLIDER_STREAMING.prefetchRadius, this.wanted, inWorld);
    this.busy = true;
  }

  private load(key: ChunkKey): void {
    const content = generateChunk(this.seed, chunkX(key), chunkZ(key));
    this.loaded.set(key, buildStaticColliders(content, this.physics));
    this.loadsTotal++;
  }

  private unload(key: ChunkKey): void {
    const ids = this.loaded.get(key);
    if (ids === undefined) return;
    for (const id of ids) this.physics.removeCollider(id);
    this.loaded.delete(key);
    this.unloadsTotal++;
  }
}
