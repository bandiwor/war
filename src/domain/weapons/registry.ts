import { z } from 'zod';

/**
 * Ammunition, weapons and attachments as data. Numbers follow published
 * ballistics where they exist (velocities, masses, drag fitted to retained
 * velocity at range); gameplay values (damage, spread) are tuned for a
 * realistic, lethal feel. A new weapon is a new entry; engine code reads
 * only these fields.
 */
export const DAMAGE_TYPES = [
  'ballistic',
  'slash',
  'blunt',
  'fire',
  'explosive',
  'emp',
  'light',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const AmmoSchema = z.object({
  label: z.string(),
  /** Projectile mass in grams (per pellet for shot). */
  massGrams: z.number().positive(),
  /**
   * Quadratic drag constant k = ½·ρ·Cd·A / m (1/m): a = −k·|v|·v.
   * Fitted so retained velocity at range matches published data.
   */
  dragK: z.number().nonnegative(),
  /** Supersonic rounds make a crack downrange (audio, AI hearing). */
  supersonic: z.boolean(),
  /** Ejected case; null for caseless rounds (rockets). */
  casing: z
    .object({
      length: z.number().positive(),
      radius: z.number().positive(),
      shell: z.boolean(),
    })
    .nullable(),
});
export type Ammo = z.infer<typeof AmmoSchema>;

export const AMMO = {
  '9x19': {
    label: '9×19 mm 124 gr',
    massGrams: 8.0,
    dragK: 0.00145,
    supersonic: true,
    casing: { length: 0.019, radius: 0.0049, shell: false },
  },
  '5.56x45': {
    label: '5.56×45 mm M855',
    massGrams: 4.0,
    dragK: 0.00104,
    supersonic: true,
    casing: { length: 0.045, radius: 0.0048, shell: false },
  },
  '7.62x51': {
    label: '7.62×51 mm M80',
    massGrams: 9.5,
    dragK: 0.0007,
    supersonic: true,
    casing: { length: 0.051, radius: 0.006, shell: false },
  },
  '12ga-buck': {
    label: '12 ga 00 buckshot (9 pellets)',
    massGrams: 3.5,
    dragK: 0.0094,
    supersonic: true,
    casing: { length: 0.07, radius: 0.0105, shell: true },
  },
  // PG-7V HEAT rocket: 2.2 kg, 85 mm warhead. Launched at 115 m/s; the sustainer takes it to ~295 m/s.
  pg7v: {
    label: 'PG-7V HEAT rocket',
    massGrams: 2200,
    dragK: 0.00046,
    supersonic: false,
    casing: null,
  },
} as const satisfies Record<string, Ammo>;
export type AmmoId = keyof typeof AMMO;
export function isAmmoId(v: unknown): v is AmmoId {
  return typeof v === 'string' && Object.hasOwn(AMMO, v);
}

/** How a fired round is replaced: gas/recoil (semi/auto), manual bolt, manual pump. */
/** 'single' = one round loaded straight into the tube/chamber, nothing to cycle (launchers). */
const Action = z.enum(['semiauto', 'bolt', 'pump', 'single']);
const FireMode = z.enum(['semi', 'auto', 'burst']);
export type FireMode = z.infer<typeof FireMode>;

/** One procedural model part (boxes and cylinders), in weapon space: +Z forward, metres. */
const ModelPart = z.object({
  shape: z.enum(['box', 'cylinder']),
  size: z.tuple([z.number(), z.number(), z.number()]),
  at: z.tuple([z.number(), z.number(), z.number()]),
  material: z.enum(['polymer', 'steel', 'wood', 'brass', 'rubber']),
  /** Detaches for reload animation. */
  role: z.enum(['body', 'magazine', 'slide', 'bolt', 'pump', 'warhead']).default('body'),
});

const Model = z.object({
  parts: z.array(ModelPart).min(1),
  /** Hand anchors (weapon space) for arm IK. */
  grip: z.tuple([z.number(), z.number(), z.number()]),
  support: z.tuple([z.number(), z.number(), z.number()]),
  muzzle: z.tuple([z.number(), z.number(), z.number()]),
  ejectionPort: z.tuple([z.number(), z.number(), z.number()]),
});

const Recoil = z.object({
  /** Per-shot kick in degrees: pitch up, yaw right; the pattern repeats from `loopFrom`. */
  pattern: z.array(z.tuple([z.number(), z.number()])).min(1),
  loopFrom: z.number().int().nonnegative(),
  /** Random extra yaw (± degrees) per shot. */
  jitter: z.number().nonnegative(),
  /** Degrees per second the aim settles back toward the original point. */
  recovery: z.number().positive(),
});

const GunshotSound = z.object({
  /** Muzzle blast loudness / energy 0..1 (caliber, barrel length). */
  blast: z.number().min(0).max(1),
  /** Blast body frequency (Hz): shorter barrels/bigger bores are lower and boomier. */
  body: z.number().min(40).max(2000),
  /** Mechanical action noise 0..1 (slide, bolt carrier). */
  mechanism: z.number().min(0).max(1),
  /** 'launcher' = booster bang plus sustainer whoosh instead of a muzzle blast. */
  kind: z.enum(['gun', 'launcher']).default('gun'),
});

/** What leaves the muzzle: an inert bullet, or a self-propelled explosive rocket. */
const Projectile = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('bullet') }),
    z.object({
      kind: z.literal('rocket'),
      /** Sustainer acceleration (m/s²) between `ignite` and `burnout` seconds after launch. */
      thrust: z.number().positive(),
      ignite: z.number().nonnegative(),
      burnout: z.number().positive(),
      /** The fuze arms after this distance; closer impacts are duds. */
      armMeters: z.number().nonnegative(),
      /** Self-destruct time (s). */
      fuseSeconds: z.number().positive(),
      explosion: z.object({
        radius: z.number().positive(),
        damage: z.number().positive(),
        damageType: z.enum(['explosive', 'emp']),
      }),
    }),
  ])
  .default({ kind: 'bullet' });
