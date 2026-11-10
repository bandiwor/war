import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  chunkCoord,
  chunkKey,
  chunkRing,
  chunksAround,
  chunkX,
  chunkZ,
  type ChunkKey,
} from './chunks';

describe('chunk grid', () => {
  it('packs and unpacks chunk coordinates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -30000, max: 30000 }),
        fc.integer({ min: -30000, max: 30000 }),
        (x, z) => {
          const k = chunkKey(x, z);
          expect(chunkX(k)).toBe(x);
          expect(chunkZ(k)).toBe(z);
        },
      ),
    );
  });

  it('maps world coordinates to the chunk that contains them', () => {
    expect(chunkCoord(0)).toBe(0);
    expect(chunkCoord(CHUNK_SIZE - 1e-9)).toBe(0);
    expect(chunkCoord(CHUNK_SIZE)).toBe(1);
    expect(chunkCoord(-1e-9)).toBe(-1);
  });

  it('lists rings nearest first, each chunk once, in a fixed order', () => {
    const out: ChunkKey[] = [];
    chunksAround(3, -2, 2, out);
    expect(out).toHaveLength(25);
    expect(new Set(out).size).toBe(25);
    expect(out[0]).toBe(chunkKey(3, -2));
    const rings = out.map((k) => chunkRing(chunkX(k), chunkZ(k), 3, -2));
    expect(rings).toEqual([...rings].sort((a, b) => a - b));
    expect(chunksAround(3, -2, 2, [])).toEqual(out);
  });

  it('respects the bounds filter and reuses the output array', () => {
    const out: ChunkKey[] = [chunkKey(99, 99)];
    chunksAround(0, 0, 1, out, (x, z) => x >= 0 && z >= 0);
    expect(out.map((k) => [chunkX(k), chunkZ(k)])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });
});
