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
  /**
   * Optional wall clock (ms) and sink for each tick's cost: the profiler checks
   * the simulation's frame budget. Injected because game logic has no clock.
   */
  readonly clock?: () => number;
  readonly onTickTime?: (ms: number) => void;
}

/** Glues a frame source to the fixed-step simulation and a presenter. */
export class GameLoop {
  private readonly accumulator: FixedStepAccumulator;
  private lastFrameMs: number | undefined;
  private paused = false;
  private pendingSingleSteps = 0;
  private running = false;
  private pauseAt = -1;

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

  /** Pause exactly when the simulation reaches `tick` (debugging, replay inspection). */
  pauseAtTick(tick: number): void {
    this.pauseAt = tick;
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
    for (let i = 0; i < steps && !this.reachedPausePoint(); i++) this.simulateOne();
    this.reachedPausePoint();
    this.options.presenter.present(this.paused ? 1 : this.accumulator.alpha);
  }

  /** Pauses (once) when the requested tick is reached. */
  private reachedPausePoint(): boolean {
    if (this.pauseAt < 0 || this.options.simulation.tick < this.pauseAt) return false;
    this.pauseAt = -1;
    this.paused = true;
    this.accumulator.reset();
    return true;
  }

  private simulateOne(): void {
    const sim = this.options.simulation;
    const { clock, onTickTime } = this.options;
    const t0 = clock?.() ?? 0;
    sim.step(this.options.input.commandsFor(sim.tick));
    if (clock !== undefined && onTickTime !== undefined) onTickTime(clock() - t0);
    this.options.onTick?.(sim);
  }
}
