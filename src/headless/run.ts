import { createEmptyWorld } from '../application/scenes/empty-world';
import { createSandbox } from '../application/scenes/sandbox';
import { scriptedCommands } from '../application/replay/scripted-input';
import type { Simulation } from '../application/simulation';
import type { Seed } from '../domain/core/brand';
import { Rng } from '../domain/math/prng';
import { createRapierPhysics } from '../infrastructure/physics/rapier-physics';

export type HeadlessScene = 'empty' | 'sandbox';

export interface HeadlessResult {
  readonly ticks: number;
  readonly hash: string;
}

/** Builds a scene for Node (no rendering, no audio). */
export async function createHeadlessScene(
  scene: HeadlessScene,
  runSeed: Seed,
): Promise<Simulation> {
  switch (scene) {
    case 'empty':
      return createEmptyWorld(runSeed).simulation;
    case 'sandbox':
      return createSandbox(runSeed, await createRapierPhysics(60)).simulation;
  }
}

/** Runs the simulation without any rendering, as fast as the CPU allows. */
export async function runHeadless(
  runSeed: Seed,
  ticks: number,
  withInput: boolean,
  scene: HeadlessScene = 'empty',
): Promise<HeadlessResult> {
  const simulation = await createHeadlessScene(scene, runSeed);
  const script = withInput ? scriptedCommands(Rng.stream(runSeed, 'test.input'), ticks) : [];
  for (let t = 0; t < ticks; t++) simulation.step(script[t] ?? []);
  return { ticks, hash: simulation.stateHash() };
}
