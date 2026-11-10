import * as THREE from 'three';
import type { MaterialId } from '../../../domain/procgen/materials';
import type { PropKind } from '../../../domain/world/street-layout';
import type { MaterialLibrary } from '../textures/material-library';
import {
  barrelGeometry,
  crateGeometry,
  fungusGeometry,
  lampPostGeometry,
  rockGeometry,
  treeCanopyGeometry,
  treeTrunkGeometry,
} from './geometry';

/** One drawable part of a prop: a tree is a trunk (prop material) plus a canopy (foliage). */
export interface PropPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly castShadow: boolean;
}

/**
 * Shared prop geometries and materials, built once per scene and reused by
 * every instanced mesh (street scene and streamed chunks alike).
 */
export class PropLibrary {
  readonly fungusMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b2a24,
    emissive: new THREE.Color(0.2, 1.0, 0.8),
    emissiveIntensity: 2.2,
    roughness: 0.35,
    metalness: 0,
  });
  private readonly geometries: Readonly<Record<PropKind, THREE.BufferGeometry>>;
  private readonly canopy: THREE.BufferGeometry;
  private readonly cache = new Map<string, readonly PropPart[]>();

  constructor(
    private readonly materials: MaterialLibrary,
    seed: number,
  ) {
    this.geometries = {
      barrel: barrelGeometry(),
      crate: crateGeometry(),
      lampPost: lampPostGeometry(),
      fungus: fungusGeometry(seed),
      tree: treeTrunkGeometry(),
      rock: rockGeometry(seed),
    };
    this.canopy = treeCanopyGeometry(seed);
  }

  parts(kind: PropKind, material: MaterialId): readonly PropPart[] {
    const key = `${kind}:${material}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const geometry = this.geometries[kind];
    let parts: PropPart[];
    switch (kind) {
      case 'fungus':
        parts = [{ geometry, material: this.fungusMaterial, castShadow: false }];
        break;
      case 'tree':
        parts = [
          { geometry, material: this.materials.get(material), castShadow: true },
          { geometry: this.canopy, material: this.materials.get('foliage'), castShadow: true },
        ];
        break;
      case 'barrel':
      case 'crate':
      case 'lampPost':
      case 'rock':
        parts = [{ geometry, material: this.materials.get(material), castShadow: true }];
    }
    this.cache.set(key, parts);
    return parts;
  }

  dispose(): void {
    for (const g of Object.values(this.geometries)) g.dispose();
    this.canopy.dispose();
    this.fungusMaterial.dispose();
  }
}
