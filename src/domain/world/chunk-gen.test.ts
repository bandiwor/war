import { describe, expect, it } from 'vitest';
import { seed } from '../core/brand';
import { CHUNK_SIZE } from './chunks';
import { CHUNK_LIMITS, generateChunk, type ChunkContent } from './chunk-gen';
import { HUBS, MAX_CHUNK, MIN_CHUNK, WORLD_SPAWN, chunkHub } from './world-map';

const S = seed(1337);
const all: ChunkContent[] = [];
for (let cz = MIN_CHUNK; cz <= MAX_CHUNK; cz++)
  for (let cx = MIN_CHUNK; cx <= MAX_CHUNK; cx++) all.push(generateChunk(S, cx, cz));

/** Ground pieces: the boxes whose top is at road/pavement level and that reach below it. */
const isGround = (b: ChunkContent['boxes'][number]): boolean =>
  b.yaw === 0 && b.center[1] < 0 && b.center[1] + b.size[1] / 2 <= 0.15 + 1e-9;

describe('chunk generation', () => {
  it('is a pure function of (seed, cx, cz)', () => {
    expect(generateChunk(S, 2, -3)).toEqual(generateChunk(S, 2, -3));
    expect(generateChunk(seed(7), 2, -3)).not.toEqual(generateChunk(S, 2, -3));
  });

  it('floors every chunk exactly once: ground cells tile the chunk with no overlap', () => {
    for (const c of all) {
      const covered = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
      const x0 = c.cx * CHUNK_SIZE;
      const z0 = c.cz * CHUNK_SIZE;
      for (const b of c.boxes.filter(isGround)) {
        for (let j = 0; j < b.size[2]; j++) {
          for (let i = 0; i < b.size[0]; i++) {
            const ci = Math.floor(b.center[0] - b.size[0] / 2 - x0 + i);
            const cj = Math.floor(b.center[2] - b.size[2] / 2 - z0 + j);
            covered[cj * CHUNK_SIZE + ci] = (covered[cj * CHUNK_SIZE + ci] ?? 0) + 1;
          }
        }
      }
      expect(
        covered.every((n) => n === 1),
        `chunk ${String(c.cx)},${String(c.cz)}`,
      ).toBe(true);
    }
  });

  it('keeps everything inside its own chunk, so chunks never overlap', () => {
    for (const c of all) {
      const x0 = c.cx * CHUNK_SIZE;
      const z0 = c.cz * CHUNK_SIZE;
      const inside = (x: number, z: number, r: number): boolean =>
        x - r >= x0 - 1e-6 &&
        x + r <= x0 + CHUNK_SIZE + 1e-6 &&
        z - r >= z0 - 1e-6 &&
        z + r <= z0 + CHUNK_SIZE + 1e-6;
      for (const b of c.boxes) {
        // Exact footprint corners of the (possibly rotated) box.
        const c0 = Math.cos(b.yaw);
        const s0 = Math.sin(b.yaw);
        for (const [u, v] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          const lx = (u * b.size[0]) / 2;
          const lz = (v * b.size[2]) / 2;
          const x = b.center[0] + lx * c0 + lz * s0;
          const z = b.center[2] - lx * s0 + lz * c0;
          expect(inside(x, z, 0), JSON.stringify(b)).toBe(true);
        }
      }
      for (const p of c.props) expect(inside(p.position[0], p.position[2], 0)).toBe(true);
      // Lamp lights hang at the end of a 1.6 m arm and may reach over the edge (render-only).
      for (const l of c.lights) expect(inside(l.position[0], l.position[2], -2)).toBe(true);
    }
  });

  it('respects the per-chunk caps', () => {
    for (const c of all) {
      expect(c.boxes.filter((b) => !isGround(b)).length).toBeLessThanOrEqual(CHUNK_LIMITS.boxes);
      expect(c.props.length).toBeLessThanOrEqual(CHUNK_LIMITS.props);
      expect(c.lights.length).toBeLessThanOrEqual(CHUNK_LIMITS.lights);
    }
  });

  it('builds nothing on the player start or the hub anchors', () => {
    const points = [WORLD_SPAWN.position, ...HUBS.map((h) => h.anchor)];
    for (const c of all) {
      for (const p of points) {
        for (const b of c.boxes.filter((x) => !isGround(x))) {
          const d = Math.max(
            Math.abs(b.center[0] - p[0]) - b.size[0] / 2,
            Math.abs(b.center[2] - p[2]) - b.size[2] / 2,
          );
          expect(d, `${JSON.stringify(b)} near ${JSON.stringify(p)}`).toBeGreaterThan(1);
        }
        for (const q of c.props) {
          expect(Math.hypot(q.position[0] - p[0], q.position[2] - p[2])).toBeGreaterThan(2);
        }
      }
    }
  });

  it('gives each zone its own character', () => {
    const count = (zone: string, f: (c: ChunkContent) => number): number =>
      all.filter((c) => c.zone === zone).reduce((s, c) => s + f(c), 0);
    expect(count('forest', (c) => c.props.filter((p) => p.kind === 'tree').length)).toBeGreaterThan(
      500,
    );
    expect(count('abandonedCity', (c) => c.props.filter((p) => p.kind === 'tree').length)).toBe(0);
    expect(
      count('abandonedCity', (c) => c.boxes.filter((b) => b.material === 'brick').length),
    ).toBeGreaterThan(20);
    expect(
      count('industrial', (c) => c.boxes.filter((b) => b.material === 'rustedMetal').length),
    ).toBeGreaterThan(20);
    expect(
      count('subway', (c) => c.lights.filter((l) => l.kind === 'emergencyBeacon').length),
    ).toBeGreaterThan(0);
    expect(
      count('researchComplex', (c) => c.lights.filter((l) => l.color[2] > l.color[0]).length),
    ).toBeGreaterThan(0);
    for (const c of all) expect(c.zone).toBe(chunkHub(c.cx, c.cz).zone);
  });

  it('walls in the world edge with a blocker behind it', () => {
    const edge = all.filter(
      (c) => c.cx === MIN_CHUNK || c.cx === MAX_CHUNK || c.cz === MIN_CHUNK || c.cz === MAX_CHUNK,
    );
    for (const c of edge) expect(c.blockers.length).toBeGreaterThan(0);
    const inner = all.filter((c) => !edge.includes(c));
    for (const c of inner) expect(c.blockers).toEqual([]);
  });
});
