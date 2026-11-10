import type { ZoneId } from '../audio/zones';
import type { MaterialId } from '../procgen/materials';
import { CHUNK_SIZE, chunkCoord } from './chunks';
import type { Vec3 } from './street-layout';

/**
 * The authored structure of the open world: hub zones, the road network that
 * connects them and the quarantine wall around everything. Procedural detail
 * (chunk-gen.ts) is generated on top of this, chunk by chunk.
 *
 *            N (+z)
 *   ┌──────────────┬───────────────┐
 *   │   forest     │   research    │
 *   │              │   complex     │
 *   │      ┌───────┴──────┐        │
 *   │      │    subway    │        │
 *   ├──────┴──────────────┴────────┤  ← main avenue (z = −16)
 *   │  abandoned   │  industrial   │
 *   │    city      │    yards      │
 *   └──────────────┴───────────────┘
 *
 * Units are metres; the world spans chunks [MIN_CHUNK, MAX_CHUNK] on both axes.
 */
export const MIN_CHUNK = -8;
export const MAX_CHUNK = 7;
export const WORLD_MIN = MIN_CHUNK * CHUNK_SIZE;
export const WORLD_MAX = (MAX_CHUNK + 1) * CHUNK_SIZE;

export interface Hub {
  readonly zone: ZoneId;
  readonly label: string;
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
  /** Bare-ground material outside roads and buildings. */
  readonly ground: MaterialId;
  /** A clear point on a road inside the hub (teleport target, later spawns). */
  readonly anchor: Vec3;
}

export const HUBS: readonly Hub[] = [
  {
    zone: 'abandonedCity',
    label: 'Abandoned city',
    min: [-240, -240],
    max: [-24, -24],
    ground: 'concrete',
    anchor: [-128, 0, -64],
  },
  {
    zone: 'industrial',
    label: 'Industrial yards',
    min: [24, -240],
    max: [240, -24],
    ground: 'concrete',
    anchor: [128, 0, -96],
  },
  {
    zone: 'subway',
    label: 'Subway station',
    min: [-56, -8],
    max: [56, 72],
    ground: 'concrete',
    anchor: [0, 0, 40],
  },
  {
    zone: 'forest',
    label: 'Forest',
    min: [-240, 88],
    max: [-40, 240],
    ground: 'forestFloor',
    anchor: [-128, 0, 160],
  },
  {
    zone: 'researchComplex',
    label: 'Research complex',
    min: [72, 96],
    max: [232, 232],
    ground: 'concrete',
    anchor: [160, 0, 160],
  },
];

/** An axis-aligned road band: a centre line from `from` to `to` along one axis. */
export interface Road {
  readonly axis: 'x' | 'z';
  /** Fixed coordinate of the centre line (z for an x-road, x for a z-road). */
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly halfWidth: number;
}

export const ROADS: readonly Road[] = [
  // Main avenue between the southern hubs and the station.
  { axis: 'x', at: -16, from: -248, to: 248, halfWidth: 6 },
  // North–south avenue through the station plaza.
  { axis: 'z', at: 0, from: -248, to: 248, halfWidth: 6 },
  // City high street (the stage-1 street lives on here) and the industrial access road.
  { axis: 'z', at: -128, from: -248, to: 160, halfWidth: 5 },
  { axis: 'z', at: 128, from: -248, to: -16, halfWidth: 5 },
  // Old road through the forest and the research complex gate road.
  { axis: 'x', at: 160, from: -248, to: 248, halfWidth: 4 },
];

/** City streets run on every chunk border inside the city: blocks are one chunk. */
const CITY_STREET_HALF = 4;
const SIDEWALK = 2;

/** Distance from a point to a hub rectangle (0 inside). */
function hubDistance(h: Hub, x: number, z: number): number {
  const dx = Math.max(h.min[0] - x, 0, x - h.max[0]);
  const dz = Math.max(h.min[1] - z, 0, z - h.max[1]);
  return Math.sqrt(dx * dx + dz * dz);
}