export type RocketSpec = Extract<z.infer<typeof Projectile>, { kind: 'rocket' }>;

export const FirearmSchema = z.object({
  kind: z.literal('firearm'),
  label: z.string(),
  ammo: z.custom<AmmoId>(isAmmoId, 'unknown ammo'),
  magazine: z.number().int().positive(),
  /** Closed-bolt weapons hold one extra round in the chamber. */
  chamber: z.boolean(),
  /** Tube-fed: reload one shell at a time. */
  tubeFed: z.boolean(),
  action: Action,
  modes: z.array(FireMode).min(1),
  burst: z.number().int().positive(),
  rpm: z.number().positive(),
  /** Manual action time (bolt/pump) in seconds. */
  cycleSeconds: z.number().nonnegative(),
  muzzleVelocity: z.number().positive(),
  pellets: z.number().int().positive(),
  damage: z.number().positive(),
  falloff: z.object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
    min: z.number().min(0).max(1),
  }),
  /** Mechanical accuracy in MOA (cone diameter at 100 yd ≈ inches). */
  accuracyMoa: z.number().nonnegative(),
  /** Pellet cone (degrees, full angle) for shot. */
  pelletSpreadDeg: z.number().nonnegative(),
  spread: z.object({
    hipDeg: z.number().nonnegative(),
    adsDeg: z.number().nonnegative(),
    movingDeg: z.number().nonnegative(),
    bloomPerShotDeg: z.number().nonnegative(),
    bloomMaxDeg: z.number().nonnegative(),
    bloomRecoveryDegPerSec: z.number().positive(),
  }),
  recoil: Recoil,
  reload: z.object({
    tacticalSeconds: z.number().positive(),
    emptySeconds: z.number().positive(),
    shellSeconds: z.number().nonnegative(),
  }),
  drawSeconds: z.number().positive(),
  wear: z.object({
    perShot: z.number().nonnegative(),
    jamBase: z.number().min(0).max(1),
    jamAtFullWear: z.number().min(0).max(1),
    clearSeconds: z.number().positive(),
  }),
  zeroMeters: z.number().positive(),
  sightHeight: z.number().nonnegative(),
  adsZoom: z.number().min(1),
  sound: GunshotSound,
  projectile: Projectile,
  model: Model,
  attachments: z.array(z.string()),
});

