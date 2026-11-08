/**
 * Deterministic, tileable 2D noise for texture baking. Built only from integer
 * hashing and + - * floor, so results are bit-identical on every engine
 * (ADR-0003). Every function takes an integer `period`: noise(x + period, y)
 * equals noise(x, y), which makes baked textures tile seamlessly.
 */

/** 32-bit integer hash of a lattice point (x, y) under a seed. */
export function hash2i(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash to a float in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  return hash2i(x, y, seed) / 4294967296;
}

function wrap(i: number, period: number): number {
  const m = i % period;
  return m < 0 ? m + period : m;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// 8 unit-ish gradient directions; avoids trig at runtime.
const GX = [1, -1, 1, -1, 1.4142135, -1.4142135, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 1.4142135, -1.4142135];

function grad(ix: number, iy: number, seed: number, dx: number, dy: number): number {
  const g = hash2i(ix, iy, seed) & 7;
  return (GX[g] ?? 0) * dx + (GY[g] ?? 0) * dy;
}

/** Periodic gradient (Perlin-style) noise, roughly in [-1, 1]. */
export function gradient2(x: number, y: number, period: number, seed: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const dx = x - fx;
  const dy = y - fy;
  const x0 = wrap(fx, period);
  const y0 = wrap(fy, period);
  const x1 = wrap(fx + 1, period);
  const y1 = wrap(fy + 1, period);
  const n00 = grad(x0, y0, seed, dx, dy);
  const n10 = grad(x1, y0, seed, dx - 1, dy);
  const n01 = grad(x0, y1, seed, dx, dy - 1);
  const n11 = grad(x1, y1, seed, dx - 1, dy - 1);
  const u = fade(dx);
  const v = fade(dy);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 0.7071;
}

export interface FbmOptions {
  readonly octaves: number;
  /** Base lattice period (cells across the tile). Doubles each octave, so tiling holds. */
  readonly period: number;
  readonly gain?: number;
  readonly seed: number;
}

/** Fractal Brownian motion of gradient noise, normalised to roughly [0, 1]. Input in tile units [0, 1). */
export function fbm2(u: number, v: number, o: FbmOptions): number {
  const gain = o.gain ?? 0.5;
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let period = o.period;
  for (let i = 0; i < o.octaves; i++) {
    sum += amp * gradient2(u * period, v * period, period, o.seed + i * 1013);
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  return 0.5 + 0.5 * (sum / norm);
}

/** Result of a Worley (cellular) query; reused to avoid allocation. */
export interface WorleyResult {
  /** Distance to nearest feature point (cell units). */
  f1: number;
  /** Distance to second-nearest feature point. */
  f2: number;
  /** Hash of the nearest cell, stable per cell: use for per-cell variation. */
  cell: number;
}

export function createWorleyResult(): WorleyResult {
  return { f1: 0, f2: 0, cell: 0 };
}

/** Periodic Worley noise. Input in tile units [0, 1); `period` cells across. */
export function worley2(
  u: number,
  v: number,
  period: number,
  seed: number,
  out: WorleyResult,
): WorleyResult {
  const x = u * period;
  const y = v * period;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  let cell = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = wrap(cx + i, period);
      const gy = wrap(cy + j, period);
      const h = hash2i(gx, gy, seed);
      const px = cx + i + (h & 0xffff) / 65536;
      const py = cy + j + (h >>> 16) / 65536;
      const dx = px - x;
      const dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        cell = h;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.cell = cell;
  return out;
}

/** fbm with its input displaced by two more fbm fields (Inigo Quilez domain warping). */
export function warpedFbm2(u: number, v: number, o: FbmOptions, warp: number): number {
  if (warp === 0) return fbm2(u, v, o);
  const wo = { octaves: Math.max(1, o.octaves - 2), period: o.period, seed: o.seed + 77 };
  const qx = fbm2(u, v, wo) - 0.5;
  const qy = fbm2(u + 0.37, v + 0.71, { ...wo, seed: o.seed + 91 }) - 0.5;
  return fbm2(u + warp * qx, v + warp * qy, o);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}
