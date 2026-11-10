import type { ZoneId } from '../audio/zones';
import type { Seed } from '../core/brand';
import { cos, sin, PI } from '../math/dmath';
import { Rng } from '../math/prng';
import type { MaterialId } from '../procgen/materials';
import { CHUNK_SIZE } from './chunks';
import type {
  BlockerPiece,
  BoxPiece,
  LightPiece,
  PropKind,
  PropPiece,
  Vec3,
  ZoneVolume,
} from './street-layout';
import {
  CELL,
  CURB_HEIGHT,
  HUBS,
  MAX_CHUNK,
  MIN_CHUNK,
  WORLD_MAX,
  WORLD_MIN,
  WORLD_SPAWN,
  cellClassAt,
  chunkHub,
  type CellClass,
  type Hub,
} from './world-map';

/**
 * Procedural detail for one chunk of the open world. A pure function of
 * (seed, cx, cz): the simulation (colliders) and the render worker (meshes)
 * call it independently and get identical content. Everything stays inside
 * the chunk, so neighbours never overlap and chunks load in any order.
 */
export interface ChunkContent {
  readonly cx: number;
  readonly cz: number;
  readonly zone: ZoneId;
  readonly boxes: readonly BoxPiece[];
  readonly blockers: readonly BlockerPiece[];
  readonly props: readonly PropPiece[];
  readonly lights: readonly LightPiece[];
  readonly volume: ZoneVolume;
}

/** Per-chunk caps keep the worst case bounded for the frame and collider budgets. */
export const CHUNK_LIMITS = { boxes: 96, props: 96, lights: 5 } as const;

const N = CHUNK_SIZE;
const GROUND_DEPTH = 0.4;
/** Keep wrecks and debris off the player start and the hub anchors. */
const KEEP_CLEAR = 7;

const SODIUM: Vec3 = [1.0, 0.55, 0.18];
const COLD: Vec3 = [0.7, 0.85, 1.0];
const WARM_WINDOW: Vec3 = [1.0, 0.62, 0.3];
const RED: Vec3 = [1.0, 0.08, 0.04];
const CYAN: Vec3 = [0.15, 1.0, 0.75];

