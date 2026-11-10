import { z } from 'zod';
import { SURFACE_IDS } from '../world/surfaces';

/**
 * Procedural PBR material recipes. A recipe is pure data; `bakeMaterial`
 * turns it into albedo / normal / ORM+height texels. A new surface is a new
 * entry here, no code changes. Colours are sRGB in [0, 1].
 */
const Color = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);
const Amount = z.number().min(0).max(1);

const Pattern = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('bricks'),
    rows: z.number().int().positive(),
    cols: z.number().int().positive(),
    mortar: z.number().min(0).max(0.3),
    mortarColor: Color,
    variation: Amount,
  }),
  z.object({
    kind: z.literal('planks'),
    count: z.number().int().positive(),
    gap: z.number().min(0).max(0.2),
    variation: Amount,
  }),
  z.object({
    kind: z.literal('panels'),
    rows: z.number().int().positive(),
    cols: z.number().int().positive(),
    seam: z.number().min(0).max(0.1),
  }),
]);

const Layer = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cracks'), amount: Amount, scale: z.number().int().positive() }),
  z.object({ kind: z.literal('rust'), amount: Amount, color: Color }),
  z.object({ kind: z.literal('dirt'), amount: Amount, color: Color }),
  z.object({ kind: z.literal('moss'), amount: Amount, color: Color }),
  z.object({ kind: z.literal('wet'), amount: Amount }),
  z.object({ kind: z.literal('scratches'), amount: Amount }),
  z.object({ kind: z.literal('blood'), amount: Amount }),
  z.object({ kind: z.literal('stains'), amount: Amount, color: Color }),
]);

export const MaterialRecipeSchema = z.object({
  label: z.string(),
  /** Two base colours mixed by warped fbm. */
  base: z.object({
    colorA: Color,
    colorB: Color,
    period: z.number().int().positive(),
    octaves: z.number().int().min(1).max(8),
    warp: z.number().min(0).max(2),
  }),
  pattern: Pattern,
  roughness: z.tuple([Amount, Amount]),
  metalness: Amount,
  layers: z.array(Layer),
  /** Normal map strength from the height field. */
  bumpiness: z.number().min(0).max(8),
  /** World metres covered by one texture tile. */
  tileMeters: z.number().positive(),
  /** Acoustic/physical surface for footsteps, impacts and AI noise. */
  surface: z.enum(SURFACE_IDS),
});

export type MaterialRecipe = z.infer<typeof MaterialRecipeSchema>;
export type MaterialLayer = MaterialRecipe['layers'][number];
export type MaterialPattern = MaterialRecipe['pattern'];

