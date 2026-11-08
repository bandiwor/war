import { z } from 'zod';

/**
 * Walkable surface types with their footstep acoustics. Every procedural
 * material maps to one surface (materials.ts), so footstep sound, AI noise and
 * later bullet impacts all come from the same data. Values are unitless
 * synthesis parameters; see infrastructure/audio/dsp/footstep.ts.
 */
export const SURFACE_IDS = ['asphalt', 'concrete', 'metal', 'wood', 'dirt', 'water'] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

const Level = z.number().min(0).max(1);
export const FootstepAcousticsSchema = z.object({
  /** Low "body" of the heel strike. */
  thump: z.object({
    freq: z.number().min(30).max(400),
    decay: z.number().positive(),
    level: Level,
  }),
  /** Bright transient of sole on hard ground (band-passed noise). */
  click: z.object({
    freq: z.number().min(200).max(12000),
    q: z.number().positive(),
    decay: z.number().positive(),
    level: Level,
  }),
  /** Resonant partials (metal plates, hollow wood). Empty for dull surfaces. */
  ring: z.object({
    freqs: z.array(z.number().min(50).max(12000)),
    decay: z.number().positive(),
    level: Level,
  }),
  /** Crunchy granular noise (grit, gravel, leaves). */
  grit: z.object({ density: z.number().min(0).max(1), level: Level }),
  /** Water splash amount (puddles). */
  splash: Level,
  /** Loudness for AI hearing, relative to concrete = 1. */
  loudness: z.number().positive(),
  /** Mid-band acoustic absorption coefficient (Sabine alpha) for reverb estimation. */
  absorption: z.number().min(0).max(1),
});
export type FootstepAcoustics = z.infer<typeof FootstepAcousticsSchema>;

export const SURFACES = {
  asphalt: {
    thump: { freq: 85, decay: 0.05, level: 0.7 },
    click: { freq: 2600, q: 0.8, decay: 0.025, level: 0.45 },
    ring: { freqs: [], decay: 0.05, level: 0 },
    grit: { density: 0.35, level: 0.35 },
    splash: 0.15,
    loudness: 1,
    absorption: 0.05,
  },
  concrete: {
    thump: { freq: 95, decay: 0.045, level: 0.65 },
    click: { freq: 3400, q: 1.1, decay: 0.02, level: 0.6 },
    ring: { freqs: [], decay: 0.05, level: 0 },
    grit: { density: 0.15, level: 0.2 },
    splash: 0,
    loudness: 1,
    absorption: 0.02,
  },
  metal: {
    thump: { freq: 120, decay: 0.06, level: 0.5 },
    click: { freq: 5200, q: 2, decay: 0.015, level: 0.55 },
    ring: { freqs: [410, 1130, 2290, 3870], decay: 0.35, level: 0.45 },
    grit: { density: 0.05, level: 0.1 },
    splash: 0,
    loudness: 1.6,
    absorption: 0.04,
  },
  wood: {
    thump: { freq: 150, decay: 0.08, level: 0.85 },
    click: { freq: 1800, q: 1.4, decay: 0.03, level: 0.4 },
    ring: { freqs: [230, 610], decay: 0.12, level: 0.3 },
    grit: { density: 0.05, level: 0.1 },
    splash: 0,
    loudness: 1.2,
    absorption: 0.12,
  },
  dirt: {
    thump: { freq: 70, decay: 0.06, level: 0.6 },
    click: { freq: 1400, q: 0.6, decay: 0.03, level: 0.2 },
    ring: { freqs: [], decay: 0.05, level: 0 },
    grit: { density: 0.7, level: 0.55 },
    splash: 0,
    loudness: 0.6,
    absorption: 0.35,
  },
  water: {
    thump: { freq: 80, decay: 0.05, level: 0.4 },
    click: { freq: 1200, q: 0.5, decay: 0.04, level: 0.2 },
    ring: { freqs: [], decay: 0.05, level: 0 },
    grit: { density: 0.1, level: 0.1 },
    splash: 0.9,
    loudness: 1.3,
    absorption: 0.01,
  },
} as const satisfies Record<SurfaceId, FootstepAcoustics>;

export function surfaceAcoustics(id: SurfaceId): FootstepAcoustics {
  return SURFACES[id];
}

export function isSurfaceId(v: string): v is SurfaceId {
  return SURFACE_IDS.some((id) => id === v);
}
