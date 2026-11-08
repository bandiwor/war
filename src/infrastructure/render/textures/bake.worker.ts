/// <reference lib="webworker" />
import { bakeMaterial } from '../../../domain/procgen/bake';
import { isMaterialId, materialRecipe } from '../../../domain/procgen/materials';
import { BakeRequestSchema, type BakeResponse } from './bake-protocol';

/** Texture-bake worker: pure CPU work off the main thread, results transferred (zero copy). */
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the project tsconfig uses DOM lib typings; in this module globalThis is a DedicatedWorkerGlobalScope
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

function respond(msg: BakeResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

scope.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = BakeRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const req = parsed.data;
  try {
    if (!isMaterialId(req.materialId)) throw new Error(`Unknown material ${req.materialId}`);
    const started = performance.now();
    const baked = bakeMaterial(materialRecipe(req.materialId), req.seed, req.size);
    respond(
      {
        ok: true,
        requestId: req.requestId,
        size: baked.size,
        albedo: baked.albedo,
        normal: baked.normal,
        orm: baked.orm,
        ms: performance.now() - started,
      },
      [baked.albedo.buffer, baked.normal.buffer, baked.orm.buffer],
    );
  } catch (error) {
    respond({
      ok: false,
      requestId: req.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
