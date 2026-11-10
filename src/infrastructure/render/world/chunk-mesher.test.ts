import { describe, expect, it } from 'vitest';
import { seed } from '../../../domain/core/brand';
import { generateChunk } from '../../../domain/world/chunk-gen';
import { chunkBuffers, meshChunk } from './chunk-mesher';
import { ChunkMeshSchema } from './chunk-protocol';

const content = generateChunk(seed(1337), -2, -1); // city, on the avenue
const mesh = meshChunk(content);

describe('chunk mesher', () => {
  it('merges boxes per material: 24 vertices and 36 indices per box', () => {
    const boxes = content.boxes.length;
    const verts = mesh.meshes.reduce((n, m) => n + m.position.length / 3, 0);
    const indices = mesh.meshes.reduce((n, m) => n + m.index.length, 0);
    expect(verts).toBe(boxes * 24);
    expect(indices).toBe(boxes * 36);
    expect(new Set(mesh.meshes.map((m) => m.material)).size).toBe(mesh.meshes.length);
  });

  it('writes unit normals and keeps every vertex inside the chunk sphere', () => {
    const [cx, cy, cz, r] = mesh.bounds;
    for (const m of mesh.meshes) {
      for (let i = 0; i < m.normal.length; i += 3) {
        expect(
          Math.hypot(m.normal[i] ?? 0, m.normal[i + 1] ?? 0, m.normal[i + 2] ?? 0),
        ).toBeCloseTo(1, 5);
        const d = Math.hypot(
          (m.position[i] ?? 0) - cx,
          (m.position[i + 1] ?? 0) - cy,
          (m.position[i + 2] ?? 0) - cz,
        );
        expect(d).toBeLessThanOrEqual(r + 1e-3);
      }
      for (const ix of m.index) expect(ix).toBeLessThan(m.position.length / 3);
    }
  });

  it('gives box tops world-space UVs so neighbouring ground tiles seamlessly', () => {
    const ground = mesh.meshes.find((m) => m.material === 'asphalt');
    if (ground === undefined) throw new Error('no asphalt on the avenue');
    for (let v = 0; v < ground.position.length / 3; v++) {
      if (ground.normal[v * 3 + 1] !== 1) continue;
      expect(ground.uv[v * 2]).toBeCloseTo(ground.position[v * 3] ?? 0, 5);
      expect(ground.uv[v * 2 + 1]).toBeCloseTo(-(ground.position[v * 3 + 2] ?? 0), 5);
    }
  });

  it('turns props into instance matrices with their position, yaw and scale', () => {
    const total = mesh.instances.reduce((n, i) => n + i.matrices.length / 16, 0);
    expect(total).toBe(content.props.length);
    const first = mesh.instances[0];
    const prop = content.props.find((p) => p.kind === first?.kind && p.material === first.material);
    if (first === undefined || prop === undefined) throw new Error('no props');
    expect(first.matrices[12]).toBeCloseTo(prop.position[0], 5);
    expect(first.matrices[14]).toBeCloseTo(prop.position[2], 5);
    expect(first.matrices[5]).toBeCloseTo(prop.scale, 5);
    expect(first.detail).toBe(first.kind !== 'lampPost' && first.kind !== 'tree');
  });

  it('round-trips the worker protocol and lists every buffer for transfer', () => {
    expect(ChunkMeshSchema.safeParse(mesh).success).toBe(true);
    const buffers = chunkBuffers(mesh);
    const expected =
      mesh.meshes.length * 4 + mesh.instances.length + (mesh.emissive === null ? 0 : 3);
    expect(buffers).toHaveLength(expected);
  });

  it('adds emissive quads for lit windows, lamp bulbs and beacon domes', () => {
    const lights = content.lights;
    const quads =
      lights.filter((l) => l.kind === 'window').length +
      2 * lights.filter((l) => l.kind === 'sodiumLamp' || l.kind === 'emergencyBeacon').length;
    expect((mesh.emissive?.index.length ?? 0) / 12).toBe(quads);
  });
});
