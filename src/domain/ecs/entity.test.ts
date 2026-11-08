import { describe, expect, it } from 'vitest';
import {
  EntityAllocator,
  MAX_ENTITIES,
  entityGeneration,
  entityIndex,
  makeEntityId,
  rawEntityIndex,
} from './entity';

describe('EntityAllocator', () => {
  it('packs index and generation', () => {
    const id = makeEntityId(123, 7);
    expect(entityIndex(id)).toBe(123);
    expect(entityGeneration(id)).toBe(7);
    expect(rawEntityIndex(id)).toBe(123);
    expect(entityGeneration(makeEntityId(1, 0x3ff))).toBe(0x3ff);
    expect(makeEntityId(MAX_ENTITIES - 1, 0x3ff)).toBeLessThan(2 ** 30); // always a Smi
  });

  it('creates, destroys and reuses slots LIFO with bumped generations', () => {
    const a = new EntityAllocator(2);
    const e0 = a.create();
    const e1 = a.create();
    const e2 = a.create(); // forces growth
    expect([e0, e1, e2].map(entityIndex)).toEqual([0, 1, 2]);
    expect(a.count).toBe(3);
    expect(a.destroy(e1)).toBe(true);
    expect(a.destroy(e1)).toBe(false);
    expect(a.isAlive(e1)).toBe(false);
    const e1b = a.create();
    expect(entityIndex(e1b)).toBe(1);
    expect(entityGeneration(e1b)).toBe(1);
    expect(a.isAlive(e1b)).toBe(true);
    expect(a.isAlive(e1)).toBe(false);
    expect(a.highWater).toBe(3);
  });

  it('idAt reports live handles or -1', () => {
    const a = new EntityAllocator();
    const e = a.create();
    expect(a.idAt(0)).toBe(e);
    a.destroy(e);
    expect(a.idAt(0)).toBe(-1);
    expect(a.idAt(99)).toBe(-1);
    expect(a.isAlive(makeEntityId(50, 0))).toBe(false);
  });

  it('wraps generations after 1024 reuses', () => {
    const a = new EntityAllocator(1);
    let e = a.create();
    for (let i = 0; i < 1024; i++) {
      a.destroy(e);
      e = a.create();
    }
    expect(entityGeneration(e)).toBe(0);
  });

  it('throws when the entity limit is reached', () => {
    const a = new EntityAllocator(1024);
    for (let i = 0; i < MAX_ENTITIES; i++) a.create();
    expect(() => a.create()).toThrow('Entity limit');
  });
});
