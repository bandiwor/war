import { z } from 'zod';
import { ZONE_IDS } from '../audio/zones';
import { RACES } from '../combat/races';
import { hotPatch, sameKeys } from '../core/hot-patch';
import { UTILITY_ACTIONS } from '../ai/utility';

/**
 * Every mob is a registry entry: body, senses, memory, attack, temperament,
 * utility weights, spawn rules, animations and look. The bestiary, the
 * spawner and the AI read only this, so a new mob is a new entry here.
 * Stage 7 gives each race its own behaviour through these fields: zombies
 * smell pheromones and fear light, animals have hunger, territory and packs,
 * plants bite, spit and leap, robots network, flank and take cover.
 */
const Unit = z.number().min(0).max(1);
const Color = z.number().int().min(0).max(0xffffff);
const Weight = z.number().min(0);

export const ANIMATIONS = ['idle', 'walk', 'run', 'attack', 'hit', 'die', 'alert'] as const;
export type AnimationId = (typeof ANIMATIONS)[number];

/** Body forms the model builder knows (race substyles, chassis types). */
export const FORMS = [
  'humanoid',
  'wheels',
  'spider',
  'flytrap',
  'creeper',
  'wolf',
  'boar',
] as const;
export type Form = (typeof FORMS)[number];

export const MobSpecSchema = z.object({
  label: z.string(),
  race: z.enum(RACES),
  /** One line of lore for the bestiary. */
  description: z.string(),
  body: z.object({
    /** Size relative to the race's hitbox archetype (hitboxes and model scale together). */
    scale: z.number().min(0.3).max(3),
    /** Collision radius for steering and the nav grid (m). */
    radius: z.number().positive(),
    walkSpeed: z.number().min(0),
    runSpeed: z.number().min(0),
    /** Max turn rate (rad/s). */
    turnRate: z.number().positive(),
    /** Eye/sensor height (m, unscaled). */
    eyeHeight: z.number().positive(),
  }),
  healthScale: z.number().positive(),
  senses: z.object({
    /** Cameras/eyes: a cone that needs light (flashlight, sky, lamps) to see by. */
    sight: z
      .object({
        range: z.number().positive(),
        fovDeg: z.number().min(1).max(360),
        /** 0 = sees in the dark (thermal), 1 = blind without light. */
        needsLight: Unit,
      })
      .nullable(),
    /** Multiplier on a noise's audible radius (footsteps, shots). */
    hearing: z.number().min(0).nullable(),
    /** Close-range sense that ignores walls and light (scent). */
    proximity: z.number().min(0).nullable(),
    /**
     * Zombies: no eyes or ears to speak of; they smell the pheromone field (the
     * prey's scent and the alarm other zombies leave) and follow its gradient.
     */
    pheromone: z
      .object({
        /** Concentration at which it notices anything. */
        threshold: z.number().positive(),
        /** Alarm it lays down while it has prey (how strongly it recruits others). */
        alarm: z.number().min(0),
      })
      .nullable(),
  }),
  memory: z.object({
    /** Seconds to forget the target once senses lose it. */
    forget: z.number().positive(),
    /** Seconds spent searching around the last known position. */
    search: z.number().min(0),
  }),
  /** Close attack (bite, claw, ram). */
  attack: z.object({
    range: z.number().positive(),
    damage: z.number().min(0),
    cooldown: z.number().positive(),
  }),
  /**
   * Ranged attack: a robot's laser, a flytrap's acid spit, a creeper's leap (it
   * then clings on, `damage` per second, until shaken off).
   */
  ranged: z
    .object({
      kind: z.enum(['laser', 'spit', 'leap']),
      /** Shortest and longest distance it is used at (m). */
      minRange: z.number().min(0),
      range: z.number().positive(),
      damage: z.number().min(0),
      cooldown: z.number().positive(),
    })
    .nullable(),
  temperament: z.object({
    aggression: Unit,
    /** Flees below this health fraction. */
    fleeBelow: Unit,
    /** Stays within this distance of its spawn point when calm (0 = never moves). */
    roam: z.number().min(0),
    /** How much light frightens it: lit ground is avoided, a beam in the face panics it. */
    lightFear: Unit,
    /** Defends this radius around its home: warns at the edge, attacks inside (0 = none). */
    territory: z.number().min(0),
    /** Aggression added per packmate nearby; a lone pack animal loses its nerve (0 = loner). */
    pack: z.number().min(0),
    /** Hunger gained per minute; a fed animal rarely attacks first (0 = never hungry). */
    hunger: z.number().min(0),
  }),
  /** Robots: what makes them the smartest race. */
  tactics: z.object({
    /** Sightings are shared with its own kind within this range (m) (0 = none). */
    network: z.number().min(0),
    /** Approaches from different sides when several are engaged. */
    flank: z.boolean(),
    /** Retreats to cover (out of your line of sight) when hurt. */
    cover: z.boolean(),
    /** Reinforcements it calls in when it first spots you. */
    reinforce: z.number().int().min(0),
  }),
  /** Weight per utility action (0 disables it); keys are exactly UTILITY_ACTIONS. */
  utility: z.object({
    idle: Weight,
    wander: Weight,
    investigate: Weight,
    chase: Weight,
    attack: Weight,
    search: Weight,
    flee: Weight,
    home: Weight,
    warn: Weight,
  }),
  spawn: z.object({
    zones: z.array(z.enum(ZONE_IDS)),
    weight: z.number().min(0),
    group: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    /** −1 = only by day, 0 = any time, 1 = only by night. */
    night: z.number().min(-1).max(1),
  }),
  animations: z.array(z.enum(ANIMATIONS)).min(1),
  look: z.object({ color: Color, emissive: Color, form: z.enum(FORMS) }),
});

