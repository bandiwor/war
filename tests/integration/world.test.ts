import { describe, expect, it } from 'vitest';
import { ReplayRecorder, playReplay } from '../../src/application/replay/replay';
import { COLLIDER_STREAMING, ChunkColliders } from '../../src/application/world/chunk-colliders';
import { Environment } from '../../src/application/world/environment-system';
import {
  createRenderView,
  createSandbox,
  readRenderView,
  type Sandbox,
} from '../../src/application/scenes/sandbox';
import { seed } from '../../src/domain/core/brand';
import type { InputCommand } from '../../src/domain/input/commands';
import { CHUNK_SIZE, chunkCoord, chunkRing } from '../../src/domain/world/chunks';
import { DAY_SECONDS, START_TIME_OF_DAY, TIME_SCALE } from '../../src/domain/world/environment';
import { HUBS, WORLD_SPAWN } from '../../src/domain/world/world-map';
import { newPhysics } from '../fixtures/physics';

const world = (s = 1337): Sandbox => createSandbox(seed(s), newPhysics(), { kind: 'world' });

function run(sb: Sandbox, ticks: number, first: InputCommand[] = []): void {
  for (let i = 0; i < ticks; i++) sb.simulation.step(i === 0 ? first : []);
}

describe('open world: collider streaming', () => {
  it('starts with every chunk within the prefetch radius solid', () => {
    const sb = world();
    const r = COLLIDER_STREAMING.prefetchRadius;
    expect(sb.chunks?.loadedCount).toBe((2 * r + 1) ** 2);
    expect(sb.physics.staticColliderCount).toBeGreaterThan(100);
  });

  it('keeps the floor under the player across a teleport (the required ring loads in the same tick)', () => {
    const sb = world();
    const forest = HUBS.find((h) => h.zone === 'forest');
    if (forest === undefined) throw new Error('no forest');
    const [x, y, z] = forest.anchor;
    sb.simulation.step([{ type: 'teleport', x, y: y + 0.05, z }]);
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) expect(sb.chunks?.isLoaded(cx + dx, cz + dz)).toBe(true);
    run(sb, 120);
    const v = readRenderView(sb, 1, createRenderView());
    expect(v.grounded).toBe(true);
    expect(v.y).toBeGreaterThan(1); // eye height above the ground, not falling
    expect(Math.hypot(v.x - x, v.z - z)).toBeLessThan(0.5);
  });

  it('prefetches the outer ring one chunk per tick and unloads past the keep radius', () => {
    const sb = world();
    const streamer = sb.chunks;
    if (streamer === null) throw new Error('no streamer');
    const before = streamer.loadsTotal;
    // Jump four chunks east along the avenue: the required ring at once, the rest over the next ticks.
    const x = WORLD_SPAWN.position[0] + 4 * CHUNK_SIZE;
    const z = WORLD_SPAWN.position[2];
    sb.simulation.step([{ type: 'teleport', x, y: 0.05, z }]);
    const afterTeleport = streamer.loadsTotal - before;
    expect(afterTeleport).toBeGreaterThanOrEqual(9);
    expect(afterTeleport).toBeLessThanOrEqual(9 + COLLIDER_STREAMING.loadsPerTick);
    sb.simulation.step();
    expect(streamer.loadsTotal - before).toBeLessThanOrEqual(
      afterTeleport + COLLIDER_STREAMING.loadsPerTick,
    );
    run(sb, 60);
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    for (const key of streamer.loadedKeys()) {
      const k = Number(key);
      const kx = Math.floor(k / 0x10000) - 0x8000;
      const kz = (k % 0x10000) - 0x8000;
      expect(chunkRing(kx, kz, cx, cz)).toBeLessThanOrEqual(COLLIDER_STREAMING.keepRadius);
    }
    // Everything within the prefetch radius is solid; older chunks linger up to the keep radius (hysteresis).
    const r = COLLIDER_STREAMING.prefetchRadius;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) expect(streamer.isLoaded(cx + dx, cz + dz)).toBe(true);
  });

  it('removes exactly the colliders a chunk added', () => {
    const physics = newPhysics();
    const c = new ChunkColliders(seed(3), physics);
    c.loadAllAround(0, 0);
    const loaded = physics.staticColliderCount;
    // Walk the centre far away: everything old is beyond the keep radius and unloads.
    for (let i = 0; i < 200; i++) c.update(200, 200);
    const far = physics.staticColliderCount;
    for (let i = 0; i < 200; i++) c.update(0, 0);
    expect(physics.staticColliderCount).toBe(loaded);
    expect(far).toBeGreaterThan(0);
  });
});

