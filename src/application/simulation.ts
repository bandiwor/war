import { tick as toTick, type Seed, type Tick } from '../domain/core/brand';
import type { World } from '../domain/ecs/world';
import { buildSchedule, type System } from '../domain/ecs/schedule';
import type { InputCommand } from '../domain/input/commands';
import { StateHasher } from '../domain/math/hash';
import { RngStreams } from '../domain/math/prng';

/** What every system sees for one tick. Reused across ticks (no per-tick allocation). */
export interface SimContext {
  readonly world: World;
  readonly rng: RngStreams;
  readonly tick: Tick;
  /** Fixed step in seconds. */
  readonly dt: number;
  readonly commands: readonly InputCommand[];
}

interface MutableContext {
  world: World;
  rng: RngStreams;
  tick: Tick;
  dt: number;
  commands: readonly InputCommand[];
}

export interface SimulationOptions {
  readonly seed: Seed;
  readonly tickRate: number;
  readonly world: World;
  readonly systems: readonly System<SimContext>[];
}

// Deliberately not Object.freeze()d: iterating a frozen array leaves V8's
// array-iterator fast path and allocates on every tick (caught by perf gate).
const NO_COMMANDS: readonly InputCommand[] = [];

/**
 * Deterministic simulation: state after N ticks is a pure function of
 * (seed, per-tick commands, N). It has no notion of wall-clock time.
 */
export class Simulation {
  readonly seed: Seed;
  readonly tickRate: number;
  readonly world: World;
  readonly rng: RngStreams;
  private readonly schedule: readonly System<SimContext>[];
  private readonly ctx: MutableContext;
  private readonly hasher = new StateHasher();
  private currentTick = 0;

  constructor(options: SimulationOptions) {
    if (!Number.isInteger(options.tickRate) || options.tickRate <= 0) {
      throw new RangeError('tickRate must be a positive integer');
    }
    this.seed = options.seed;
    this.tickRate = options.tickRate;
    this.world = options.world;
    this.rng = new RngStreams(options.seed);
    this.schedule = buildSchedule(options.systems);
    this.ctx = {
      world: this.world,
      rng: this.rng,
      tick: toTick(0),
      dt: 1 / options.tickRate,
      commands: NO_COMMANDS,
    };
  }

  get tick(): Tick {
    return toTick(this.currentTick);
  }

  get systemOrder(): readonly string[] {
    return this.schedule.map((s) => s.name);
  }

  /** Advances exactly one fixed step using the commands issued for this tick. */
  step(commands: readonly InputCommand[] = NO_COMMANDS): void {
    const ctx = this.ctx;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- currentTick is a non-negative integer by construction; avoids the validating constructor in the hot path
    ctx.tick = this.currentTick as Tick;
    ctx.commands = commands;
    const schedule = this.schedule;
    for (let i = 0; i < schedule.length; i++) schedule[i]?.run(ctx);
    ctx.commands = NO_COMMANDS;
    this.currentTick++;
  }

  /** Fingerprint of everything that defines the simulation state. */
  stateHash(): string {
    const h = this.hasher.reset();
    h.u32(this.seed).u32(this.tickRate).u32(this.currentTick);
    for (const name of this.rng.names()) {
      const s = this.rng.get(name).state();
      h.string(name).u32(s.a).u32(s.b).u32(s.c).u32(s.d);
    }
    this.world.hashInto(h);
    return h.digest();
  }
}
