import { z } from 'zod';

/** Messages between the main thread and texture-bake workers (validated on both ends). */
export const BakeRequestSchema = z.object({
  requestId: z.number().int(),
  materialId: z.string(),
  seed: z.number().int(),
  size: z.number().int(),
});
export type BakeRequest = z.infer<typeof BakeRequestSchema>;

const bytes = z.instanceof(Uint8Array);
export const BakeResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    requestId: z.number().int(),
    size: z.number().int(),
    albedo: bytes,
    normal: bytes,
    orm: bytes,
    ms: z.number(),
  }),
  z.object({ ok: z.literal(false), requestId: z.number().int(), error: z.string() }),
]);
export type BakeResponse = z.infer<typeof BakeResponseSchema>;