class ChunkBuilder {
  readonly boxes: BoxPiece[] = [];
  readonly blockers: BlockerPiece[] = [];
  readonly props: PropPiece[] = [];
  readonly lights: LightPiece[] = [];
  /** Cell classes, row-major [z][x]. */
  readonly cells = new Uint8Array(N * N);
  /** 1 = something already stands here (or nothing may). */
  readonly used = new Uint8Array(N * N);
  readonly x0: number;
  readonly z0: number;

  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly hub: Hub,
    readonly rng: Rng,
  ) {
    this.x0 = cx * N;
    this.z0 = cz * N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = cellClassAt(this.x0 + i + 0.5, this.z0 + j + 0.5);
        this.cells[j * N + i] = c;
        if (c !== CELL.ground || nearReserved(this.x0 + i + 0.5, this.z0 + j + 0.5))
          this.used[j * N + i] = 1;
      }
    }
  }

  cell(i: number, j: number): CellClass | -1 {
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    const c = this.cells[j * N + i];
    return c === CELL.road ? CELL.road : c === CELL.sidewalk ? CELL.sidewalk : CELL.ground;
  }

  /** True when every cell of the local rect [i0, i1) × [j0, j1) is free ground, at least `margin` from the edge. */
  free(i0: number, j0: number, i1: number, j1: number, margin = 1): boolean {
    if (i0 < margin || j0 < margin || i1 > N - margin || j1 > N - margin) return false;
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) if (this.used[j * N + i] === 1) return false;
    return true;
  }

  claim(i0: number, j0: number, i1: number, j1: number): void {
    for (let j = Math.max(0, j0); j < Math.min(N, j1); j++)
      for (let i = Math.max(0, i0); i < Math.min(N, i1); i++) this.used[j * N + i] = 1;
  }

  /**
   * Tries to place a w×d footprint (metres, axis-aligned) on free ground.
   * Returns its world centre, or null after `tries` misses.
   */
  place(w: number, d: number, tries: number, margin = 1): readonly [number, number] | null {
    const wi = Math.ceil(w);
    const di = Math.ceil(d);
    if (wi > N - 2 * margin || di > N - 2 * margin) return null;
    for (let t = 0; t < tries; t++) {
      const i0 = this.rng.int(margin, N - margin - wi);
      const j0 = this.rng.int(margin, N - margin - di);
      if (!this.free(i0, j0, i0 + wi, j0 + di, margin)) continue;
      // Claim one extra cell around it so things do not touch.
      this.claim(i0 - 1, j0 - 1, i0 + wi + 1, j0 + di + 1);
      return [this.x0 + i0 + wi / 2, this.z0 + j0 + di / 2];
    }
    return null;
  }

  /** A random cell of the given class, or null. */
  pickCell(cls: CellClass, tries: number, needFree: boolean): readonly [number, number] | null {
    for (let t = 0; t < tries; t++) {
      const i = this.rng.int(1, N - 2);
      const j = this.rng.int(1, N - 2);
      if (this.cell(i, j) !== cls) continue;
      if (needFree && this.used[j * N + i] === 1 && cls === CELL.ground) continue;
      const x = this.x0 + i + 0.5;
      const z = this.z0 + j + 0.5;
      if (nearReserved(x, z)) continue;
      return [x, z];
    }
    return null;
  }

  box(material: MaterialId, center: Vec3, size: Vec3, yaw = 0, solid = true): void {
    if (this.boxes.length >= CHUNK_LIMITS.boxes) return;
    this.boxes.push({ material, center, size, yaw, solid });
  }

  prop(kind: PropKind, material: MaterialId, position: Vec3, yaw: number, scale: number): void {
    if (this.props.length >= CHUNK_LIMITS.props) return;
    this.props.push({ kind, material, position, yaw, scale });
  }

  light(piece: LightPiece): void {
    if (this.lights.length >= CHUNK_LIMITS.lights) return;
    this.lights.push(piece);
  }

  /** Lamp post at (x, z) whose arm points along yaw; maybe lit. */
  lamp(x: number, z: number, y: number, yaw: number, color: Vec3, aliveChance: number): void {
    this.prop('lampPost', 'paintedMetal', [x, y, z], yaw, 1);
    const state = this.rng.nextFloat();
    if (state >= aliveChance) return;
    this.light({
      kind: 'sodiumLamp',
      position: [x + 1.6 * cos(yaw), y + 6.05, z - 1.6 * sin(yaw)],
      color,
      intensity: 60,
      range: 22,
      flicker: state < aliveChance * 0.25 ? 0.8 : 0.05,
    });
  }
}

/** Points nothing may be built on: the player start and the hub anchors (teleport targets). */
const RESERVED: readonly Vec3[] = [WORLD_SPAWN.position, ...HUBS.map((h) => h.anchor)];

function nearReserved(x: number, z: number): boolean {
  for (const p of RESERVED) {
    const dx = x - p[0];
    const dz = z - p[2];
    if (dx * dx + dz * dz < KEEP_CLEAR * KEEP_CLEAR) return true;
  }
  return false;
}

/** Ground, roads and pavements as non-overlapping rectangles (greedy merge of 1 m cells). */
function buildGround(b: ChunkBuilder): void {
  const done = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (done[j * N + i] === 1) continue;
      const cls = b.cell(i, j);
      let w = 1;
      while (i + w < N && done[j * N + i + w] !== 1 && b.cell(i + w, j) === cls) w++;
      let d = 1;
      grow: while (j + d < N) {
        for (let k = 0; k < w; k++) {
          if (done[(j + d) * N + i + k] === 1 || b.cell(i + k, j + d) !== cls) break grow;
        }
        d++;
      }
      for (let jj = j; jj < j + d; jj++) for (let ii = i; ii < i + w; ii++) done[jj * N + ii] = 1;
      const top = cls === CELL.sidewalk ? CURB_HEIGHT : 0;
      const material: MaterialId =
        cls === CELL.road ? 'asphalt' : cls === CELL.sidewalk ? 'concrete' : b.hub.ground;
      const height = top + GROUND_DEPTH;
      // Ground is exempt from the box cap: a chunk without floor would swallow the player.
      b.boxes.push({
        material,
        center: [b.x0 + i + w / 2, top - height / 2, b.z0 + j + d / 2],
        size: [w, height, d],
        yaw: 0,
        solid: true,
      });
    }
  }
}

