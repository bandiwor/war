import { FixedStepAccumulator } from './fixed-step';
import type { FrameSource, InputSource, Presenter } from './ports';
import type { Simulation } from '../simulation';

export interface GameLoopOptions {
  readonly simulation: Simulation;
  readonly frames: FrameSource;
  readonly input: InputSource;
  readonly presenter: Presenter;
  readonly maxStepsPerFrame?: number;
  /** Optional hook after each simulated tick (replay recording, debug tools). */
  readonly onTick?: (sim: Simulation) => void;
}

/** Glues a frame source to the fixed-step simulation and a presenter. */
export class GameLoop {
  private readonly accumulator: FixedStepAccumulator;
  private lastFrameMs: number | undefined;
  private paused = false;
  private pendingSingleSteps = 0;
  private running = false;

  constructor(private readonly options: GameLoopOptions) {
    this.accumulator = new FixedStepAccumulator({
      stepMs: 1000 / options.simulation.tickRate,
      maxStepsPerFrame: options.maxStepsPerFrame ?? 5,
    });
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameMs = undefined;
    this.options.frames.start((now) => {
      this.frame(now);
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.options.frames.stop();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.accumulator.reset();
  }

  /** While paused, run exactly one tick on the next frame (frame-by-frame debugging). */
  stepOnce(): void {
    this.pendingSingleSteps++;
  }

  frame(nowMs: number): void {
    const delta = this.lastFrameMs === undefined ? 0 : nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;
    let steps: number;
    if (this.paused) {
      steps = this.pendingSingleSteps;
      this.pendingSingleSteps = 0;
    } else {
      steps = this.accumulator.advance(delta);
    }
    for (let i = 0; i < steps; i++) this.simulateOne();
    this.options.presenter.present(this.paused ? 1 : this.accumulator.alpha);
  }

  private simulateOne(): void {
    const sim = this.options.simulation;
    sim.step(this.options.input.commandsFor(sim.tick));
    this.options.onTick?.(sim);
  }
}
