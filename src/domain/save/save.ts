import { z } from 'zod';
import { RACES } from '../combat/races';
import { QUEST_STATUSES, AMMO_KINDS } from '../story/schema';
import type { StorySnapshot } from '../story/engine';

/**
 * Saves (stage 8): a versioned, validated JSON checkpoint of everything
 * that is the player's progress: where you stand, what you carry, the
 * hour and the weather, and the whole story state. The world itself is
 * regenerated from the seed and repopulated by the spawner, so mobs and
 * debris are not saved (ADR-0014). Old saves are migrated forward one
 * version at a time, and every step is validated.
 */
export const SAVE_FORMAT = 'war-save';
export const SAVE_VERSION = 3;
export const SAVE_SCENES = ['sandbox', 'range', 'world'] as const;

const Seed = z.number().int().min(0).max(0xffffffff);
const Finite = z.number();

/** v1 (stage 8 prototype): a position and loose story flags. */
const SaveV1Schema = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.literal(1),
  seed: Seed,
  scene: z.enum(SAVE_SCENES),
  player: z.object({ x: Finite, y: Finite, z: Finite, yaw: Finite, health: Finite }),
  flags: z.record(z.string(), Finite),
});

const KillsSchema = z.object({
  zombie: z.number().int().min(0),
  robot: z.number().int().min(0),
  plant: z.number().int().min(0),
  animal: z.number().int().min(0),
  any: z.number().int().min(0),
});

/** v2: the story's quests, logs and triggers; ammunition and the flashlight. */
const SaveV2Schema = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.literal(2),
  seed: Seed,
  scene: z.enum(SAVE_SCENES),
  player: z.object({
    x: Finite,
    y: Finite,
    z: Finite,
    yaw: Finite,
    health: Finite,
    flashlight: z.boolean(),
    battery: z.number().min(0).max(1),
  }),
  ammo: z.partialRecord(z.enum(AMMO_KINDS), z.number().int().min(0)),
  story: z.object({
    chapter: z.string(),
    flags: z.array(z.tuple([z.string(), Finite])),
    quests: z.array(z.tuple([z.string(), z.enum(QUEST_STATUSES)])),
    objectives: z.array(z.string()),
    logs: z.array(z.string()),
    used: z.array(z.string()),
    fired: z.array(z.string()),
    kills: KillsSchema,
  }),
});

export const StorySnapshotSchema = z.object({
  chapter: z.string(),
  ending: z.string().nullable(),
  flags: z.array(z.tuple([z.string(), Finite])),
  quests: z.array(z.tuple([z.string(), z.enum(QUEST_STATUSES)])),
  objectives: z.array(z.string()),
  logs: z.array(z.string()),
  used: z.array(z.string()),
  fired: z.array(z.string()),
  kills: KillsSchema,
  playing: z.array(
    z.object({ source: z.enum(['radio', 'log']), id: z.string(), next: z.number().int().min(0) }),
  ),
  lineLeft: Finite,
  started: z.boolean(),
}) satisfies z.ZodType<StorySnapshot>;

const WeaponSlotSchema = z.object({
  weapon: z.string(),
  mag: z.number().int().min(0),
  chambered: z.boolean(),
  wear: z.number().min(0).max(1),
  mode: z.number().int().min(0),
});

/** v3 (current): pitch, vitals, the weapons themselves, the clock and weather, the full story. */
export const SaveSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.literal(SAVE_VERSION),
  seed: Seed,
  scene: z.enum(SAVE_SCENES),
  /** Shown in the load menu: chapter title, simulated play time. */
  meta: z.object({ label: z.string(), playSeconds: z.number().min(0) }),
  player: z.object({
    x: Finite,
    y: Finite,
    z: Finite,
    yaw: Finite,
    pitch: Finite,
    health: Finite,
    deaths: z.number().int().min(0),
    stamina: z.number().min(0).max(1),
    flashlight: z.boolean(),
    battery: z.number().min(0).max(1),
  }),
  ammo: z.partialRecord(z.enum(AMMO_KINDS), z.number().int().min(0)),
  /** One entry per loadout slot, in slot order; null = a fresh loadout. */
  weapons: z
    .object({ active: z.number().int().min(0), slots: z.array(WeaponSlotSchema) })
    .nullable(),
  /** World clock and weather overrides (open world only). */
  environment: z
    .object({
      timeOfDay: Finite,
      timeScale: Finite,
      clock: Finite,
      fogOverride: Finite,
      rainOverride: Finite,
      windOverride: Finite,
    })
    .nullable(),
  story: StorySnapshotSchema.nullable(),
});

export type SaveGame = z.infer<typeof SaveSchema>;

const EMPTY_KILLS = Object.fromEntries([...RACES, 'any'].map((r) => [r, 0]));

/** v1 → v2: loose flags become the story's flags; nothing else of the story existed. */
function v1to2(v1: z.infer<typeof SaveV1Schema>): z.infer<typeof SaveV2Schema> {
  return {
    format: SAVE_FORMAT,
    version: 2,
    seed: v1.seed,
    scene: v1.scene,
    player: { ...v1.player, flashlight: true, battery: 1 },
    ammo: {},
    story: {
      chapter: 'arrival',
      flags: Object.entries(v1.flags).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      quests: [],
      objectives: [],
      logs: [],
      used: [],
      fired: [],
      kills: KillsSchema.parse(EMPTY_KILLS),
    },
  };
}

/** v2 → v3: the story gains its line queue and ending; weapons and the clock start fresh. */
function v2to3(v2: z.infer<typeof SaveV2Schema>): SaveGame {
  return {
    format: SAVE_FORMAT,
    version: 3,
    seed: v2.seed,
    scene: v2.scene,
    meta: { label: `Chapter: ${v2.story.chapter}`, playSeconds: 0 },
    player: { ...v2.player, pitch: 0, deaths: 0, stamina: 1 },
    ammo: v2.ammo,
    weapons: null,
    environment: null,
    story: {
      ...v2.story,
      ending: null,
      playing: [],
      lineLeft: 0,
      // A v2 save was always made mid-story: the start effects already ran.
      started: true,
    },
  };
}

/** Parses any known save version into the current one (throws on anything else). */
export function parseSave(json: unknown): SaveGame {
  const version: unknown =
    typeof json === 'object' && json !== null ? Reflect.get(json, 'version') : undefined;
  switch (version) {
    case 1:
      return v2to3(v1to2(SaveV1Schema.parse(json)));
    case 2:
      return v2to3(SaveV2Schema.parse(json));
    case SAVE_VERSION:
      return SaveSchema.parse(json);
    default:
      throw new Error(`Unknown save version ${String(version)}`);
  }
}

/**
 * Diff-friendly text: two-space indent, keys in schema order, one value per
 * line (story arrays are kept sorted by the engine).
 */
export function serializeSave(save: SaveGame): string {
  // JSON has no −0: write it as 0 so a save reads back exactly as it was written.
  const text = JSON.stringify(
    SaveSchema.parse(save),
    (_k, v: unknown) => (typeof v === 'number' && Object.is(v, -0) ? 0 : v),
    2,
  );
  return `${text}\n`;
}
