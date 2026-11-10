import { z } from 'zod';
import { isMaterialId, type MaterialId } from '../../../domain/procgen/materials';

/** Messages between the main thread and chunk-mesh workers (validated on both ends). */
export const ChunkRequestSchema = z.object({
  requestId: z.number().int(),
  seed: z.number().int().min(0).max(0xffffffff),
  cx: z.number().int(),
  cz: z.number().int(),
});
export type ChunkRequest = z.infer<typeof ChunkRequestSchema>;

const f32 = z.instanceof(Float32Array);
const u32 = z.instanceof(Uint32Array);
const materialId = z.custom<MaterialId>((v) => typeof v === 'string' && isMaterialId(v));
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const ChunkMeshSchema = z.object({
  cx: z.number().int(),
  cz: z.number().int(),
  meshes: z.array(
    z.object({ material: materialId, position: f32, normal: f32, uv: f32, index: u32 }),
  ),
  instances: z.array(
    z.object({
      kind: z.enum(['barrel', 'crate', 'lampPost', 'fungus', 'tree', 'rock']),
      material: materialId,
      matrices: f32,
      detail: z.boolean(),
    }),
  ),
  emissive: z.object({ position: f32, color: f32, index: u32 }).nullable(),
  lights: z.array(
    z.object({
      kind: z.enum(['sodiumLamp', 'emergencyBeacon', 'bioluminescence', 'window']),
      position: vec3,
      color: vec3,
      intensity: z.number(),
      range: z.number(),
      flicker: z.number(),
      facing: z.enum(['x', 'z']).optional(),
    }),
  ),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export const ChunkResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    requestId: z.number().int(),
    ms: z.number(),
    mesh: ChunkMeshSchema,
  }),
  z.object({ ok: z.literal(false), requestId: z.number().int(), error: z.string() }),
]);
