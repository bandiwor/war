import { describe, expect, it } from 'vitest';
import { assertNever, invariant } from './assert';
import { seed, tick } from './brand';

describe('brand constructors', () => {
  it('accepts valid seeds and ticks', () => {
    expect(seed(0)).toBe(0);
    expect(seed(0xffffffff)).toBe(0xffffffff);
    expect(tick(10)).toBe(10);
  });
  it.each([-1, 1.5, 2 ** 32, Number.NaN])('rejects seed %s', (v) => {
    expect(() => seed(v)).toThrow(RangeError);
  });
  it.each([-1, 0.5, Number.POSITIVE_INFINITY])('rejects tick %s', (v) => {
    expect(() => tick(v)).toThrow(RangeError);
  });
});

describe('assertions', () => {
  it('assertNever throws with context', () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- simulating an impossible value reaching the guard at runtime
    expect(() => assertNever('x' as never, 'thing')).toThrow('Unhandled thing: "x"');
  });
  it('invariant passes and throws', () => {
    expect(() => {
      invariant(true, 'ok');
    }).not.toThrow();
    expect(() => {
      invariant(0, 'zero');
    }).toThrow('Invariant violated: zero');
  });
});
