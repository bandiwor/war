import { Rng } from '../../../domain/math/prng';

/**
 * Schedules signal-loss events as a Poisson process (rate per minute), each
 * with a short attack/decay envelope. Render-side only: seeded, but driven by
 * wall time, so it never affects the simulation.
 */
export class SignalLossScheduler {
  private readonly rng: Rng;
  private eventStart = -1;
  private eventLength = 0;
  private eventPeak = 0;
  private seedValue = 0;
  private forced = 0;

  constructor(seed: number) {
    this.rng = Rng.fromSeed(seed);
  }

  /** Debug: force an event of the given strength for `seconds`. */
  trigger(now: number, seconds = 0.6, peak = 1): void {
    this.start(now, seconds, peak);
  }

  /** Visual tests: hold a constant level (0 = off). */
  force(level: number): void {
    this.forced = level;
  }

  update(now: number, dt: number, ratePerMinute: number): void {
    if (this.forced > 0) return;
    const active = this.eventStart >= 0 && now < this.eventStart + this.eventLength;
    if (
      !active &&
      dt > 0 &&
      dt < 1 &&
      this.rng.nextFloat() < 1 - Math.exp((-ratePerMinute / 60) * dt)
    ) {
      this.start(now, this.rng.range(0.12, 0.8), this.rng.range(0.35, 1));
    }
  }

  level(now: number): number {
    if (this.forced > 0) return this.forced;
    if (this.eventStart < 0) return 0;
    const t = (now - this.eventStart) / this.eventLength;
    if (t < 0 || t > 1) return 0;
    const envelope = Math.min(1, t * 8) * Math.min(1, (1 - t) * 4);
    return envelope * this.eventPeak;
  }

  get seed(): number {
    return this.seedValue;
  }

  private start(now: number, seconds: number, peak: number): void {
    this.eventStart = now;
    this.eventLength = seconds;
    this.eventPeak = peak;
    this.seedValue = this.rng.int(0, 9999);
  }
}
