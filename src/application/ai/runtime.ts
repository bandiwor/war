import type { EntityId } from '../../domain/ecs/entity';
import { PathFinder, type PathResult } from '../../domain/nav/astar';
import { NavGrid } from '../../domain/nav/nav-grid';

/** Per-mob path (side table: derived, recomputable state, see ADR-0011). */
export interface MobPath {
  readonly points: Float64Array;
  count: number;
  next: number;
  goalX: number;
  goalZ: number;
  version: number;
}

export const MAX_PATH_POINTS = 24;

/**
 * Deterministic per-tick work budgets: counts, not milliseconds, so the
 * same ticks get the same work on every machine (ADR-0011).
 */
export const AI_BUDGET = {
  /** Line-of-sight rays per tick, all mobs together. */
  sightRays: 24,
  /** A* node expansions per tick, all mobs together, and per search. */
  pathExpansions: 4000,
  searchExpansions: 1500,
  /** Mobs closer than this think at full rate; beyond `farLod` they freeze. */
  nearLod: 40,
  farLod: 90,
} as const;

const BUCKETS = 1024;
const HASH_CELL = 8;

/** Uniform spatial hash over mob rows, rebuilt every tick without allocating. */
export class SpatialHash {
  private readonly head = new Int32Array(BUCKETS);
  private next = new Int32Array(64);
  private xs = new Float64Array(64);
  private zs = new Float64Array(64);
  size = 0;

  reset(capacity: number): void {
    this.head.fill(-1);
    if (capacity > this.next.length) {
      const n = Math.max(capacity, this.next.length * 2);
      this.next = new Int32Array(n);
      this.xs = new Float64Array(n);
      this.zs = new Float64Array(n);
    }
    this.size = 0;
  }

  /** Inserts item `row` (must be inserted in increasing row order, rows 0..size-1). */
  insert(row: number, x: number, z: number): void {
    const b = bucket(Math.floor(x / HASH_CELL), Math.floor(z / HASH_CELL));
    this.next[row] = this.head[b] ?? -1;
    this.head[b] = row;
    this.xs[row] = x;
    this.zs[row] = z;
    this.size = Math.max(this.size, row + 1);
  }

  /** Rows found by the last `near` query and their squared distances. */
  readonly found = new Int32Array(256);
  readonly foundD2 = new Float64Array(256);

  /** Items within `r` (≤ 8 m) of (x, z) into `found`; returns how many (allocation-free). */
  near(x: number, z: number, r: number): number {
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    const r2 = r * r;
    // The 3×3 cells' buckets, each visited once (different cells can share a bucket).
    let nb = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const b = bucket(cx + dx, cz + dz);
        let dup = false;
        for (let k = 0; k < nb; k++) if (this.buckets[k] === b) dup = true;
        if (!dup) this.buckets[nb++] = b;
      }
    }
    let n = 0;
    for (let k = 0; k < nb; k++) {
      for (
        let i = this.head[this.buckets[k] ?? 0] ?? -1;
        i >= 0 && n < this.found.length;
        i = this.next[i] ?? -1
      ) {
        const ix = (this.xs[i] ?? 0) - x;
        const iz = (this.zs[i] ?? 0) - z;
        const d2 = ix * ix + iz * iz;
        if (d2 > r2) continue;
        this.found[n] = i;
        this.foundD2[n] = d2;
        n++;
      }
    }
    return n;
  }
  private readonly buckets = new Int32Array(9);
}

function bucket(cx: number, cz: number): number {
  return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & (BUCKETS - 1);
}

/** AI services shared by the systems of one scene. */
export class AiRuntime {
  readonly nav = new NavGrid(0.35);
  readonly finder = new PathFinder(96);
  readonly paths = new Map<number, MobPath>();
  readonly hash = new SpatialHash();
  readonly pathResult: PathResult = { status: 'failed', points: 0, expansions: 0 };
  /** Counters for the debug view and tests. */
  readonly stats = { searches: 0, expansions: 0, rays: 0, spawned: 0, despawned: 0, attacks: 0 };

  pathOf(id: EntityId): MobPath {
    let p = this.paths.get(id);
    if (p === undefined) {
      p = {
        points: new Float64Array(MAX_PATH_POINTS * 2),
        count: 0,
        next: 0,
        goalX: 0,
        goalZ: 0,
        version: -1,
      };
      this.paths.set(id, p);
    }
    return p;
  }

  forget(id: EntityId): void {
    this.paths.delete(id);
  }
}
