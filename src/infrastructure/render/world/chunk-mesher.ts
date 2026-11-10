import type { ChunkContent } from '../../../domain/world/chunk-gen';
import type { MaterialId } from '../../../domain/procgen/materials';
import type { BoxPiece, LightPiece, PropKind } from '../../../domain/world/street-layout';

/**
 * Turns a chunk's content into GPU-ready typed arrays, with no Three.js and
 * no DOM, so it runs in a worker (or in Node for tests). The main thread only
 * wraps the arrays in BufferGeometries: no merging, no per-vertex work.
 *
 * Boxes are merged per material (one draw call each per chunk), with UVs in
 * metres like `meterBox`. Props become instance matrices per (kind, material).
 * Window panes and lamp bulbs become one vertex-coloured emissive mesh.
 */
export interface MeshArrays {
  readonly material: MaterialId;
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array;
  readonly index: Uint32Array;
}

export interface InstanceArrays {
  readonly kind: PropKind;
  readonly material: MaterialId;
  /** Column-major 4×4 matrices, 16 floats per instance. */
  readonly matrices: Float32Array;
  /** Small props are hidden in far rings (geometry LOD). */
  readonly detail: boolean;
}

export interface EmissiveArrays {
  readonly position: Float32Array;
  /** Linear HDR colour per vertex (already multiplied by brightness). */
  readonly color: Float32Array;
  readonly index: Uint32Array;
}

export interface ChunkMesh {
  readonly cx: number;
  readonly cz: number;
  readonly meshes: readonly MeshArrays[];
  readonly instances: readonly InstanceArrays[];
  readonly emissive: EmissiveArrays | null;
  readonly lights: readonly LightPiece[];
  /** Bounding sphere of everything in the chunk: [x, y, z, r]. */
  readonly bounds: readonly [number, number, number, number];
}

/** Props worth drawing only up close. */
const DETAIL_PROPS: ReadonlySet<PropKind> = new Set(['barrel', 'crate', 'fungus', 'rock']);

// Face order +x, −x, +y, −y, +z, −z: normal, then the two in-face axes (u, v).
const FACES: readonly (readonly [readonly number[], readonly number[], readonly number[]])[] = [
  [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ],
  [
    [-1, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ],
  [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, -1],
    [-1, 0, 0],
    [0, 1, 0],
  ],
];
const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

function dim(axis: readonly number[], size: readonly number[]): number {
  return (
    Math.abs(axis[0] ?? 0) * (size[0] ?? 0) +
    Math.abs(axis[1] ?? 0) * (size[1] ?? 0) +
    Math.abs(axis[2] ?? 0) * (size[2] ?? 0)
  );
}

/** Appends one box (24 vertices, 36 indices) at vertex offset `v` / index offset `ii`. */
function writeBox(
  b: BoxPiece,
  m: { position: Float32Array; normal: Float32Array; uv: Float32Array; index: Uint32Array },
  v: number,
  ii: number,
): void {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const [hx, hy, hz] = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];
  let vi = v;
  let ix = ii;
  for (const [n, u, w] of FACES) {
    const du = dim(u, b.size);
    const dv = dim(w, b.size);
    const base = vi;
    for (const [cu, cv] of CORNERS) {
      // Local corner: normal * half extent + u * ±half + v * ±half.
      const lx = (n[0] ?? 0) * hx + (u[0] ?? 0) * cu * hx + (w[0] ?? 0) * cv * hx;
      const ly = (n[1] ?? 0) * hy + (u[1] ?? 0) * cu * hy + (w[1] ?? 0) * cv * hy;
      const lz = (n[2] ?? 0) * hz + (u[2] ?? 0) * cu * hz + (w[2] ?? 0) * cv * hz;
      // Rotate about Y like Object3D.rotation.y = yaw.
      m.position[vi * 3] = b.center[0] + lx * c + lz * s;
      m.position[vi * 3 + 1] = b.center[1] + ly;
      m.position[vi * 3 + 2] = b.center[2] - lx * s + lz * c;
      const nx = n[0] ?? 0;
      const nz = n[2] ?? 0;
      m.normal[vi * 3] = nx * c + nz * s;
      m.normal[vi * 3 + 1] = n[1] ?? 0;
      m.normal[vi * 3 + 2] = -nx * s + nz * c;
      if (n[1] !== 0) {
        // Top/bottom faces in world space: neighbouring ground rectangles tile seamlessly.
        m.uv[vi * 2] = m.position[vi * 3] ?? 0;
        m.uv[vi * 2 + 1] = -(m.position[vi * 3 + 2] ?? 0);
      } else {
        m.uv[vi * 2] = ((cu + 1) / 2) * du;
        m.uv[vi * 2 + 1] = ((cv + 1) / 2) * dv;
      }
      vi++;
    }
    m.index[ix++] = base;
    m.index[ix++] = base + 1;
    m.index[ix++] = base + 2;
    m.index[ix++] = base;
    m.index[ix++] = base + 2;
    m.index[ix++] = base + 3;
  }
}

