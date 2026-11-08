import { MATERIALS } from '../../domain/procgen/materials';
import type { StreetLayout } from '../../domain/world/street-layout';
import type { PhysicsPort } from './ports';

/** Collider dimensions of the procedural props (must match their render geometry). */
export const PROP_COLLIDERS = {
  barrel: { kind: 'cylinder', radius: 0.3, height: 0.88 },
  crate: { kind: 'box', size: [0.8, 0.8, 0.8] },
  lampPost: { kind: 'cylinder', radius: 0.11, height: 6.4 },
} as const;

/** Adds every solid piece of a layout to the physics world. Returns the collider count. */
export function buildStaticColliders(layout: StreetLayout, physics: PhysicsPort): number {
  let count = 0;
  for (const b of layout.boxes) {
    if (!b.solid) continue;
    physics.addStaticBox(b.center, b.size, b.yaw, MATERIALS[b.material].surface);
    count++;
  }
  for (const w of layout.blockers) {
    physics.addStaticBox(w.center, w.size, 0, null);
    count++;
  }
  for (const p of layout.props) {
    const surface = MATERIALS[p.material].surface;
    switch (p.kind) {
      case 'barrel':
      case 'lampPost': {
        const c = PROP_COLLIDERS[p.kind];
        physics.addStaticCylinder(p.position, c.height * p.scale, c.radius * p.scale, surface);
        count++;
        break;
      }
      case 'crate': {
        const s = PROP_COLLIDERS.crate.size[0] * p.scale;
        physics.addStaticBox(
          [p.position[0], p.position[1] + s / 2, p.position[2]],
          [s, s, s],
          p.yaw,
          surface,
        );
        count++;
        break;
      }
      case 'fungus':
        break; // soft growth: no collision
    }
  }
  return count;
}
