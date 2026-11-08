import { bakeMaterial, type BakedMaterial } from '../../../domain/procgen/bake';
import { materialRecipe, type MaterialId } from '../../../domain/procgen/materials';
import { BakeResponseSchema } from './bake-protocol';

export interface TextureBaker {
  bake(id: MaterialId, seed: number, size: number): Promise<BakedMaterial>;
  dispose(): void;
}

/** Main-thread fallback (and what tests use). */
export class InlineTextureBaker implements TextureBaker {
  bake(id: MaterialId, seed: number, size: number): Promise<BakedMaterial> {
    return Promise.resolve(bakeMaterial(materialRecipe(id), seed, size));
  }
  dispose(): void {
    // Nothing to release: baking ran on this thread.
  }
}

interface Pending {
  resolve(m: BakedMaterial): void;
  reject(e: Error): void;
}

/** Round-robin pool of module workers. */
export class WorkerTextureBaker implements TextureBaker {
  private readonly workers: Worker[];
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;

  constructor(count: number) {
    this.workers = Array.from({ length: Math.max(1, count) }, () => {
      const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), {
        type: 'module',
        name: 'war-bake',
      });
      worker.addEventListener('message', (e: MessageEvent<unknown>) => {
        this.onMessage(e.data);
      });
      return worker;
    });
  }

  bake(id: MaterialId, seed: number, size: number): Promise<BakedMaterial> {
    const requestId = this.nextId++;
    const worker = this.workers[requestId % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker?.postMessage({ requestId, materialId: id, seed, size });
    });
  }

  private onMessage(data: unknown): void {
    const msg = BakeResponseSchema.safeParse(data);
    if (!msg.success) return;
    const pending = this.pending.get(msg.data.requestId);
    if (pending === undefined) return;
    this.pending.delete(msg.data.requestId);
    if (msg.data.ok)
      pending.resolve({
        size: msg.data.size,
        albedo: msg.data.albedo,
        normal: msg.data.normal,
        orm: msg.data.orm,
      });
    else pending.reject(new Error(msg.data.error));
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error('baker disposed'));
    this.pending.clear();
  }
}

export function createTextureBaker(): TextureBaker {
  if (typeof Worker === 'undefined') return new InlineTextureBaker();
  const cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency;
  return new WorkerTextureBaker(Math.min(4, Math.max(1, cores - 1)));
}
