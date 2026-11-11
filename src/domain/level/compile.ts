import type { MaterialId } from '../procgen/materials';
import type {
  BlockerPiece,
  BoxPiece,
  LightPiece,
  PropPiece,
  StreetLayout,
} from '../world/street-layout';
import {
  CELL_DIGITS,
  HEIGHT_STEP,
  TERRAIN_CELL,
  heightAt,
  levelBounds,
  materialAt,
  type Level,
} from './level';

/**
 * A level as the engine sees any playable area: a `StreetLayout`. Terrain
 * cells of equal height and material merge greedily into as few boxes as
 * possible (colliders and draw calls stay cheap); objects, decor and lights
 * map one to one; invisible walls close the edges. Physics, the nav grid,
 * the renderer and the soundscape then need nothing level-specific.
 */
const GROUND_DEPTH = 0.4;
const EDGE_WALL = 10;

export interface CompileOptions {
  /** Start the player here instead of the level's spawn (the editor's "play from here"). */
  readonly from?: { readonly at: readonly [number, number]; readonly yaw: number } | undefined;
}

/** Height of the terrain top at a cell (m). */
export function cellHeight(level: Level, i: number, k: number): number {
  return heightAt(level, i, k) * HEIGHT_STEP;
}

function terrainBoxes(level: Level): BoxPiece[] {
  const [w, d] = level.cells;
  const done = new Uint8Array(w * d);
  const key = (i: number, k: number): string =>
    `${level.terrain.heights[k]?.[i] ?? '0'}${level.terrain.materials[k]?.[i] ?? '0'}`;
  const boxes: BoxPiece[] = [];
  for (let k = 0; k < d; k++) {
    for (let i = 0; i < w; i++) {
      if (done[k * w + i] === 1) continue;
      const kind = key(i, k);
      // Grow right, then down while the whole row segment matches.
      let i1 = i;
      while (i1 + 1 < w && done[k * w + i1 + 1] !== 1 && key(i1 + 1, k) === kind) i1++;
      let k1 = k;
      for (;;) {
        const next = k1 + 1;
        if (next >= d) break;
        let ok = true;
        for (let x = i; x <= i1 && ok; x++) ok = done[next * w + x] !== 1 && key(x, next) === kind;
        if (!ok) break;
        k1 = next;
      }
      for (let z = k; z <= k1; z++) for (let x = i; x <= i1; x++) done[z * w + x] = 1;
      const top = cellHeight(level, i, k);
      const material: MaterialId = materialAt(level, i, k);
      const x0 = level.origin[0] + i * TERRAIN_CELL;
      const z0 = level.origin[1] + k * TERRAIN_CELL;
      const sx = (i1 - i + 1) * TERRAIN_CELL;
      const sz = (k1 - k + 1) * TERRAIN_CELL;
      boxes.push({
        material,
        center: [x0 + sx / 2, (top - GROUND_DEPTH) / 2, z0 + sz / 2],
        size: [sx, top + GROUND_DEPTH, sz],
        yaw: 0,
        solid: true,
      });
    }
  }
  return boxes;
}

export function levelToLayout(level: Level, options: CompileOptions = {}): StreetLayout {
  const [x0, z0, x1, z1] = levelBounds(level);
  const boxes: BoxPiece[] = [
    ...terrainBoxes(level),
    ...level.objects.map((o): BoxPiece => ({
      material: o.material,
      center: o.center,
      size: o.size,
      yaw: o.yaw,
      solid: o.solid,
    })),
  ];
  const props: PropPiece[] = level.decor.map((p) => ({
    kind: p.kind,
    material: p.material,
    position: [p.at[0], groundAt(level, p.at[0], p.at[1]), p.at[1]],
    yaw: p.yaw,
    scale: p.scale,
  }));
  const lights: LightPiece[] = level.lights.map((l) => ({
    kind: l.kind,
    position: l.at,
    color: l.color,
    intensity: l.intensity,
    range: l.range,
    flicker: l.flicker,
  }));
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const wx = x1 - x0;
  const wz = z1 - z0;
  const blockers: BlockerPiece[] = [
    { center: [x0 - 0.5, EDGE_WALL / 2, cz], size: [1, EDGE_WALL, wz + 2] },
    { center: [x1 + 0.5, EDGE_WALL / 2, cz], size: [1, EDGE_WALL, wz + 2] },
    { center: [cx, EDGE_WALL / 2, z0 - 0.5], size: [wx + 2, EDGE_WALL, 1] },
    { center: [cx, EDGE_WALL / 2, z1 + 0.5], size: [wx + 2, EDGE_WALL, 1] },
  ];
  const start = options.from ?? level.spawn;
  return {
    kind: 'street',
    targets: [],
    zones: [{ zone: level.zone, min: [x0, z0], max: [x1, z1] }],
    boxes,
    blockers,
    props,
    lights,
    spawn: {
      position: [start.at[0], groundAt(level, start.at[0], start.at[1]), start.at[1]],
      yaw: start.yaw,
    },
    walkBounds: [x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5],
  };
}

/** Terrain top under a world point (0 outside the terrain). */
export function groundAt(level: Level, x: number, z: number): number {
  const i = Math.floor((x - level.origin[0]) / TERRAIN_CELL);
  const k = Math.floor((z - level.origin[1]) / TERRAIN_CELL);
  if (i < 0 || k < 0 || i >= level.cells[0] || k >= level.cells[1]) return 0;
  return CELL_DIGITS.indexOf(level.terrain.heights[k]?.[i] ?? '0') * HEIGHT_STEP;
}