describe('open world: clock and weather', () => {
  it('advances the clock at TIME_SCALE and wraps at midnight', () => {
    const sb = world();
    const v = createRenderView();
    readRenderView(sb, 1, v);
    expect(v.env.active).toBe(true);
    expect(v.env.timeOfDay).toBe(START_TIME_OF_DAY);
    run(sb, 60);
    readRenderView(sb, 1, v);
    expect(v.env.timeOfDay).toBeCloseTo(START_TIME_OF_DAY + TIME_SCALE, 6);
    sb.simulation.step([{ type: 'env', key: 'timeOfDay', value: DAY_SECONDS - 1 }]);
    run(sb, 30);
    readRenderView(sb, 1, v);
    expect(v.env.timeOfDay).toBeLessThan(TIME_SCALE);
  });

  it('weather overrides hold until handed back with −1', () => {
    const sb = world();
    const v = createRenderView();
    sb.simulation.step([
      { type: 'env', key: 'rain', value: 0.9 },
      { type: 'env', key: 'timeScale', value: 0 },
    ]);
    run(sb, 10);
    readRenderView(sb, 1, v);
    expect(v.env.weather.rain).toBe(0.9);
    const time = v.env.timeOfDay;
    run(sb, 10);
    expect(readRenderView(sb, 1, v).env.timeOfDay).toBe(time);
    sb.simulation.step([
      { type: 'env', key: 'wind', value: 1 },
      { type: 'env', key: 'fog', value: 0 },
    ]);
    readRenderView(sb, 1, v);
    expect(v.env.weather.wind).toBe(1);
    expect(v.env.weather.fog).toBe(0);
    sb.simulation.step([{ type: 'env', key: 'rain', value: -1 }]);
    expect(readRenderView(sb, 1, v).env.weather.rain).toBeLessThan(0.5); // the opening mist is dry
  });

  it('is part of the simulation state (hash) and absent from the fixed street', () => {
    const a = world();
    const b = world();
    b.simulation.step([{ type: 'env', key: 'fog', value: 0.2 }]);
    a.simulation.step();
    expect(a.simulation.stateHash()).not.toBe(b.simulation.stateHash());
    const street = createSandbox(seed(1337), newPhysics());
    expect(street.simulation.world.tryStore(Environment)).toBeNull();
    expect(readRenderView(street, 1, createRenderView()).env.active).toBe(false);
  });
});

describe('open world: determinism', () => {
  /** A tour that walks, teleports between hubs and changes the weather. */
  function tour(): InputCommand[][] {
    const ticks: InputCommand[][] = Array.from({ length: 2400 }, () => []);
    ticks[0] = [
      { type: 'move', forward: 1, strafe: 0 },
      { type: 'action', action: 'sprint', pressed: true },
    ];
    HUBS.forEach((h, i) => {
      ticks[300 + i * 400] = [{ type: 'teleport', x: h.anchor[0], y: 0.05, z: h.anchor[2] }];
      ticks[320 + i * 400] = [{ type: 'look', yaw: 0.7 * (i + 1), pitch: 0 }];
    });
    ticks[900] = [{ type: 'env', key: 'rain', value: 0.6 }];
    ticks[1700] = [{ type: 'env', key: 'timeOfDay', value: 22 * 3600 }];
    return ticks;
  }

  it('records and replays a streaming tour with identical checkpoints', () => {
    const sb = world(77);
    const rec = new ReplayRecorder('world', seed(77), 60, 120);
    for (const cmds of tour()) {
      rec.record(sb.simulation.tick, cmds);
      sb.simulation.step(cmds);
      rec.afterStep(sb.simulation);
    }
    const replay = rec.finish();
    const result = playReplay(
      replay,
      (s) => createSandbox(s, newPhysics(), { kind: 'world' }).simulation,
    );
    expect(result.divergence).toBeNull();
    expect(result.finalHash).toBe(sb.simulation.stateHash());
    expect(sb.chunks?.loadsTotal).toBeGreaterThan(5 * 9);
  });
});
