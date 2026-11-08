/**
 * Fixed-timestep accumulator ("Fix Your Timestep"). Converts variable frame
 * deltas into a whole number of simulation steps plus an interpolation alpha
 * for rendering. Pure: it is told the time, it never reads a clock.
 */
export interface FixedStepOptions {
  readonly stepMs: number;
  /** Cap on catch-up steps per frame, to avoid the spiral of death. */
  readonly maxStepsPerFrame: number;
}

export class FixedStepAccumulator {
  private accumulatorMs = 0;
  private droppedTotalMs = 0;

  constructor(readonly options: FixedStepOptions) {
    if (!(options.stepMs > 0)) throw new RangeError('stepMs must be > 0');
    if (!Number.isInteger(options.maxStepsPerFrame) || options.maxStepsPerFrame < 1) {
      throw new RangeError('maxStepsPerFrame must be a positive integer');
    }
  }

  /** Adds frame time and returns how many fixed steps to run now. */
  advance(frameDeltaMs: number): number {
    if (!(frameDeltaMs > 0)) return 0;
    this.accumulatorMs += frameDeltaMs;
    let steps = Math.floor(this.accumulatorMs / this.options.stepMs);
    if (steps > this.options.maxStepsPerFrame) {
      const excess = (steps - this.options.maxStepsPerFrame) * this.options.stepMs;
      this.droppedTotalMs += excess;
      this.accumulatorMs -= excess;
      steps = this.options.maxStepsPerFrame;
    }
    this.accumulatorMs -= steps * this.options.stepMs;
    return steps;
  }

  /** Fraction of a step left over, in [0, 1): blend factor between the last two states. */
  get alpha(): number {
    return this.accumulatorMs / this.options.stepMs;
  }

  /** Wall time discarded because the simulation could not keep up. */
  get droppedMs(): number {
    return this.droppedTotalMs;
  }

  reset(): void {
    this.accumulatorMs = 0;
  }
}
