import type { StateHasher } from '../math/hash';

/**
 * The zombies' world: a concentration field on 2 m cells in a window around
 * the player, with two channels:
 *  - prey: the scent living things leave (the player lays it down as they move);
 *  - alarm: what zombies lay down while they have prey in their nose.
 * Both diffuse to walkable neighbours (walls stop them) and decay. Zombies
 * read the sum and climb its gradient; nobody gives orders, yet one zombie on
 * a trail draws the others in: the group behaviour is emergent (ADR-0013).
 *
 * Deterministic: fixed-size Float32Arrays, fixed update order, no allocation.
 */
export const PHEROMONE = {
  /** Cell side (m). Zombies need direction, not detail: 2 m keeps the field cheap. */
  cell: 2,
  /** Window side in cells: scent further than ~48 m from the player is not tracked. */
  size: 48,
  /**
   * Diffusion rate per cell (1/s): the fraction exchanged with each neighbour per
   * second (2 m²/s on 2 m cells). Alarm is volatile: it spreads twice as fast.
   */
  diffusion: 0.5,
  alarmDiffusion: 1,
  /**
   * Decay per second of each channel. A steady source spreads over
   * cell × √(rate / decay) metres: ~5 m for prey scent, ~4.5 m for alarm (laid
   * down three times as strongly); trails left by moving bodies reach further.
   */
  preyDecay: 0.08,
  alarmDecay: 0.2,
  /** How far the player may drift from the window centre before it recentres (cells). */
  recentre: 8,
} as const;

export const PREY = 0;
export const ALARM = 1;

export class PheromoneField {
  readonly size: number = PHEROMONE.size;
  /** Cell coordinates of the window's corner cell. */
  ox = 0;
  oz = 0;
  private readonly cell: number = PHEROMONE.cell;
  private readonly cur: [Float32Array, Float32Array];
  private readonly next: [Float32Array, Float32Array];
  /** 1 = walkable (scent spreads), 0 = wall. */
  readonly open: Uint8Array;
  private openVersion = -1;
  private placed = false;
  /** Bounding box of cells holding anything (inclusive): steps skip the empty rest. */
  private minI = 1;
  private maxI = 0;
  private minK = 1;
  private maxK = 0;

  constructor() {
    const n = this.size * this.size;
    this.cur = [new Float32Array(n), new Float32Array(n)];
    this.next = [new Float32Array(n), new Float32Array(n)];
    this.open = new Uint8Array(n);
  }

  /** Concentration of a channel at a world point (0 outside the window). */
  at(channel: number, x: number, z: number): number {
    const i = Math.floor(x / this.cell) - this.ox;
    const k = Math.floor(z / this.cell) - this.oz;
    if (i < 0 || k < 0 || i >= this.size || k >= this.size) return 0;
    return this.cur[channel === ALARM ? 1 : 0][k * this.size + i] ?? 0;
  }

  /** Prey scent plus a share of the alarm: what a zombie's nose reports. */
  smell(x: number, z: number, alarmWeight: number): number {
    return this.at(PREY, x, z) + alarmWeight * this.at(ALARM, x, z);
  }

  /** Lays down `amount` (per second × dt, per m² of one metre's cell) of a channel at a world point. */
  deposit(channel: number, x: number, z: number, amount: number): void {
    const i = Math.floor(x / this.cell) - this.ox;
    const k = Math.floor(z / this.cell) - this.oz;
    if (i < 0 || k < 0 || i >= this.size || k >= this.size) return;
    const c = this.cur[channel === ALARM ? 1 : 0];
    const j = k * this.size + i;
    // Spread over the cell's area: values are per square metre whatever the cell size.
    c[j] = (c[j] ?? 0) + amount / (this.cell * this.cell);
    this.grow(i, k);
  }

  private grow(i: number, k: number): void {
    if (this.minI > this.maxI) {
      this.minI = this.maxI = i;
      this.minK = this.maxK = k;
      return;
    }
    if (i < this.minI) this.minI = i;
    if (i > this.maxI) this.maxI = i;
    if (k < this.minK) this.minK = k;
    if (k > this.maxK) this.maxK = k;
  }

