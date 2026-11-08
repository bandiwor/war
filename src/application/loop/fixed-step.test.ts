import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FixedStepAccumulator } from './fixed-step';

describe('FixedStepAccumulator', () => {
  it('validates options', () => {
    expect(() => new FixedStepAccumulator({ stepMs: 0, maxStepsPerFrame: 1 })).toThrow(RangeError);
    expect(() => new FixedStepAccumulator({ stepMs: 1, maxStepsPerFrame: 0 })).toThrow(RangeError);
  });

  it('total steps equal floor(total time / step) when never clamped', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 50 }), { maxLength: 200 }), (deltas) => {
        const acc = new FixedStepAccumulator({ stepMs: 10, maxStepsPerFrame: 100 });
        let steps = 0;
        for (const d of deltas) {
          steps += acc.advance(d);
          expect(acc.alpha).toBeGreaterThanOrEqual(0);
          expect(acc.alpha).toBeLessThan(1);
        }
        const total = deltas.reduce((a, b) => a + b, 0);
        expect(steps).toBe(Math.floor(total / 10));
        expect(acc.droppedMs).toBe(0);
      }),
    );
  });

  it('clamps catch-up steps and records dropped time', () => {
    const acc = new FixedStepAccumulator({ stepMs: 10, maxStepsPerFrame: 3 });
    expect(acc.advance(105)).toBe(3);
    expect(acc.droppedMs).toBe(70);
    expect(acc.alpha).toBeCloseTo(0.5);
  });

  it('ignores non-positive deltas and resets', () => {
    const acc = new FixedStepAccumulator({ stepMs: 10, maxStepsPerFrame: 3 });
    expect(acc.advance(0)).toBe(0);
    expect(acc.advance(-5)).toBe(0);
    expect(acc.advance(Number.NaN)).toBe(0);
    acc.advance(5);
    acc.reset();
    expect(acc.alpha).toBe(0);
  });
});
