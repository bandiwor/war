import { z } from 'zod';

/**
 * Bodycam "footage" effects as data. Each entry is one post-processing module
 * with its own parameters; the renderer must implement every id (compile-time
 * exhaustive), and the debug menu builds its controls from this table, so a
 * new effect is a new entry plus its shader.
 *
 * `order` is the position in the post chain. HDR effects run before tone
 * mapping, LDR effects after it, `camera` effects modify the view transform.
 */
export interface ParamSpec {
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const p = (def: number, min: number, max: number, step = (max - min) / 100): ParamSpec => ({
  default: def,
  min,
  max,
  step,
});

export type EffectStage = 'hdr' | 'ldr' | 'camera';

export interface EffectSpec {
  readonly label: string;
  readonly stage: EffectStage;
  readonly order: number;
  readonly params: Readonly<Record<string, ParamSpec>>;
}

export const POST_EFFECTS = {
  autoExposure: {
    label: 'Auto exposure (lagged)',
    stage: 'hdr',
    order: 10,
    params: {
      key: p(0.18, 0.02, 0.6),
      speedUp: p(1.2, 0.05, 8),
      speedDown: p(3.0, 0.05, 8),
      minExposure: p(0.3, 0.05, 4),
      maxExposure: p(9, 1, 40),
    },
  },
  motionBlur: {
    label: 'Motion blur',
    stage: 'hdr',
    order: 20,
    params: { shutter: p(0.5, 0, 1), maxPixels: p(40, 2, 120, 1) },
  },
  bloom: {
    label: 'Bloom',
    stage: 'hdr',
    order: 30,
    params: {
      threshold: p(1.2, 0, 8),
      knee: p(0.6, 0, 2),
      intensity: p(0.45, 0, 3),
      radius: p(0.7, 0.1, 1),
    },
  },
  overexposure: {
    label: 'Sensor overexposure',
    stage: 'hdr',
    order: 40,
    params: { clip: p(3.5, 0.5, 8), desaturate: p(0.9, 0, 1), halation: p(0.35, 0, 2) },
  },
  lensDistortion: {
    label: 'Wide-angle lens (fisheye)',
    stage: 'ldr',
    order: 100,
    params: { strength: p(0.2, 0, 1), zoom: p(1.3, 0.8, 1.8) },
  },
  chromaticAberration: {
    label: 'Chromatic aberration',
    stage: 'ldr',
    order: 110,
    params: { amount: p(0.004, 0, 0.03, 0.0005) },
  },
  lensDirt: {
    label: 'Lens dirt & droplets',
    stage: 'ldr',
    order: 120,
    params: { dirt: p(0.6, 0, 2), droplets: p(0.25, 0, 1), refraction: p(0.012, 0, 0.05, 0.001) },
  },
  vignette: {
    label: 'Vignette',
    stage: 'ldr',
    order: 130,
    params: { amount: p(0.55, 0, 1.5), softness: p(0.55, 0.05, 1) },
  },
  rollingShutter: {
    label: 'Rolling shutter',
    stage: 'ldr',
    order: 140,
    params: { readout: p(0.025, 0, 0.1, 0.001) },
  },
  shadowNoise: {
    label: 'Digital noise in shadows',
    stage: 'ldr',
    order: 150,
    params: { amount: p(0.07, 0, 0.4), chroma: p(0.6, 0, 1), threshold: p(0.25, 0.01, 1) },
  },
  grain: {
    label: 'Sensor grain',
    stage: 'ldr',
    order: 160,
    params: { amount: p(0.045, 0, 0.3), size: p(1.3, 0.5, 4) },
  },
  compression: {
    label: 'Compression artifacts',
    stage: 'ldr',
    order: 170,
    params: {
      base: p(0.05, 0, 1),
      motionGain: p(0.8, 0, 4),
      blockSize: p(8, 4, 32, 1),
      levels: p(28, 4, 64, 1),
    },
  },
  signalLoss: {
    label: 'Signal loss',
    stage: 'ldr',
    order: 180,
    params: { ratePerMinute: p(0.6, 0, 30), intensity: p(1, 0, 1) },
  },
  osd: {
    label: 'On-screen display',
    stage: 'ldr',
    order: 190,
    params: { opacity: p(0.9, 0, 1) },
  },
  cameraShake: {
    label: 'Chest-mount shake (steps, breathing)',
    stage: 'camera',
    order: 0,
    params: { breathing: p(1, 0, 3), footsteps: p(1, 0, 3), roll: p(1, 0, 3) },
  },
} as const satisfies Record<string, EffectSpec>;

export type EffectId = keyof typeof POST_EFFECTS;
export type EffectParams<Id extends EffectId> = {
  -readonly [K in keyof (typeof POST_EFFECTS)[Id]['params']]: number;
};
export interface EffectState<Id extends EffectId> {
  enabled: boolean;
  params: EffectParams<Id>;
}
export type PostFxConfig = { [Id in EffectId]: EffectState<Id> };

export function isEffectId(id: string): id is EffectId {
  return Object.hasOwn(POST_EFFECTS, id);
}

export const EFFECT_IDS: readonly EffectId[] = Object.keys(POST_EFFECTS)
  .filter(isEffectId)
  .sort((a, b) => POST_EFFECTS[a].order - POST_EFFECTS[b].order);

export function effectSpec(id: EffectId): EffectSpec {
  return POST_EFFECTS[id];
}

function defaultsOf(spec: EffectSpec): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(spec.params)) out[k] = v.default;
  return out;
}

export function defaultPostFx(): PostFxConfig {
  const out: Record<string, { enabled: boolean; params: Record<string, number> }> = {};
  for (const id of EFFECT_IDS) out[id] = { enabled: true, params: defaultsOf(POST_EFFECTS[id]) };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- built by iterating every EffectId with each spec's own param keys
  return out as PostFxConfig;
}

/** Zod schema for persisted settings: unknown ids/params are rejected, values clamped to spec range. */
export const PostFxConfigSchema = z
  .object(
    Object.fromEntries(
      EFFECT_IDS.map((id) => [
        id,
        z.object({
          enabled: z.boolean(),
          params: z
            .object(
              Object.fromEntries(
                Object.entries(POST_EFFECTS[id].params).map(([k, s]) => [
                  k,
                  z.number().min(s.min).max(s.max),
                ]),
              ),
            )
            .strict(),
        }),
      ]),
    ),
  )
  .strict();

export function clonePostFx(src: PostFxConfig, dst: PostFxConfig = defaultPostFx()): PostFxConfig {
  for (const id of EFFECT_IDS) {
    dst[id].enabled = src[id].enabled;
    Object.assign(dst[id].params, src[id].params);
  }
  return dst;
}

/** Generic param write used by data-driven UIs; clamps to the spec range. */
export function setEffectParam(
  cfg: PostFxConfig,
  id: EffectId,
  key: string,
  value: number,
): boolean {
  const spec: Readonly<Record<string, ParamSpec>> = POST_EFFECTS[id].params;
  const s = spec[key];
  if (s === undefined) return false;
  const params: Record<string, number> = cfg[id].params;
  params[key] = Math.min(s.max, Math.max(s.min, value));
  return true;
}

export function getEffectParam(cfg: PostFxConfig, id: EffectId, key: string): number | undefined {
  const params: Readonly<Record<string, number>> = cfg[id].params;
  return params[key];
}
