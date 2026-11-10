import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayInput } from '../../src/application/replay/replay-input';
import { ReplayRecorder, formatReplay, parseReplay, playReplay, type Replay } from '../../src/application/replay/replay';
import { createRenderView, createSandbox, readRenderView } from '../../src/application/scenes/sandbox';
import type { ZoneId } from '../../src/domain/audio/zones';
import { seed } from '../../src/domain/core/brand';
import type { InputCommand } from '../../src/domain/input/commands';
import { HUBS, WORLD_SPAWN, hubAt } from '../../src/domain/world/world-map';
import { newPhysics } from '../fixtures/physics';

/**
 * Stage-5 acceptance (simulation side): a golden replay of the open world.
 * The tour sprints along the main avenue across chunk borders (prefetch
 * streaming), teleports through every hub (required-ring streaming), and
 * changes the clock and the weather through `env` commands. Every state-hash
 * checkpoint (ECS incl. environment + RNG + Rapier snapshot, so the set of
 * loaded colliders) must match on playback.
 */
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const FILE = fileURLToPath(new URL('replays/world-tour.replay.json', import.meta.url));
const SEED = 1337;
const TICKS = 60 * 60;

function tour(): InputCommand[][] {
  const ticks: InputCommand[][] = Array.from({ length: TICKS }, () => []);
  // Sprint east along the avenue for 20 s (~70 m: two chunk borders).
  ticks[0] = [{ type: 'move', forward: 1, strafe: 0 }, { type: 'action', action: 'sprint', pressed: true }];
  ticks[1200] = [{ type: 'action', action: 'sprint', pressed: false }];
  HUBS.forEach((h, i) => {
    const t = 1260 + i * 420;
    ticks[t] = [{ type: 'teleport', x: h.anchor[0], y: h.anchor[1] + 0.05, z: h.anchor[2] }];
    ticks[t + 30] = [{ type: 'look', yaw: 0.9, pitch: 0 }];
  });
  ticks[1500] = [{ type: 'env', key: 'rain', value: 0.8 }];
  ticks[2400] = [{ type: 'env', key: 'timeOfDay', value: 23 * 3600 }, { type: 'env', key: 'timeScale', value: 60 }];
  ticks[3000] = [{ type: 'env', key: 'rain', value: -1 }];
  return ticks;
}

function record(): Replay {
  const sb = createSandbox(seed(SEED), newPhysics(), { kind: 'world' });
  const rec = new ReplayRecorder('world', seed(SEED), sb.simulation.tickRate, 120);
  for (const cmds of tour()) {
    rec.record(sb.simulation.tick, cmds);
    sb.simulation.step(cmds);
    rec.afterStep(sb.simulation);
  }
  return rec.finish();
}

if (UPDATE) writeFileSync(FILE, formatReplay(record()));

describe('golden world replay', () => {
  const replay = parseReplay(JSON.parse(readFileSync(FILE, 'utf8')));

  it('plays back with every checkpoint matching', () => {
    expect(replay.scene).toBe('world');
    expect(replay.checkpoints.length).toBe(TICKS / 120);
    const result = playReplay(replay, (s) => createSandbox(s, newPhysics(), { kind: 'world' }).simulation);
    expect(result.divergence).toBeNull();
  });

  it('streams across the world: every zone visited, chunks loaded and dropped, weather changed', () => {
    const sb = createSandbox(seed(replay.seed), newPhysics(), { kind: 'world' });
    const input = new ReplayInput(replay);
    const view = createRenderView();
    const zones = new Set<ZoneId>();
    let maxX = -Infinity;
    let rainy = false;
    for (let t = 0; t < replay.length; t++) {
      sb.simulation.step(input.commandsFor(sb.simulation.tick));
      readRenderView(sb, 1, view);
      zones.add(hubAt(view.x, view.z).zone);
      if (t < 1200) maxX = Math.max(maxX, view.x);
      if (view.env.weather.rain > 0.7) rainy = true;
      // Never through the floor, wherever the tour goes.
      expect(view.y).toBeGreaterThan(0.5);
    }
    expect([...zones].sort()).toEqual(HUBS.map((h) => h.zone).sort());
    expect(maxX - WORLD_SPAWN.position[0]).toBeGreaterThan(50);
    expect(rainy).toBe(true);
    expect(sb.chunks?.unloadsTotal).toBeGreaterThan(20);
    expect(view.env.timeOfDay).toBeGreaterThan(23 * 3600);
  });
});
