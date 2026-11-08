import type { Tick } from '../../domain/core/brand';
import type { InputCommand } from '../../domain/input/commands';

/** Calls back once per display frame with a monotonic timestamp in ms. */
export interface FrameSource {
  start(onFrame: (nowMs: number) => void): void;
  stop(): void;
}

/** Produces the commands for the tick about to be simulated. */
export interface InputSource {
  commandsFor(tick: Tick): readonly InputCommand[];
}

/** Draws the current state; `alpha` interpolates between the last two ticks. */
export interface Presenter {
  present(alpha: number): void;
}
