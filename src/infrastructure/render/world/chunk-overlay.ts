import * as THREE from 'three';
import { CHUNK_SIZE, chunkX, chunkZ, type ChunkKey } from '../../../domain/world/chunks';

/**
 * Debug view of streaming: a square on the ground per drawn chunk, green
 * where the simulation also has its colliders, amber where only the
 * renderer has it (visible but not solid: the gap must stay out of reach).
 */
export class ChunkOverlay {
  readonly lines: THREE.LineSegments;
  private readonly geometry = new THREE.BufferGeometry();

  constructor() {
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(this.geometry, material);
    this.lines.frustumCulled = false;
    this.lines.name = 'chunk-overlay';
  }

  rebuild(drawn: Iterable<ChunkKey>, solid: (cx: number, cz: number) => boolean): void {
    const pos: number[] = [];
    const col: number[] = [];
    const inset = 0.4;
    for (const key of drawn) {
      const cx = chunkX(key);
      const cz = chunkZ(key);
      const x0 = cx * CHUNK_SIZE + inset;
      const z0 = cz * CHUNK_SIZE + inset;
      const x1 = (cx + 1) * CHUNK_SIZE - inset;
      const z1 = (cz + 1) * CHUNK_SIZE - inset;
      const y = 0.35;
      const c = solid(cx, cz) ? [0.2, 3, 0.6] : [3, 1.6, 0.1];
      const corners = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ];
      for (let i = 0; i < 4; i++) {
        const a = corners[i] ?? [0, 0];
        const b = corners[(i + 1) % 4] ?? [0, 0];
        pos.push(a[0] ?? 0, y, a[1] ?? 0, b[0] ?? 0, y, b[1] ?? 0);
        col.push(...c, ...c);
      }
    }
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }

  dispose(): void {
    this.geometry.dispose();
    const m = this.lines.material;
    if (!Array.isArray(m)) m.dispose();
  }
}
