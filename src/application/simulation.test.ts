import { describe, expect, it } from 'vitest';
import { seed } from '../domain/core/brand';
import type { System } from '../domain/ecs/schedule';
import { World } from '../domain/ecs/world';
import { Simulation, type SimContext } from './simulation';

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
