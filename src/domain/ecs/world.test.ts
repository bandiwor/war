import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StateHasher } from '../math/hash';
import { defineComponent } from './component';
import type { EntityId } from './entity';
import { World } from './world';

const Pos = defineComponent('Pos', { x: 'f64', y: 'f64' });
const Hp = defineComponent('Hp', { value: 'i32' });

const hashOf = (w: World): string => {
  const h = new StateHasher();
  w.hashInto(h);
  return h.digest();
};

describe('World', () => {
  it('registers components once and looks them up', () => {
    const w = new World();
    const pos = w.register(Pos);
    expect(w.store(Pos)).toBe(pos);
    expect(() => w.register(Pos)).toThrow('already registered');
    expect(() => w.store(Hp)).toThrow('not registered');
    w.register(Hp);
    expect(w.componentNames()).toEqual(['Pos', 'Hp']);
  });

  it('despawn removes the entity from every store', () => {
    const w = new World();
    w.register(Pos);
    w.register(Hp);
    const e = w.spawn();
    w.store(Pos).add(e);
    w.store(Hp).add(e);
    expect(w.isAlive(e)).toBe(true);
    expect(w.despawn(e)).toBe(true);
    expect(w.despawn(e)).toBe(false);
    expect(w.store(Pos).has(e)).toBe(false);
    expect(w.store(Hp).size).toBe(0);
  });

  it('hash depends on values and liveness', () => {
    const w = new World();
    w.register(Pos);
    const e = w.spawn();
    const row = w.store(Pos).add(e);
    const h0 = hashOf(w);
    w.store(Pos).fields.x[row] = 1;
    const h1 = hashOf(w);
    expect(h1).not.toBe(h0);
    w.despawn(e);
    expect(hashOf(w)).not.toBe(h1);
  });

  it('hash is independent of the order components were added (logical state only)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true }), { minLength: 1, maxLength: 30 }),
        fc.integer(),
        (xs, shuffleSeed) => {
          const build = (order: readonly number[]): string => {
            const w = new World();
            w.register(Pos);
            const ids: EntityId[] = xs.map(() => w.spawn());
            for (const i of order) {
              const id = ids[i];
              if (id === undefined) continue;
              w.store(Pos).fields.x[w.store(Pos).add(id)] = xs[i] ?? 0;
            }
            return hashOf(w);
          };
          const natural = xs.map((_, i) => i);
          const shuffled = [...natural].sort(
            (a, b) =>
              ((a * 2654435761 + shuffleSeed) >>> 0) - ((b * 2654435761 + shuffleSeed) >>> 0),
          );
          expect(build(shuffled)).toBe(build(natural));
        },
      ),
    );
  });
});
