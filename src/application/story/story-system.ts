import { actionBit } from '../../domain/input/commands';
import { raceAt } from '../../domain/combat/races';
import { cos, sin } from '../../domain/math/dmath';
import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import { StoryEngine, type StoryWorld } from '../../domain/story/engine';
import type { Interactable, StoryData } from '../../domain/story/schema';
import { nightness, sunElevation } from '../../domain/world/environment';
import { hubAt } from '../../domain/world/world-map';
import { Ammo } from '../combat/components';
import { PlayerIntent } from '../scenes/empty-world';
import type { SimContext } from '../simulation';
import { Environment } from '../world/environment-system';
import type { AiRuntime } from '../ai/runtime';
import { newPlayerState, spawnMob, type PlayerProbe } from '../ai/systems';

/**
 * The story inside the simulation: a deterministic system that feeds the
 * pure story engine where the player stands, what they killed and what
 * they used, then carries out what the story asked for (loot, ambushes,
 * a fresh battery) and publishes every note on the event bus for the HUD,
 * the radio and the save system.
 */
export class StoryRuntime {
  readonly engine: StoryEngine;
  /** The world as the story saw it on the last tick. */
  readonly view: StoryWorld = { x: 0, z: 0, zone: 'abandonedCity', night: 1 };

  constructor(readonly data: StoryData) {
    this.engine = new StoryEngine(data);
  }

  /** The interactable the player would use from (x, z): nearest in reach and usable. */
  usableAt(x: number, z: number): Interactable | null {
    let best: Interactable | null = null;
    let bestD = Infinity;
    const w: StoryWorld = { ...this.view, x, z };
    for (const i of this.data.interactables) {
      const dx = x - i.at[0];
      const dz = z - i.at[2];
      const d = dx * dx + dz * dz;
      if (d > i.radius * i.radius || d >= bestD || !this.engine.canUse(i.id, w)) continue;
      best = i;
      bestD = d;
    }
    return best;
  }
}

const USE = actionBit('use');

/** Conditions are scanned every this many ticks (10 Hz); uses and kills scan at once. */
const SCAN_EVERY = 6;

/** Ambushes appear on a ring around their point, never on top of each other. */
const AMBUSH_RING = 3;

export function storySystem(
  story: StoryRuntime,
  ai: AiRuntime,
  probe: PlayerProbe,
  player: EntityId,
  /** Puts a fresh battery in the player's flashlight (the component lives with the scene). */
  freshBattery: (ctx: SimContext) => void,
): System<SimContext> {
  const p = newPlayerState();
  return {
    name: 'story.step',
    after: ['targets.step', 'player.vitals', 'ai.attack'],
    run(ctx) {
      const world = ctx.world;
      if (!probe(world, p)) return;
      const w = story.view;
      w.x = p.x;
      w.z = p.z;
      if (ctx.tick % SCAN_EVERY === 0) {
        w.zone = hubAt(p.x, p.z).zone;
        const env = world.tryStore(Environment);
        w.night =
          env !== null && env.size > 0 ? nightness(sunElevation(env.fields.timeOfDay[0] ?? 0)) : 1;
      }
      for (let i = 0; i < ctx.events.hit.size; i++) {
        const e = ctx.events.hit.at(i);
        if (e?.killed === true) story.engine.killed(raceAt(e.race));
      }
      const intent = world.store(PlayerIntent);
      const ir = intent.rowOf(player);
      const pressed = ir >= 0 && ((intent.fields.pressed[ir] ?? 0) & USE) !== 0;
      const use = pressed && p.alive ? (story.usableAt(p.x, p.z)?.id ?? null) : null;
      const notes = story.engine.tick(ctx.dt, w, use, ctx.tick % SCAN_EVERY === 0);
      for (const note of notes) {
        ctx.events.story.emit().note = note;
        switch (note.kind) {
          case 'spawn':
            for (let k = 0; k < note.count; k++) {
              const a = (k / note.count) * Math.PI * 2;
              spawnMob(
                world,
                ai,
                note.mob,
                note.x + sin(a) * AMBUSH_RING,
                note.z + cos(a) * AMBUSH_RING,
                a,
              );
            }
            break;
          case 'supply': {
            const ammo = world.store(Ammo);
            const r = ammo.rowOf(player);
            if (r >= 0) {
              const col = ammo.fields[note.ammo];
              col[r] = Math.min(9999, (col[r] ?? 0) + note.amount);
            }
            break;
          }
          case 'battery':
            freshBattery(ctx);
            break;
          case 'quest':
          case 'objective':
          case 'log':
          case 'chapter':
          case 'ending':
          case 'line':
          case 'used':
            break; // for the HUD, the radio and the save system (on the bus)
        }
      }
    },
  };
}
