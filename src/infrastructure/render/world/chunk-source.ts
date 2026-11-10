import { seed as toSeed } from '../../../domain/core/brand';
import { generateChunk } from '../../../domain/world/chunk-gen';
import { meshChunk, type ChunkMesh } from './chunk-mesher';
import { ChunkResponseSchema } from './chunk-protocol';

/** Where chunk meshes come from: a worker pool in browsers, inline in tests. */
export interface ChunkMeshSource {
  request(cx: number, cz: number): Promise<ChunkMesh>;
  dispose(): void;
}

export class InlineChunkSource implements ChunkMeshSource {
  constructor(private readonly seed: number) {}
  request(cx: number, cz: number): Promise<ChunkMesh> {
    return Promise.resolve(meshChunk(generateChunk(toSeed(this.seed), cx, cz)));
  }
  dispose(): void {
    // Nothing to release.
  }
}

interface Pending {
  resolve(m: ChunkMesh): void;
  reject(e: Error): void;
}

/** Round-robin pool of module workers. */
export class WorkerChunkSource implements ChunkMeshSource {
  private readonly workers: Worker[];
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  /** Worker-side generation + meshing time of the last chunk (ms). */
  lastWorkerMs = 0;

  constructor(
    private readonly seed: number,
    count: number,
  ) {
    this.workers = Array.from({ length: Math.max(1, count) }, () => {
      const worker = new Worker(new URL('./chunk.worker.ts', import.meta.url), {
        type: 'module',
        name: 'war-chunks',
      });
      worker.addEventListener('message', (e: MessageEvent<unknown>) => {
        this.onMessage(e.data);
      });
      return worker;
    });
  }

  request(cx: number, cz: number): Promise<ChunkMesh> {
    const requestId = this.nextId++;
    const worker = this.workers[requestId % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker?.postMessage({ requestId, seed: this.seed, cx, cz });
    });
  }

  private onMessage(data: unknown): void {
    const msg = ChunkResponseSchema.safeParse(data);
    if (!msg.success) return;
    const pending = this.pending.get(msg.data.requestId);
    if (pending === undefined) return;
    this.pending.delete(msg.data.requestId);
    if (msg.data.ok) {
      this.lastWorkerMs = msg.data.ms;
      pending.resolve(msg.data.mesh);
    } else pending.reject(new Error(msg.data.error));
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error('chunk source disposed'));
    this.pending.clear();
  }
}

export function createChunkSource(seed: number): ChunkMeshSource {
  if (typeof Worker === 'undefined') return new InlineChunkSource(seed);
  const cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency;
  return new WorkerChunkSource(seed, Math.min(2, Math.max(1, cores - 2)));
}
