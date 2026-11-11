import { NavGrid } from '../nav/nav-grid';
import { PathFinder, type PathResult } from '../nav/astar';
import { validateStory } from '../story/schema';
import { CELL_DIGITS, levelBounds, type Level } from './level';
import { levelToLayout } from './compile';

/**
 * Automatic level checks (stage 9), run live in the editor, before "play
 * from here", and in CI over every shipped level. The nav checks use the
 * game's own nav grid (the same rasterisation and the same 8-connected,
 * no-corner-cutting rule as the mobs' A*), so "reachable" here means
 * reachable in the game.
 */
export type IssueCode =
  | 'duplicate-id'
  | 'unknown-patrol'
  | 'terrain-shape'
  | 'out-of-bounds'
  | 'spawn-blocked'
  | 'mob-stuck'
  | 'unreachable'
  | 'patrol-blocked'
  | 'zone-unreachable'
  | 'pocket'
  | 'story'
  | 'budget';

export interface LevelIssue {
  readonly severity: 'error' | 'warning';
  readonly code: IssueCode;
  readonly message: string;
  /** Where to look (x, z), if the issue has a place. */
  readonly at: readonly [number, number] | null;
  /** The entity it is about, if any. */
  readonly ref: string | null;
}

export interface CheckReport {
  readonly issues: readonly LevelIssue[];
  readonly errors: number;
  readonly warnings: number;
  /** Walkable and reachable ground (m²), for the editor's status line. */
  readonly walkable: number;
  readonly reachable: number;
}

/** Budgets a level must stay inside (frame and simulation budgets, ADR-0010/0011). */
export const LEVEL_BUDGETS = { lights: 24, boxes: 900, mobs: 48, decor: 600 } as const;

/** Walkable ground cut off from the spawn smaller than this (m²) is noise between props, not a pocket. */
const POCKET_MIN_AREA = 4;

