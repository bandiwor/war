import { defineComponent } from '../../domain/ecs/component';
import type { System } from '../../domain/ecs/schedule';
import { World } from '../../domain/ecs/world';
import type { EntityId } from '../../domain/ecs/entity';
import { actionBit } from '../../domain/input/commands';
import { assertNever } from '../../domain/core/assert';
import type { Seed } from '../../domain/core/brand';
import { Simulation, type SimContext } from '../simulation';

/**
 * Stage-0 world: one player entity whose intent is driven by input commands.
 * No physics or rendering yet; this exists so the loop, input pipeline,
 * replays and state hash have something real to exercise.
 */
export const PlayerIntent = defineComponent('PlayerIntent', {
  forward: 'f32',
  strafe: 'f32',
  yaw: 'f64',
  pitch: 'f64',
  buttons: 'u32',
});

export const TICK_RATE = 60;

function intentSystem(player: EntityId): System<SimContext> {
  return {
    name: 'input.intent',
    run(ctx) {
      const store = ctx.world.store(PlayerIntent);
      const row = store.rowOf(player);
      if (row < 0) return;
      const f = store.fields;
      const commands = ctx.commands;
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        if (cmd === undefined) continue;
        switch (cmd.type) {
          case 'move':
            f.forward[row] = cmd.forward;
            f.strafe[row] = cmd.strafe;
            break;
          case 'look':
            f.yaw[row] = (f.yaw[row] ?? 0) + cmd.yaw;
            f.pitch[row] = Math.max(-1.5, Math.min(1.5, (f.pitch[row] ?? 0) + cmd.pitch));
            break;
          case 'action': {
            const bit = actionBit(cmd.action);
            const prev = f.buttons[row] ?? 0;
            f.buttons[row] = cmd.pressed ? prev | bit : prev & ~bit;
            break;
          }
          default:
            assertNever(cmd, 'input command');
        }
      }
    },
  };
}

export interface EmptyWorld {
  readonly simulation: Simulation;
  readonly player: EntityId;
}

export function createEmptyWorld(seed: Seed): EmptyWorld {
  const world = new World();
  world.register(PlayerIntent);
  const player = world.spawn();
  world.store(PlayerIntent).add(player);
  const simulation = new Simulation({
    seed,
    tickRate: TICK_RATE,
    world,
    systems: [intentSystem(player)],
  });
  return { simulation, player };
}
