/**
 * Seeded noise sources for real-time synthesis (allocation-free per sample).
 * xorshift32 is plenty for audio and much cheaper than the game PRNG.
 */
export class WhiteNoise {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform in [-1, 1). */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 2147483648 - 1;
  }

  /** Uniform in [0, 1). */
  unit(): number {
    return (this.next() + 1) * 0.5;
  }
}

/** Pink (1/f, −3 dB/octave) noise: Paul Kellet's refined filter. */
export class PinkNoise {
  private readonly white: WhiteNoise;
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  constructor(seed: number) {
    this.white = new WhiteNoise(seed);
  }

  next(): number {
    const w = this.white.next();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const out = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return out * 0.11;
  }
}

/** Brown (1/f², −6 dB/octave) noise: leaky integrated white noise. */
export class BrownNoise {
  private readonly white: WhiteNoise;
  private last = 0;

  constructor(seed: number) {
    this.white = new WhiteNoise(seed);
  }

  next(): number {
    this.last = (this.last + 0.02 * this.white.next()) / 1.02;
    return this.last * 3.5;
  }
}

/** One-pole smoother (parameter de-zippering, envelopes). */
export class Smoother {
  value: number;
  private readonly k: number;

  /** `seconds` = time constant; `rate` = updates per second. */
  constructor(initial: number, seconds: number, rate: number) {
    this.value = initial;
    this.k = 1 - Math.exp(-1 / Math.max(1e-6, seconds * rate));
  }

  step(target: number): number {
    this.value += (target - this.value) * this.k;
    return this.value;
  }
}
