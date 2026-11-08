import type { Brand } from '../core/brand';

/**
 * Entity handle = 20-bit slot index | 10-bit generation. The generation makes
 * stale handles detectable after a slot is recycled. 30 bits total keeps every
 * handle a V8 Smi (small integer), so passing ids around never boxes a
 * HeapNumber — measured: 32-bit handles caused per-tick GC pressure.
 */
export type EntityId = Brand<number, 'EntityId'>;

export const INDEX_BITS = 20;
export const MAX_ENTITIES = 1 << INDEX_BITS;
const INDEX_MASK = MAX_ENTITIES - 1;
export const GENERATION_BITS = 10;
const GENERATION_MASK = (1 << GENERATION_BITS) - 1;

export function entityIndex(id: EntityId): number {
  return id & INDEX_MASK;
}

/** Slot index of a raw packed handle read back from a typed array. */
export function rawEntityIndex(packed: number): number {
  return packed & INDEX_MASK;
}

export function entityGeneration(id: EntityId): number {
  return id >>> INDEX_BITS;
}

export function makeEntityId(index: number, generation: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand constructor for packed handles
  return (((generation & GENERATION_MASK) << INDEX_BITS) | (index & INDEX_MASK)) as EntityId;
}

/** Slot allocator with LIFO free list: deterministic reuse order. */
export class EntityAllocator {
  private generations: Uint16Array;
  private alive: Uint8Array;
  private freeList: Uint32Array;
  private freeCount = 0;
  private nextIndex = 0;
  private liveCount = 0;

  constructor(initialCapacity = 1024) {
    this.generations = new Uint16Array(initialCapacity);
    this.alive = new Uint8Array(initialCapacity);
    this.freeList = new Uint32Array(initialCapacity);
  }

  get count(): number {
    return this.liveCount;
  }

  /** Highest slot index ever used + 1; iteration bound for index-ordered scans. */
  get highWater(): number {
    return this.nextIndex;
  }

  create(): EntityId {
    let index: number;
    if (this.freeCount > 0) {
      this.freeCount--;
      index = this.freeList[this.freeCount] ?? 0;
    } else {
      if (this.nextIndex >= MAX_ENTITIES) throw new RangeError('Entity limit reached');
      index = this.nextIndex++;
      if (index >= this.alive.length) this.grow(index + 1);
    }
    this.alive[index] = 1;
    this.liveCount++;
    return makeEntityId(index, this.generations[index] ?? 0);
  }

  destroy(id: EntityId): boolean {
    if (!this.isAlive(id)) return false;
    const index = entityIndex(id);
    this.alive[index] = 0;
    this.generations[index] = ((this.generations[index] ?? 0) + 1) & GENERATION_MASK;
    this.freeList[this.freeCount++] = index;
    this.liveCount--;
    return true;
  }

  isAlive(id: EntityId): boolean {
    const index = entityIndex(id);
    return (
      index < this.nextIndex &&
      this.alive[index] === 1 &&
      (this.generations[index] ?? -1) === entityGeneration(id)
    );
  }

  /** Live handle for a slot, or -1 if the slot is free. */
  idAt(index: number): EntityId | -1 {
    if (index >= this.nextIndex || this.alive[index] !== 1) return -1;
    return makeEntityId(index, this.generations[index] ?? 0);
  }

  private grow(minCapacity: number): void {
    let cap = this.alive.length * 2;
    while (cap < minCapacity) cap *= 2;
    cap = Math.min(cap, MAX_ENTITIES);
    const generations = new Uint16Array(cap);
    generations.set(this.generations);
    const alive = new Uint8Array(cap);
    alive.set(this.alive);
    const freeList = new Uint32Array(cap);
    freeList.set(this.freeList);
    this.generations = generations;
    this.alive = alive;
    this.freeList = freeList;
  }
}