export const MeleeSchema = z.object({
  kind: z.literal('melee'),
  label: z.string(),
  damage: z.number().positive(),
  damageType: z.enum(['slash', 'blunt']),
  reach: z.number().positive(),
  swingSeconds: z.number().positive(),
  /** When in the swing the blow lands (0..1). */
  impactAt: z.number().min(0).max(1),
  staminaCost: z.number().min(0).max(1),
  drawSeconds: z.number().positive(),
  model: Model,
});

const ThrowEffect = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('explosion'),
    radius: z.number().positive(),
    damage: z.number().positive(),
    damageType: z.enum(['explosive', 'emp']),
  }),
  z.object({
    type: z.literal('flare'),
    lightRadius: z.number().positive(),
    seconds: z.number().positive(),
    lightDps: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('fire'),
    radius: z.number().positive(),
    seconds: z.number().positive(),
    dps: z.number().positive(),
  }),
]);
export type ThrowEffect = z.infer<typeof ThrowEffect>;

export const ThrowableSchema = z.object({
  kind: z.literal('throwable'),
  label: z.string(),
  /** Fuse from release; null = triggers on first impact (molotov). */
  fuseSeconds: z.number().positive().nullable(),
  throwSpeed: z.number().positive(),
  restitution: z.number().min(0).max(1),
  effect: ThrowEffect,
  drawSeconds: z.number().positive(),
  model: Model,
});

export const WeaponSchema = z.discriminatedUnion('kind', [
  FirearmSchema,
  MeleeSchema,
  ThrowableSchema,
]);
export type Firearm = z.infer<typeof FirearmSchema>;
export type Melee = z.infer<typeof MeleeSchema>;
export type Throwable = z.infer<typeof ThrowableSchema>;
export type Weapon = z.infer<typeof WeaponSchema>;

type Part = z.input<typeof ModelPart>;
const box = (
  size: [number, number, number],
  at: [number, number, number],
  material: Part['material'],
  role: Part['role'] = 'body',
): Part => ({ shape: 'box', size, at, material, role });
const cyl = (
  size: [number, number, number],
  at: [number, number, number],
  material: Part['material'],
  role: Part['role'] = 'body',
): Part => ({ shape: 'cylinder', size, at, material, role });

