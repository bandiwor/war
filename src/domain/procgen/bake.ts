import { StateHasher } from '../math/hash';
import type { MaterialLayer, MaterialPattern, MaterialRecipe } from './materials';
import {
  createWorleyResult,
  fbm2,
  hash2,
  smoothstep,
  warpedFbm2,
  worley2,
  type WorleyResult,
} from './noise';

/**
 * Bakes a material recipe into three RGBA8 textures (tileable):
 *  - albedo: sRGB colour
 *  - normal: tangent-space normal (RGB) — OpenGL convention, +Y up
 *  - orm:    R = ambient occlusion, G = roughness, B = metalness, A = height
 * Pure and deterministic: same (recipe, seed, size) ⇒ identical bytes.
 */
export interface BakedMaterial {
  readonly size: number;
  readonly albedo: Uint8Array<ArrayBuffer>;
  readonly normal: Uint8Array<ArrayBuffer>;
  readonly orm: Uint8Array<ArrayBuffer>;
}

interface Texel {
  r: number;
  g: number;
  b: number;
  rough: number;
  metal: number;
  height: number;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function tint(t: Texel, c: readonly [number, number, number], m: number): void {
  t.r = mix(t.r, c[0], m);
  t.g = mix(t.g, c[1], m);
  t.b = mix(t.b, c[2], m);
}

/** Applies the structural pattern; returns a 0..1 "groove" mask (mortar, seams, gaps). */
function applyPattern(p: MaterialPattern, u: number, v: number, seed: number, t: Texel): number {
  switch (p.kind) {
    case 'none':
      return 0;
    case 'bricks': {
      const row = Math.floor(v * p.rows);
      const offset = row % 2 === 0 ? 0 : 0.5;
      const bu = u * p.cols + offset;
      const col = Math.floor(bu);
      const fu = bu - col;
      const fv = v * p.rows - row;
      const m = p.mortar * 0.5 * p.cols;
      const edge = Math.min(
        fu,
        1 - fu,
        ((fv * p.cols) / p.rows) * 2,
        (((1 - fv) * p.cols) / p.rows) * 2,
      );
      const mortar = 1 - smoothstep(m * 0.6, m * 1.4, edge);
      const variation =
        (hash2(((col % p.cols) + p.cols) % p.cols, row, seed + 5) - 0.5) * p.variation;
      t.r = clamp01(t.r * (1 + variation));
      t.g = clamp01(t.g * (1 + variation * 0.8));
      t.b = clamp01(t.b * (1 + variation * 0.6));
      tint(t, p.mortarColor, mortar);
      t.height = mix(0.75 + variation * 0.1, 0.25, mortar);
      t.rough = mix(t.rough, 1, mortar * 0.5);
      return mortar;
    }
    case 'planks': {
      const x = u * p.count;
      const i = Math.floor(x);
      const f = x - i;
      const gap = 1 - smoothstep(p.gap * 0.5, p.gap * 1.5, Math.min(f, 1 - f));
      const variation = (hash2(i % p.count, 0, seed + 11) - 0.5) * p.variation;
      t.r = clamp01(t.r * (1 + variation));
      t.g = clamp01(t.g * (1 + variation));
      t.b = clamp01(t.b * (1 + variation));
      // Grain: stretched fbm along the plank.
      const grain = fbm2(u * 0.25 + i * 0.13, v, { octaves: 4, period: 8, seed: seed + 13 + i });
      t.r *= 0.8 + 0.4 * grain;
      t.g *= 0.8 + 0.4 * grain;
      t.b *= 0.8 + 0.4 * grain;
      t.height = mix(0.6 + grain * 0.2, 0.1, gap);
      tint(t, [0.04, 0.03, 0.02], gap * 0.8);
      return gap;
    }
    case 'panels': {
      const fu = u * p.cols - Math.floor(u * p.cols);
      const fv = v * p.rows - Math.floor(v * p.rows);
      const seam = 1 - smoothstep(p.seam * 0.5, p.seam * 1.5, Math.min(fu, 1 - fu, fv, 1 - fv));
      t.height = mix(t.height, 0.2, seam);
      tint(t, [t.r * 0.5, t.g * 0.5, t.b * 0.5], seam);
      return seam;
    }
  }
}

function applyLayer(
  l: MaterialLayer,
  u: number,
  v: number,
  seed: number,
  groove: number,
  t: Texel,
  w: WorleyResult,
): void {
  switch (l.kind) {
    case 'cracks': {
      worley2(u, v, l.scale, seed + 21, w);
      const warpU = u + (fbm2(u, v, { octaves: 3, period: 4, seed: seed + 22 }) - 0.5) * 0.08;
      worley2(warpU, v, l.scale, seed + 21, w);
      const edge = w.f2 - w.f1;
      const crack =
        (1 - smoothstep(0, 0.035, edge)) *
        smoothstep(
          0.55 - l.amount * 0.4,
          0.75,
          fbm2(u, v, { octaves: 3, period: 3, seed: seed + 23 }),
        );
      tint(t, [0.03, 0.03, 0.03], crack * 0.9);
      t.height = mix(t.height, 0, crack);
      return;
    }
    case 'rust': {
      const n = warpedFbm2(u, v, { octaves: 6, period: 4, seed: seed + 31 }, 0.9);
      const m = smoothstep(1 - l.amount * 0.75, 1.05 - l.amount * 0.6, n + groove * 0.25);
      const flake = fbm2(u, v, { octaves: 4, period: 32, seed: seed + 32 });
      tint(
        t,
        [
          l.color[0] * (0.7 + 0.6 * flake),
          l.color[1] * (0.7 + 0.6 * flake),
          l.color[2] * (0.7 + 0.5 * flake),
        ],
        m,
      );
      t.metal = mix(t.metal, 0, m);
      t.rough = mix(t.rough, 0.92, m);
      t.height = mix(t.height, t.height + 0.15 * flake, m);
      return;
    }
    case 'dirt': {
      const n = fbm2(u, v, { octaves: 5, period: 5, seed: seed + 41 });
      const cavity = 1 - t.height;
      const m = clamp01(
        smoothstep(0.35, 0.9, n * 0.6 + cavity * 0.6 + groove * 0.3) * l.amount * 1.4,
      );
      tint(t, l.color, m * 0.85);
      t.rough = mix(t.rough, 0.95, m);
      return;
    }
    case 'moss': {
      const n = warpedFbm2(u, v, { octaves: 5, period: 3, seed: seed + 51 }, 1.1);
      const m = smoothstep(
        1 - l.amount * 0.6,
        1.1 - l.amount * 0.5,
        n + (1 - t.height) * 0.15 + groove * 0.12,
      );
      const fuzz = hash2(Math.floor(u * 512), Math.floor(v * 512), seed + 52);
      tint(
        t,
        [
          l.color[0] * (0.7 + 0.5 * fuzz),
          l.color[1] * (0.7 + 0.5 * fuzz),
          l.color[2] * (0.7 + 0.5 * fuzz),
        ],
        m,
      );
      t.rough = mix(t.rough, 1, m);
      t.metal = mix(t.metal, 0, m);
      t.height = mix(t.height, t.height + 0.1, m);
      return;
    }
    case 'wet': {
      const n = fbm2(u, v, { octaves: 4, period: 2, seed: seed + 61 });
      const puddle = smoothstep(
        0.62 - l.amount * 0.25,
        0.68 - l.amount * 0.2,
        n + (1 - t.height) * 0.2,
      );
      const damp = l.amount * 0.4;
      const m = clamp01(puddle + damp);
      t.rough = mix(t.rough, 0.04, puddle) * (1 - damp * 0.5);
      t.r *= 1 - 0.35 * m;
      t.g *= 1 - 0.35 * m;
      t.b *= 1 - 0.32 * m;
      t.height = mix(t.height, 0.3, puddle * 0.5);
      return;
    }
    case 'scratches': {
      // Thin straight segments with random direction/length, distance-tested
      // with wrap-around so they tile.
      const count = Math.round(40 * l.amount);
      let m = 0;
      for (let i = 0; i < count; i++) {
        const cx = hash2(i, 1, seed + 71);
        const cy = hash2(i, 2, seed + 71);
        const ax = hash2(i, 3, seed + 71) - 0.5;
        const ay = hash2(i, 4, seed + 71) - 0.5;
        const alen = Math.sqrt(ax * ax + ay * ay) + 1e-6;
        const len = 0.05 + 0.25 * hash2(i, 5, seed + 71);
        let dx = u - cx;
        let dy = v - cy;
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const along = (dx * ax + dy * ay) / alen;
        if (along < -len || along > len) continue;
        const across = Math.abs(dx * ay - dy * ax) / alen;
        m = Math.max(m, 1 - smoothstep(0.0005, 0.0025, across));
      }
      m *= l.amount;
      t.r = mix(t.r, 0.62, m);
      t.g = mix(t.g, 0.62, m);
      t.b = mix(t.b, 0.64, m);
      t.metal = mix(t.metal, 1, m);
      t.rough = mix(t.rough, 0.25, m);
      t.height = mix(t.height, t.height - 0.05, m);
      return;
    }
    case 'blood': {
      worley2(u, v, 6, seed + 81, w);
      const drop =
        (1 - smoothstep(0.05, 0.25, w.f1)) * (hash2(w.cell, 0, seed + 82) < l.amount ? 1 : 0);
      const splat =
        drop * smoothstep(0.3, 0.6, fbm2(u, v, { octaves: 4, period: 16, seed: seed + 83 }));
      tint(t, [0.2, 0.02, 0.015], splat * 0.9);
      t.rough = mix(t.rough, 0.3, splat);
      t.metal = mix(t.metal, 0, splat);
      return;
    }
    case 'stains': {
      const n = warpedFbm2(u, v, { octaves: 5, period: 2, seed: seed + 91 }, 1.5);
      // Vertical streaks: low-frequency in u only.
      const streak = fbm2(u, 0.5, { octaves: 4, period: 8, seed: seed + 92 });
      const m = smoothstep(0.5, 0.85, n * 0.7 + streak * 0.5 * (1 - v * 0.5)) * l.amount;
      tint(t, l.color, m * 0.7);
      return;
    }
  }
}

function toByte(x: number): number {
  return Math.round(clamp01(x) * 255);
}

export function bakeMaterial(recipe: MaterialRecipe, seed: number, size: number): BakedMaterial {
  if (!Number.isInteger(size) || size < 4 || (size & (size - 1)) !== 0) {
    throw new RangeError('size must be a power of two >= 4');
  }
  const n = size * size;
  const albedo = new Uint8Array(n * 4);
  const normal = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  const t: Texel = { r: 0, g: 0, b: 0, rough: 0, metal: 0, height: 0 };
  const w = createWorleyResult();
  const base = recipe.base;
  const fbmBase = { octaves: base.octaves, period: base.period, seed };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const nb = warpedFbm2(u, v, fbmBase, base.warp);
      const k = smoothstep(0.25, 0.75, nb);
      t.r = mix(base.colorA[0], base.colorB[0], k);
      t.g = mix(base.colorA[1], base.colorB[1], k);
      t.b = mix(base.colorA[2], base.colorB[2], k);
      t.rough = mix(
        recipe.roughness[0],
        recipe.roughness[1],
        fbm2(u, v, { octaves: 3, period: base.period * 2, seed: seed + 3 }),
      );
      t.metal = recipe.metalness;
      t.height = 0.4 + 0.3 * nb;
      const groove = applyPattern(recipe.pattern, u, v, seed, t);
      for (const layer of recipe.layers) applyLayer(layer, u, v, seed, groove, t, w);
      const i = y * size + x;
      height[i] = clamp01(t.height);
      albedo[i * 4] = toByte(t.r);
      albedo[i * 4 + 1] = toByte(t.g);
      albedo[i * 4 + 2] = toByte(t.b);
      albedo[i * 4 + 3] = 255;
      orm[i * 4 + 1] = toByte(t.rough);
      orm[i * 4 + 2] = toByte(t.metal);
      orm[i * 4 + 3] = toByte(t.height);
    }
  }
  deriveNormalsAndAo(height, size, recipe.bumpiness, normal, orm);
  return { size, albedo, normal, orm };
}