/** Concrete quarantine wall plus an invisible blocker on the outer edges of the world. */
function buildBorder(b: ChunkBuilder): void {
  const wallH = 6;
  const mid = (a: number): number => a + N / 2;
  const edges: { on: boolean; center: Vec3; size: Vec3; blocker: BlockerPiece }[] = [
    {
      on: b.cx === MIN_CHUNK,
      center: [WORLD_MIN + 0.5, wallH / 2, mid(b.z0)],
      size: [1, wallH, N],
      blocker: { center: [WORLD_MIN - 0.5, 10, mid(b.z0)], size: [1, 20, N] },
    },
    {
      on: b.cx === MAX_CHUNK,
      center: [WORLD_MAX - 0.5, wallH / 2, mid(b.z0)],
      size: [1, wallH, N],
      blocker: { center: [WORLD_MAX + 0.5, 10, mid(b.z0)], size: [1, 20, N] },
    },
    {
      on: b.cz === MIN_CHUNK,
      center: [mid(b.x0), wallH / 2, WORLD_MIN + 0.5],
      size: [N, wallH, 1],
      blocker: { center: [mid(b.x0), 10, WORLD_MIN - 0.5], size: [N, 20, 1] },
    },
    {
      on: b.cz === MAX_CHUNK,
      center: [mid(b.x0), wallH / 2, WORLD_MAX - 0.5],
      size: [N, wallH, 1],
      blocker: { center: [mid(b.x0), 10, WORLD_MAX + 0.5], size: [N, 20, 1] },
    },
  ];
  for (const e of edges) {
    if (!e.on) continue;
    b.box('concrete', e.center, e.size);
    b.blockers.push(e.blocker);
  }
  // Nothing may be built against the wall.
  if (b.cx === MIN_CHUNK) b.claim(0, 0, 2, N);
  if (b.cx === MAX_CHUNK) b.claim(N - 2, 0, N, N);
  if (b.cz === MIN_CHUNK) b.claim(0, 0, N, 2);
  if (b.cz === MAX_CHUNK) b.claim(0, N - 2, N, N);
}

/** Yaw that points a lamp arm from (x, z) toward the nearest road, or null if none is close. */
function yawTowardRoad(x: number, z: number): number | null {
  const probes: readonly (readonly [number, number, number])[] = [
    [3, 0, 0],
    [-3, 0, PI],
    [0, -3, PI / 2],
    [0, 3, -PI / 2],
  ];
  for (const [dx, dz, yaw] of probes) {
    if (cellClassAt(x + dx, z + dz) === CELL.road) return yaw;
  }
  return null;
}

function scatterDebris(b: ChunkBuilder, count: number, metals: readonly MaterialId[]): void {
  for (let k = 0; k < count; k++) {
    const onRoad = b.rng.chance(0.35);
    const at = b.pickCell(onRoad ? CELL.road : CELL.ground, 8, true);
    if (at === null) continue;
    const [x, z] = at;
    const i = Math.floor(x - b.x0);
    const j = Math.floor(z - b.z0);
    if (!onRoad) b.claim(i, j, i + 1, j + 1);
    const kind: PropKind = b.rng.chance(0.55) ? 'barrel' : 'crate';
    const material: MaterialId =
      kind === 'crate' ? 'woodPlanks' : (metals[b.rng.int(0, metals.length - 1)] ?? 'rustedMetal');
    b.prop(kind, material, [x, 0, z], b.rng.range(-PI, PI), b.rng.range(0.85, 1.15));
  }
}

function wreck(b: ChunkBuilder): void {
  const at = b.pickCell(CELL.road, 10, false);
  if (at === null) return;
  const [x, z] = at;
  // Keep the whole car (±2.5 m) inside the chunk.
  if (x - b.x0 < 3 || b.x0 + N - x < 3 || z - b.z0 < 3 || b.z0 + N - z < 3) return;
  const along = cellClassAt(x, z + 3) === CELL.road && cellClassAt(x, z - 3) === CELL.road;
  const yaw = (along ? 0 : PI / 2) + b.rng.range(-0.5, 0.5);
  b.box('rustedMetal', [x, 0.55, z], [1.9, 0.8, 4.3], yaw);
  b.box('rustedMetal', [x - 0.2 * sin(yaw), 1.2, z - 0.2 * cos(yaw)], [1.7, 0.6, 2.2], yaw);
}