/** Raw entries; parsed (defaults applied) into WEAPONS below. */
const RAW = {
  pistol: {
    kind: 'firearm',
    label: 'Service pistol (9 mm)',
    ammo: '9x19',
    magazine: 17,
    chamber: true,
    tubeFed: false,
    action: 'semiauto',
    modes: ['semi'],
    burst: 1,
    rpm: 450,
    cycleSeconds: 0,
    muzzleVelocity: 360,
    pellets: 1,
    damage: 34,
    falloff: { start: 25, end: 60, min: 0.6 },
    accuracyMoa: 4,
    pelletSpreadDeg: 0,
    spread: {
      hipDeg: 1.6,
      adsDeg: 0.3,
      movingDeg: 1.2,
      bloomPerShotDeg: 0.5,
      bloomMaxDeg: 2.5,
      bloomRecoveryDegPerSec: 4,
    },
    recoil: {
      pattern: [
        [1.8, 0.2],
        [1.6, -0.3],
        [1.7, 0.3],
        [1.5, -0.2],
      ],
      loopFrom: 0,
      jitter: 0.35,
      recovery: 9,
    },
    reload: { tacticalSeconds: 1.6, emptySeconds: 2.0, shellSeconds: 0 },
    drawSeconds: 0.45,
    wear: { perShot: 0.0004, jamBase: 0.0004, jamAtFullWear: 0.05, clearSeconds: 1.1 },
    zeroMeters: 25,
    sightHeight: 0.016,
    adsZoom: 1.1,
    sound: { blast: 0.6, body: 420, mechanism: 0.45 },
    model: {
      parts: [
        box([0.03, 0.032, 0.185], [0, 0.03, 0.06], 'steel', 'slide'),
        box([0.028, 0.03, 0.16], [0, 0, 0.05], 'polymer'),
        box([0.027, 0.11, 0.045], [0, -0.06, -0.01], 'polymer'),
        box([0.024, 0.1, 0.035], [0, -0.065, -0.01], 'steel', 'magazine'),
      ],
      grip: [0, -0.04, -0.01],
      support: [0, -0.06, 0.0],
      muzzle: [0, 0.03, 0.155],
      ejectionPort: [0.016, 0.035, 0.06],
    },
    attachments: ['weaponLight', 'suppressor'],
  },
  shotgun: {
    kind: 'firearm',
    label: 'Pump shotgun (12 ga)',
    ammo: '12ga-buck',
    magazine: 6,
    chamber: true,
    tubeFed: true,
    action: 'pump',
    modes: ['semi'],
    burst: 1,
    rpm: 90,
    cycleSeconds: 0.5,
    muzzleVelocity: 400,
    pellets: 9,
    damage: 17,
    falloff: { start: 8, end: 35, min: 0.25 },
    accuracyMoa: 6,
    pelletSpreadDeg: 2.8,
    spread: {
      hipDeg: 1.2,
      adsDeg: 0.4,
      movingDeg: 1,
      bloomPerShotDeg: 0.8,
      bloomMaxDeg: 2,
      bloomRecoveryDegPerSec: 3,
    },
    recoil: { pattern: [[5.5, 0.6]], loopFrom: 0, jitter: 0.8, recovery: 6 },
    reload: { tacticalSeconds: 0.5, emptySeconds: 0.5, shellSeconds: 0.5 },
    drawSeconds: 0.7,
    wear: { perShot: 0.0006, jamBase: 0.0005, jamAtFullWear: 0.03, clearSeconds: 1.4 },
    zeroMeters: 20,
    sightHeight: 0.02,
    adsZoom: 1.1,
    sound: { blast: 0.95, body: 160, mechanism: 0.7 },
    model: {
      parts: [
        cyl([0.022, 0.022, 0.5], [0, 0.03, 0.42], 'steel'),
        cyl([0.02, 0.02, 0.42], [0, 0.0, 0.36], 'steel', 'magazine'),
        box([0.045, 0.05, 0.2], [0, 0.015, 0.08], 'steel'),
        box([0.05, 0.045, 0.16], [0, 0.0, 0.33], 'wood', 'pump'),
        box([0.04, 0.09, 0.3], [0, -0.03, -0.17], 'wood'),
      ],
      grip: [0, -0.04, -0.03],
      support: [0, -0.02, 0.33],
      muzzle: [0, 0.03, 0.67],
      ejectionPort: [0.025, 0.03, 0.09],
    },
    attachments: ['weaponLight'],
  },
  carbine: {
    kind: 'firearm',
    label: 'Carbine (5.56 mm)',
    ammo: '5.56x45',
    magazine: 30,
    chamber: true,
    tubeFed: false,
    action: 'semiauto',
    modes: ['semi', 'auto'],
    burst: 1,
    rpm: 750,
    cycleSeconds: 0,
    muzzleVelocity: 900,
    pellets: 1,
    damage: 38,
    falloff: { start: 150, end: 400, min: 0.55 },
    accuracyMoa: 2,
    pelletSpreadDeg: 0,
    spread: {
      hipDeg: 2.4,
      adsDeg: 0.12,
      movingDeg: 1.5,
      bloomPerShotDeg: 0.25,
      bloomMaxDeg: 2,
      bloomRecoveryDegPerSec: 3,
    },
    recoil: {
      pattern: [
        [1.1, 0.1],
        [1.0, 0.2],
        [0.95, 0.25],
        [0.9, 0.15],
        [0.85, -0.1],
        [0.8, -0.3],
        [0.75, -0.35],
        [0.7, -0.2],
        [0.65, 0.2],
        [0.6, 0.35],
        [0.6, 0.3],
        [0.55, -0.2],
      ],
      loopFrom: 6,
      jitter: 0.15,
      recovery: 7,
    },
    reload: { tacticalSeconds: 2.2, emptySeconds: 2.7, shellSeconds: 0 },
    drawSeconds: 0.7,
    wear: { perShot: 0.0002, jamBase: 0.0003, jamAtFullWear: 0.03, clearSeconds: 1.6 },
    zeroMeters: 100,
    sightHeight: 0.065,
    adsZoom: 1.5,
    sound: { blast: 0.85, body: 260, mechanism: 0.4 },
    model: {
      parts: [
        cyl([0.016, 0.016, 0.37], [0, 0.035, 0.4], 'steel'),
        box([0.04, 0.05, 0.22], [0, 0.03, 0.42], 'polymer'),
        box([0.03, 0.07, 0.24], [0, 0.025, 0.08], 'steel'),
        box([0.028, 0.14, 0.06], [0, -0.06, 0.13], 'steel', 'magazine'),
        box([0.025, 0.08, 0.04], [0, -0.045, -0.02], 'polymer'),
        box([0.035, 0.06, 0.24], [0, 0.02, -0.17], 'polymer'),
        box([0.02, 0.025, 0.05], [0, 0.085, 0.12], 'steel'),
      ],
      grip: [0, -0.045, -0.02],
      support: [0, 0.0, 0.38],
      muzzle: [0, 0.035, 0.6],
      ejectionPort: [0.02, 0.035, 0.1],
    },
    attachments: ['weaponLight', 'suppressor', 'scope', 'laser'],
  },
  rifle: {
    kind: 'firearm',
    label: 'Bolt-action rifle (7.62 mm)',
    ammo: '7.62x51',
    magazine: 5,
    chamber: true,
    tubeFed: false,
    action: 'bolt',
    modes: ['semi'],
    burst: 1,
    rpm: 60,
    cycleSeconds: 0.95,
    muzzleVelocity: 840,
    pellets: 1,
    damage: 95,
    falloff: { start: 300, end: 900, min: 0.8 },
    accuracyMoa: 0.8,
    pelletSpreadDeg: 0,
    spread: {
      hipDeg: 4,
      adsDeg: 0.02,
      movingDeg: 3,
      bloomPerShotDeg: 1,
      bloomMaxDeg: 3,
      bloomRecoveryDegPerSec: 2,
    },
    recoil: { pattern: [[4.5, 0.5]], loopFrom: 0, jitter: 0.6, recovery: 5 },
    reload: { tacticalSeconds: 3.0, emptySeconds: 3.5, shellSeconds: 0 },
    drawSeconds: 0.9,
    wear: { perShot: 0.0003, jamBase: 0.0002, jamAtFullWear: 0.02, clearSeconds: 1.8 },
    zeroMeters: 100,
    sightHeight: 0.045,
    adsZoom: 6,
    sound: { blast: 1, body: 220, mechanism: 0.55 },
    model: {
      parts: [
        cyl([0.017, 0.017, 0.55], [0, 0.03, 0.55], 'steel'),
        cyl([0.022, 0.022, 0.32], [0, 0.085, 0.12], 'steel'),
        box([0.035, 0.05, 0.2], [0, 0.03, 0.08], 'steel', 'bolt'),
        box([0.025, 0.06, 0.05], [0, -0.02, 0.1], 'steel', 'magazine'),
        box([0.05, 0.08, 0.75], [0, -0.005, 0.12], 'wood'),
      ],
      grip: [0, -0.045, -0.06],
      support: [0, -0.02, 0.38],
      muzzle: [0, 0.03, 0.83],
      ejectionPort: [0.022, 0.04, 0.08],
    },
    attachments: ['scope', 'suppressor'],
  },
  knife: {
    kind: 'melee',
    label: 'Combat knife',
    damage: 45,
    damageType: 'slash',
    reach: 1.4,
    swingSeconds: 0.45,
    impactAt: 0.4,
    staminaCost: 0.05,
    drawSeconds: 0.3,
    model: {
      parts: [
        box([0.004, 0.025, 0.17], [0, 0, 0.13], 'steel'),
        box([0.025, 0.03, 0.11], [0, 0, 0], 'rubber'),
      ],
      grip: [0, 0, 0],
      support: [0.05, -0.1, -0.05],
      muzzle: [0, 0, 0.22],
      ejectionPort: [0, 0, 0],
    },
  },
  crowbar: {
    kind: 'melee',
    label: 'Crowbar',
    damage: 60,
    damageType: 'blunt',
    reach: 1.75,
    swingSeconds: 0.85,
    impactAt: 0.45,
    staminaCost: 0.1,
    drawSeconds: 0.5,
    model: {
      parts: [
        cyl([0.012, 0.012, 0.75], [0, 0, 0.3], 'steel'),
        box([0.012, 0.06, 0.03], [0, 0.03, 0.68], 'steel'),
      ],
      grip: [0, 0, 0],
      support: [0, 0, 0.12],
      muzzle: [0, 0, 0.7],
      ejectionPort: [0, 0, 0],
    },
  },
  frag: {
    kind: 'throwable',
    label: 'Fragmentation grenade',
    fuseSeconds: 4,
    throwSpeed: 14,
    restitution: 0.3,
    effect: { type: 'explosion', radius: 8, damage: 170, damageType: 'explosive' },
    drawSeconds: 0.5,
    model: {
      parts: [
        cyl([0.03, 0.03, 0.08], [0, 0, 0], 'steel'),
        box([0.01, 0.03, 0.02], [0.02, 0.04, 0], 'steel'),
      ],
      grip: [0, 0, 0],
      support: [0, 0, 0],
      muzzle: [0, 0, 0],
      ejectionPort: [0, 0, 0],
    },
  },
  emp: {
    kind: 'throwable',
    label: 'Improvised EMP charge',
    fuseSeconds: 2.5,
    throwSpeed: 12,
    restitution: 0.25,
    effect: { type: 'explosion', radius: 7, damage: 130, damageType: 'emp' },
    drawSeconds: 0.5,
    model: {
      parts: [
        box([0.08, 0.05, 0.05], [0, 0, 0], 'polymer'),
        cyl([0.01, 0.01, 0.06], [0.03, 0.04, 0], 'brass'),
      ],
      grip: [0, 0, 0],
      support: [0, 0, 0],
      muzzle: [0, 0, 0],
      ejectionPort: [0, 0, 0],
    },
  },
  flare: {
    kind: 'throwable',
    label: 'Road flare',
    fuseSeconds: 0.2,
    throwSpeed: 11,
    restitution: 0.2,
    effect: { type: 'flare', lightRadius: 16, seconds: 60, lightDps: 6 },
    drawSeconds: 0.4,
    model: {
      parts: [cyl([0.016, 0.016, 0.22], [0, 0, 0], 'polymer')],
      grip: [0, 0, 0],
      support: [0, 0, 0],
      muzzle: [0, 0, 0.11],
      ejectionPort: [0, 0, 0],
    },
  },
  molotov: {
    kind: 'throwable',
    label: 'Molotov cocktail',
    fuseSeconds: null,
    throwSpeed: 12,
    restitution: 0,
    effect: { type: 'fire', radius: 3, seconds: 9, dps: 18 },
    drawSeconds: 0.6,
    model: {
      parts: [
        cyl([0.035, 0.035, 0.14], [0, 0, 0], 'polymer'),
        cyl([0.012, 0.012, 0.06], [0, 0, 0.1], 'rubber'),
      ],
      grip: [0, 0, 0],
      support: [0, 0, 0],
      muzzle: [0, 0, 0.13],
      ejectionPort: [0, 0, 0],
    },
  },
  // Appended last: weapon indices are stored in replays and must stay stable.
  rpg7: {
    kind: 'firearm',
    label: 'RPG-7 launcher (PG-7V)',
    ammo: 'pg7v',
    magazine: 1,
    chamber: true,
    tubeFed: true, // muzzle-loaded one rocket at a time
    action: 'single',
    modes: ['semi'],
    burst: 1,
    rpm: 60,
    cycleSeconds: 0.5, // cock the hammer
    muzzleVelocity: 115,
    pellets: 1,
    damage: 600, // direct HEAT hit
    falloff: { start: 500, end: 900, min: 1 },
    accuracyMoa: 14,
    pelletSpreadDeg: 0,
    spread: {
      hipDeg: 3,
      adsDeg: 0.25,
      movingDeg: 3,
      bloomPerShotDeg: 0,
      bloomMaxDeg: 0,
      bloomRecoveryDegPerSec: 1,
    },
    // Recoilless: the backblast balances the launch, the tube only bucks a little.
    recoil: { pattern: [[1.6, 0.4]], loopFrom: 0, jitter: 0.5, recovery: 5 },
    reload: { tacticalSeconds: 3.4, emptySeconds: 3.4, shellSeconds: 3.4 },
    drawSeconds: 1.1,
    wear: { perShot: 0.002, jamBase: 0, jamAtFullWear: 0, clearSeconds: 1 },
    zeroMeters: 100,
    sightHeight: 0.09,
    adsZoom: 2.7, // PGO-7 optic
    sound: { blast: 1, body: 110, mechanism: 0.6, kind: 'launcher' },
    projectile: {
      kind: 'rocket',
      thrust: 420,
      ignite: 0.1,
      burnout: 0.6,
      armMeters: 5,
      fuseSeconds: 4.5,
      explosion: { radius: 5, damage: 220, damageType: 'explosive' },
    },
    model: {
      parts: [
        cyl([0.022, 0.022, 0.95], [0, 0.03, 0.05], 'steel'),
        cyl([0.036, 0.036, 0.32], [0, 0.03, -0.02], 'wood'), // heat shield
        cyl([0.022, 0.045, 0.16], [0, 0.03, -0.5], 'steel'), // rear venturi
        box([0.028, 0.1, 0.04], [0, -0.04, 0.2], 'wood'),
        box([0.028, 0.09, 0.035], [0, -0.035, 0.02], 'wood'),
        box([0.03, 0.06, 0.12], [-0.045, 0.09, 0.12], 'steel'), // optic
        cyl([0.02, 0.043, 0.16], [0, 0.03, 0.6], 'steel', 'warhead'),
        cyl([0.043, 0.012, 0.2], [0, 0.03, 0.78], 'steel', 'warhead'),
      ],
      grip: [0, -0.06, 0.2],
      support: [0, -0.055, 0.02],
      muzzle: [0, 0.03, 0.9],
      ejectionPort: [0, 0.03, -0.58], // backblast exits here
    },
    attachments: [],
  },
} as const;

