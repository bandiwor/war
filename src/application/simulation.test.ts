import { describe, expect, it } from 'vitest';
import { seed } from '../domain/core/brand';
import type { System } from '../domain/ecs/schedule';
import { World } from '../domain/ecs/world';
import { Simulation, systemTimings, type SimContext } from './simulation';
import { createEmptyWorld } from './scenes/empty-world';

const make = (systems: System<SimContext>[] = [], tickRate = 60): Simulation =>
  new Simulation({ seed: seed(9), tickRate, world: new World(), systems });

describe('Simulation', () => {
  it('validates tickRate', () => {
    expect(() => make([], 0)).toThrow(RangeError);
    expect(() => make([], 59.5)).toThrow(RangeError);
  });

  it('advances ticks and passes a stable context to systems', () => {
    const seen: { tick: number; dt: number; n: number }[] = [];
    const sim = make([
      {
        name: 'probe',
        run(ctx) {
          seen.push({ tick: ctx.tick, dt: ctx.dt, n: ctx.commands.length });
        },
      },
    ]);
    sim.step();
    sim.step([{ type: 'move', forward: 1, strafe: 0 }]);
    expect(sim.tick).toBe(2);
    expect(seen).toEqual([
      { tick: 0, dt: 1 / 60, n: 0 },
      { tick: 1, dt: 1 / 60, n: 1 },
    ]);
    expect(sim.systemOrder).toEqual(['probe']);
  });

  it('hash covers tick count and RNG stream state', () => {
    const a = make([{ name: 'roll', run: (ctx) => void ctx.rng.get('x').nextU32() }]);
    const b = make();
    expect(a.stateHash()).toBe(b.stateHash());
    a.step();
    b.step();
    expect(a.stateHash()).not.toBe(b.stateHash());
  });
});

describe('system profiling', () => {
  it('times every system with an external clock and never changes the state', () => {
    const a = createEmptyWorld(seed(3)).simulation;
    const b = createEmptyWorld(seed(3)).simulation;
    let fake = 0;
    const prof = b.setProfiler(() => (fake += 0.25));
    for (let i = 0; i < 100; i++) {
      a.step([{ type: 'move', forward: 1, strafe: 0 }]);
      b.step([{ type: 'move', forward: 1, strafe: 0 }]);
    }
    expect(b.stateHash()).toBe(a.stateHash());
    if (prof === null) throw new Error('no profiler');
    expect(prof.ticks).toBe(100);
    const t = systemTimings(prof);
    expect(t.map((x) => x.name).sort()).toEqual([...b.systemOrder].sort());
    expect(t[0]?.ms).toBeCloseTo(0.25, 6);
    expect(t.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6);
    expect(b.setProfiler(null)).toBeNull();
    // Several systems: sorted slowest first.
    const sys = (name: string): System<SimContext> => ({ name, run: () => undefined });
    const multi = new Simulation({
      seed: seed(1),
      tickRate: 60,
      world: new World(),
      systems: [sys('fast'), sys('slow')],
    });
    let clock = 0;
    let n = 0;
    const p2 = multi.setProfiler(() => (clock += n++ % 3 === 2 ? 3 : 1));
    for (let i = 0; i < 10; i++) multi.step();
    if (p2 === null) throw new Error('no profiler');
    const order = systemTimings(p2).map((x) => x.name);
    expect(order).toHaveLength(2);
    expect(systemTimings(p2)[0]?.ms).toBeGreaterThanOrEqual(systemTimings(p2)[1]?.ms ?? 0);
    b.step([]);
    expect(prof.ticks).toBe(100);
  });
});
