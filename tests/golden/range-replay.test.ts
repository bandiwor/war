import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayInput } from '../../src/application/replay/replay-input';
import { ReplayRecorder, formatReplay, parseReplay, playReplay, type Replay } from '../../src/application/replay/replay';
import { createSandbox } from '../../src/application/scenes/sandbox';
import { seed } from '../../src/domain/core/brand';
import type { InputCommand } from '../../src/domain/input/commands';
import { WEAPON_IDS, type WeaponId } from '../../src/domain/weapons/registry';
import { newPhysics } from '../fixtures/physics';

/**
 * Stage-4 golden replay: a scripted range session that fires every firearm,
 * switches fire modes, reloads, and throws a frag, an EMP and a molotov.
 * Every checkpoint (projectiles, targets, weapon states, RNG) must match.
 */
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const FILE = fileURLToPath(new URL('replays/range-session.replay.json', import.meta.url));
const SEED = 2024;

const sel = (id: WeaponId): InputCommand => ({ type: 'select', slot: WEAPON_IDS.indexOf(id) });
const act = (action: 'fire' | 'aim' | 'reload' | 'fireMode', pressed: boolean): InputCommand => ({ type: 'action', action, pressed });
const look = (yaw: number, pitch: number): InputCommand => ({ type: 'look', yaw, pitch });

/** [seconds, commands at the start of the segment]. Aim offsets are relative (look deltas). */
const SCRIPT: readonly (readonly [number, InputCommand[]])[] = [
  [1, [sel('carbine'), act('aim', true), look(0.12, -0.02)]],
  [0.2, [act('fire', true)]],
  [0.3, [act('fire', false)]],
  [0.1, [act('fireMode', true)]],
  [0.1, [act('fireMode', false)]],
  [0.6, [act('fire', true)]], // auto burst
  [0.4, [act('fire', false), act('reload', true)]],
  [2.6, [act('reload', false)]],
  [1, [sel('rifle'), look(-0.05, 0.004)]],
  [0.2, [act('fire', true)]],
  [1.4, [act('fire', false)]],
  [0.2, [act('fire', true)]],
  [0.6, [act('fire', false), act('aim', false)]],
  [1, [sel('shotgun'), look(0.08, -0.03)]],
  [0.2, [act('fire', true)]],
  [0.8, [act('fire', false)]],
  [0.2, [act('fire', true)]],
  [0.8, [act('fire', false)]],
  [1, [sel('pistol'), look(-0.1, 0)]],
  [0.1, [act('fire', true)]],
  [0.2, [act('fire', false)]],
  [0.1, [act('fire', true)]],
  [0.2, [act('fire', false)]],
  [1, [sel('frag'), look(0.02, 0.15)]],
  [0.2, [act('fire', true)]],
  [5, [act('fire', false)]],
  [1, [sel('emp'), look(-0.06, 0)]],
  [0.2, [act('fire', true)]],
  [3.5, [act('fire', false)]],
  [1, [sel('molotov'), look(0.12, 0)]],
  [0.2, [act('fire', true)]],
  [4.6, [act('fire', false)]], // total is a whole number of seconds: last checkpoint = last tick
];

function commands(): InputCommand[][] {
  const ticks: InputCommand[][] = [];
  for (const [seconds, cmds] of SCRIPT) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) ticks.push(i === 0 ? cmds : []);
  }
  return ticks;
}

function record(): Replay {
  const sb = createSandbox(seed(SEED), newPhysics(), { kind: 'range' });
  const rec = new ReplayRecorder('range', seed(SEED), 60, 60);
  for (const cmds of commands()) {
    rec.record(sb.simulation.tick, cmds);
    sb.simulation.step(cmds);
    rec.afterStep(sb.simulation);
  }
  return rec.finish();
}

if (UPDATE) writeFileSync(FILE, formatReplay(record()));

describe('golden range replay (stage 4)', () => {
  const replay = parseReplay(JSON.parse(readFileSync(FILE, 'utf8')));

  it('plays back bit-exactly at every checkpoint', () => {
    expect(replay.scene).toBe('range');
    expect(replay.length % 60).toBe(0);
    const result = playReplay(replay, (s) => createSandbox(s, newPhysics(), { kind: 'range' }).simulation);
    expect(result.divergence).toBeNull();
    expect(result.finalHash).toBe(replay.checkpoints.at(-1)?.hash);
  });

  it('the session actually fights: shots, hits, kills, every explosive', () => {
    const sb = createSandbox(seed(replay.seed), newPhysics(), { kind: 'range' });
    const input = new ReplayInput(replay);
    let shots = 0;
    let hits = 0;
    let kills = 0;
    const explosionKinds = new Set<number>();
    for (let t = 0; t < replay.length; t++) {
      sb.simulation.step(input.commandsFor(sb.simulation.tick));
      const e = sb.simulation.events;
      shots += e.shot.size;
      for (let i = 0; i < e.hit.size; i++) {
        hits++;
        if (e.hit.at(i)?.killed === true) kills++;
      }
      for (let i = 0; i < e.explosion.size; i++) explosionKinds.add(e.explosion.at(i)?.kind ?? -1);
    }
    expect(shots).toBeGreaterThan(10);
    expect(hits).toBeGreaterThan(5);
    expect(kills).toBeGreaterThan(0);
    expect(explosionKinds).toEqual(new Set([0, 1, 2]));
  });
});