function fungus(b: ChunkBuilder, lightChance: number): void {
  const at = b.pickCell(CELL.ground, 8, true);
  if (at === null) return;
  const [x, z] = at;
  const cluster = b.rng.int(3, 7);
  for (let k = 0; k < cluster; k++) {
    b.prop(
      'fungus',
      'concrete',
      [x + b.rng.range(-0.5, 0.5), b.rng.range(0, 0.9), z + b.rng.range(-0.5, 0.5)],
      b.rng.range(-3, 3),
      b.rng.range(0.12, 0.35),
    );
  }
  if (b.rng.chance(lightChance)) {
    b.light({
      kind: 'bioluminescence',
      position: [x, 0.6, z],
      color: CYAN,
      intensity: 2.5,
      range: 5,
      flicker: 0.15,
    });
  }
}

function windows(
  b: ChunkBuilder,
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
  color: Vec3,
  chance: number,
): void {
  if (!b.rng.chance(chance)) return;
  // A lit pane on the face toward the nearest road.
  const face = b.rng.int(0, 3);
  const y = b.rng.range(2.5, Math.max(2.6, Math.min(h - 1, 10)));
  const px =
    face === 0
      ? cx + w / 2 + 0.05
      : face === 1
        ? cx - w / 2 - 0.05
        : cx + b.rng.range(-w / 3, w / 3);
  const pz =
    face === 2
      ? cz + d / 2 + 0.05
      : face === 3
        ? cz - d / 2 - 0.05
        : cz + b.rng.range(-d / 3, d / 3);
  b.light({
    kind: 'window',
    position: [px, y, pz],
    color,
    intensity: b.rng.range(0.8, 2),
    range: 6,
    flicker: b.rng.chance(0.4) ? b.rng.range(0.2, 0.7) : 0,
    facing: face < 2 ? 'x' : 'z',
  });
}

function sidewalkLamps(b: ChunkBuilder, tries: number, color: Vec3, alive: number): void {
  for (let k = 0; k < tries; k++) {
    const at = b.pickCell(CELL.sidewalk, 12, false);
    if (at === null) continue;
    const yaw = yawTowardRoad(at[0], at[1]);
    if (yaw === null) continue;
    b.lamp(at[0], at[1], CURB_HEIGHT, yaw, color, alive);
  }
}

function genCity(b: ChunkBuilder): void {
  const buildings = b.rng.int(1, 3);
  for (let k = 0; k < buildings; k++) {
    const w = b.rng.range(7, k === 0 ? 20 : 12);
    const d = b.rng.range(7, k === 0 ? 20 : 12);
    const at = b.place(w, d, 14);
    if (at === null) continue;
    const h = b.rng.range(6, 24);
    const material: MaterialId = b.rng.chance(0.55) ? 'brick' : 'concrete';
    b.box(material, [at[0], h / 2, at[1]], [w, h, d]);
    windows(b, at[0], at[1], w, d, h, WARM_WINDOW, 0.3);
  }
  sidewalkLamps(b, 2, SODIUM, 0.45);
  if (b.rng.chance(0.45)) wreck(b);
  scatterDebris(b, b.rng.int(2, 6), ['rustedMetal', 'paintedMetal']);
  if (b.rng.chance(0.35)) fungus(b, 0.6);
}

function genIndustrial(b: ChunkBuilder): void {
  if (b.rng.chance(0.7)) {
    const w = b.rng.range(14, 24);
    const d = b.rng.range(10, 18);
    // Footprint includes the loading dock along the +z face.
    const at = b.place(w, d + 2, 10);
    if (at !== null) {
      const h = b.rng.range(7, 11);
      const z = at[1] - 1;
      b.box(b.rng.chance(0.5) ? 'paintedMetal' : 'rustedMetal', [at[0], h / 2, z], [w, h, d]);
      b.box('concrete', [at[0], 0.6, z + d / 2 + 1], [Math.min(8, w - 2), 1.2, 2]);
      windows(b, at[0], z, w, d, h, SODIUM, 0.25);
    }
  }
  const stacks = b.rng.int(1, 4);
  for (let k = 0; k < stacks; k++) {
    const turned = b.rng.chance(0.5);
    const w = turned ? 2.5 : 6.1;
    const d = turned ? 6.1 : 2.5;
    const at = b.place(w, d, 8);
    if (at === null) continue;
    const levels = b.rng.int(1, 3);
    for (let l = 0; l < levels; l++) {
      b.box(
        b.rng.chance(0.6) ? 'rustedMetal' : 'paintedMetal',
        [at[0], 1.3 + l * 2.6, at[1]],
        [w - 0.05, 2.58, d - 0.05],
        b.rng.range(-0.03, 0.03),
      );
    }
  }
  const pole = b.pickCell(CELL.ground, 10, true);
  if (pole !== null) {
    const i = Math.floor(pole[0] - b.x0);
    const j = Math.floor(pole[1] - b.z0);
    b.claim(i - 1, j - 1, i + 2, j + 2);
    b.lamp(pole[0], pole[1], 0, b.rng.range(-PI, PI), SODIUM, 0.6);
  }
  if (b.rng.chance(0.3)) wreck(b);
  scatterDebris(b, b.rng.int(3, 8), ['rustedMetal', 'rustedMetal', 'paintedMetal']);
}