export type MobSpec = z.infer<typeof MobSpecSchema>;

const W = (
  idle: number,
  wander: number,
  investigate: number,
  chase: number,
  attack: number,
  search: number,
  flee: number,
  home: number,
  warn = 0,
): MobSpec['utility'] => ({ idle, wander, investigate, chase, attack, search, flee, home, warn });

const ALL: MobSpec['animations'] = ['idle', 'walk', 'run', 'attack', 'hit', 'die', 'alert'];
const NO_TACTICS: MobSpec['tactics'] = { network: 0, flank: false, cover: false, reinforce: 0 };

const RAW = {
  shambler: {
    label: 'Shambler',
    race: 'zombie',
    description:
      'A former resident. The fungus drives what is left: it smells you, it never sees you, and it hates the light.',
    body: { scale: 1, radius: 0.32, walkSpeed: 0.8, runSpeed: 1.9, turnRate: 2.5, eyeHeight: 1.6 },
    healthScale: 1,
    senses: {
      sight: null,
      hearing: null,
      proximity: null,
      pheromone: { threshold: 0.05, alarm: 1 },
    },
    memory: { forget: 6, search: 8 },
    attack: { range: 1.2, damage: 18, cooldown: 1.4 },
    ranged: null,
    temperament: {
      aggression: 1,
      fleeBelow: 0,
      roam: 12,
      lightFear: 1,
      territory: 0,
      pack: 0,
      hunger: 0,
    },
    tactics: NO_TACTICS,
    utility: W(0.4, 0.5, 0.8, 1, 1.2, 0.6, 1, 0.2),
    spawn: {
      zones: ['abandonedCity', 'subway', 'industrial'],
      weight: 4,
      group: [2, 4],
      night: 0.5,
    },
    animations: ALL,
    look: { color: 0x5d5a4a, emissive: 0x0b3a2c, form: 'humanoid' },
  },
  lurcher: {
    label: 'Lurcher',
    race: 'zombie',
    description: 'Fresher, faster, keener nose. The growths have not reached its legs yet.',
    body: {
      scale: 0.95,
      radius: 0.3,
      walkSpeed: 1.1,
      runSpeed: 3.4,
      turnRate: 3.5,
      eyeHeight: 1.55,
    },
    healthScale: 0.7,
    senses: {
      sight: null,
      hearing: null,
      proximity: null,
      pheromone: { threshold: 0.025, alarm: 1.5 },
    },
    memory: { forget: 5, search: 6 },
    attack: { range: 1.2, damage: 12, cooldown: 0.9 },
    ranged: null,
    temperament: {
      aggression: 1,
      fleeBelow: 0,
      roam: 20,
      lightFear: 0.8,
      territory: 0,
      pack: 0,
      hunger: 0,
    },
    tactics: NO_TACTICS,
    utility: W(0.2, 0.7, 0.9, 1.2, 1.2, 0.5, 1, 0.1),
    spawn: { zones: ['abandonedCity', 'subway'], weight: 2, group: [1, 2], night: 1 },
    animations: ALL,
    look: { color: 0x6a5f50, emissive: 0x0b3a2c, form: 'humanoid' },
  },
  sentry: {
    label: 'Sentry unit',
    race: 'robot',
    description:
      'Wheeled watcher of unknown make. Sees only through its camera, talks to the others, and calls for help.',
    body: { scale: 1, radius: 0.45, walkSpeed: 1.2, runSpeed: 2.6, turnRate: 2, eyeHeight: 1.38 },
    healthScale: 1,
    senses: {
      sight: { range: 32, fovDeg: 70, needsLight: 0.75 },
      hearing: 0.4,
      proximity: null,
      pheromone: null,
    },
    memory: { forget: 10, search: 10 },
    attack: { range: 2, damage: 22, cooldown: 1.6 },
    ranged: { kind: 'laser', minRange: 3, range: 16, damage: 9, cooldown: 1.3 },
    temperament: {
      aggression: 0.8,
      fleeBelow: 0.3,
      roam: 25,
      lightFear: 0,
      territory: 0,
      pack: 0,
      hunger: 0,
    },
    tactics: { network: 70, flank: true, cover: true, reinforce: 2 },
    utility: W(0.3, 0.6, 1, 1, 1.1, 1, 0.9, 0.4),
    spawn: { zones: ['researchComplex', 'industrial'], weight: 3, group: [1, 2], night: 0 },
    animations: ALL,
    look: { color: 0x3a3f46, emissive: 0xff1a10, form: 'wheels' },
  },
  stalker: {
    label: 'Stalker drone',
    race: 'robot',
    description:
      'Spider-legged, quick, low. A wide-angle camera, a short memory, and the network behind it.',
    body: { scale: 0.8, radius: 0.4, walkSpeed: 1.5, runSpeed: 4, turnRate: 4, eyeHeight: 1.1 },
    healthScale: 0.6,
    senses: {
      sight: { range: 24, fovDeg: 110, needsLight: 0.6 },
      hearing: 0.6,
      proximity: null,
      pheromone: null,
    },
    memory: { forget: 6, search: 6 },
    attack: { range: 1.6, damage: 14, cooldown: 1 },
    ranged: null,
    temperament: {
      aggression: 0.9,
      fleeBelow: 0.2,
      roam: 30,
      lightFear: 0,
      territory: 0,
      pack: 0,
      hunger: 0,
    },
    tactics: { network: 70, flank: true, cover: false, reinforce: 0 },
    utility: W(0.2, 0.8, 1, 1.1, 1.1, 0.8, 0.8, 0.3),
    spawn: { zones: ['researchComplex', 'subway'], weight: 2, group: [1, 3], night: 0.3 },
    animations: ALL,
    look: { color: 0x2c3036, emissive: 0xff2a10, form: 'spider' },
  },
  flytrap: {
    label: 'Wall flytrap',
    race: 'plant',
    description:
      'Rooted where the vines broke through. It cannot follow you: it bites what comes close and spits at what does not.',
    body: { scale: 1, radius: 0.5, walkSpeed: 0, runSpeed: 0, turnRate: 3, eyeHeight: 1.5 },
    healthScale: 1,
    senses: { sight: null, hearing: 0.3, proximity: 11, pheromone: null },
    memory: { forget: 2, search: 0 },
    attack: { range: 2.4, damage: 25, cooldown: 2 },
    ranged: { kind: 'spit', minRange: 3, range: 10, damage: 7, cooldown: 3.5 },
    temperament: {
      aggression: 1,
      fleeBelow: 0,
      roam: 0,
      lightFear: 0,
      territory: 0,
      pack: 0,
      hunger: 0,
    },
    tactics: NO_TACTICS,
    utility: W(0.5, 0, 0, 0, 1.5, 0, 0, 0),
    spawn: { zones: ['forest', 'researchComplex'], weight: 2, group: [1, 3], night: 0 },
    animations: ['idle', 'attack', 'hit', 'die', 'alert'],
    look: { color: 0x274a32, emissive: 0x0b3a2c, form: 'flytrap' },
  },
  creeper: {
    label: 'Creeper',
    race: 'plant',
    description:
      'A mobile bulb on root-legs. Slow until it is close enough to leap, then it clings until torn off.',
    body: { scale: 0.85, radius: 0.35, walkSpeed: 0.5, runSpeed: 2.2, turnRate: 2, eyeHeight: 1.2 },
    healthScale: 0.8,
    senses: { sight: null, hearing: 0.5, proximity: 8, pheromone: null },
    memory: { forget: 4, search: 4 },
    attack: { range: 1.4, damage: 10, cooldown: 1.2 },
    ranged: { kind: 'leap', minRange: 2, range: 6, damage: 6, cooldown: 4 },
    temperament: {
      aggression: 0.9,
      fleeBelow: 0,
      roam: 10,
      lightFear: 0,
      territory: 0,
      pack: 0,
      hunger: 0,
    },
    tactics: NO_TACTICS,
    utility: W(0.5, 0.4, 0.7, 1, 1.2, 0.4, 0, 0.3),
    spawn: { zones: ['forest'], weight: 3, group: [1, 3], night: 0 },
    animations: ALL,
    look: { color: 0x2f5a3a, emissive: 0x115a40, form: 'creeper' },
  },
  wolf: {
    label: 'Feral wolf',
    race: 'animal',
    description:
      'Hungry, wary of light, brave in a pack and timid alone. Good ears and a nose for blood.',
    body: { scale: 0.85, radius: 0.35, walkSpeed: 1.6, runSpeed: 6, turnRate: 5, eyeHeight: 0.6 },
    healthScale: 0.6,
    senses: {
      sight: { range: 28, fovDeg: 160, needsLight: 0.35 },
      hearing: 1.3,
      proximity: 5,
      pheromone: null,
    },
    memory: { forget: 8, search: 8 },
    attack: { range: 1.4, damage: 16, cooldown: 1 },
    ranged: null,
    temperament: {
      aggression: 0.35,
      fleeBelow: 0.35,
      roam: 35,
      lightFear: 0.4,
      territory: 0,
      pack: 0.25,
      hunger: 1.2,
    },
    tactics: NO_TACTICS,
    utility: W(0.3, 0.8, 0.9, 1, 1.1, 0.7, 1.2, 0.3, 0.9),
    spawn: { zones: ['forest', 'industrial'], weight: 3, group: [2, 4], night: 0.6 },
    animations: ALL,
    look: { color: 0x3a3530, emissive: 0x000000, form: 'wolf' },
  },
  boar: {
    label: 'Boar',
    race: 'animal',
    description:
      'Territorial. Leaves you alone at a distance, warns you at the edge of its ground, charges inside it.',
    body: { scale: 1.15, radius: 0.5, walkSpeed: 1.2, runSpeed: 5, turnRate: 2.5, eyeHeight: 0.6 },
    healthScale: 1.2,
    senses: {
      sight: { range: 14, fovDeg: 120, needsLight: 0.5 },
      hearing: 0.9,
      proximity: 6,
      pheromone: null,
    },
    memory: { forget: 4, search: 3 },
    attack: { range: 1.6, damage: 24, cooldown: 1.8 },
    ranged: null,
    temperament: {
      aggression: 0.2,
      fleeBelow: 0.25,
      roam: 15,
      lightFear: 0.2,
      territory: 9,
      pack: 0,
      hunger: 0.3,
    },
    tactics: NO_TACTICS,
    utility: W(0.6, 0.6, 0.4, 0.8, 1.2, 0.2, 1, 0.8, 1),
    spawn: { zones: ['forest'], weight: 2, group: [1, 2], night: -0.3 },
    animations: ALL,
    look: { color: 0x3a2a1e, emissive: 0x000000, form: 'boar' },
  },
} as const satisfies Record<string, MobSpec>;

