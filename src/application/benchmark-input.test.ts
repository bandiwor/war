import { describe, expect, it } from 'vitest';
import { tick } from '../domain/core/brand';
import { BenchmarkInput } from './benchmark-input';

describe('BenchmarkInput', () => {
  it('starts walking on tick 0, then only looks; deterministic per tick', () => {
    const a = new BenchmarkInput();
    expect(a.commandsFor(tick(0)).map((c) => c.type)).toEqual(['move', 'look']);
    expect(a.commandsFor(tick(1)).map((c) => c.type)).toEqual(['look']);
    const b = new BenchmarkInput();
    expect(JSON.stringify(b.commandsFor(tick(400)))).toBe(JSON.stringify(a.commandsFor(tick(400))));
  });

  it('whip-pans for 20 ticks every 6 seconds', () => {
    const a = new BenchmarkInput();
    const yaw = (t: number): number => {
      const c = a.commandsFor(tick(t)).find((x) => x.type === 'look');
      return c?.type === 'look' ? c.yaw : Number.NaN;
    };
    expect(yaw(365)).toBeGreaterThan(0.07);
    expect(yaw(400)).toBeLessThan(0.02);
  });
});
