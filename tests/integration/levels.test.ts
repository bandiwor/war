import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Mob } from '../../src/application/ai/components';
import { Target } from '../../src/application/combat/components';
import { createLevelSandbox } from '../../src/application/level/play-level';
import { createRenderView, readRenderView } from '../../src/application/scenes/sandbox';
import type { EntityId } from '../../src/domain/ecs/entity';
import { parseLevel, type Level } from '../../src/domain/level/level';
import { mobIndex, type MobId } from '../../src/domain/mobs/registry';
import { newPhysics } from '../fixtures/physics';

/**
 * Stage 9: a level from the editor runs in the real engine — its layout
 * (colliders, nav grid), its placed mobs on their patrols, its spawn zones
 * and its story — and "play from here" starts the player where asked.
 */
const yard = (): Level =>
  parseLevel(
    JSON.parse(readFileSync(new URL('../../levels/yard.level.json', import.meta.url), 'utf8')),
  );

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test: dense rows hold live entity ids
  return raw as EntityId;
}

function mobsOf(sb: ReturnType<typeof createLevelSandbox>, kind: MobId) {
  const w = sb.simulation.world;
  const mob = w.store(Mob);
  const t = w.store(Target);
  const out: { x: number; z: number; zone: number; patrol: number }[] = [];
  for (let r = 0; r < mob.size; r++) {
    if (mob.fields.kind[r] !== mobIndex(kind)) continue;
    const tr = t.rowOf(entity(mob.dense[r] ?? 0));
    out.push({
      x: t.fields.x[tr] ?? 0,
      z: t.fields.z[tr] ?? 0,
      zone: mob.fields.zone[r] ?? 0,
      patrol: mob.fields.patrol[r] ?? 0,
    });
  }
  return out;
}

describe('levels in the engine', () => {
  it('starts at the spawn (or where "play from here" says), with the placed mobs and the story', () => {
    const level = yard();
    const sb = createLevelSandbox(level, newPhysics());
    sb.simulation.step([]);
    const v = readRenderView(sb, 1, createRenderView());
    expect(v.x).toBeCloseTo(0, 4);
    expect(v.z).toBeCloseTo(-26, 4);
    expect(mobsOf(sb, 'shambler')).toHaveLength(2);
    expect(mobsOf(sb, 'sentry')[0]?.patrol).toBe(1);
    expect(sb.story?.engine.status('yardPower')).toBe('active');
    const here = createLevelSandbox(level, newPhysics(), { at: [-10, -20], yaw: 1 });
    here.simulation.step([]);
    const h = readRenderView(here, 1, createRenderView());
    expect(h.x).toBeCloseTo(-10, 4);
    expect(h.z).toBeCloseTo(-20, 4);
  });

  it('the dock and the containers are solid: walking into them stops the player', () => {
    const sb = createLevelSandbox(yard(), newPhysics(), { at: [16, -22], yaw: Math.PI });
    // Facing +z (forward is −z rotated by yaw): straight into container A (z −17…−11).
    sb.simulation.step([{ type: 'move', forward: 1, strafe: 0 }]);
    for (let i = 0; i < 60 * 4; i++) sb.simulation.step([]);
    const v = readRenderView(sb, 1, createRenderView());
    expect(v.z).toBeLessThan(-16.5);
    expect(v.z).toBeGreaterThan(-18);
  });

  it('the sentry walks its patrol loop', () => {
    const sb = createLevelSandbox(yard(), newPhysics(), { at: [-30, -25], yaw: 0 });
    sb.simulation.step([{ type: 'cheat', key: 'god', on: true }]);
    const visited = new Set<number>();
    const loop = yard().patrols[0]?.points ?? [];
    for (let t = 0; t < 60 * 90; t++) {
      sb.simulation.step([]);
      const s = mobsOf(sb, 'sentry')[0];
      if (s === undefined) break;
      loop.forEach(([px, pz], i) => {
        if (Math.hypot(s.x - px, s.z - pz) < 2) visited.add(i);
      });
      if (visited.size === loop.length) break;
    }
    expect(visited.size).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('a spawn zone keeps its wolves topped up, inside the zone', () => {
    const level = yard();
    const sb = createLevelSandbox(level, newPhysics());
    for (let t = 0; t < 60 * 5; t++) sb.simulation.step([]);
    const zone = level.spawnZones[0];
    if (zone === undefined) throw new Error('fixture');
    const wolves = mobsOf(sb, 'wolf').filter((w) => w.zone === 1);
    expect(wolves.length).toBe(zone.population);
    // Spawned inside the zone (they may have wandered a little since).
    for (const w of wolves) {
      expect(w.x).toBeGreaterThan(zone.min[0] - 10);
      expect(w.z).toBeGreaterThan(zone.min[1] - 10);
    }
  });

  it('a zone never spawns in the player’s face, and dead mobs make room for new ones', () => {
    const level = yard();
    const zone = level.spawnZones[0];
    if (zone === undefined) throw new Error('fixture');
    // Stand in the middle of the zone: every candidate spot within 12 m is refused.
    const tight: Level = { ...level, spawnZones: [{ ...zone, min: [-26, 18], max: [-22, 22] }] };
    const sb = createLevelSandbox(tight, newPhysics(), { at: [-24, 20], yaw: 0 });
    sb.simulation.step([{ type: 'cheat', key: 'god', on: true }]);
    for (let t = 0; t < 60 * 3; t++) sb.simulation.step([]);
    expect(mobsOf(sb, 'wolf').filter((w) => w.zone === 1)).toHaveLength(0);
    // Away from it, the zone fills; kill one and it refills.
    const far = createLevelSandbox(level, newPhysics());
    for (let t = 0; t < 60 * 3; t++) far.simulation.step([]);
    const mob = far.simulation.world.store(Mob);
    const t = far.simulation.world.store(Target);
    for (let r = 0; r < mob.size; r++)
      if (mob.fields.zone[r] === 1) {
        t.fields.health[t.rowOf(entity(mob.dense[r] ?? 0))] = 0;
        mob.fields.action[r] = 255;
        break;
      }
    for (let k = 0; k < 60 * 3; k++) far.simulation.step([]);
    const alive = mobsOf(far, 'wolf').filter((w) => w.zone === 1).length;
    expect(alive).toBeGreaterThanOrEqual(zone.population);
  });

  it('is deterministic', () => {
    const run = (): string => {
      const sb = createLevelSandbox(yard(), newPhysics());
      for (let t = 0; t < 600; t++)
        sb.simulation.step(t === 5 ? [{ type: 'move', forward: 1, strafe: 0.2 }] : []);
      return sb.simulation.stateHash();
    };
    expect(run()).toBe(run());
  });
});