  /**
   * Keeps the window centred on (x, z): when the player drifts far enough the
   * contents shift (what scrolls out is lost, what scrolls in starts empty).
   * Returns true when the walkability mask must be refreshed.
   */
  follow(x: number, z: number): boolean {
    const half = this.size >> 1;
    const cx = Math.floor(x / this.cell) - half;
    const cz = Math.floor(z / this.cell) - half;
    if (
      this.placed &&
      Math.abs(cx - this.ox) < PHEROMONE.recentre &&
      Math.abs(cz - this.oz) < PHEROMONE.recentre
    )
      return false;
    this.placed = true;
    const dx = cx - this.ox;
    const dz = cz - this.oz;
    for (let ch = 0; ch < 2; ch++) {
      const src = this.cur[ch] ?? this.cur[0];
      const dst = this.next[ch] ?? this.next[0];
      for (let k = 0; k < this.size; k++) {
        for (let i = 0; i < this.size; i++) {
          const si = i + dx;
          const sk = k + dz;
          dst[k * this.size + i] =
            si >= 0 && sk >= 0 && si < this.size && sk < this.size
              ? (src[sk * this.size + si] ?? 0)
              : 0;
        }
      }
      src.set(dst);
    }
    this.ox = cx;
    this.oz = cz;
    this.openVersion = -1;
    if (this.minI <= this.maxI) {
      this.minI = Math.max(0, this.minI - dx);
      this.maxI = Math.min(this.size - 1, this.maxI - dx);
      this.minK = Math.max(0, this.minK - dz);
      this.maxK = Math.min(this.size - 1, this.maxK - dz);
      if (this.minI > this.maxI || this.minK > this.maxK) {
        this.minI = this.minK = 1;
        this.maxI = this.maxK = 0;
      }
    }
    return true;
  }

  /**
   * Refreshes the wall mask from a walkability test at each cell's centre (world
   * metres), on recentre and when the nav grid changes.
   */
  refreshMask(version: number, walkable: (x: number, z: number) => boolean): void {
    if (version === this.openVersion) return;
    const c = this.cell;
    for (let k = 0; k < this.size; k++)
      for (let i = 0; i < this.size; i++)
        this.open[k * this.size + i] = walkable((this.ox + i + 0.5) * c, (this.oz + k + 0.5) * c)
          ? 1
          : 0;
    this.openVersion = version;
  }

  /** One diffusion + decay step of both channels (only over the occupied box, grown by 1). */
  step(dt: number): void {
    if (this.minI > this.maxI) return;
    // Explicit diffusion is stable while rate × dt ≤ 0.2: faster channels take substeps.
    const sub = Math.max(1, Math.ceil((PHEROMONE.alarmDiffusion * dt) / 0.2));
    this.minI = Math.max(0, this.minI - sub);
    this.maxI = Math.min(this.size - 1, this.maxI + sub);
    this.minK = Math.max(0, this.minK - sub);
    this.maxK = Math.min(this.size - 1, this.maxK + sub);
    this.stepChannel(0, PHEROMONE.diffusion, PHEROMONE.preyDecay, dt);
    for (let i = 0; i < sub; i++)
      this.stepChannel(1, PHEROMONE.alarmDiffusion, PHEROMONE.alarmDecay, dt / sub);
    this.shrink();
  }

