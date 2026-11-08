import type { FrameSource } from '../../application/loop/ports';

/** requestAnimationFrame-driven frames. The only place wall-clock time enters the game. */
export class RafFrameSource implements FrameSource {
  private handle = 0;
  private callback: ((nowMs: number) => void) | undefined;

  private readonly tick = (now: number): void => {
    if (this.callback === undefined) return;
    this.callback(now);
    this.handle = requestAnimationFrame(this.tick);
  };

  start(onFrame: (nowMs: number) => void): void {
    this.callback = onFrame;
    this.handle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.callback = undefined;
    cancelAnimationFrame(this.handle);
  }
}
