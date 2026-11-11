import { z } from 'zod';
import { ZONE_IDS } from '../audio/zones';
import { RACES } from '../combat/races';
import { MOB_IDS, type MobId } from '../mobs/registry';

/**
 * The story as data (stage 8): chapters, quests and their objectives,
 * found logs (notes, audio logs, camera recordings), radio transmissions,
 * things in the world you can use, triggers, and the endings. Nothing in
 * the engine knows any quest by name; the level editor (stage 9) edits
 * exactly this. Conditions and effects are small closed vocabularies, so
 * every reference can be checked before the game runs (`validateStory`).
 */
const Id = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'ids are camelCase');
const FlagName = z.string().regex(/^[a-z][a-zA-Z0-9.]*$/, 'flags are dotted camelCase');
const Point2 = z.tuple([z.number(), z.number()]);
const Point3 = z.tuple([z.number(), z.number(), z.number()]);

export const COMPARISONS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const;

export type Condition =
  | { readonly is: 'all'; readonly of: readonly Condition[] }
  | { readonly is: 'any'; readonly of: readonly Condition[] }
  | { readonly is: 'not'; readonly c: Condition }
  | {
      readonly is: 'flag';
      readonly flag: string;
      readonly op: (typeof COMPARISONS)[number];
      readonly value: number;
    }
  | { readonly is: 'zone'; readonly zone: (typeof ZONE_IDS)[number] }
  | { readonly is: 'near'; readonly at: readonly [number, number]; readonly radius: number }
  | { readonly is: 'kills'; readonly race: (typeof RACES)[number] | 'any'; readonly count: number }
  | { readonly is: 'chapter'; readonly chapter: string }
  | { readonly is: 'quest'; readonly quest: string; readonly status: QuestStatus }
  | { readonly is: 'log'; readonly log: string }
  | { readonly is: 'used'; readonly interactable: string }
  /** 0 = day, 1 = deep night. */
  | { readonly is: 'night'; readonly min: number };

export const QUEST_STATUSES = ['inactive', 'active', 'done', 'failed'] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('is', [
    z.object({ is: z.literal('all'), of: z.array(ConditionSchema).min(1) }),
    z.object({ is: z.literal('any'), of: z.array(ConditionSchema).min(1) }),
    z.object({ is: z.literal('not'), c: ConditionSchema }),
    z.object({
      is: z.literal('flag'),
      flag: FlagName,
      op: z.enum(COMPARISONS),
      value: z.number(),
    }),
    z.object({ is: z.literal('zone'), zone: z.enum(ZONE_IDS) }),
    z.object({ is: z.literal('near'), at: Point2, radius: z.number().positive() }),
    z.object({
      is: z.literal('kills'),
      race: z.enum([...RACES, 'any']),
      count: z.number().int().positive(),
    }),
    z.object({ is: z.literal('chapter'), chapter: Id }),
    z.object({ is: z.literal('quest'), quest: Id, status: z.enum(QUEST_STATUSES) }),
    z.object({ is: z.literal('log'), log: Id }),
    z.object({ is: z.literal('used'), interactable: Id }),
    z.object({ is: z.literal('night'), min: z.number().min(0).max(1) }),
  ]),
);

export const AMMO_KINDS = [
  'r9x19',
  'r556',
  'r762',
  'r12ga',
  'frag',
  'emp',
  'flare',
  'molotov',
  'rpg',
] as const;
export type AmmoKind = (typeof AMMO_KINDS)[number];

export const EffectSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('setFlag'), flag: FlagName, value: z.number() }),
  z.object({ do: z.literal('addFlag'), flag: FlagName, by: z.number() }),
  z.object({ do: z.literal('startQuest'), quest: Id }),
  z.object({ do: z.literal('objective'), quest: Id, objective: Id }),
  z.object({ do: z.literal('completeQuest'), quest: Id }),
  z.object({ do: z.literal('failQuest'), quest: Id }),
  /** The log is found: it enters the journal (an audio log or recording also plays). */
  z.object({ do: z.literal('log'), log: Id }),
  z.object({ do: z.literal('radio'), radio: Id }),
  z.object({ do: z.literal('chapter'), chapter: Id }),
  z.object({ do: z.literal('ending'), ending: Id }),
  /** An ambush or a set piece: mobs appear around a point. */
  z.object({
    do: z.literal('spawn'),
    mob: z.custom<MobId>((v) => typeof v === 'string' && MOB_IDS.some((m) => m === v), {
      message: 'unknown mob',
    }),
    at: Point2,
    count: z.number().int().min(1).max(8),
  }),
  /** Loot: ammunition, consumables, a fresh battery. */
  z.object({ do: z.literal('supply'), ammo: z.enum(AMMO_KINDS), amount: z.number().int().min(1) }),
  z.object({ do: z.literal('battery') }),
]);
export type Effect = z.infer<typeof EffectSchema>;

