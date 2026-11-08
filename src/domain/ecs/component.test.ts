import { describe, expect, it } from 'vitest';
import { ComponentStore, defineComponent } from './component';
import { EntityAllocator, makeEntityId } from './entity';

const Kinds = defineComponent('Kinds', {
  a: 'f32',
  b: 'f64',
  c: 'i32',
  d: 'u32',
  e: 'u8',
  g: 'u16',
});

describe('ComponentStore', () => {
  it('rejects empty schemas and freezes defs', () => {
    expect(() => defineComponent('Empty', {})).toThrow('no fields');
    expect(Object.isFrozen(Kinds)).toBe(true);
  });

  it('allocates the right typed array per field type', () => {
    const s = new ComponentStore(Kinds);
    expect(s.fields.a).toBeInstanceOf(Float32Array);
    expect(s.fields.b).toBeInstanceOf(Float64Array);
    expect(s.fields.c).toBeInstanceOf(Int32Array);
    expect(s.fields.d).toBeInstanceOf(Uint32Array);
    expect(s.fields.e).toBeInstanceOf(Uint8Array);
    expect(s.fields.g).toBeInstanceOf(Uint16Array);
    expect(s.fieldNamesInOrder()).toEqual(['a', 'b', 'c', 'd', 'e', 'g']);
  });

  it('adds zeroed rows, is idempotent, swap-removes', () => {
    const ents = new EntityAllocator();
    const s = new ComponentStore(Kinds, 2);
    const ids = [ents.create(), ents.create(), ents.create()];
    ids.forEach((id, i) => {
      const row = s.add(id);
      s.fields.b[row] = i + 0.5;
    });
    expect(s.add(ids[0] ?? makeEntityId(0, 0))).toBe(0);
    expect(s.size).toBe(3);
    const [e0, e1, e2] = ids;
    if (e0 === undefined || e1 === undefined || e2 === undefined) throw new Error('setup');
    expect(s.remove(e0)).toBe(true);
    expect(s.remove(e0)).toBe(false);
    expect(s.has(e0)).toBe(false);
    expect(s.rowOf(e2)).toBe(0); // last row moved into the hole
    expect(s.fields.b[s.rowOf(e2)]).toBe(2.5);
    expect(s.fields.b[s.rowOf(e1)]).toBe(1.5);
    expect(s.remove(e2)).toBe(true); // removing the last row needs no swap
    expect(s.size).toBe(1);
    const re = s.add(e2);
    expect(s.fields.b[re]).toBe(0);
  });

  it('grows sparse and dense storage preserving data', () => {
    const ents = new EntityAllocator(4);
    const s = new ComponentStore(Kinds, 1);
    const ids = Array.from({ length: 300 }, () => ents.create());
    for (const [i, id] of ids.entries()) {
      const row = s.add(id); // add() may grow storage: read `fields` only afterwards
      s.fields.d[row] = i;
    }
    for (const [i, id] of ids.entries()) expect(s.fields.d[s.rowOf(id)]).toBe(i);
    expect(s.rowOf(makeEntityId(5000, 0))).toBe(-1);
  });

  it('does not match stale handles of a recycled slot', () => {
    const ents = new EntityAllocator();
    const s = new ComponentStore(Kinds);
    const old = ents.create();
    s.add(old);
    s.remove(old);
    ents.destroy(old);
    const fresh = ents.create();
    s.add(fresh);
    expect(s.has(old)).toBe(false);
    expect(s.has(fresh)).toBe(true);
  });
});
