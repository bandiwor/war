import { describe, expect, it } from 'vitest';
import { bakeMaterial, bakedHash } from './bake';
import {
  MATERIALS,
  MATERIAL_IDS,
  MaterialRecipeSchema,
  isMaterialId,
  materialRecipe,
  type MaterialRecipe,
} from './materials';

describe('material registry', () => {
  it('every entry validates against the schema', () => {
    for (const id of MATERIAL_IDS) {
      expect(isMaterialId(id)).toBe(true);
      if (isMaterialId(id))
        expect(MaterialRecipeSchema.safeParse(materialRecipe(id)).success).toBe(true);
    }
    expect(isMaterialId('unobtainium')).toBe(false);
  });
});

describe('bakeMaterial', () => {
  it('rejects non power-of-two sizes', () => {
    expect(() => bakeMaterial(MATERIALS.brick, 1, 30)).toThrow(RangeError);
    expect(() => bakeMaterial(MATERIALS.brick, 1, 2)).toThrow(RangeError);
  });

  it.each(MATERIAL_IDS)('%s is deterministic and seed-dependent', (id) => {
    if (!isMaterialId(id)) throw new Error(id);
    const a = bakeMaterial(materialRecipe(id), 7, 32);
    expect(bakedHash(a)).toBe(bakedHash(bakeMaterial(materialRecipe(id), 7, 32)));
    expect(bakedHash(a)).not.toBe(bakedHash(bakeMaterial(materialRecipe(id), 8, 32)));
    expect(a.albedo).toHaveLength(32 * 32 * 4);
  });

  it('produces plausible PBR ranges and unit normals', () => {
    const m = bakeMaterial(MATERIALS.rustedMetal, 3, 64);
    let metalSum = 0;
    for (let i = 0; i < 64 * 64; i++) {
      const nx = (m.normal[i * 4] ?? 0) / 127.5 - 1;
      const ny = (m.normal[i * 4 + 1] ?? 0) / 127.5 - 1;
      const nz = (m.normal[i * 4 + 2] ?? 0) / 127.5 - 1;
      expect(Math.abs(Math.hypot(nx, ny, nz) - 1)).toBeLessThan(0.03);
      expect(nz).toBeGreaterThan(0);
      metalSum += m.orm[i * 4 + 2] ?? 0;
    }
    // Rusted steel is partly metallic, partly rust (dielectric).
    const meanMetal = metalSum / (64 * 64 * 255);
    expect(meanMetal).toBeGreaterThan(0.2);
    expect(meanMetal).toBeLessThan(0.95);
  });

  it('tiles seamlessly: opposite edges are as similar as neighbouring columns', () => {
    const size = 64;
    const m = bakeMaterial(MATERIALS.concrete, 5, size);
    const colDiff = (a: number, b: number): number => {
      let d = 0;
      for (let y = 0; y < size; y++)
        d += Math.abs((m.orm[(y * size + a) * 4 + 3] ?? 0) - (m.orm[(y * size + b) * 4 + 3] ?? 0));
      return d / size;
    };
    expect(colDiff(size - 1, 0)).toBeLessThan(colDiff(1, 0) * 2 + 2);
  });

  it('covers every pattern and layer kind', () => {
    const recipe: MaterialRecipe = {
      ...MATERIALS.brick,
      layers: [
        { kind: 'cracks', amount: 1, scale: 3 },
        { kind: 'rust', amount: 1, color: [0.4, 0.2, 0.1] },
        { kind: 'dirt', amount: 1, color: [0.1, 0.1, 0.1] },
        { kind: 'moss', amount: 1, color: [0.1, 0.3, 0.1] },
        { kind: 'wet', amount: 1 },
        { kind: 'scratches', amount: 1 },
        { kind: 'blood', amount: 1 },
        { kind: 'stains', amount: 1, color: [0.1, 0.1, 0.1] },
      ],
    };
    for (const pattern of [
      MATERIALS.brick.pattern,
      MATERIALS.woodPlanks.pattern,
      MATERIALS.concrete.pattern,
      MATERIALS.asphalt.pattern,
    ]) {
      const baked = bakeMaterial({ ...recipe, pattern }, 1, 16);
      expect(baked.orm.some((v) => v > 0)).toBe(true);
    }
  });
});
