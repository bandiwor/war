import { tick as toTick, type Seed, type Tick } from '../domain/core/brand';
import type { World } from '../domain/ecs/world';
import { buildSchedule, type System } from '../domain/ecs/schedule';
import type { InputCommand } from '../domain/input/commands';
import { StateHasher } from '../domain/math/hash';
import { RngStreams } from '../domain/math/prng';
import { GameEvents } from '../domain/events/bus';

/** What every system sees for one tick. Reused across ticks (no per-tick allocation). */
export interface SimContext {
  readonly world: World;
  readonly rng: RngStreams;
  readonly tick: Tick;
  /** Fixed step in seconds. */
  readonly dt: number;
  readonly commands: readonly InputCommand[];
  /** Events emitted this tick; cleared at the start of the next one. */
  readonly events: GameEvents;
}

interface MutableContext {
  world: World;
  rng: RngStreams;
  tick: Tick;
  dt: number;
  commands: readonly InputCommand[];
  events: GameEvents;
}

export interface SimulationOptions {
  readonly seed: Seed;
  readonly tickRate: number;
  readonly world: World;
  readonly systems: readonly System<SimContext>[];
  readonly events?: GameEvents;
  /** Extra state outside the ECS (e.g. the physics world) that the state hash must cover. */
  readonly hashExtras?: readonly ((h: StateHasher) => void)[];
}

// Deliberately not Object.freeze()d: iterating a frozen array leaves V8's
// array-iterator fast path and allocates on every tick (caught by perf gate).
const NO_COMMANDS: readonly InputCommand[] = [];

/** Accumulated time per system (same order as `systemOrder`) since profiling started. */
export interface SystemProfiler {
  readonly clock: () => number;
  readonly names: readonly string[];
  readonly totals: Float64Array;
  ticks: number;
}

/** Mean milliseconds per tick of each system, slowest first. */
export function systemTimings(p: SystemProfiler): { name: string; ms: number; share: number }[] {
  const total = p.totals.reduce((a, b) => a + b, 0) || 1;
  return p.names
    .map((name, i) => {
      const t = p.totals[i] ?? 0;
      return { name, ms: t / Math.max(1, p.ticks), share: t / total };
    })
    .sort((a, b) => b.ms - a.ms);
}

/**
 * Deterministic simulation: state after N ticks is a pure function of
 * (seed, per-tick commands, N). It has no notion of wall-clock time.
 */
export class Simulation {
  readonly seed: Seed;
  readonly tickRate: number;
  readonly world: World;
  readonly rng: RngStreams;
  readonly events: GameEvents;
  private readonly hashExtras: readonly ((h: StateHasher) => void)[];
  private readonly schedule: readonly System<SimContext>[];
  private readonly ctx: MutableContext;
  private readonly hasher = new StateHasher();
  private currentTick = 0;
  private profiler: SystemProfiler | null = null;

  constructor(options: SimulationOptions) {
    if (!Number.isInteger(options.tickRate) || options.tickRate <= 0) {
      throw new RangeError('tickRate must be a positive integer');
    }
    this.seed = options.seed;
    this.tickRate = options.tickRate;
    this.world = options.world;
    this.rng = new RngStreams(options.seed);
    this.events = options.events ?? new GameEvents();
    this.hashExtras = options.hashExtras ?? [];
    this.schedule = buildSchedule(options.systems);
    this.ctx = {
      world: this.world,
      rng: this.rng,
      tick: toTick(0),
      dt: 1 / options.tickRate,
      commands: NO_COMMANDS,
      events: this.events,
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
    this.events.clear();
    const schedule = this.schedule;
    const prof = this.profiler;
    if (prof === null) {
      for (let i = 0; i < schedule.length; i++) schedule[i]?.run(ctx);
    } else {
      // Instrumented: the clock is the profiler's (outside the simulation), so timing never feeds back.
      let t = prof.clock();
      for (let i = 0; i < schedule.length; i++) {
        schedule[i]?.run(ctx);
        const now = prof.clock();
        prof.totals[i] = (prof.totals[i] ?? 0) + (now - t);
        t = now;
      }
      prof.ticks++;
    }
    ctx.commands = NO_COMMANDS;
    this.currentTick++;
  }

  /**
   * Starts (or with null stops) timing every system, for the debug menu and
   * the profiling script. The clock comes from outside (`performance.now` in
   * the browser), so the simulation stays free of wall-clock reads; timings are
   * observed, never used.
   */
  setProfiler(clock: (() => number) | null): SystemProfiler | null {
    this.profiler =
      clock === null
        ? null
        : {
            clock,
            names: this.systemOrder,
            totals: new Float64Array(this.schedule.length),
            ticks: 0,
          };
    return this.profiler;
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
    for (const extra of this.hashExtras) extra(h);
    return h.digest();
  }
}