export type MobId = keyof typeof RAW;
export const MOB_IDS: readonly MobId[] = Object.keys(RAW).filter((k): k is MobId =>
  Object.hasOwn(RAW, k),
);

/** Validated registry. Mutable underneath only for dev hot reload (see the bottom of this file). */
export const MOBS: Readonly<Record<MobId, MobSpec>> =
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fromEntries over exactly MOB_IDS, each parsed by MobSpecSchema
  Object.fromEntries(MOB_IDS.map((id) => [id, MobSpecSchema.parse(RAW[id])])) as Record<
    MobId,
    MobSpec
  >;

/** Utility weights in UTILITY_ACTIONS order (the AI's scoring input). */
export function utilityWeights(spec: MobSpec, out: number[]): number[] {
  // Indexed writes, not length = 0 + push: keeps the array's backing store (no garbage per call).
  for (let i = 0; i < UTILITY_ACTIONS.length; i++) {
    const a = UTILITY_ACTIONS[i];
    out[i] = a === undefined ? 0 : spec.utility[a];
  }
  out.length = UTILITY_ACTIONS.length;
  return out;
}

export function isMobId(v: string): v is MobId {
  return Object.hasOwn(MOBS, v);
}

export function mobIndex(id: MobId): number {
  return MOB_IDS.indexOf(id);
}

export function mobAt(index: number): MobId | undefined {
  return MOB_IDS[index];
}

/**
 * Dev hot reload: edits to this file patch the live registry in place, so a
 * running game picks up new speeds, senses or weights without losing state.
 * New or removed ids need a reload (ECS columns index by id). `import.meta.hot`
 * is undefined in Node and in production builds, where this block is removed.
 */
/* v8 ignore start -- dev-server only: import.meta.hot is undefined under Node; verified by hand (ADR-0011) */
if (import.meta.hot) {
  // Vite finds self-accepting modules by the literal `import.meta.hot.accept(` call.
  const data: unknown = import.meta.hot.data;
  if (isRecord(data)) {
    // The first instance's object is the one the game holds; later versions patch it.
    data['live'] ??= MOBS;
    import.meta.hot.accept((next) => {
      const live = data['live'];
      const fresh: unknown = next === undefined ? undefined : Reflect.get(next, 'MOBS');
      if (!isRecord(live) || !isRecord(fresh) || !sameKeys(live, fresh)) {
        import.meta.hot?.invalidate('mob ids changed');
        return;
      }
      hotPatch(live, fresh);
    });
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
/* v8 ignore stop */
