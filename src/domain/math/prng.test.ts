import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seed } from '../core/brand';
import { Rng, RngStreams } from './prng';

const take = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.nextU32());

describe('Rng', () => {
  it('matches the known-answer vector (guards against accidental algorithm changes)', () => {
    expect(take(Rng.fromSeed(1337), 6)).toMatchInlineSnapshot(`
      [
        3264853039,
        3747632982,
        4046707854,
        3280569478,
        1559638689,
        1560858406,
      ]
    `);
  });

  it('is reproducible for any seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (s) => {
        expect(take(Rng.fromSeed(s), 16)).toEqual(take(Rng.fromSeed(s), 16));
      }),
    );
  });

  it('different seeds give different sequences', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (a, b) => {
          fc.pre(a !== b);
          expect(take(Rng.fromSeed(a), 4)).not.toEqual(take(Rng.fromSeed(b), 4));
        },
      ),
    );
  });

  it('produces u32 and floats in [0,1)', () => {
    const rng = Rng.fromSeed(7);
    for (let i = 0; i < 10_000; i++) {
      const u = rng.nextU32();
      expect(Number.isInteger(u) && u >= 0 && u <= 0xffffffff).toBe(true);
      const f = rng.nextFloat();
      expect(f >= 0 && f < 1).toBe(true);
    }
  });

  it('range and int respect bounds', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (s, lo, w) => {
          const rng = Rng.fromSeed(s >>> 0);
          const v = rng.int(lo, lo + w);
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(lo + w);
          const r = rng.range(lo, lo + w + 1);
          expect(r).toBeGreaterThanOrEqual(lo);
          expect(r).toBeLessThan(lo + w + 1);
        },
      ),
    );
  });

  it('int is roughly uniform (chi-square)', () => {
    const rng = Rng.fromSeed(99);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const b = rng.int(0, 9);
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    const expected = n / 10;
    const chi = buckets.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(27.88); // p = 0.001, 9 dof
  });

  it('int handles the full 2^32 span and rejects bad ranges', () => {
    const v = Rng.fromSeed(1).int(0, 0xffffffff);
    expect(v >= 0 && v <= 0xffffffff).toBe(true);
    expect(() => Rng.fromSeed(1).int(5, 4)).toThrow(RangeError);
    expect(() => Rng.fromSeed(1).int(0.5, 4)).toThrow(RangeError);
    expect(() => Rng.fromSeed(1).int(0, 2 ** 33)).toThrow(RangeError);
  });

  it('int rejection loop triggers for awkward spans', () => {
    // span 3*2^30 rejects a quarter of draws, so the retry path is exercised.
    const rng = Rng.fromSeed(5);
    for (let i = 0; i < 64; i++) {
      const v = rng.int(0, 3 * 2 ** 30 - 1);
      expect(v).toBeLessThan(3 * 2 ** 30);
    }
  });

  it('chance follows probability', () => {
    const rng = Rng.fromSeed(3);
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (rng.chance(0.25)) hits++;
    expect(hits / 20_000).toBeCloseTo(0.25, 1);
    expect(rng.chance(0)).toBe(false);
  });

  it('state round-trips', () => {
    const rng = Rng.fromSeed(42);
    take(rng, 10);
    const copy = Rng.fromState(rng.state());
    expect(take(copy, 8)).toEqual(take(rng, 8));
  });

  it('named streams are independent of each other', () => {
    const a = Rng.stream(seed(1), 'ai');
    const b = Rng.stream(seed(1), 'audio');
    expect(take(a, 4)).not.toEqual(take(b, 4));
    expect(take(Rng.stream(seed(1), 'ai'), 4)).toEqual(take(Rng.stream(seed(1), 'ai'), 4));
    expect(take(Rng.stream(seed(1), 'ai'), 4)).not.toEqual(take(Rng.stream(seed(2), 'ai'), 4));
  });
});

describe('RngStreams', () => {
  it('stream sequences do not depend on creation order or other streams usage', () => {
    const x = new RngStreams(seed(10));
    const y = new RngStreams(seed(10));
    take(x.get('physics'), 100);
    const ai1 = take(x.get('ai'), 5);
    const ai2 = take(y.get('ai'), 5);
    expect(ai1).toEqual(ai2);
    expect(x.get('ai')).toBe(x.get('ai'));
    expect(x.root).toBe(10);
  });

  it('snapshot/restore resumes every stream exactly', () => {
    const s = new RngStreams(seed(10));
    take(s.get('b'), 3);
    take(s.get('a'), 7);
    expect(s.names()).toEqual(['a', 'b']);
    const snap = s.snapshot();
    const expected = [take(s.get('a'), 4), take(s.get('b'), 4)];
    const r = new RngStreams(seed(10));
    r.restore(snap);
    expect([take(r.get('a'), 4), take(r.get('b'), 4)]).toEqual(expected);
  });
});
