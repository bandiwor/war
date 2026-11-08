import { z } from 'zod';
import { DISTANT_KINDS, type ZoneSoundscape } from './zones';

/** Validation schema for zone soundscapes (kept apart from the data for bundle size). */
const L = z.number().min(0).max(1);

export const ZoneSoundscapeSchema = z.object({
  label: z.string(),
  wind: z.object({ level: L, gustiness: L, brightness: L }),
  /** Electrical hum: transformers, ballasts, failing equipment. */
  hum: z.object({ level: L, freq: z.number().min(30).max(400), harmonics: L }),
  /** Crickets (0) to cicadas (1). */
  insects: z.object({ level: L, density: L, pitch: z.number().min(1000).max(9000), cicada: L }),
  drips: z.object({ level: L, rate: z.number().min(0).max(30), pitch: L }),
  /** Structural creaks; `metal` 1 = steel groans, 0 = wood. */
  creaks: z.object({ level: L, ratePerMinute: z.number().min(0).max(60), metal: L }),
  rumble: z.object({ level: L, freq: z.number().min(20).max(150) }),
  roomTone: z.object({ level: L, brightness: L }),
  distant: z.object({
    ratePerMinute: z.number().min(0).max(30),
    weights: z.record(z.enum(DISTANT_KINDS), z.number().min(0)),
  }),
});

/** Compile-time check that the schema and the hand-written interface agree. */
export type SchemaMatches =
  z.infer<typeof ZoneSoundscapeSchema> extends ZoneSoundscape ? true : never;
export const SCHEMA_MATCHES: SchemaMatches = true;
