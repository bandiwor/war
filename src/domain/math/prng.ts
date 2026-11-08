import type { Seed } from '../core/brand';
import { fnv1a32 } from './hash';

/**
 * sfc32 PRNG (Chris Doty-Humphrey's Small Fast Counting generator).
 * 128-bit state, period >= 2^32, passes PractRand to multi-terabyte sizes,
 * and needs only 32-bit integer ops, so it is bit-identical on every JS engine.
 *
 * Streams: every subsystem gets its own generator derived from (rootSeed, name)
 * so adding RNG calls in one subsystem never shifts another's sequence.
 */
export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

function splitmix32(x: number): number {
  x = (x + 0x9e3779b9) >>> 0;
  let z = x;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

export class Rng {
  /**
   * State lives in a typed array, not object fields: uint32 values above 2^30
   * are not V8 Smis, so field writes would box a HeapNumber on every draw.
   */
  private readonly s = new Uint32Array(4);

  private constructor(a: number, b: number, c: number, d: number) {
    this.s[0] = a;
    this.s[1] = b;
    this.s[2] = c;
    this.s[3] = d;
  }

  static fromSeed(seed: number): Rng {
    const s0 = splitmix32(seed);
    const s1 = splitmix32(s0);
    const s2 = splitmix32(s1);
    const rng = new Rng(s0, s1, s2, 1);
    // Discard the first outputs: sfc32 needs a few rounds to decorrelate from the seed.
    for (let i = 0; i < 12; i++) rng.nextU32();
    return rng;
  }

  static fromState(state: RngState): Rng {
    return new Rng(state.a, state.b, state.c, state.d);
  }

  /** Independent stream named `name` under `root`. Order of creation does not matter. */
  static stream(root: Seed, name: string): Rng {
    return Rng.fromSeed(splitmix32(root ^ fnv1a32(name)) ^ fnv1a32(name + '#'));
  }

  state(): RngState {
    const s = this.s;
    return { a: s[0] ?? 0, b: s[1] ?? 0, c: s[2] ?? 0, d: s[3] ?? 0 };
  }

  nextU32(): number {
    const s = this.s;
    const a = s[0] ?? 0;
    const b = s[1] ?? 0;
    const c = s[2] ?? 0;
    const d = s[3] ?? 0;
    const t = (a + b + d) >>> 0;
    s[3] = d + 1;
    s[0] = b ^ (b >>> 9);
    s[1] = c + (c << 3);
    s[2] = ((c << 21) | (c >>> 11)) + t;
    return t;
  }

  /** Uniform float in [0, 1) with 32 bits of resolution. */
  nextFloat(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.nextFloat();
  }

  /** Uniform integer in [min, max] (inclusive), unbiased via rejection sampling. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Invalid int range [${String(min)}, ${String(max)}]`);
    }
    const span = max - min + 1;
    if (span > 4294967296) throw new RangeError('Range wider than 2^32');
    if (span === 4294967296) return min + this.nextU32();
    const limit = 4294967296 - (4294967296 % span);
    let x = this.nextU32();
    while (x >= limit) x = this.nextU32();
    return min + (x % span);
  }

  chance(probability: number): boolean {
    return this.nextFloat() < probability;
  }
}

/**
 * One root seed, lazily created named streams. Hashing iterates streams in
 * sorted-name order so the digest does not depend on creation order.
 */
export class RngStreams {
  private readonly streams = new Map<string, Rng>();

  constructor(readonly root: Seed) {}

  get(name: string): Rng {
    let rng = this.streams.get(name);
    if (rng === undefined) {
      rng = Rng.stream(this.root, name);
      this.streams.set(name, rng);
    }
    return rng;
  }

  names(): readonly string[] {
    return [...this.streams.keys()].sort();
  }

  snapshot(): Readonly<Record<string, RngState>> {
    const out: Record<string, RngState> = {};
    for (const name of this.names()) {
      const rng = this.streams.get(name);
      if (rng !== undefined) out[name] = rng.state();
    }
    return out;
  }

  restore(snapshot: Readonly<Record<string, RngState>>): void {
    this.streams.clear();
    for (const [name, state] of Object.entries(snapshot))
      this.streams.set(name, Rng.fromState(state));
  }
}
