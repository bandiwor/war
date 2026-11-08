import * as THREE from 'three';
import { WEAPONS, WEAPON_IDS, type WeaponId } from '../../../domain/weapons/registry';

/**
 * Procedural weapon meshes built from the registry's part lists (boxes and
 * cylinders, +Z forward). Parts with a role (magazine, slide, bolt, pump)
 * are separate objects so the viewmodel can animate them.
 */
export interface WeaponModel {
  readonly group: THREE.Group;
  readonly parts: ReadonlyMap<string, readonly THREE.Object3D[]>;
  readonly rest: ReadonlyMap<THREE.Object3D, THREE.Vector3>;
}

const MATERIAL_SPECS = {
  polymer: { color: 0x15171a, roughness: 0.75, metalness: 0.0 },
  steel: { color: 0x2b2e33, roughness: 0.38, metalness: 0.9 },
  wood: { color: 0x4a2e19, roughness: 0.65, metalness: 0.0 },
  brass: { color: 0xb08a3a, roughness: 0.3, metalness: 1.0 },
  rubber: { color: 0x0d0d0d, roughness: 0.95, metalness: 0.0 },
} as const;

export class WeaponModelLibrary {
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly models = new Map<WeaponId, WeaponModel>();

  constructor() {
    for (const [name, spec] of Object.entries(MATERIAL_SPECS))
      this.materials.set(name, new THREE.MeshStandardMaterial(spec));
    for (const id of WEAPON_IDS) this.models.set(id, this.build(id));
  }

  get(id: WeaponId): WeaponModel {
    const m = this.models.get(id);
    if (m === undefined) throw new Error(`No model for ${id}`);
    return m;
  }

  private build(id: WeaponId): WeaponModel {
    const w = WEAPONS[id];
    const group = new THREE.Group();
    group.name = `weapon:${id}`;
    const parts = new Map<string, THREE.Object3D[]>();
    const rest = new Map<THREE.Object3D, THREE.Vector3>();
    for (const p of w.model.parts) {
      let geometry: THREE.BufferGeometry;
      if (p.shape === 'box') geometry = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
      else {
        geometry = new THREE.CylinderGeometry(p.size[0], p.size[1], p.size[2], 12);
        geometry.rotateX(Math.PI / 2); // cylinders run along +Z like barrels
      }
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, this.materials.get(p.material));
      mesh.position.set(p.at[0], p.at[1], p.at[2]);
      group.add(mesh);
      const list = parts.get(p.role) ?? [];
      list.push(mesh);
      parts.set(p.role, list);
      rest.set(mesh, mesh.position.clone());
    }
    return { group, parts, rest };
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials.values()) m.dispose();
  }
}

/** Star-burst muzzle flash texture (procedural, additive). */
export function muzzleFlashTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.atan2(dy, dx);
      const rays =
        Math.pow(Math.abs(Math.cos(a * 3)), 12) * Math.max(0, 1 - r) +
        Math.pow(Math.abs(Math.cos(a * 2 + 0.4)), 18) * Math.max(0, 1 - r * 0.8);
      const core = Math.exp(-r * r * 18);
      const v = Math.min(1, core + rays * 0.8);
      const i = (y * size + x) * 4;
      data[i] = Math.round(255 * Math.min(1, v * 1.1));
      data[i + 1] = Math.round(255 * Math.min(1, v * 0.8));
      data[i + 2] = Math.round(255 * Math.min(1, v * 0.45));
      data[i + 3] = Math.round(255 * v);
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
