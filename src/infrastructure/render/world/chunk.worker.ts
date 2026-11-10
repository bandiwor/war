/// <reference lib="webworker" />
import { seed } from '../../../domain/core/brand';
import { generateChunk } from '../../../domain/world/chunk-gen';
import { chunkBuffers, meshChunk } from './chunk-mesher';
import { ChunkRequestSchema } from './chunk-protocol';

/** Chunk worker: procedural generation and meshing off the main thread, results transferred. */
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the project tsconfig uses DOM lib typings; in this module globalThis is a DedicatedWorkerGlobalScope
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = ChunkRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const req = parsed.data;
  try {
    const started = performance.now();
    const mesh = meshChunk(generateChunk(seed(req.seed), req.cx, req.cz));
    scope.postMessage(
      { ok: true, requestId: req.requestId, ms: performance.now() - started, mesh },
      chunkBuffers(mesh),
    );
  } catch (error) {
    scope.postMessage({
      ok: false,
      requestId: req.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