function composeMatrix(
  out: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scale: number,
): void {
  const c = Math.cos(yaw) * scale;
  const s = Math.sin(yaw) * scale;
  out[o] = c;
  out[o + 1] = 0;
  out[o + 2] = -s;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = scale;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = s;
  out[o + 9] = 0;
  out[o + 10] = c;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

interface QuadSink {
  position: Float32Array;
  color: Float32Array;
  index: Uint32Array;
  quads: number;
}

/**
 * A double-sided quad centred at (x, y, z) spanned by unit axes a and b with
 * half sizes ha and hb.
 */
function writeQuad(
  e: QuadSink,
  x: number,
  y: number,
  z: number,
  a: readonly [number, number, number],
  ha: number,
  b: readonly [number, number, number],
  hb: number,
  rgb: readonly [number, number, number],
): void {
  const v = e.quads * 4;
  for (let k = 0; k < 4; k++) {
    const [ca, cb] = CORNERS[k] ?? [0, 0];
    e.position[(v + k) * 3] = x + a[0] * ca * ha + b[0] * cb * hb;
    e.position[(v + k) * 3 + 1] = y + a[1] * ca * ha + b[1] * cb * hb;
    e.position[(v + k) * 3 + 2] = z + a[2] * ca * ha + b[2] * cb * hb;
    e.color[(v + k) * 3] = rgb[0];
    e.color[(v + k) * 3 + 1] = rgb[1];
    e.color[(v + k) * 3 + 2] = rgb[2];
  }
  const ii = e.quads * 12;
  const idx = [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2];
  for (let k = 0; k < idx.length; k++) e.index[ii + k] = v + (idx[k] ?? 0);
  e.quads++;
}

const X: readonly [number, number, number] = [1, 0, 0];
const Y: readonly [number, number, number] = [0, 1, 0];
const Z: readonly [number, number, number] = [0, 0, 1];

export function meshChunk(content: ChunkContent): ChunkMesh {
  // Boxes per material.
  const byMaterial = new Map<MaterialId, BoxPiece[]>();
  let minY = 0;
  let maxY = 0;
  for (const b of content.boxes) {
    const list = byMaterial.get(b.material);
    if (list === undefined) byMaterial.set(b.material, [b]);
    else list.push(b);
    minY = Math.min(minY, b.center[1] - b.size[1] / 2);
    maxY = Math.max(maxY, b.center[1] + b.size[1] / 2);
  }
  const meshes: MeshArrays[] = [];
  for (const [material, boxes] of byMaterial) {
    const m = {
      material,
      position: new Float32Array(boxes.length * 24 * 3),
      normal: new Float32Array(boxes.length * 24 * 3),
      uv: new Float32Array(boxes.length * 24 * 2),
      index: new Uint32Array(boxes.length * 36),
    };
    boxes.forEach((b, i) => {
      writeBox(b, m, i * 24, i * 36);
    });
    meshes.push(m);
  }

  // Prop instances per (kind, material).
  const groups = new Map<
    string,
    { kind: PropKind; material: MaterialId; items: ChunkContent['props'][number][] }
  >();
  for (const p of content.props) {
    const key = `${p.kind}:${p.material}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, { kind: p.kind, material: p.material, items: [p] });
    else g.items.push(p);
    maxY = Math.max(maxY, p.position[1] + (p.kind === 'tree' ? 11 : 6.5) * p.scale);
  }
  const instances: InstanceArrays[] = [];
  for (const g of groups.values()) {
    const matrices = new Float32Array(g.items.length * 16);
    g.items.forEach((p, i) => {
      composeMatrix(matrices, i * 16, p.position[0], p.position[1], p.position[2], p.yaw, p.scale);
    });
    instances.push({
      kind: g.kind,
      material: g.material,
      matrices,
      detail: DETAIL_PROPS.has(g.kind),
    });
  }

  // Emissive panes (windows), lamp bulbs and beacon domes (crossed quads: visible from below and the side).
  let quads = 0;
  for (const l of content.lights)
    quads += l.kind === 'window' ? 1 : l.kind === 'bioluminescence' ? 0 : 2;
  let emissive: EmissiveArrays | null = null;
  if (quads > 0) {
    const e: QuadSink = {
      position: new Float32Array(quads * 4 * 3),
      color: new Float32Array(quads * 4 * 3),
      index: new Uint32Array(quads * 12),
      quads: 0,
    };
    for (const l of content.lights) {
      const [x, y, z] = l.position;
      if (l.kind === 'window') {
        const k = 2.5 * l.intensity;
        const rgb: [number, number, number] = [l.color[0] * k, l.color[1] * k, l.color[2] * k];
        writeQuad(e, x, y, z, l.facing === 'x' ? Z : X, 0.55, Y, 0.75, rgb);
      } else if (l.kind === 'sodiumLamp') {
        const rgb: [number, number, number] = [l.color[0] * 40, l.color[1] * 40, l.color[2] * 40];
        writeQuad(e, x, y + 0.1, z, X, 0.2, Z, 0.1, rgb);
        writeQuad(e, x, y + 0.13, z, X, 0.2, Y, 0.03, rgb);
      } else if (l.kind === 'emergencyBeacon') {
        // The beacon dome: visible from afar even without a pooled light.
        const rgb: [number, number, number] = [l.color[0] * 25, l.color[1] * 25, l.color[2] * 25];
        writeQuad(e, x, y + 0.05, z, X, 0.11, Y, 0.06, rgb);
        writeQuad(e, x, y + 0.05, z, Z, 0.11, Y, 0.06, rgb);
      }
    }
    emissive = { position: e.position, color: e.color, index: e.index };
  }

  const half = 16;
  const cxw = content.volume.min[0] + half;
  const czw = content.volume.min[1] + half;
  const cy = (minY + maxY) / 2;
  const r = Math.sqrt(half * half * 2 + ((maxY - minY) / 2) ** 2);
  return {
    cx: content.cx,
    cz: content.cz,
    meshes,
    instances,
    emissive,
    lights: content.lights,
    bounds: [cxw, cy, czw, r],
  };
}

/** Every transferable buffer of a chunk mesh (for zero-copy postMessage). */
export function chunkBuffers(m: ChunkMesh): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (a: { buffer: ArrayBufferLike }): void => {
    if (a.buffer instanceof ArrayBuffer) out.push(a.buffer);
  };
  for (const mesh of m.meshes) {
    add(mesh.position);
    add(mesh.normal);
    add(mesh.uv);
    add(mesh.index);
  }
  for (const i of m.instances) add(i.matrices);
  if (m.emissive !== null) {
    add(m.emissive.position);
    add(m.emissive.color);
    add(m.emissive.index);
  }
  return out;
}
