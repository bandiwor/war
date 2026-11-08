import type { InputCommand } from '../../domain/input/commands';
import { ACTIONS } from '../../domain/input/commands';
import type { Rng } from '../../domain/math/prng';

/**
 * Generates a pseudo-random but reproducible input stream, used to fuzz the
 * simulation in determinism tests and benchmarks.
 */
export function scriptedCommands(rng: Rng, ticks: number): InputCommand[][] {
  const out: InputCommand[][] = [];
  for (let t = 0; t < ticks; t++) {
    const cmds: InputCommand[] = [];
    if (rng.chance(0.3)) {
      cmds.push({ type: 'move', forward: rng.range(-1, 1), strafe: rng.range(-1, 1) });
    }
    if (rng.chance(0.5)) {
      cmds.push({ type: 'look', yaw: rng.range(-0.05, 0.05), pitch: rng.range(-0.05, 0.05) });
    }
    if (rng.chance(0.1)) {
      const action = ACTIONS[rng.int(0, ACTIONS.length - 1)] ?? 'fire';
      cmds.push({ type: 'action', action, pressed: rng.chance(0.5) });
    }
    out.push(cmds);
  }
  return out;
}