/** Sobel normals and a cavity-style AO from the (tileable, wrapped) height field. */
function deriveNormalsAndAo(
  height: Float32Array,
  size: number,
  bump: number,
  normal: Uint8Array,
  orm: Uint8Array,
): void {
  const mask = size - 1;
  const h = (x: number, y: number): number => height[(y & mask) * size + (x & mask)] ?? 0;
  const strength = bump * (size / 256);
  const aoRadius = Math.max(1, size >> 6);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        h(x + 1, y - 1) +
        2 * h(x + 1, y) +
        h(x + 1, y + 1) -
        h(x - 1, y - 1) -
        2 * h(x - 1, y) -
        h(x - 1, y + 1);
      const dy =
        h(x - 1, y + 1) +
        2 * h(x, y + 1) +
        h(x + 1, y + 1) -
        h(x - 1, y - 1) -
        2 * h(x, y - 1) -
        h(x + 1, y - 1);
      let nx = -dx * strength;
      // Texture v grows downwards in our bake loop; flip for OpenGL +Y-up normals.
      let ny = dy * strength;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      normal[i] = toByte(nx * 0.5 + 0.5);
      normal[i + 1] = toByte(ny * 0.5 + 0.5);
      normal[i + 2] = toByte(nz * 0.5 + 0.5);
      normal[i + 3] = 255;
      const c = h(x, y);
      const around =
        (h(x + aoRadius, y) + h(x - aoRadius, y) + h(x, y + aoRadius) + h(x, y - aoRadius)) * 0.25;
      orm[i] = toByte(1 - clamp01((around - c) * 3));
    }
  }
}

/** Content hash of a baked material (golden tests, caching). */
export function bakedHash(m: BakedMaterial): string {
  const h = new StateHasher();
  h.u32(m.size);
  for (const arr of [m.albedo, m.normal, m.orm])
    for (let i = 0; i < arr.length; i += 4)
      h.u32(
        (arr[i] ?? 0) |
          ((arr[i + 1] ?? 0) << 8) |
          ((arr[i + 2] ?? 0) << 16) |
          ((arr[i + 3] ?? 0) << 24),
      );
  return h.digest();
}
