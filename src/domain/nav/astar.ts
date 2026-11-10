import type { NavGrid } from './nav-grid';

/**
 * A* over the nav grid inside a square window around start and goal:
 * 8-connected (no corner cutting), octile heuristic, deterministic tie
 * breaking, and a node-expansion budget so a frame's pathfinding cost is
 * bounded by count, not by time (time would break determinism). All
 * buffers are preallocated: a search allocates nothing.
 */
export type PathStatus = 'found' | 'partial' | 'failed';

export interface PathResult {
  status: PathStatus;
  /** Number of waypoints written (x, z pairs). */
  points: number;
  expansions: number;
}

const SQRT2 = 1.4142135623730951;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

export class PathFinder {
  private readonly size: number;
  private readonly g: Float64Array;
  private readonly f: Float64Array;
  private readonly parent: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: Int32Array;
  private heapLen = 0;
  private gen = 0;
  // Current search frame (fields, not closures: a search allocates nothing).
  private ox = 0;
  private oz = 0;
  private hx = 0;
  private hz = 0;
  private readonly cells: Int32Array;

  constructor(readonly window = 96) {
    this.size = window * window;
    this.g = new Float64Array(this.size);
    this.f = new Float64Array(this.size);
    this.parent = new Int32Array(this.size);
    this.stamp = new Uint32Array(this.size);
    this.closed = new Uint32Array(this.size);
    this.heap = new Int32Array(this.size);
    this.cells = new Int32Array(this.size);
  }

