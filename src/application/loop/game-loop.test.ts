import { describe, expect, it } from 'vitest';
import { createEmptyWorld } from '../scenes/empty-world';
import { seed } from '../../domain/core/brand';
import type { InputCommand } from '../../domain/input/commands';
import { GameLoop } from './game-loop';
import type { FrameSource } from './ports';

class ManualFrames implements FrameSource {
  cb: ((now: number) => void) | undefined;
  starts = 0;
  start(onFrame: (now: number) => void): void {
    this.cb = onFrame;
    this.starts++;
  }
  stop(): void {
    this.cb = undefined;
  }
  emit(now: number): void {
    this.cb?.(now);
  }
}

function setup() {
  const { simulation } = createEmptyWorld(seed(1));
  const frames = new ManualFrames();
  const alphas: number[] = [];
  const ticks: number[] = [];
  const asked: number[] = [];
  const cmd: InputCommand[] = [{ type: 'move', forward: 1, strafe: 0 }];
  const loop = new GameLoop({
    simulation,
    frames,
    input: {
      commandsFor(t) {
        asked.push(t);
        return t === 0 ? cmd : [];
      },
    },
    presenter: { present: (a) => alphas.push(a) },
    onTick: (s) => ticks.push(s.tick),
  });
  return { simulation, frames, loop, alphas, ticks, asked };
}

describe('GameLoop', () => {
  it('converts frames into fixed ticks and presents with alpha', () => {
    const { frames, loop, simulation, alphas, ticks, asked } = setup();
    loop.start();
    loop.start(); // idempotent
    expect(frames.starts).toBe(1);
    expect(loop.isRunning).toBe(true);
    frames.emit(1000);
    frames.emit(1000 + 50); // 3 steps at 60 Hz, alpha 0.0
    expect(simulation.tick).toBe(3);
    expect(ticks).toEqual([1, 2, 3]);
    expect(asked).toEqual([0, 1, 2]);
    expect(alphas).toHaveLength(2);
    expect(alphas[1]).toBeGreaterThanOrEqual(0);
    loop.stop();
    loop.stop();
    expect(loop.isRunning).toBe(false);
  });

  it('pauses exactly at a requested tick', () => {
    const { frames, loop, simulation } = setup();
    loop.start();
    frames.emit(0);
    loop.pauseAtTick(4);
    frames.emit(80); // 4.8 steps worth of time, max 5 per frame
    expect(simulation.tick).toBe(4);
    expect(loop.isPaused).toBe(true);
    frames.emit(200);
    expect(simulation.tick).toBe(4);
  });

  it('pauses and single-steps', () => {
    const { frames, loop, simulation, alphas } = setup();
    loop.start();
    frames.emit(0);
    loop.setPaused(true);
    expect(loop.isPaused).toBe(true);
    frames.emit(500);
    expect(simulation.tick).toBe(0);
    loop.stepOnce();
    loop.stepOnce();
    frames.emit(516);
    expect(simulation.tick).toBe(2);
    expect(alphas.at(-1)).toBe(1);
    loop.setPaused(false);
    frames.emit(532);
    expect(simulation.tick).toBe(2); // accumulator was reset on unpause; 16ms < one step
  });
});