function genSubway(b: ChunkBuilder): void {
  if (b.rng.chance(0.6)) {
    // Station entrance pavilion: walk-in shell (back + side walls, roof) with a barred stairwell.
    const turned = b.rng.chance(0.5);
    const w = turned ? 8 : 6;
    const d = turned ? 6 : 8;
    const at = b.place(w, d, 10, 2);
    if (at !== null) {
      const [x, z] = at;
      const h = 3.2;
      const t = 0.3;
      if (turned) {
        b.box('concrete', [x, h / 2, z - d / 2 + t / 2], [w, h, t]);
        b.box('concrete', [x - w / 2 + t / 2, h / 2, z], [t, h, d]);
        b.box('concrete', [x + w / 2 - t / 2, h / 2, z], [t, h, d]);
      } else {
        b.box('concrete', [x - w / 2 + t / 2, h / 2, z], [t, h, d]);
        b.box('concrete', [x, h / 2, z - d / 2 + t / 2], [w, h, t]);
        b.box('concrete', [x, h / 2, z + d / 2 - t / 2], [w, h, t]);
      }
      b.box('paintedMetal', [x, h + 0.15, z], [w + 0.6, 0.3, d + 0.6]);
      // The stairwell is sealed: a grate over a dark pit.
      b.box('rustedMetal', [x, 0.05, z], [Math.min(w, d) - 1.6, 0.1, Math.min(w, d) - 1.6]);
      if (b.rng.chance(0.5)) {
        b.light({
          kind: 'emergencyBeacon',
          position: [x, h + 0.45, z],
          color: RED,
          intensity: 40,
          range: 18,
          flicker: 0,
        });
      }
    }
  }
  const vents = b.rng.int(0, 2);
  for (let k = 0; k < vents; k++) {
    const at = b.place(2, 2, 6);
    if (at !== null) b.box('rustedMetal', [at[0], 0.75, at[1]], [2, 1.5, 2]);
  }
  if (b.rng.chance(0.4)) {
    const at = b.place(2.5, 2, 6);
    if (at !== null) b.box('woodPlanks', [at[0], 1.25, at[1]], [2.5, 2.5, 2]);
  }
  sidewalkLamps(b, 2, SODIUM, 0.35);
  if (b.rng.chance(0.3)) wreck(b);
  scatterDebris(b, b.rng.int(1, 4), ['paintedMetal']);
  if (b.rng.chance(0.25)) fungus(b, 0.5);
}

function genForest(b: ChunkBuilder): void {
  // Jittered grid of trees, thinned at random: no two trunks share a cell.
  for (let gj = 2; gj < N - 2; gj += 4) {
    for (let gi = 2; gi < N - 2; gi += 4) {
      if (!b.rng.chance(0.6)) continue;
      const i = gi + b.rng.int(0, 2);
      const j = gj + b.rng.int(0, 2);
      if (!b.free(i, j, i + 1, j + 1)) continue;
      b.claim(i, j, i + 1, j + 1);
      b.prop(
        'tree',
        'bark',
        [b.x0 + i + 0.5, 0, b.z0 + j + 0.5],
        b.rng.range(-PI, PI),
        b.rng.range(0.7, 1.4),
      );
    }
  }
  const rocks = b.rng.int(1, 4);
  for (let k = 0; k < rocks; k++) {
    const s = b.rng.range(0.5, 1.6);
    const at = b.place(2 * s, 2 * s, 6);
    if (at !== null) b.prop('rock', 'concrete', [at[0], 0, at[1]], b.rng.range(-PI, PI), s);
  }
  const logs = b.rng.int(0, 2);
  for (let k = 0; k < logs; k++) {
    const len = b.rng.range(4, 7);
    const at = b.place(len, len, 6);
    if (at !== null) b.box('bark', [at[0], 0.3, at[1]], [0.6, 0.6, len], b.rng.range(-PI, PI));
  }
  const clusters = b.rng.int(0, 3);
  for (let k = 0; k < clusters; k++) fungus(b, 0.7);
}

