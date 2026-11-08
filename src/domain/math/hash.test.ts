import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StateHasher, fnv1a32 } from './hash';

const digestOf = (values: readonly number[]): string => {
  const h = new StateHasher();
  for (const v of values) h.f64(v);
  return h.digest();
};

describe('StateHasher', () => {
  it('is deterministic and 16 hex chars', () => {
    fc.assert(
      fc.property(fc.array(fc.double()), (vals) => {
        const d = digestOf(vals);
        expect(d).toMatch(/^[0-9a-f]{16}$/);
        expect(digestOf(vals)).toBe(d);
      }),
    );
  });

  it('distinguishes different inputs', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true })),
        fc.array(fc.double({ noNaN: true })),
        (a, b) => {
          fc.pre(!(a.length === b.length && a.every((v, i) => Object.is(v, b[i]))));
          expect(digestOf(a)).not.toBe(digestOf(b));
        },
      ),
    );
  });

  it('is order-sensitive and length-sensitive', () => {
    expect(digestOf([1, 2])).not.toBe(digestOf([2, 1]));
    expect(digestOf([0])).not.toBe(digestOf([0, 0]));
    expect(new StateHasher().digest()).not.toBe(digestOf([0]));
  });

  it('treats -0 and 0 as different, all NaNs as equal', () => {
    expect(digestOf([-0])).not.toBe(digestOf([0]));
    const nanA = new Float64Array(new Uint32Array([1, 0x7ff00000]).buffer)[0] ?? 0;
    expect(digestOf([nanA])).toBe(digestOf([Number.NaN]));
  });

  it('hashes u32, bool and string inputs; reset restarts', () => {
    const h = new StateHasher();
    const a = h.u32(5).bool(true).string('war').digest();
    expect(h.reset().u32(5).bool(true).string('war').digest()).toBe(a);
    expect(h.reset().u32(5).bool(false).string('war').digest()).not.toBe(a);
    expect(h.reset().string('ab').digest()).not.toBe(h.reset().string('ba').digest());
  });
});

describe('fnv1a32', () => {
  it('matches reference values', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
});