export type WeaponId = keyof typeof RAW;
export const WEAPON_IDS: readonly WeaponId[] = Object.keys(RAW).filter((k): k is WeaponId =>
  Object.hasOwn(RAW, k),
);

/** Parsed, validated registry (Zod applies defaults such as part roles). */
export const WEAPONS: Readonly<Record<WeaponId, Weapon>> =
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fromEntries over exactly WEAPON_IDS, each parsed by WeaponSchema
  Object.fromEntries(WEAPON_IDS.map((id) => [id, WeaponSchema.parse(RAW[id])])) as Record<
    WeaponId,
    Weapon
  >;

export function weapon(id: WeaponId): Weapon {
  return WEAPONS[id];
}

export function isWeaponId(v: string): v is WeaponId {
  return Object.hasOwn(RAW, v);
}

export function weaponIndex(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id);
}

export function weaponAt(index: number): WeaponId | undefined {
  return WEAPON_IDS[index];
}

export const ATTACHMENTS = {
  weaponLight: { label: 'Weapon light', spreadFactor: 1, soundFactor: 1, velocityFactor: 1 },
  suppressor: { label: 'Suppressor', spreadFactor: 1, soundFactor: 0.35, velocityFactor: 1.03 },
  scope: { label: 'Optic', spreadFactor: 0.6, soundFactor: 1, velocityFactor: 1 },
  laser: { label: 'Laser', spreadFactor: 0.8, soundFactor: 1, velocityFactor: 1 },
} as const;
export type AttachmentId = keyof typeof ATTACHMENTS;
