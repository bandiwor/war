import { describe, expect, it } from 'vitest';
import { Ammo } from '../../src/application/combat/components';
import { playReplay, ReplayRecorder, parseReplay } from '../../src/application/replay/replay';
import { captureSave, restoreSave } from '../../src/application/save/save-game';
import {
  createSandbox,
  readRenderView,
  createRenderView,
  type Sandbox,
} from '../../src/application/scenes/sandbox';
import { seed, type Seed } from '../../src/domain/core/brand';
import type { InputCommand } from '../../src/domain/input/commands';
import { parseSave, serializeSave, type SaveGame } from '../../src/domain/save/save';
import { SITES, type SiteId } from '../../src/domain/story/sites';
import { newPhysics } from '../fixtures/physics';

const SEED = 8;
const fresh = (s: Seed = seed(SEED)): Sandbox => createSandbox(s, newPhysics(), { kind: 'world' });

function go(sb: Sandbox, site: SiteId): void {
  const [x, y, z] = SITES[site];
  sb.simulation.step([{ type: 'teleport', x, y: y + 0.05, z }]);
  for (let i = 0; i < 20; i++) sb.simulation.step([]);
}

function use(sb: Sandbox): void {
  sb.simulation.step([{ type: 'action', action: 'use', pressed: true }]);
  sb.simulation.step([{ type: 'action', action: 'use', pressed: false }]);
}

/** A game in progress: two chapters in, ammo spent and found, the clock moved, a shot fired. */
function midGame(): Sandbox {
  const sb = fresh();
  sb.simulation.step([{ type: 'cheat', key: 'god', on: true }]);
  for (const [site, press] of [
    ['rallyPoint', false],
    ['reyesCamera', true],
    ['cityCache', true],
    ['generatorA', true],
  ] as const) {
    go(sb, site);
    if (press) use(sb);
  }
  sb.simulation.step([{ type: 'env', key: 'timeOfDay', value: 79000 }]);
  sb.simulation.step([{ type: 'action', action: 'fire', pressed: true }]);
  for (let i = 0; i < 30; i++) sb.simulation.step([]);
  sb.simulation.step([{ type: 'action', action: 'fire', pressed: false }]);
  sb.simulation.step([{ type: 'look', yaw: 0.7, pitch: -0.2 }]);
  for (let i = 0; i < 30; i++) sb.simulation.step([]);
  return sb;
}

const load = (save: SaveGame): Sandbox => {
  const sb = fresh(seed(save.seed));
  restoreSave(sb, save);
  return sb;
};

const comparable = (s: SaveGame): Omit<SaveGame, 'meta'> => {
  const { meta: _meta, ...rest } = s;
  return rest;
};

describe('saves', () => {
  it('capture → text → load → capture gives back the same progress', () => {
    const sb = midGame();
    const saved = captureSave(sb);
    expect(saved.story?.used).toEqual(['cityCache', 'generatorA', 'reyesCamera']);
    expect(saved.environment?.timeOfDay).toBeGreaterThan(78000);
    const loaded = load(parseSave(JSON.parse(serializeSave(saved))));
    expect(comparable(captureSave(loaded))).toEqual(comparable(saved));
    // The view agrees: you stand where you saved, looking the same way.
    const a = readRenderView(sb, 1, createRenderView());
    const b = readRenderView(loaded, 1, createRenderView());
    expect([b.x, b.z, b.yaw]).toEqual([a.x, a.z, a.yaw]);
    expect(loaded.story?.engine.chapter).toBe('power');
    // Play time carries over.
    expect(captureSave(loaded).meta.playSeconds).toBeCloseTo(saved.meta.playSeconds, 6);
  }, 30_000);

  it('a loaded game carries on: the story resumes, the start does not replay', () => {
    const loaded = load(captureSave(midGame()));
    const ammo = loaded.simulation.world.store(Ammo);
    const before = ammo.fields.r9x19[ammo.rowOf(loaded.player)] ?? 0;
    for (let i = 0; i < 5; i++) loaded.simulation.step([]);
    expect(loaded.story?.engine.status('rally')).toBe('done');
    go(loaded, 'generatorB');
    use(loaded);
    for (let i = 0; i < 3; i++) loaded.simulation.step([]);
    expect(loaded.story?.engine.flag('power.genB')).toBe(1);
    expect(ammo.fields.r9x19[ammo.rowOf(loaded.player)]).toBe(before);
  }, 30_000);

  it('is deterministic: two loads of one save, given the same input, reach the same state hash', () => {
    const save = captureSave(midGame());
    const script: InputCommand[][] = [
      [{ type: 'move', forward: 1, strafe: 0 }],
      [{ type: 'action', action: 'sprint', pressed: true }],
      [{ type: 'look', yaw: -0.3, pitch: 0 }],
    ];
    const runFrom = (): string => {
      const sb = load(save);
      for (let t = 0; t < 600; t++) sb.simulation.step(script[t % 97] ?? []);
      return sb.simulation.stateHash();
    };
    expect(runFrom()).toBe(runFrom());
  }, 30_000);

  it('a session recorded after a load replays exactly from its save', () => {
    const save = captureSave(midGame());
    const sb = load(save);
    const rec = new ReplayRecorder('world', seed(save.seed), 60, 60, save);
    for (let t = 0; t < 300; t++) {
      const cmds: InputCommand[] = t === 10 ? [{ type: 'move', forward: 1, strafe: 0.3 }] : [];
      rec.record(sb.simulation.tick, cmds);
      sb.simulation.step(cmds);
      rec.afterStep(sb.simulation);
    }
    const replay = parseReplay(JSON.parse(JSON.stringify(rec.finish())));
    expect(replay.save).not.toBeNull();
    const result = playReplay(replay, (s, start) => {
      const fresh2 = fresh(s);
      if (start !== null) restoreSave(fresh2, start);
      return fresh2.simulation;
    });
    expect(result.divergence).toBeNull();
    expect(result.finalHash).toBe(sb.simulation.stateHash());
  }, 30_000);

  it('a scene without story or clock saves and loads too; a slot for another weapon is skipped', () => {
    const street = createSandbox(seed(3), newPhysics(), { kind: 'street' });
    street.simulation.step([{ type: 'teleport', x: -18, y: 0.05, z: 2 }]);
    for (let i = 0; i < 10; i++) street.simulation.step([]);
    const save = captureSave(street);
    expect(save.scene).toBe('sandbox');
    expect(save.story).toBeNull();
    expect(save.environment).toBeNull();
    const slots = save.weapons?.slots ?? [];
    const [first, ...rest] = slots;
    if (first === undefined) throw new Error('no weapons');
    // A registry change put another weapon in slot 0: that slot keeps its fresh state.
    const edited: SaveGame = {
      ...save,
      weapons: { active: 0, slots: [{ ...first, weapon: 'nonexistent', mag: 0 }, ...rest] },
    };
    const loaded = createSandbox(seed(3), newPhysics(), { kind: 'street' });
    restoreSave(loaded, edited);
    const back = captureSave(loaded);
    expect(back.player.x).toBeCloseTo(save.player.x, 6);
    expect(back.weapons?.slots[0]?.mag).not.toBe(0);
    expect(back.weapons?.slots.slice(1)).toEqual(rest);
  }, 30_000);

  it('refuses a save for another seed or scene', () => {
    const save = captureSave(fresh());
    expect(() => {
      restoreSave(fresh(seed(9)), save);
    }).toThrow('seed');
    expect(() => {
      restoreSave(createSandbox(seed(SEED), newPhysics(), { kind: 'range' }), save);
    }).toThrow('scene');
  }, 30_000);
});