  /**
   * Path from (sx, sz) to (gx, gz) in world metres. Waypoints (cell centres,
   * smoothed by line of sight, ending at the goal) go into `out` as x, z
   * pairs, at most `maxPoints`. Budget exhausted → the best partial path.
   */
  find(
    grid: NavGrid,
    sx: number,
    sz: number,
    gx: number,
    gz: number,
    budget: number,
    out: Float64Array,
    maxPoints: number,
    result: PathResult,
  ): PathResult {
    result.points = 0;
    result.expansions = 0;
    result.status = 'failed';
    const W = this.window;
    let s0x = Math.floor(sx);
    let s0z = Math.floor(sz);
    let g0x = Math.floor(gx);
    let g0z = Math.floor(gz);
    // Window origin: centred between start and goal.
    this.ox = Math.floor((s0x + g0x) / 2) - (W >> 1);
    this.oz = Math.floor((s0z + g0z) / 2) - (W >> 1);
    if (!this.inside(s0x, s0z) || !this.inside(g0x, g0z)) return result;
    // Bodies brush inflated cells: snap start and goal to the nearest walkable cell.
    const s = nearestWalkable(grid, s0x, s0z, 2);
    const g = nearestWalkable(grid, g0x, g0z, 3);
    if (s < 0 || g < 0) return result;
    s0x = Math.floor(s / 65536) - 32768;
    s0z = (s % 65536) - 32768;
    g0x = Math.floor(g / 65536) - 32768;
    g0z = (g % 65536) - 32768;
    if (!this.inside(s0x, s0z) || !this.inside(g0x, g0z)) return result;
    this.hx = g0x;
    this.hz = g0z;
    const ox = this.ox;
    const oz = this.oz;

    this.gen++;
    if (this.gen === 0xffffffff) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    this.heapLen = 0;
    const start = (s0z - oz) * W + (s0x - ox);
    const goal = (g0z - oz) * W + (g0x - ox);
    this.g[start] = 0;
    this.f[start] = this.h(s0x, s0z);
    this.parent[start] = -1;
    this.stamp[start] = this.gen;
    this.push(start);
    let best = start;
    let bestH = this.f[start] ?? 0;
    let reached = false;
    while (this.heapLen > 0) {
      const cur = this.pop();
      if (this.closed[cur] === this.gen) continue;
      this.closed[cur] = this.gen;
      if (cur === goal) {
        reached = true;
        break;
      }
      if (result.expansions >= budget) break;
      result.expansions++;
      const cx = (cur % W) + ox;
      const cz = Math.floor(cur / W) + oz;
      const hc = this.h(cx, cz);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      const gc = this.g[cur] ?? 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + (DX[k] ?? 0);
        const nz = cz + (DZ[k] ?? 0);
        if (!this.inside(nx, nz) || !grid.walkable(nx, nz)) continue;
        if (k >= 4 && (!grid.walkable(nx, cz) || !grid.walkable(cx, nz))) continue;
        const n = (nz - oz) * W + (nx - ox);
        if (this.closed[n] === this.gen) continue;
        const ng = gc + (k >= 4 ? SQRT2 : 1);
        if (this.stamp[n] === this.gen && ng >= (this.g[n] ?? Infinity)) continue;
        this.stamp[n] = this.gen;
        this.g[n] = ng;
        this.f[n] = ng + this.h(nx, nz);
        this.parent[n] = cur;
        this.push(n);
      }
    }
    const end = reached ? goal : best;
    if (end === start && !reached) return result;
    result.status = reached ? 'found' : 'partial';
    // Walk back to the start into `cells` (reversed order).
    let count = 0;
    for (let c = end; c !== -1 && count < this.size; c = this.parent[c] ?? -1)
      this.cells[count++] = c;
    // String pulling: keep a cell only when the straight line from the last kept one is blocked.
    let points = 0;
    let anchor = this.cells[count - 1] ?? start;
    let i = count - 1;
    while (i > 0 && points < maxPoints) {
      let j = i - 1;
      while (j > 0) {
        const next = this.cells[j - 1] ?? 0;
        if (!grid.lineWalkable(this.wx(anchor), this.wz(anchor), this.wx(next), this.wz(next)))
          break;
        j--;
      }
      const c = this.cells[j] ?? 0;
      out[points * 2] = this.wx(c);
      out[points * 2 + 1] = this.wz(c);
      points++;
      anchor = c;
      i = j;
    }
    const prevX =
      points > 1 ? (out[(points - 2) * 2] ?? 0) : this.wx(this.cells[count - 1] ?? start);
    const prevZ =
      points > 1 ? (out[(points - 2) * 2 + 1] ?? 0) : this.wz(this.cells[count - 1] ?? start);
    if (reached && points > 0 && grid.lineWalkable(prevX, prevZ, gx, gz)) {
      // Finish on the exact goal rather than its cell centre.
      out[(points - 1) * 2] = gx;
      out[(points - 1) * 2 + 1] = gz;
    }
    result.points = points;
    return result;
  }

  private inside(x: number, z: number): boolean {
    return x >= this.ox && z >= this.oz && x < this.ox + this.window && z < this.oz + this.window;
  }

  /** Octile distance to the goal cell. */
  private h(x: number, z: number): number {
    const ax = Math.abs(x - this.hx);
    const az = Math.abs(z - this.hz);
    return ax > az ? ax + (SQRT2 - 1) * az : az + (SQRT2 - 1) * ax;
  }

  private wx(c: number): number {
    return (c % this.window) + this.ox + 0.5;
  }

  private wz(c: number): number {
    return Math.floor(c / this.window) + this.oz + 0.5;
  }

  private push(n: number): void {
    let i = this.heapLen++;
    this.heap[i] = n;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(this.heap[i] ?? 0, this.heap[p] ?? 0)) break;
      const t = this.heap[i] ?? 0;
      this.heap[i] = this.heap[p] ?? 0;
      this.heap[p] = t;
      i = p;
    }
  }

  private pop(): number {
    const top = this.heap[0] ?? 0;
    const last = this.heap[--this.heapLen] ?? 0;
    let i = 0;
    this.heap[0] = last;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.heapLen && this.less(this.heap[l] ?? 0, this.heap[m] ?? 0)) m = l;
      if (r < this.heapLen && this.less(this.heap[r] ?? 0, this.heap[m] ?? 0)) m = r;
      if (m === i) break;
      const t = this.heap[i] ?? 0;
      this.heap[i] = this.heap[m] ?? 0;
      this.heap[m] = t;
      i = m;
    }
    return top;
  }

  /** Lower f first; ties by lower index (deterministic). */
  private less(a: number, b: number): boolean {
    const fa = this.f[a] ?? 0;
    const fb = this.f[b] ?? 0;
    return fa < fb || (fa === fb && a < b);
  }
}

/** Packed (x+32768)·65536 + (z+32768) of the nearest walkable cell within `r`, or −1. */
function nearestWalkable(grid: NavGrid, x: number, z: number, r: number): number {
  if (grid.walkable(x, z)) return (x + 32768) * 65536 + (z + 32768);
  for (let ring = 1; ring <= r; ring++) {
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        if (grid.walkable(x + dx, z + dz)) return (x + dx + 32768) * 65536 + (z + dz + 32768);
      }
    }
  }
  return -1;
}
