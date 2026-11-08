import { createEmptyWorld } from '../application/scenes/empty-world';
import { scriptedCommands } from '../application/replay/scripted-input';
import type { Seed } from '../domain/core/brand';
import { Rng } from '../domain/math/prng';

export interface HeadlessResult {
  readonly ticks: number;
  readonly hash: string;
}

/** Runs the simulation without any rendering, as fast as the CPU allows. */
export function runHeadless(runSeed: Seed, ticks: number, withInput: boolean): HeadlessResult {
  const { simulation } = createEmptyWorld(runSeed);
  const script = withInput ? scriptedCommands(Rng.stream(runSeed, 'test.input'), ticks) : [];
  for (let t = 0; t < ticks; t++) simulation.step(script[t] ?? []);
  return { ticks, hash: simulation.stateHash() };
}