export const LINE = z.object({
  speaker: z.string().min(1),
  text: z.string().min(1),
  /** How long the line stays up (and the voice runs). */
  seconds: z.number().positive().max(20),
});
export type Line = z.infer<typeof LINE>;

export const ChapterSchema = z.object({
  id: Id,
  title: z.string(),
  zone: z.enum(ZONE_IDS),
  summary: z.string(),
});

export const QuestSchema = z.object({
  id: Id,
  title: z.string(),
  chapter: Id,
  /** Main-arc quests drive the chapters; side quests are optional. */
  main: z.boolean(),
  summary: z.string(),
  objectives: z
    .array(
      z.object({
        id: Id,
        text: z.string(),
        /** Completes by itself when this holds (else only by an effect). */
        done: ConditionSchema.optional(),
      }),
    )
    .min(1),
  /** Runs when every objective is done. */
  onComplete: z.array(EffectSchema),
});
export type Quest = z.infer<typeof QuestSchema>;

export const LORE_ASPECTS = ['origin', 'motive', 'weakness'] as const;

export const LogSchema = z.object({
  id: Id,
  kind: z.enum(['note', 'audio', 'camera']),
  title: z.string(),
  /** Who wrote or recorded it. */
  author: z.string(),
  /** In-world date line ("14 Oct, 23:10"). */
  date: z.string(),
  /** Notes are read; audio logs and camera recordings also play their lines. */
  lines: z.array(LINE).min(1),
  /** What it reveals about a race (every race has an origin, a motive and a weakness). */
  lore: z.array(z.object({ race: z.enum(RACES), aspect: z.enum(LORE_ASPECTS) })).default([]),
});
export type Log = z.infer<typeof LogSchema>;

export const RadioSchema = z.object({
  id: Id,
  /** Channel label on the OSD ("CH 4 · OVERWATCH"). */
  channel: z.string(),
  lines: z.array(LINE).min(1),
});

export const INTERACTABLE_KINDS = [
  'log',
  'generator',
  'terminal',
  'radio',
  'door',
  'cache',
] as const;
export type InteractableKind = (typeof INTERACTABLE_KINDS)[number];

export const InteractableSchema = z.object({
  id: Id,
  kind: z.enum(INTERACTABLE_KINDS),
  /** Prompt verb + object ("Read: shift log"). */
  label: z.string(),
  at: Point3,
  radius: z.number().positive().max(6).default(2.2),
  /** Usable only while this holds (absent = always). */
  available: ConditionSchema.optional(),
  /** Usable once (logs, caches) or every time (terminals that answer). */
  once: z.boolean().default(true),
  effects: z.array(EffectSchema).min(1),
});
export type Interactable = z.infer<typeof InteractableSchema>;

export const TriggerSchema = z.object({
  id: Id,
  when: ConditionSchema,
  once: z.boolean().default(true),
  effects: z.array(EffectSchema).min(1),
});

export const EndingSchema = z.object({
  id: Id,
  title: z.string(),
  epilogue: z.array(z.string()).min(1),
});

export const StorySchema = z.object({
  title: z.string(),
  /** Applied on the first tick of a new game. */
  start: z.array(EffectSchema),
  chapters: z.array(ChapterSchema).min(1),
  quests: z.array(QuestSchema),
  logs: z.array(LogSchema),
  radio: z.array(RadioSchema),
  interactables: z.array(InteractableSchema),
  triggers: z.array(TriggerSchema),
  endings: z.array(EndingSchema).min(1),
});
export type StoryInput = z.input<typeof StorySchema>;
export type StoryData = z.infer<typeof StorySchema>;

