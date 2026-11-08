/**
 * Per-zone ambient soundscapes, as data. Each zone of the semi-open world has
 * its own sound signature (the "zones sound distinct" acceptance of stage 3 is
 * measured on these). Levels are linear gains in 0..1 before the master mix.
 * Kept free of Zod so the audio worklet bundle stays small; the schema lives
 * in zones-schema.ts and every entry is validated in tests.
 */
export const ZONE_IDS = [
  'abandonedCity',
  'industrial',
  'forest',
  'subway',
  'researchComplex',
] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export const DISTANT_KINDS = ['bark', 'howl', 'clang', 'siren', 'chirp', 'shot'] as const;
export type DistantKind = (typeof DISTANT_KINDS)[number];

/** Shape of a zone soundscape; validated by `ZoneSoundscapeSchema` (zones-schema.ts). */
export interface ZoneSoundscape {
  readonly label: string;
  readonly wind: {
    readonly level: number;
    readonly gustiness: number;
    readonly brightness: number;
  };
  /** Electrical hum: transformers, ballasts, failing equipment. */
  readonly hum: { readonly level: number; readonly freq: number; readonly harmonics: number };
  /** Crickets (cicada 0) to cicadas (1). */
  readonly insects: {
    readonly level: number;
    readonly density: number;
    readonly pitch: number;
    readonly cicada: number;
  };
  readonly drips: { readonly level: number; readonly rate: number; readonly pitch: number };
  /** Structural creaks; `metal` 1 = steel groans, 0 = wood. */
  readonly creaks: {
    readonly level: number;
    readonly ratePerMinute: number;
    readonly metal: number;
  };
  readonly rumble: { readonly level: number; readonly freq: number };
  readonly roomTone: { readonly level: number; readonly brightness: number };
  readonly distant: {
    readonly ratePerMinute: number;
    readonly weights: Readonly<Record<DistantKind, number>>;
  };
}

const none = { bark: 0, howl: 0, clang: 0, siren: 0, chirp: 0, shot: 0 };

export const ZONE_SOUNDSCAPES: Readonly<Record<ZoneId, ZoneSoundscape>> = {
  abandonedCity: {
    label: 'Abandoned city',
    wind: { level: 0.55, gustiness: 0.6, brightness: 0.5 },
    hum: { level: 0.06, freq: 50, harmonics: 0.4 },
    insects: { level: 0.3, density: 0.35, pitch: 4300, cicada: 0 },
    drips: { level: 0.25, rate: 0.8, pitch: 0.5 },
    creaks: { level: 0.25, ratePerMinute: 3, metal: 0.6 },
    rumble: { level: 0.15, freq: 45 },
    roomTone: { level: 0, brightness: 0.4 },
    distant: {
      ratePerMinute: 3,
      weights: { ...none, bark: 3, clang: 2, siren: 1, shot: 1, howl: 1 },
    },
  },
  industrial: {
    label: 'Industrial area',
    wind: { level: 0.45, gustiness: 0.8, brightness: 0.75 },
    hum: { level: 0.4, freq: 50, harmonics: 0.85 },
    insects: { level: 0.08, density: 0.15, pitch: 4600, cicada: 0 },
    drips: { level: 0.2, rate: 1.2, pitch: 0.3 },
    creaks: { level: 0.55, ratePerMinute: 10, metal: 1 },
    rumble: { level: 0.3, freq: 38 },
    roomTone: { level: 0, brightness: 0.5 },
    distant: { ratePerMinute: 4, weights: { ...none, clang: 4, chirp: 2, siren: 1 } },
  },
  forest: {
    label: 'Forest',
    wind: { level: 0.6, gustiness: 0.45, brightness: 0.9 },
    hum: { level: 0, freq: 50, harmonics: 0 },
    insects: { level: 0.8, density: 0.9, pitch: 5200, cicada: 0.45 },
    drips: { level: 0.1, rate: 0.4, pitch: 0.7 },
    creaks: { level: 0.3, ratePerMinute: 4, metal: 0 },
    rumble: { level: 0.05, freq: 50 },
    roomTone: { level: 0, brightness: 0.4 },
    distant: { ratePerMinute: 3, weights: { ...none, howl: 3, bark: 2 } },
  },
  subway: {
    label: 'Subway',
    wind: { level: 0.12, gustiness: 0.9, brightness: 0.2 },
    hum: { level: 0.25, freq: 100, harmonics: 0.5 },
    insects: { level: 0, density: 0, pitch: 4000, cicada: 0 },
    drips: { level: 0.75, rate: 4, pitch: 0.35 },
    creaks: { level: 0.25, ratePerMinute: 4, metal: 0.8 },
    rumble: { level: 0.7, freq: 32 },
    roomTone: { level: 0.5, brightness: 0.2 },
    distant: { ratePerMinute: 2, weights: { ...none, clang: 2, chirp: 1, shot: 1 } },
  },
  researchComplex: {
    label: 'Research complex',
    wind: { level: 0.05, gustiness: 0.2, brightness: 0.3 },
    hum: { level: 0.55, freq: 120, harmonics: 0.2 },
    insects: { level: 0, density: 0, pitch: 4000, cicada: 0 },
    drips: { level: 0.15, rate: 0.6, pitch: 0.8 },
    creaks: { level: 0.1, ratePerMinute: 1, metal: 1 },
    rumble: { level: 0.2, freq: 60 },
    roomTone: { level: 0.6, brightness: 0.8 },
    distant: { ratePerMinute: 4, weights: { ...none, chirp: 5, siren: 1 } },
  },
};

export function isZoneId(v: string): v is ZoneId {
  return ZONE_IDS.some((id) => id === v);
}
