import type { Brand } from '../core/brand';

/**
 * The open world is cut into square chunks on the XZ plane. Simulation
 * (colliders) and rendering (meshes, lights) stream chunks independently,
 * each around its own centre and with its own radius; both derive a chunk's
 * content from (seed, cx, cz) alone, so they always agree.
 */
export const CHUNK_SIZE = 32;

/** Chunk coordinates packed into one integer: 16 bits per axis, offset to be non-negative. */
export type ChunkKey = Brand<number, 'ChunkKey'>;

const OFFSET = 0x8000;

export function chunkKey(cx: number, cz: number): ChunkKey {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand constructor: the packed value is the key
  return ((cx + OFFSET) * 0x10000 + (cz + OFFSET)) as ChunkKey;
}

export function chunkX(key: ChunkKey): number {
  return Math.floor(key / 0x10000) - OFFSET;
}

export function chunkZ(key: ChunkKey): number {
  return (key % 0x10000) - OFFSET;
}

/** Chunk coordinate containing world coordinate `v`. */
export function chunkCoord(v: number): number {
  return Math.floor(v / CHUNK_SIZE);
}

/** Chebyshev distance in chunks: the "ring" a chunk sits in around a centre chunk. */
export function chunkRing(ax: number, az: number, bx: number, bz: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(az - bz));
}

/**
 * Chunks within `radius` rings of (cx, cz), nearest ring first and in a fixed
 * order inside each ring, so loading order is deterministic. Writes into `out`.
 */
export function chunksAround(
  cx: number,
  cz: number,
  radius: number,
  out: ChunkKey[],
  inBounds: (cx: number, cz: number) => boolean = () => true,
): ChunkKey[] {
  out.length = 0;
  for (let r = 0; r <= radius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (inBounds(cx + dx, cz + dz)) out.push(chunkKey(cx + dx, cz + dz));
      }
    }
  }
  return out;
}