/** Fence segments along the research hub's border, open where roads pass (the gates). */
function researchFence(b: ChunkBuilder): void {
  const h = b.hub;
  const height = 2.8;
  const run = (fixed: number, axis: 'x' | 'z', a0: number, a1: number): void => {
    let start = -1;
    for (let a = a0; a <= a1; a++) {
      const x = axis === 'x' ? a + 0.5 : fixed;
      const z = axis === 'x' ? fixed : a + 0.5;
      const open = a === a1 || cellClassAt(x, z) !== CELL.ground;
      if (!open && start < 0) start = a;
      if (open && start >= 0) {
        const len = a - start;
        const c = start + len / 2;
        b.box(
          'rustedMetal',
          axis === 'x' ? [c, height / 2, fixed] : [fixed, height / 2, c],
          axis === 'x' ? [len, height, 0.08] : [0.08, height, len],
          0,
        );
        start = -1;
      }
    }
  };
  const lo = (v: number, origin: number): number => Math.max(v, origin);
  const hi = (v: number, origin: number): number => Math.min(v, origin + N);
  // Half a metre inside the hub: a fence on a chunk border would belong to two chunks.
  for (const z of [h.min[1] + 0.5, h.max[1] - 0.5]) {
    if (z >= b.z0 && z < b.z0 + N) {
      const a0 = lo(h.min[0], b.x0);
      const a1 = hi(h.max[0], b.x0);
      if (a1 > a0) run(z, 'x', a0, a1);
    }
  }
  for (const x of [h.min[0] + 0.5, h.max[0] - 0.5]) {
    if (x >= b.x0 && x < b.x0 + N) {
      const a0 = lo(h.min[1], b.z0);
      const a1 = hi(h.max[1], b.z0);
      if (a1 > a0) run(x, 'z', a0, a1);
    }
  }
}

function genResearch(b: ChunkBuilder): void {
  researchFence(b);
  const labs = b.rng.int(1, 2);
  for (let k = 0; k < labs; k++) {
    const w = b.rng.range(9, 18);
    const d = b.rng.range(8, 14);
    const at = b.place(w, d, 12, 2);
    if (at === null) continue;
    const h = b.rng.range(4, 9);
    b.box('concrete', [at[0], h / 2, at[1]], [w, h, d]);
    b.box('paintedMetal', [at[0], h + 0.4, at[1]], [w * 0.4, 0.8, d * 0.3]);
    windows(b, at[0], at[1], w, d, h, COLD, 0.55);
  }
  if (b.rng.chance(0.3)) {
    const at = b.place(1, 1, 6);
    if (at !== null) {
      b.box('paintedMetal', [at[0], 7, at[1]], [0.3, 14, 0.3]);
      b.light({
        kind: 'emergencyBeacon',
        position: [at[0], 14.2, at[1]],
        color: RED,
        intensity: 25,
        range: 14,
        flicker: 0,
      });
    }
  }
  sidewalkLamps(b, 2, COLD, 0.5);
  scatterDebris(b, b.rng.int(1, 3), ['paintedMetal']);
}

const GENERATORS: Readonly<Record<ZoneId, (b: ChunkBuilder) => void>> = {
  abandonedCity: genCity,
  industrial: genIndustrial,
  subway: genSubway,
  forest: genForest,
  researchComplex: genResearch,
};

export function generateChunk(seed: Seed, cx: number, cz: number): ChunkContent {
  const hub = chunkHub(cx, cz);
  const rng = Rng.stream(seed, `world.chunk:${String(cx)},${String(cz)}`);
  const b = new ChunkBuilder(cx, cz, hub, rng);
  buildGround(b);
  buildBorder(b);
  GENERATORS[hub.zone](b);
  return {
    cx,
    cz,
    zone: hub.zone,
    boxes: b.boxes,
    blockers: b.blockers,
    props: b.props,
    lights: b.lights,
    volume: { zone: hub.zone, min: [b.x0, b.z0], max: [b.x0 + N, b.z0 + N] },
  };
}
