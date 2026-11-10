import { cos, sin } from '../math/dmath';
import { CHUNK_SIZE, chunkKey, type ChunkKey } from '../world/chunks';
import type { BlockerPiece, BoxPiece, PropKind, PropPiece } from '../world/street-layout';

/**
 * Walkability for mobs: 1 m cells grouped in chunk-sized tiles, rasterised
 * from the same layout/chunk content as the colliders (ADR-0011). A cell
 * stores 0 (blocked) or its floor height (encoded); obstacles are inflated by
 * the agent radius so a path through free cells keeps bodies off walls.
 * Missing tiles are blocked: mobs never path into unloaded ground.
 */
export const NAV_CELL = 1;
const N = CHUNK_SIZE / NAV_CELL;
/** Floor height step of the encoding (m). */
const STEP = 0.05;
/** Boxes this low are floor (roads, pavements, curbs), not obstacles. */
const MAX_FLOOR = 0.35;
/** Things whose underside is this high are overhead (roofs): mobs walk under them. */
const HEADROOM = 1.7;

/** Collision radius of props for navigation (matches the physics colliders). */
const PROP_RADIUS: Readonly<Record<PropKind, number>> = {
  barrel: 0.3,
  crate: 0.45,
  lampPost: 0.11,
  tree: 0.22,
  rock: 0.8,
  fungus: 0,
};

export interface NavContent {
  readonly boxes: readonly BoxPiece[];
  readonly blockers: readonly BlockerPiece[];
  readonly props: readonly PropPiece[];
}

export class NavGrid {
  private readonly tiles = new Map<ChunkKey, Uint8Array>();
  /** Bumped whenever tiles change: cached paths can check it. */
  version = 0;

  constructor(readonly agentRadius = 0.35) {}

  get tileCount(): number {
    return this.tiles.size;
  }

  hasTile(cx: number, cz: number): boolean {
    return this.tiles.has(chunkKey(cx, cz));
  }

  removeTile(cx: number, cz: number): void {
    if (this.tiles.delete(chunkKey(cx, cz))) this.version++;
    this.lastKey = -1;
  }

  // One-entry tile cache: consecutive lookups (line walks, A*) hit the same tile.
  private lastKey = -1;
  private lastTile: Uint8Array | undefined = undefined;

