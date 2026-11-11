import { z } from 'zod';
import { ZONE_IDS } from '../audio/zones';
import { MOB_IDS, type MobId } from '../mobs/registry';
import { MATERIALS, type MaterialId } from '../procgen/materials';
import { StorySchema } from '../story/schema';

/**
 * Levels (stage 9): what the editor authors and the game plays. A level is
 * versioned, validated JSON that compiles to the same `StreetLayout` the
 * engine already runs (colliders, nav grid, renderer, soundscape), plus
 * the mobs, patrols, spawn zones and story placed in it. The text form is
 * diff-friendly: two-space JSON, one terrain row per line, entities in
 * authoring order. Old versions are migrated forward and validated.
 */
export const LEVEL_FORMAT = 'war-level';
export const LEVEL_VERSION = 2;

/** Terrain cell size (m) and height step per level digit (m). */
export const TERRAIN_CELL = 2;
export const HEIGHT_STEP = 0.15;
/** Height digits 0–9: up to 0.3 m is walkable floor; 3 and above is a raised block (a wall to walk around). */
export const MAX_HEIGHT = 9;
/** Digits for terrain rows; a material row uses the same alphabet as palette indices. */
export const CELL_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

const Id = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'ids are camelCase');
const XZ = z.tuple([z.number(), z.number()]);
const XYZ = z.tuple([z.number(), z.number(), z.number()]);
const Material = z.custom<MaterialId>((v) => typeof v === 'string' && Object.hasOwn(MATERIALS, v), {
  message: 'unknown material',
});
const Mob = z.custom<MobId>((v) => typeof v === 'string' && MOB_IDS.some((m) => m === v), {
  message: 'unknown mob',
});

export const PROP_KINDS = ['barrel', 'crate', 'lampPost', 'fungus', 'tree', 'rock'] as const;
export const LIGHT_KINDS = ['sodiumLamp', 'emergencyBeacon', 'bioluminescence', 'window'] as const;

export const ObjectSchema = z.object({
  id: Id,
  /** A box: walls, slabs, containers, ramps of stairs. */
  material: Material,
  center: XYZ,
  size: XYZ,
  yaw: z.number(),
  solid: z.boolean(),
});

export const DecorSchema = z.object({
  id: Id,
  kind: z.enum(PROP_KINDS),
  material: Material,
  at: XZ,
  yaw: z.number(),
  scale: z.number().positive().max(5),
});

export const LightSchema = z.object({
  id: Id,
  kind: z.enum(LIGHT_KINDS),
  at: XYZ,
  color: XYZ,
  intensity: z.number().min(0),
  range: z.number().positive(),
  flicker: z.number().min(0).max(1),
});

export const MobPlacementSchema = z.object({
  id: Id,
  mob: Mob,
  at: XZ,
  yaw: z.number(),
  /** Walks this patrol path instead of wandering (null = wanders around where placed). */
  patrol: Id.nullable(),
});

export const PatrolSchema = z.object({
  id: Id,
  points: z.array(XZ).min(2),
  loop: z.boolean(),
});

export const SpawnZoneSchema = z.object({
  id: Id,
  min: XZ,
  max: XZ,
  mobs: z.array(Mob).min(1),
  /** Living mobs this zone keeps topped up. */
  population: z.number().int().min(1).max(16),
});

export const TerrainSchema = z.object({
  /** Materials by index (the digits of `materials` rows). */
  palette: z.array(Material).min(1).max(CELL_DIGITS.length),
  /** One string per row (z), one digit per cell (x): height level 0–9. */
  heights: z.array(z.string().regex(/^[0-9]*$/)),
  /** One string per row, one digit per cell: palette index. */
  materials: z.array(z.string().regex(/^[0-9a-z]*$/)),
});

export const LevelSchema = z.object({
  format: z.literal(LEVEL_FORMAT),
  version: z.literal(LEVEL_VERSION),
  id: Id,
  title: z.string(),
  /** Seeds the procedural detail and textures (same seed, same look). */
  seed: z.number().int().min(0).max(0xffffffff),
  /** Soundscape zone the whole level sounds like. */
  zone: z.enum(ZONE_IDS),
  /** South-west corner of the terrain (m) and its size in cells. */
  origin: XZ,
  cells: z.tuple([z.number().int().min(4).max(128), z.number().int().min(4).max(128)]),
  spawn: z.object({ at: XZ, yaw: z.number() }),
  terrain: TerrainSchema,
  objects: z.array(ObjectSchema),
  decor: z.array(DecorSchema),
  lights: z.array(LightSchema),
  mobs: z.array(MobPlacementSchema),
  patrols: z.array(PatrolSchema),
  spawnZones: z.array(SpawnZoneSchema),
  /** Quests, logs, radio, interactables and triggers of this level (null = none). */
  story: StorySchema.nullable(),
});

export type Level = z.infer<typeof LevelSchema>;
export type LevelObject = z.infer<typeof ObjectSchema>;
export type LevelDecor = z.infer<typeof DecorSchema>;
export type LevelLight = z.infer<typeof LightSchema>;
export type MobPlacement = z.infer<typeof MobPlacementSchema>;
export type Patrol = z.infer<typeof PatrolSchema>;
export type SpawnZone = z.infer<typeof SpawnZoneSchema>;

