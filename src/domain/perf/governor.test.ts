import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GOVERNOR, QualityGovernor } from './governor';

const BUDGET = DEFAULT_GOVERNOR.budgetMs;

/**
 * A GPU-bound frame: a fixed part plus a part proportional to pixels
 * (scale²), each tier saving a share of the pixel cost.
 */
function frameCost(fixed: number, pixels: number, g: QualityGovernor): number {
  const tierSaving = [1, 0.8, 0.65][g.tier] ?? 1;
  return fixed + pixels * g.scale * g.scale * tierSaving;
}

function run(
  g: QualityGovernor,
  frames: number,
  cost: (g: QualityGovernor, i: number) => number,
): number[] {
  const scales: number[] = [];
  for (let i = 0; i < frames; i++) {
    g.update(cost(g, i));
    scales.push(g.scale + g.tier * 10);
  }
  return scales;
}

describe('quality governor', () => {
  it('a light scene stays at full quality', () => {
    const g = new QualityGovernor();
    run(g, 3000, () => 9);
    expect([g.scale, g.tier, g.changes]).toEqual([1, 0, 0]);
  });

  it('an overloaded scene comes down until the frame fits, then stays put', () => {
    const g = new QualityGovernor();
    const trace = run(g, 6000, (x) => frameCost(4, 22, x)); // 26 ms at full resolution
    expect(g.scale).toBeLessThan(1);
    expect(frameCost(4, 22, g)).toBeLessThanOrEqual(BUDGET * DEFAULT_GOVERNOR.overload);
    // Settled: no change in the last 2000 frames (no oscillation).
    const tail = trace.slice(-2000);
    expect(new Set(tail).size).toBe(1);
    expect(g.changes).toBeLessThan(10);
  });

  it('when resolution is not enough it drops feature tiers, and gives them back when load eases', () => {
    const g = new QualityGovernor();
    run(g, 4000, (x) => frameCost(12, 30, x));
    expect(g.scale).toBe(DEFAULT_GOVERNOR.minScale);
    expect(g.tier).toBeGreaterThan(0);
    expect(g.tierName).not.toBe('full');
    // The heavy moment passes.
    run(g, 20000, (x) => frameCost(3, 6, x));
    expect(g.tier).toBe(0);
    expect(g.scale).toBe(1);
  });

  it('single spikes (GC, a shader compile) change nothing', () => {
    const g = new QualityGovernor();
    run(g, 5000, (_, i) => (i % 97 === 0 ? 120 : 10));
    expect(g.mean).toBeLessThan(13);
    expect(g.changes).toBe(0);
  });

  it('can be switched off; ignores garbage input', () => {
    const g = new QualityGovernor();
    g.enabled = false;
    run(g, 2000, () => 40);
    expect(g.changes).toBe(0);
    g.enabled = true;
    expect(g.update(Number.NaN)).toBe('none');
    expect(g.mean).toBeNull();
  });

  it('decides on time, not frame count: a 2 fps machine scales down within seconds', () => {
    const g = new QualityGovernor();
    let ms = 0;
    while (g.scale === 1 && ms < 10_000) {
      g.update(500);
      ms += 500;
    }
    expect(ms).toBeLessThanOrEqual(2000);
    expect(g.scale).toBe(DEFAULT_GOVERNOR.minScale);
  });

  it('never leaves its bounds and settles, whatever the load (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 20, noNaN: true }),
        fc.double({ min: 1, max: 60, noNaN: true }),
        (fixed, pixels) => {
          const g = new QualityGovernor();
          const trace = run(g, 8000, (x) => frameCost(fixed, pixels, x));
          expect(g.scale).toBeGreaterThanOrEqual(DEFAULT_GOVERNOR.minScale);
          expect(g.scale).toBeLessThanOrEqual(DEFAULT_GOVERNOR.maxScale);
          expect(g.tier).toBeGreaterThanOrEqual(0);
          expect(g.tier).toBeLessThanOrEqual(DEFAULT_GOVERNOR.maxTier);
          // At most a slow ceiling-decay probe in the last 1500 frames.
          expect(new Set(trace.slice(-1500)).size).toBeLessThanOrEqual(3);
        },
      ),
      { numRuns: 80 },
    );
  });
});
