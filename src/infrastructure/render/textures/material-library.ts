import * as THREE from 'three';
import type { BakedMaterial } from '../../../domain/procgen/bake';
import { MATERIALS, materialRecipe, type MaterialId } from '../../../domain/procgen/materials';
import type { TextureBaker } from './texture-baker';

/**
 * GPU side of the procedural materials: baked texels → DataTextures →
 * MeshStandardMaterial. Geometry UVs are in metres; each material's texture
 * repeat converts metres to tiles.
 */
export class MaterialLibrary {
  private readonly materials = new Map<MaterialId, THREE.MeshStandardMaterial>();
  private readonly textures: THREE.Texture[] = [];
  readonly bakeMs = new Map<MaterialId, number>();

  static async create(
    baker: TextureBaker,
    seed: number,
    size: number,
    anisotropy: number,
  ): Promise<MaterialLibrary> {
    const lib = new MaterialLibrary();
    const ids = Object.keys(MATERIALS).filter((id): id is MaterialId =>
      Object.hasOwn(MATERIALS, id),
    );
    const baked = await Promise.all(
      ids.map(async (id, i) => {
        const t0 = performance.now();
        const m = await baker.bake(id, (seed + i * 7919) >>> 0, size);
        lib.bakeMs.set(id, performance.now() - t0);
        return [id, m] as const;
      }),
    );
    for (const [id, m] of baked) lib.materials.set(id, lib.build(id, m, anisotropy));
    return lib;
  }

  get(id: MaterialId): THREE.MeshStandardMaterial {
    const m = this.materials.get(id);
    if (m === undefined) throw new Error(`Material ${id} not baked`);
    return m;
  }

  private build(
    id: MaterialId,
    baked: BakedMaterial,
    anisotropy: number,
  ): THREE.MeshStandardMaterial {
    const recipe = materialRecipe(id);
    const repeat = 1 / recipe.tileMeters;
    const tex = (data: Uint8Array, srgb: boolean): THREE.DataTexture => {
      const t = new THREE.DataTexture(
        data,
        baked.size,
        baked.size,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = anisotropy;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      this.textures.push(t);
      return t;
    };
    const orm = tex(baked.orm, false);
    const material = new THREE.MeshStandardMaterial({
      name: id,
      map: tex(baked.albedo, true),
      normalMap: tex(baked.normal, false),
      roughnessMap: orm,
      metalnessMap: orm,
      aoMap: orm,
      roughness: 1,
      metalness: 1,
      aoMapIntensity: 1,
    });
    return material;
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