export const MATERIALS = {
  asphalt: {
    label: 'Wet asphalt',
    base: {
      colorA: [0.09, 0.09, 0.1],
      colorB: [0.2, 0.2, 0.21],
      period: 16,
      octaves: 6,
      warp: 0.2,
    },
    pattern: { kind: 'none' },
    roughness: [0.75, 0.95],
    metalness: 0,
    layers: [
      { kind: 'cracks', amount: 0.5, scale: 5 },
      { kind: 'stains', amount: 0.4, color: [0.05, 0.05, 0.05] },
      { kind: 'wet', amount: 0.55 },
    ],
    bumpiness: 2.5,
    tileMeters: 4,
    surface: 'asphalt',
  },
  concrete: {
    label: 'Weathered concrete',
    base: {
      colorA: [0.36, 0.36, 0.35],
      colorB: [0.52, 0.51, 0.49],
      period: 6,
      octaves: 6,
      warp: 0.6,
    },
    pattern: { kind: 'panels', rows: 2, cols: 2, seam: 0.012 },
    roughness: [0.8, 0.97],
    metalness: 0,
    layers: [
      { kind: 'stains', amount: 0.6, color: [0.2, 0.19, 0.17] },
      { kind: 'cracks', amount: 0.35, scale: 4 },
      { kind: 'moss', amount: 0.25, color: [0.16, 0.22, 0.09] },
      { kind: 'dirt', amount: 0.4, color: [0.15, 0.13, 0.1] },
    ],
    bumpiness: 1.5,
    tileMeters: 3,
    surface: 'concrete',
  },
  brick: {
    label: 'Old red brick',
    base: {
      colorA: [0.36, 0.14, 0.09],
      colorB: [0.52, 0.25, 0.16],
      period: 8,
      octaves: 5,
      warp: 0.3,
    },
    pattern: {
      kind: 'bricks',
      rows: 8,
      cols: 4,
      mortar: 0.07,
      mortarColor: [0.45, 0.43, 0.39],
      variation: 0.5,
    },
    roughness: [0.82, 0.95],
    metalness: 0,
    layers: [
      { kind: 'dirt', amount: 0.5, color: [0.12, 0.1, 0.08] },
      { kind: 'moss', amount: 0.2, color: [0.14, 0.2, 0.08] },
      { kind: 'stains', amount: 0.5, color: [0.1, 0.09, 0.08] },
    ],
    bumpiness: 3,
    tileMeters: 1.6,
    surface: 'concrete',
  },
  rustedMetal: {
    label: 'Rusted steel',
    base: {
      colorA: [0.42, 0.43, 0.45],
      colorB: [0.56, 0.57, 0.58],
      period: 4,
      octaves: 5,
      warp: 0.4,
    },
    pattern: { kind: 'panels', rows: 1, cols: 2, seam: 0.01 },
    roughness: [0.35, 0.6],
    metalness: 0.9,
    layers: [
      { kind: 'scratches', amount: 0.6 },
      { kind: 'rust', amount: 0.7, color: [0.38, 0.16, 0.06] },
      { kind: 'dirt', amount: 0.3, color: [0.1, 0.08, 0.06] },
    ],
    bumpiness: 2,
    tileMeters: 2,
    surface: 'metal',
  },
  paintedMetal: {
    label: 'Chipped olive paint on steel',
    base: {
      colorA: [0.2, 0.24, 0.15],
      colorB: [0.27, 0.31, 0.2],
      period: 4,
      octaves: 4,
      warp: 0.2,
    },
    pattern: { kind: 'none' },
    roughness: [0.45, 0.65],
    metalness: 0.1,
    layers: [
      { kind: 'rust', amount: 0.45, color: [0.36, 0.15, 0.06] },
      { kind: 'scratches', amount: 0.4 },
      { kind: 'blood', amount: 0.15 },
    ],
    bumpiness: 1.5,
    tileMeters: 1.2,
    surface: 'metal',
  },
  woodPlanks: {
    label: 'Damp wooden planks',
    base: {
      colorA: [0.25, 0.17, 0.1],
      colorB: [0.38, 0.27, 0.16],
      period: 3,
      octaves: 5,
      warp: 1.2,
    },
    pattern: { kind: 'planks', count: 5, gap: 0.03, variation: 0.6 },
    roughness: [0.7, 0.9],
    metalness: 0,
    layers: [
      { kind: 'dirt', amount: 0.4, color: [0.1, 0.08, 0.05] },
      { kind: 'moss', amount: 0.2, color: [0.15, 0.2, 0.08] },
      { kind: 'wet', amount: 0.25 },
    ],
    bumpiness: 2,
    tileMeters: 1.2,
    surface: 'wood',
  },
  forestFloor: {
    label: 'Forest floor: mud, needles and moss',
    base: {
      colorA: [0.09, 0.08, 0.05],
      colorB: [0.2, 0.16, 0.1],
      period: 8,
      octaves: 6,
      warp: 1.4,
    },
    pattern: { kind: 'none' },
    roughness: [0.8, 1],
    metalness: 0,
    layers: [
      { kind: 'moss', amount: 0.55, color: [0.1, 0.15, 0.05] },
      { kind: 'stains', amount: 0.5, color: [0.06, 0.05, 0.03] },
      { kind: 'wet', amount: 0.35 },
    ],
    bumpiness: 3,
    tileMeters: 3,
    surface: 'dirt',
  },
  bark: {
    label: 'Pine bark',
    base: {
      colorA: [0.12, 0.09, 0.07],
      colorB: [0.26, 0.2, 0.15],
      period: 4,
      octaves: 5,
      warp: 1.8,
    },
    pattern: { kind: 'planks', count: 9, gap: 0.05, variation: 0.8 },
    roughness: [0.85, 1],
    metalness: 0,
    layers: [
      { kind: 'cracks', amount: 0.6, scale: 6 },
      { kind: 'moss', amount: 0.35, color: [0.12, 0.17, 0.06] },
    ],
    bumpiness: 4,
    tileMeters: 1.5,
    surface: 'wood',
  },
  foliage: {
    label: 'Dense conifer foliage',
    base: {
      colorA: [0.03, 0.06, 0.03],
      colorB: [0.08, 0.13, 0.06],
      period: 6,
      octaves: 6,
      warp: 1.6,
    },
    pattern: { kind: 'none' },
    roughness: [0.75, 0.95],
    metalness: 0,
    layers: [{ kind: 'dirt', amount: 0.3, color: [0.05, 0.05, 0.02] }],
    bumpiness: 5,
    tileMeters: 2,
    surface: 'dirt',
  },
} as const satisfies Record<string, MaterialRecipe>;

export type MaterialId = keyof typeof MATERIALS;
export const MATERIAL_IDS: readonly string[] = Object.keys(MATERIALS);

export function isMaterialId(id: string): id is MaterialId {
  return Object.hasOwn(MATERIALS, id);
}

export function materialRecipe(id: MaterialId): MaterialRecipe {
  return MATERIALS[id];
}
