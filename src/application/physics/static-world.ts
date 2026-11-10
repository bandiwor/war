import { MATERIALS } from '../../domain/procgen/materials';
import type { StreetLayout } from '../../domain/world/street-layout';
import type { ColliderId, PhysicsPort } from './ports';

/** Collider dimensions of the procedural props (must match their render geometry). */
export const PROP_COLLIDERS = {
  barrel: { kind: 'cylinder', radius: 0.3, height: 0.88 },
  crate: { kind: 'box', size: [0.8, 0.8, 0.8] },
  lampPost: { kind: 'cylinder', radius: 0.11, height: 6.4 },
  /** Trunk only: the canopy is out of reach and bullets pass through needles. */
  tree: { kind: 'cylinder', radius: 0.22, height: 9 },
  rock: { kind: 'cylinder', radius: 0.8, height: 0.9 },
} as const;

/** What a layout or a streamed chunk contributes to physics. */
export type StaticContent = Pick<StreetLayout, 'boxes' | 'blockers' | 'props'>;

/**
 * Adds every solid piece of a layout (or chunk) to the physics world. Returns
 * the collider ids, so a streamed chunk can remove exactly what it added.
 */
export function buildStaticColliders(layout: StaticContent, physics: PhysicsPort): ColliderId[] {
  const ids: ColliderId[] = [];
  for (const b of layout.boxes) {
    if (!b.solid) continue;
    ids.push(physics.addStaticBox(b.center, b.size, b.yaw, MATERIALS[b.material].surface));
  }
  for (const w of layout.blockers) {
    ids.push(physics.addStaticBox(w.center, w.size, 0, null));
  }
  for (const p of layout.props) {
    const surface = MATERIALS[p.material].surface;
    switch (p.kind) {
      case 'barrel':
      case 'lampPost':
      case 'tree':
      case 'rock': {
        const c = PROP_COLLIDERS[p.kind];
        ids.push(
          physics.addStaticCylinder(p.position, c.height * p.scale, c.radius * p.scale, surface),
        );
        break;
      }
      case 'crate': {
        const s = PROP_COLLIDERS.crate.size[0] * p.scale;
        ids.push(
          physics.addStaticBox(
            [p.position[0], p.position[1] + s / 2, p.position[2]],
            [s, s, s],
            p.yaw,
            surface,
          ),
        );
        break;
      }
      case 'fungus':
        break; // soft growth: no collision
    }
  }
  return ids;
}