interface Reach {
  readonly grid: NavGrid;
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly d: number;
  /** Component id per 1 m cell (0 = blocked); the spawn's component is `spawn`. */
  readonly comp: Int32Array;
  readonly sizes: number[];
  readonly spawn: number;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

/** Connected walkable components over the level's cells (the A* neighbour rule). */
function components(level: Level): Reach {
  const [bx0, bz0, bx1, bz1] = levelBounds(level);
  const grid = new NavGrid();
  grid.rasterize(levelToLayout(level));
  const x0 = Math.floor(bx0);
  const z0 = Math.floor(bz0);
  const w = Math.ceil(bx1) - x0;
  const d = Math.ceil(bz1) - z0;
  const comp = new Int32Array(w * d);
  const sizes = [0];
  const queue = new Int32Array(w * d);
  const walk = (i: number, k: number): boolean =>
    i >= 0 && k >= 0 && i < w && k < d && grid.walkable(i + x0, k + z0);
  for (let start = 0; start < w * d; start++) {
    if (comp[start] !== 0 || !walk(start % w, Math.floor(start / w))) continue;
    const id = sizes.length;
    let size = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    comp[start] = id;
    while (head < tail) {
      const c = queue[head++] ?? 0;
      size++;
      const ci = c % w;
      const ck = Math.floor(c / w);
      for (let n = 0; n < 8; n++) {
        const ni = ci + (DX[n] ?? 0);
        const nk = ck + (DZ[n] ?? 0);
        if (!walk(ni, nk)) continue;
        if (n >= 4 && (!walk(ni, ck) || !walk(ci, nk))) continue;
        const nc = nk * w + ni;
        if (comp[nc] !== 0) continue;
        comp[nc] = id;
        queue[tail++] = nc;
      }
    }
    sizes.push(size);
  }
  const si = Math.floor(level.spawn.at[0]) - x0;
  const sk = Math.floor(level.spawn.at[1]) - z0;
  const spawn = si >= 0 && sk >= 0 && si < w && sk < d ? (comp[sk * w + si] ?? 0) : 0;
  return { grid, x0, z0, w, d, comp, sizes, spawn };
}

function compAt(r: Reach, x: number, z: number): number {
  const i = Math.floor(x) - r.x0;
  const k = Math.floor(z) - r.z0;
  return i < 0 || k < 0 || i >= r.w || k >= r.d ? 0 : (r.comp[k * r.w + i] ?? 0);
}

/** Whether any cell within `radius` of (x, z) is in the spawn's component. */
function reachableNear(r: Reach, x: number, z: number, radius: number): boolean {
  if (r.spawn === 0) return false;
  for (let dz = -radius; dz <= radius; dz += 0.5)
    for (let dx = -radius; dx <= radius; dx += 0.5)
      if (dx * dx + dz * dz <= radius * radius && compAt(r, x + dx, z + dz) === r.spawn)
        return true;
  return false;
}

export function checkLevel(level: Level): CheckReport {
  const issues: LevelIssue[] = [];
  const add = (
    severity: LevelIssue['severity'],
    code: IssueCode,
    message: string,
    at: readonly [number, number] | null = null,
    ref: string | null = null,
  ): void => {
    issues.push({ severity, code, message, at, ref });
  };

  // --- Shape and references ----------------------------------------------
  const seen = new Set<string>();
  for (const list of [
    level.objects,
    level.decor,
    level.lights,
    level.mobs,
    level.patrols,
    level.spawnZones,
  ])
    for (const { id } of list) {
      if (seen.has(id)) add('error', 'duplicate-id', `Two entities are called ${id}`, null, id);
      seen.add(id);
    }
  const [w, d] = level.cells;
  const rowsOk = (rows: readonly string[]): boolean =>
    rows.length === d && rows.every((r) => r.length === w);
  if (!rowsOk(level.terrain.heights) || !rowsOk(level.terrain.materials))
    add('error', 'terrain-shape', `Terrain rows must be ${String(d)} rows of ${String(w)} cells`);
  for (const row of level.terrain.materials)
    for (const ch of row)
      if (CELL_DIGITS.indexOf(ch) >= level.terrain.palette.length) {
        add('error', 'terrain-shape', `Terrain uses palette index ${ch}, beyond the palette`);
        break;
      }
  const patrols = new Map(level.patrols.map((p) => [p.id, p]));
  for (const m of level.mobs)
    if (m.patrol !== null && !patrols.has(m.patrol))
      add('error', 'unknown-patrol', `${m.id} follows unknown patrol ${m.patrol}`, m.at, m.id);

  const [x0, z0, x1, z1] = levelBounds(level);
  const inside = (x: number, z: number): boolean => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const placed: { id: string; at: readonly [number, number] }[] = [
    { id: 'spawn', at: level.spawn.at },
    ...level.mobs,
    ...level.decor,
    ...level.lights.map((l) => ({ id: l.id, at: [l.at[0], l.at[2]] as const })),
    ...level.objects.map((o) => ({ id: o.id, at: [o.center[0], o.center[2]] as const })),
    ...(level.story?.interactables ?? []).map((i) => ({
      id: i.id,
      at: [i.at[0], i.at[2]] as const,
    })),
  ];
  for (const p of placed)
    if (!inside(p.at[0], p.at[1]))
      add('error', 'out-of-bounds', `${p.id} lies outside the terrain`, p.at, p.id);

  if (level.story !== null)
    for (const e of validateStory(level.story, { lore: false })) add('error', 'story', e);

  // --- Budgets -------------------------------------------------------------
  const layout = levelToLayout(level);
  if (level.lights.length > LEVEL_BUDGETS.lights)
    add(
      'warning',
      'budget',
      `${String(level.lights.length)} lights (budget ${String(LEVEL_BUDGETS.lights)})`,
    );
  if (layout.boxes.length > LEVEL_BUDGETS.boxes)
    add(
      'warning',
      'budget',
      `${String(layout.boxes.length)} boxes after merging (budget ${String(LEVEL_BUDGETS.boxes)})`,
    );
  if (level.mobs.length > LEVEL_BUDGETS.mobs)
    add(
      'warning',
      'budget',
      `${String(level.mobs.length)} placed mobs (budget ${String(LEVEL_BUDGETS.mobs)})`,
    );
  if (level.decor.length > LEVEL_BUDGETS.decor)
    add(
      'warning',
      'budget',
      `${String(level.decor.length)} decor props (budget ${String(LEVEL_BUDGETS.decor)})`,
    );

  // --- Navigation: reachability and stuck spots ----------------------------
  const r = components(level);
  if (r.spawn === 0)
    add(
      'error',
      'spawn-blocked',
      'The player spawn is inside geometry: the player would be stuck',
      level.spawn.at,
      'spawn',
    );
  for (const m of level.mobs) {
    const c = compAt(r, m.at[0], m.at[1]);
    if (c === 0) add('error', 'mob-stuck', `${m.id} stands inside geometry`, m.at, m.id);
    else if (c !== r.spawn)
      add('warning', 'unreachable', `${m.id} can never reach the player (walled off)`, m.at, m.id);
  }
  for (const i of level.story?.interactables ?? [])
    if (!reachableNear(r, i.at[0], i.at[2], i.radius))
      add(
        'error',
        'unreachable',
        `The player cannot get within reach of ${i.id}`,
        [i.at[0], i.at[2]],
        i.id,
      );
  for (const z of level.spawnZones) {
    let any = false;
    for (let x = Math.ceil(z.min[0]); x < z.max[0] && !any; x++)
      for (let y = Math.ceil(z.min[1]); y < z.max[1] && !any; y++)
        any = compAt(r, x + 0.5, y + 0.5) === r.spawn;
    if (!any)
      add(
        'error',
        'zone-unreachable',
        `Spawn zone ${z.id} has no walkable ground the player can reach`,
        [(z.min[0] + z.max[0]) / 2, (z.min[1] + z.max[1]) / 2],
        z.id,
      );
  }
  // Patrols: every leg must have a path (the mobs' own A*, same budget class).
  const finder = new PathFinder(160);
  const out = new Float64Array(256);
  const result: PathResult = { status: 'failed', points: 0, expansions: 0 };
  for (const p of level.patrols) {
    const legs = p.loop ? p.points.length : p.points.length - 1;
    for (let k = 0; k < legs; k++) {
      const a = p.points[k];
      const b = p.points[(k + 1) % p.points.length];
      if (a === undefined || b === undefined) continue;
      if (compAt(r, a[0], a[1]) === 0) {
        add(
          'error',
          'patrol-blocked',
          `Patrol ${p.id} point ${String(k)} is inside geometry`,
          a,
          p.id,
        );
        continue;
      }
      finder.find(r.grid, a[0], a[1], b[0], b[1], 20000, out, 128, result);
      if (result.status !== 'found')
        add(
          'error',
          'patrol-blocked',
          `Patrol ${p.id} has no path from point ${String(k)} to ${String((k + 1) % p.points.length)}`,
          a,
          p.id,
        );
    }
  }
  // Pockets: walkable ground the player cannot reach. Anything placed there is stuck.
  let walkable = 0;
  for (let c = 1; c < r.sizes.length; c++) {
    const size = r.sizes[c] ?? 0;
    walkable += size;
    if (c === r.spawn || size < POCKET_MIN_AREA) continue;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < r.comp.length; i++)
      if (r.comp[i] === c) {
        sx += (i % r.w) + r.x0 + 0.5;
        sz += Math.floor(i / r.w) + r.z0 + 0.5;
      }
    add('warning', 'pocket', `${String(size)} m² of walkable ground is walled off from the spawn`, [
      sx / size,
      sz / size,
    ]);
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  return {
    issues,
    errors,
    warnings: issues.length - errors,
    walkable,
    reachable: r.spawn === 0 ? 0 : (r.sizes[r.spawn] ?? 0),
  };
}