/** v1 (stage 9 prototype): a flat floor of one material; mobs without patrols; no spawn zones. */
const LevelV1Schema = z.object({
  format: z.literal(LEVEL_FORMAT),
  version: z.literal(1),
  id: Id,
  title: z.string(),
  seed: z.number().int().min(0).max(0xffffffff),
  zone: z.enum(ZONE_IDS),
  origin: XZ,
  cells: z.tuple([z.number().int().min(4).max(128), z.number().int().min(4).max(128)]),
  spawn: z.object({ at: XZ, yaw: z.number() }),
  floor: Material,
  objects: z.array(ObjectSchema),
  decor: z.array(DecorSchema),
  lights: z.array(LightSchema),
  mobs: z.array(z.object({ id: Id, mob: Mob, at: XZ, yaw: z.number() })),
});

function v1to2(v1: z.infer<typeof LevelV1Schema>): Level {
  const [w, d] = v1.cells;
  return {
    format: LEVEL_FORMAT,
    version: 2,
    id: v1.id,
    title: v1.title,
    seed: v1.seed,
    zone: v1.zone,
    origin: v1.origin,
    cells: v1.cells,
    spawn: v1.spawn,
    terrain: {
      palette: [v1.floor],
      heights: Array.from({ length: d }, () => '0'.repeat(w)),
      materials: Array.from({ length: d }, () => '0'.repeat(w)),
    },
    objects: v1.objects,
    decor: v1.decor,
    lights: v1.lights,
    mobs: v1.mobs.map((m) => ({ ...m, patrol: null })),
    patrols: [],
    spawnZones: [],
    story: null,
  };
}

/** Parses any known level version into the current one (throws on anything else). */
export function parseLevel(json: unknown): Level {
  const version: unknown =
    typeof json === 'object' && json !== null ? Reflect.get(json, 'version') : undefined;
  switch (version) {
    case 1:
      return LevelSchema.parse(v1to2(LevelV1Schema.parse(json)));
    case LEVEL_VERSION:
      return LevelSchema.parse(json);
    default:
      throw new Error(`Unknown level version ${String(version)}`);
  }
}

/**
 * Diff-friendly text: two-space JSON with short arrays (points, colours,
 * sizes) kept on one line, so a moved crate is a one-line diff.
 */
export function serializeLevel(level: Level): string {
  const text = JSON.stringify(
    LevelSchema.parse(level),
    (_k, v: unknown) => (typeof v === 'number' && Object.is(v, -0) ? 0 : v),
    2,
  );
  // Collapse arrays of 2–3 numbers onto one line: "[\n  1,\n  2\n]" → "[1, 2]".
  return `${text.replace(
    /\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)(?:,\s+(-?[\d.e+-]+))?\s+\]/g,
    (_m, a: string, b: string, c: string | undefined) =>
      c === undefined ? `[${a}, ${b}]` : `[${a}, ${b}, ${c}]`,
  )}\n`;
}

/** World bounds of the terrain: [minX, minZ, maxX, maxZ]. */
export function levelBounds(level: Level): [number, number, number, number] {
  const [x0, z0] = level.origin;
  return [x0, z0, x0 + level.cells[0] * TERRAIN_CELL, z0 + level.cells[1] * TERRAIN_CELL];
}

/** Terrain cell under a world point, or null outside the terrain. */
export function cellAt(level: Level, x: number, z: number): [number, number] | null {
  const i = Math.floor((x - level.origin[0]) / TERRAIN_CELL);
  const k = Math.floor((z - level.origin[1]) / TERRAIN_CELL);
  return i < 0 || k < 0 || i >= level.cells[0] || k >= level.cells[1] ? null : [i, k];
}

export function heightAt(level: Level, i: number, k: number): number {
  return CELL_DIGITS.indexOf(level.terrain.heights[k]?.[i] ?? '0');
}

export function materialAt(level: Level, i: number, k: number): MaterialId {
  const idx = CELL_DIGITS.indexOf(level.terrain.materials[k]?.[i] ?? '0');
  return level.terrain.palette[idx] ?? level.terrain.palette[0] ?? 'concrete';
}

/** A fresh, flat, empty level (the editor's "New"). */
export function newLevel(o: {
  id?: string;
  title?: string;
  seed?: number;
  cells?: [number, number];
  zone?: Level['zone'];
}): Level {
  const [w, d] = o.cells ?? [32, 32];
  return LevelSchema.parse({
    format: LEVEL_FORMAT,
    version: LEVEL_VERSION,
    id: o.id ?? 'untitled',
    title: o.title ?? 'Untitled',
    seed: o.seed ?? 1,
    zone: o.zone ?? 'abandonedCity',
    origin: [-w, -d],
    cells: [w, d],
    spawn: { at: [0, 0], yaw: 0 },
    terrain: {
      palette: ['asphalt', 'concrete', 'forestFloor', 'brick'],
      heights: Array.from({ length: d }, () => '0'.repeat(w)),
      materials: Array.from({ length: d }, () => '1'.repeat(w)),
    },
    objects: [],
    decor: [],
    lights: [],
    mobs: [],
    patrols: [],
    spawnZones: [],
    story: null,
  });
}