/** Every condition inside a condition tree (itself included). */
export function* conditionsIn(c: Condition): Generator<Condition> {
  yield c;
  if (c.is === 'all' || c.is === 'any') for (const s of c.of) yield* conditionsIn(s);
  else if (c.is === 'not') yield* conditionsIn(c.c);
}

/**
 * Checks what the schema cannot: unique ids, every reference resolves,
 * every chapter has a main quest, every race's origin, motive and weakness
 * is told by some log. Returns the problems (empty = valid).
 */
export function validateStory(
  s: StoryData,
  /** The campaign must tell every race's lore; a level's side story need not. */
  options: { readonly lore?: boolean } = {},
): string[] {
  const errors: string[] = [];
  const ids = (kind: string, list: readonly { id: string }[]): Set<string> => {
    const set = new Set<string>();
    for (const { id } of list) {
      if (set.has(id)) errors.push(`duplicate ${kind} id ${id}`);
      set.add(id);
    }
    return set;
  };
  const chapters = ids('chapter', s.chapters);
  const quests = ids('quest', s.quests);
  const logs = ids('log', s.logs);
  const radio = ids('radio', s.radio);
  const things = ids('interactable', s.interactables);
  ids('trigger', s.triggers);
  const endings = ids('ending', s.endings);
  const objectives = new Map(s.quests.map((q) => [q.id, new Set(q.objectives.map((o) => o.id))]));

  const ref = (where: string, kind: string, set: Set<string>, id: string): void => {
    if (!set.has(id)) errors.push(`${where}: unknown ${kind} ${id}`);
  };
  const checkCondition = (where: string, c: Condition | undefined): void => {
    if (c === undefined) return;
    for (const x of conditionsIn(c)) {
      if (x.is === 'chapter') ref(where, 'chapter', chapters, x.chapter);
      else if (x.is === 'quest') ref(where, 'quest', quests, x.quest);
      else if (x.is === 'log') ref(where, 'log', logs, x.log);
      else if (x.is === 'used') ref(where, 'interactable', things, x.interactable);
    }
  };
  const checkEffects = (where: string, effects: readonly Effect[]): void => {
    for (const e of effects) {
      switch (e.do) {
        case 'startQuest':
        case 'completeQuest':
        case 'failQuest':
          ref(where, 'quest', quests, e.quest);
          break;
        case 'objective':
          ref(where, 'quest', quests, e.quest);
          if (objectives.get(e.quest)?.has(e.objective) === false)
            errors.push(`${where}: quest ${e.quest} has no objective ${e.objective}`);
          break;
        case 'log':
          ref(where, 'log', logs, e.log);
          break;
        case 'radio':
          ref(where, 'radio', radio, e.radio);
          break;
        case 'chapter':
          ref(where, 'chapter', chapters, e.chapter);
          break;
        case 'ending':
          ref(where, 'ending', endings, e.ending);
          break;
        case 'setFlag':
        case 'addFlag':
        case 'spawn':
        case 'supply':
        case 'battery':
          break;
      }
    }
  };
  checkEffects('start', s.start);
  for (const q of s.quests) {
    ref(`quest ${q.id}`, 'chapter', chapters, q.chapter);
    for (const o of q.objectives) checkCondition(`quest ${q.id}.${o.id}`, o.done);
    checkEffects(`quest ${q.id}`, q.onComplete);
  }
  for (const i of s.interactables) {
    checkCondition(`interactable ${i.id}`, i.available);
    checkEffects(`interactable ${i.id}`, i.effects);
  }
  for (const t of s.triggers) {
    checkCondition(`trigger ${t.id}`, t.when);
    checkEffects(`trigger ${t.id}`, t.effects);
  }
  for (const c of s.chapters)
    if (!s.quests.some((q) => q.main && q.chapter === c.id))
      errors.push(`chapter ${c.id} has no main quest`);
  if (options.lore !== false)
    for (const race of RACES)
      for (const aspect of LORE_ASPECTS)
        if (!s.logs.some((l) => l.lore.some((x) => x.race === race && x.aspect === aspect)))
          errors.push(`no log tells the ${race}s’ ${aspect}`);
  return errors;
}