/** The hub a world point belongs to: the one containing it, else the nearest. */
export function hubAt(x: number, z: number): Hub {
  let best = HUBS[0];
  let bestD = Infinity;
  for (const h of HUBS) {
    const d = hubDistance(h, x, z);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  if (best === undefined) throw new Error('no hubs');
  return best;
}

const SPAN = MAX_CHUNK - MIN_CHUNK + 1;
/** Hub of every in-world chunk, computed once (cell classification asks millions of times). */
let hubTable: readonly Hub[] | null = null;

function buildHubTable(): readonly Hub[] {
  const table: Hub[] = [];
  for (let j = 0; j < SPAN; j++) {
    for (let i = 0; i < SPAN; i++) {
      table.push(hubAt((MIN_CHUNK + i + 0.5) * CHUNK_SIZE, (MIN_CHUNK + j + 0.5) * CHUNK_SIZE));
    }
  }
  return table;
}

/** Zone of a whole chunk (decided at its centre, so every system agrees). */
export function chunkHub(cx: number, cz: number): Hub {
  if (!inWorld(cx, cz)) return hubAt((cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE);
  hubTable ??= buildHubTable();
  const hub = hubTable[(cz - MIN_CHUNK) * SPAN + (cx - MIN_CHUNK)];
  if (hub === undefined) throw new Error('hub table out of range');
  return hub;
}

export function inWorld(cx: number, cz: number): boolean {
  return cx >= MIN_CHUNK && cx <= MAX_CHUNK && cz >= MIN_CHUNK && cz <= MAX_CHUNK;
}

/** How far (metres) a point lies outside every road band: negative = on a road. */
export function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const r of ROADS) {
    const along = r.axis === 'x' ? x : z;
    const across = r.axis === 'x' ? z : x;
    // Signed distance to the band's rectangle: negative inside.
    const d = Math.max(Math.abs(across - r.at) - r.halfWidth, r.from - along, along - r.to);
    if (d < best) best = d;
  }
  // City grid: a street on each chunk border with a city chunk on either side.
  const city = cityStreetDistance(x, z);
  return Math.min(best, city);
}

function isCity(cx: number, cz: number): boolean {
  return inWorld(cx, cz) && chunkHub(cx, cz).zone === 'abandonedCity';
}

function cityStreetDistance(x: number, z: number): number {
  const cx = chunkCoord(x);
  const cz = chunkCoord(z);
  let best = Infinity;
  // Vertical border nearest to x, within this chunk row.
  const bx = Math.round(x / CHUNK_SIZE);
  if (isCity(bx - 1, cz) || isCity(bx, cz)) {
    best = Math.min(best, Math.abs(x - bx * CHUNK_SIZE) - CITY_STREET_HALF);
  }
  const bz = Math.round(z / CHUNK_SIZE);
  if (isCity(cx, bz - 1) || isCity(cx, bz)) {
    best = Math.min(best, Math.abs(z - bz * CHUNK_SIZE) - CITY_STREET_HALF);
  }
  return best;
}

/** What a 1 m ground cell is: decides its material, height and what may be built on it. */
export const CELL = { ground: 0, road: 1, sidewalk: 2 } as const;
export type CellClass = (typeof CELL)[keyof typeof CELL];

/** Hubs with pavements along their roads. */
const PAVED: ReadonlySet<ZoneId> = new Set(['abandonedCity', 'subway', 'researchComplex']);

/** Class of the cell whose centre is (x, z). Pure in world coordinates, so neighbours agree. */
export function cellClassAt(x: number, z: number): CellClass {
  const d = roadDistance(x, z);
  if (d < 0) return CELL.road;
  if (d < SIDEWALK && PAVED.has(chunkHub(chunkCoord(x), chunkCoord(z)).zone)) return CELL.sidewalk;
  return CELL.ground;
}

export const CURB_HEIGHT = 0.15;

/** Player start: on the main avenue at the city's east edge, looking toward the station. */
export const WORLD_SPAWN: { readonly position: Vec3; readonly yaw: number } = {
  position: [-72, 0, -14],
  yaw: -Math.PI / 2,
};