  /** Raw cell value: 0 blocked, else 1 + floor height / STEP. */
  cell(ix: number, iz: number): number {
    const cx = Math.floor(ix / N);
    const cz = Math.floor(iz / N);
    const key = chunkKey(cx, cz);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.lastTile = this.tiles.get(key);
    }
    const tile = this.lastTile;
    if (tile === undefined) return 0;
    return tile[(iz - cz * N) * N + (ix - cx * N)] ?? 0;
  }

  walkable(ix: number, iz: number): boolean {
    return this.cell(ix, iz) !== 0;
  }

  walkableAt(x: number, z: number): boolean {
    return this.walkable(Math.floor(x / NAV_CELL), Math.floor(z / NAV_CELL));
  }

  /** Floor height at a point (0 where blocked). */
  floorAt(x: number, z: number): number {
    const v = this.cell(Math.floor(x / NAV_CELL), Math.floor(z / NAV_CELL));
    return v === 0 ? 0 : (v - 1) * STEP;
  }

  /**
   * Rasterises content into the tiles it covers. With `onlyTile`, writes are
   * clipped to that chunk (streamed chunks own their tile); otherwise tiles
   * are created as needed (fixed layouts such as the street).
   */
  rasterize(content: NavContent, onlyTile: readonly [number, number] | null = null): void {
    this.lastKey = -1;
    if (onlyTile !== null)
      this.tiles.set(chunkKey(onlyTile[0], onlyTile[1]), new Uint8Array(N * N));
    const write = (ix: number, iz: number, value: number, mode: 'floor' | 'block'): void => {
      const cx = Math.floor(ix / N);
      const cz = Math.floor(iz / N);
      if (onlyTile !== null && (cx !== onlyTile[0] || cz !== onlyTile[1])) return;
      const key = chunkKey(cx, cz);
      let tile = this.tiles.get(key);
      if (tile === undefined) {
        tile = new Uint8Array(N * N);
        this.tiles.set(key, tile);
      }
      const i = (iz - cz * N) * N + (ix - cx * N);
      if (mode === 'block') tile[i] = 0;
      else if (tile[i] !== 255) tile[i] = Math.max(tile[i] ?? 0, value);
    };
    // Floors first, then obstacles on top (a blocked cell stays blocked).
    for (const b of content.boxes) {
      if (!b.solid) continue;
      const top = b.center[1] + b.size[1] / 2;
      const bottom = b.center[1] - b.size[1] / 2;
      if (top <= MAX_FLOOR) {
        const code = 1 + Math.round(Math.max(0, top) / STEP);
        this.forBox(b, 0, (ix, iz) => {
          write(ix, iz, code, 'floor');
        });
      } else if (bottom < HEADROOM) {
        this.forBox(b, this.agentRadius, (ix, iz) => {
          write(ix, iz, 0, 'block');
        });
      }
    }
    for (const w of content.blockers) {
      this.forBox({ center: w.center, size: w.size, yaw: 0 }, this.agentRadius, (ix, iz) => {
        write(ix, iz, 0, 'block');
      });
    }
    for (const p of content.props) {
      const r = PROP_RADIUS[p.kind] * p.scale;
      if (r <= 0) continue;
      this.forCircle(p.position[0], p.position[2], r + this.agentRadius, (ix, iz) => {
        write(ix, iz, 0, 'block');
      });
    }
    this.version++;
  }

  /**
   * Cells of a (yawed) box footprint grown by `grow`. Floors (`grow` 0) take
   * cells whose centre is inside; obstacles take every cell they overlap, so
   * thin fences and corner-straddling props are never lost between centres.
   */
  private forBox(
    b: {
      readonly center: readonly number[];
      readonly size: readonly number[];
      readonly yaw: number;
    },
    grow: number,
    f: (ix: number, iz: number) => void,
  ): void {
    const cx = b.center[0] ?? 0;
    const cz = b.center[2] ?? 0;
    const hx = (b.size[0] ?? 0) / 2 + grow;
    const hz = (b.size[2] ?? 0) / 2 + grow;
    const c = cos(b.yaw);
    const s = sin(b.yaw);
    const ex = Math.abs(hx * c) + Math.abs(hz * s);
    const ez = Math.abs(hx * s) + Math.abs(hz * c);
    const overlap = grow > 0;
    // Half extent of a cell projected on the box axes (for the separating-axis test).
    const cellOnBox = (Math.abs(c) + Math.abs(s)) * NAV_CELL * 0.5;
    for (let iz = chunkCell(cz - ez); iz <= chunkCell(cz + ez); iz++) {
      for (let ix = chunkCell(cx - ex); ix <= chunkCell(cx + ex); ix++) {
        const px = (ix + 0.5) * NAV_CELL - cx;
        const pz = (iz + 0.5) * NAV_CELL - cz;
        // Into box space (inverse of Object3D.rotation.y = yaw).
        const lx = px * c - pz * s;
        const lz = px * s + pz * c;
        if (overlap) {
          // Separating axes: the world axes (box AABB vs cell) and the box axes.
          const worldHit =
            Math.abs(px) <= ex + NAV_CELL * 0.5 && Math.abs(pz) <= ez + NAV_CELL * 0.5;
          if (worldHit && Math.abs(lx) <= hx + cellOnBox && Math.abs(lz) <= hz + cellOnBox)
            f(ix, iz);
        } else if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) f(ix, iz);
      }
    }
  }

  /** Cells a circle overlaps (closest point of the cell within the radius). */
  private forCircle(x: number, z: number, r: number, f: (ix: number, iz: number) => void): void {
    for (let iz = chunkCell(z - r); iz <= chunkCell(z + r); iz++) {
      for (let ix = chunkCell(x - r); ix <= chunkCell(x + r); ix++) {
        const nx = Math.max(ix * NAV_CELL, Math.min(x, (ix + 1) * NAV_CELL));
        const nz = Math.max(iz * NAV_CELL, Math.min(z, (iz + 1) * NAV_CELL));
        const dx = nx - x;
        const dz = nz - z;
        if (dx * dx + dz * dz < r * r) f(ix, iz);
      }
    }
  }

  /** Straight walk check: samples the segment every 0.25 m. */
  lineWalkable(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / 0.25));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.walkableAt(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }
}

function chunkCell(v: number): number {
  return Math.floor(v / NAV_CELL);
}