  private stepChannel(ch: number, rate: number, decay: number, dt: number): void {
    const n = this.size;
    const d = Math.min(0.2, rate * dt);
    const c = this.cur[ch === 1 ? 1 : 0];
    const out = this.next[ch === 1 ? 1 : 0];
    const keep = 1 - decay * dt;
    const i0 = this.minI;
    const i1 = this.maxI;
    for (let k = this.minK; k <= this.maxK; k++) {
      for (let i = i0; i <= i1; i++) {
        const j = k * n + i;
        if (this.open[j] !== 1) {
          out[j] = 0;
          continue;
        }
        const v = c[j] ?? 0;
        // Exchange with each open neighbour: conserves mass, walls are closed boundaries.
        let flux = 0;
        if (i > 0 && this.open[j - 1] === 1) flux += (c[j - 1] ?? 0) - v;
        if (i < n - 1 && this.open[j + 1] === 1) flux += (c[j + 1] ?? 0) - v;
        if (k > 0 && this.open[j - n] === 1) flux += (c[j - n] ?? 0) - v;
        if (k < n - 1 && this.open[j + n] === 1) flux += (c[j + n] ?? 0) - v;
        const next = (v + d * flux) * keep;
        out[j] = next < 1e-6 ? 0 : next;
      }
    }
    // Copy back after the whole pass (in-place updates would read half-new neighbours).
    for (let k = this.minK; k <= this.maxK; k++) {
      for (let j = k * n + i0; j <= k * n + i1; j++) c[j] = out[j] ?? 0;
    }
  }

  /** Tightens the occupied box to the cells that still hold something. */
  private shrink(): void {
    const n = this.size;
    let minI = n;
    let maxI = -1;
    let minK = n;
    let maxK = -1;
    const a = this.cur[0];
    const b = this.cur[1];
    for (let k = this.minK; k <= this.maxK; k++) {
      for (let i = this.minI; i <= this.maxI; i++) {
        const j = k * n + i;
        if ((a[j] ?? 0) === 0 && (b[j] ?? 0) === 0) continue;
        if (i < minI) minI = i;
        if (i > maxI) maxI = i;
        if (k < minK) minK = k;
        if (k > maxK) maxK = k;
      }
    }
    if (maxI < 0) {
      this.minI = this.minK = 1;
      this.maxI = this.maxK = 0;
    } else {
      this.minI = minI;
      this.maxI = maxI;
      this.minK = minK;
      this.maxK = maxK;
    }
  }

  /**
   * Uphill direction at (x, z): the neighbouring cell (8 directions)
   * with the strongest smell. Writes the target point into `out`; returns the
   * smell there, or −1 when nothing beats the current cell.
   */
  uphill(
    x: number,
    z: number,
    alarmWeight: number,
    out: { x: number; z: number },
    preyWeight = 1,
  ): number {
    let best = preyWeight * this.at(PREY, x, z) + alarmWeight * this.at(ALARM, x, z);
    let found = -1;
    for (let k = 0; k < 8; k++) {
      const dx = DX[k] ?? 0;
      const dz = DZ[k] ?? 0;
      const v =
        preyWeight * this.at(PREY, x + dx, z + dz) + alarmWeight * this.at(ALARM, x + dx, z + dz);
      if (v > best * 1.0001) {
        best = v;
        found = k;
      }
    }
    if (found < 0) return -1;
    const c = this.cell;
    out.x = (Math.floor(x / c) + (DX[found] ?? 0) / c + 0.5) * c;
    out.z = (Math.floor(z / c) + (DZ[found] ?? 0) / c + 0.5) * c;
    return best;
  }

  /** Total of a channel (tests: mass conservation and decay). */
  total(channel: number): number {
    const c = this.cur[channel === ALARM ? 1 : 0];
    let s = 0;
    for (let j = 0; j < c.length; j++) s += c[j] ?? 0;
    return s;
  }

  /** Feeds the field into a state hash (it is simulation state). */
  hashInto(h: StateHasher): void {
    h.u32(this.ox + 0x8000).u32(this.oz + 0x8000);
    for (let ch = 0; ch < 2; ch++) {
      const c = this.cur[ch] ?? this.cur[0];
      // Quantised to keep the digest fast; 1e-4 resolution is far below anything a zombie reacts to.
      for (let j = 0; j < c.length; j += 1) {
        const v = c[j] ?? 0;
        if (v !== 0) h.u32(j).u32(Math.round(v * 1e4));
      }
    }
  }
}

const DX = [2, -2, 0, 0, 2, 2, -2, -2];
const DZ = [0, 0, 2, -2, 2, -2, 2, -2];
