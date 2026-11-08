import { RapierPhysics, initRapier } from '../../src/infrastructure/physics/rapier-physics';
import { createSandbox, type Sandbox } from '../../src/application/scenes/sandbox';
import { seed } from '../../src/domain/core/brand';

await initRapier();

/** Fresh deterministic physics world at 60 Hz (WASM already initialised). */
export function newPhysics(): RapierPhysics {
  return RapierPhysics.create(1 / 60);
}

export function newSandbox(s = 1): Sandbox {
  return createSandbox(seed(s), newPhysics());
}
