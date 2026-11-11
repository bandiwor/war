import { seed } from '../../domain/core/brand';
import { levelToLayout } from '../../domain/level/compile';
import type { Level } from '../../domain/level/level';
import type { PhysicsPort } from '../physics/ports';
import { createSandbox, type Sandbox } from '../scenes/sandbox';

/**
 * A level running in the game engine: its compiled layout, its story, its
 * mobs, patrols and spawn zones, from the level's spawn or, for "play from
 * here", from where the editor camera stands.
 */
export function createLevelSandbox(
  level: Level,
  physics: PhysicsPort,
  from?: { readonly at: readonly [number, number]; readonly yaw: number },
): Sandbox {
  return createSandbox(seed(level.seed), physics, {
    layout: levelToLayout(level, { from }),
    story: level.story,
    level: { mobs: level.mobs, patrols: level.patrols, spawnZones: level.spawnZones },
  });
}
