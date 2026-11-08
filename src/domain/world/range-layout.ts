import type { Seed } from '../core/brand';
import { RACES } from '../combat/races';
import { Rng } from '../math/prng';
import type { BoxPiece, LightPiece, PropPiece, StreetLayout, TargetPiece } from './street-layout';

/**
 * Debug shooting range: a 320 m floodlit lane behind the old police
 * training centre. Four race lanes with dummies at 10/25/50/100/200/300 m,
 * distance boards every 50 m, an earth berm at the end. Uses the same
 * layout format as the street, so render, physics and audio need no
 * special cases.
 */
const DISTANCES: readonly number[] = [10, 25, 50, 100, 200, 300];
const LANE_X: readonly number[] = [-6, -2, 2, 6];

export const RANGE = {
  length: 320,
  halfWidth: 12,
  distances: DISTANCES,
  laneX: LANE_X,
} as const;

export function generateRangeLayout(seed: Seed): StreetLayout {
  const rng = Rng.stream(seed, 'layout.range');
  const L = RANGE.length;
  const W = RANGE.halfWidth;
  const boxes: BoxPiece[] = [
    {
      material: 'concrete',
      center: [0, -0.05, L / 2 - 10],
      size: [2 * W, 0.1, L + 20],
      yaw: 0,
      solid: true,
    },
    // Side walls and the end berm.
    {
      material: 'concrete',
      center: [-W - 0.5, 1.5, L / 2 - 10],
      size: [1, 3, L + 20],
      yaw: 0,
      solid: true,
    },
    {
      material: 'concrete',
      center: [W + 0.5, 1.5, L / 2 - 10],
      size: [1, 3, L + 20],
      yaw: 0,
      solid: true,
    },
    { material: 'brick', center: [0, 4, L + 2], size: [2 * W + 2, 8, 3], yaw: 0, solid: true },
    { material: 'concrete', center: [0, 2, -11], size: [2 * W + 2, 4, 1], yaw: 0, solid: true },
    // Firing line bench.
    { material: 'woodPlanks', center: [0, 0.45, 1.2], size: [10, 0.9, 0.6], yaw: 0, solid: true },
  ];
  const props: PropPiece[] = [];
  const lights: LightPiece[] = [];
  // Floodlights on poles along both walls (most still work: the range had its own generator).
  for (let z = 5; z < L; z += 40) {
    for (const side of [-1, 1]) {
      const x = side * (W - 0.6);
      props.push({
        kind: 'lampPost',
        material: 'paintedMetal',
        position: [x, 0, z],
        yaw: side > 0 ? Math.PI : 0,
        scale: 1,
      });
      if (rng.chance(0.8))
        lights.push({
          kind: 'sodiumLamp',
          position: [x - side * 1.6, 6.2, z],
          color: [0.95, 0.85, 0.7],
          intensity: 90,
          range: 30,
          flicker: rng.chance(0.15) ? 0.4 : 0,
        });
    }
  }
  // Distance boards.
  for (let d = 50; d <= 300; d += 50)
    boxes.push({
      material: 'paintedMetal',
      center: [-W + 0.4, 1.2, d],
      size: [0.1, 0.8, 1.2],
      yaw: 0,
      solid: true,
    });
  const targets: TargetPiece[] = [];
  RACES.forEach((race, lane) => {
    const x = RANGE.laneX[lane] ?? 0;
    for (const d of RANGE.distances) targets.push({ race, position: [x, 0, d], yaw: 0 }); // facing the firing line (−Z)
  });
  return {
    kind: 'range',
    targets,
    zones: [{ zone: 'industrial', min: [-W, -12], max: [W, L + 5] }],
    boxes,
    blockers: [],
    props,
    lights,
    spawn: { position: [0, 0, 0], yaw: Math.PI },
    walkBounds: [-W + 0.5, -10, W - 0.5, L],
  };
}
