import { describe, expect, it } from 'vitest';
import { Ring } from './ring';

describe('Ring', () => {
  it('keeps recent values, mean and percentiles', () => {
    const r = new Ring();
    expect(r.mean()).toBe(0);
    expect(r.percentile(0.5)).toBe(0);
    for (let i = 1; i <= 300; i++) r.push(i);
    expect(r.count).toBe(240);
    expect(r.recent(0)).toBe(300);
    expect(r.recent(1)).toBe(299);
    expect(r.mean()).toBeCloseTo((61 + 300) / 2);
    expect(r.percentile(0.99)).toBeGreaterThanOrEqual(297);
  });
});
