import { describe, expect, it } from 'vitest';
import { seed } from '../../domain/core/brand';
import { Rng } from '../../domain/math/prng';
import { createEmptyWorld } from '../scenes/empty-world';
import { Simulation } from '../simulation';
import { World } from '../../domain/ecs/world';
import { ReplayRecorder, formatReplay, parseReplay, playReplay, type Replay } from './replay';
import { scriptedCommands } from './scripted-input';

const create = (s: ReturnType<typeof seed>): Simulation => createEmptyWorld(s).simulation;

function record(ticks: number, checkpointEvery: number): { replay: Replay; hash: string } {
  const s = seed(77);
  const sim = create(s);
  const script = scriptedCommands(Rng.fromSeed(5), ticks);
  const rec = new ReplayRecorder(s, sim.tickRate, checkpointEvery);
  for (let t = 0; t < ticks; t++) {
    const cmds = script[t] ?? [];
    rec.record(sim.tick, cmds);
    sim.step(cmds);
    rec.afterStep(sim);
  }
  return { replay: rec.finish(), hash: sim.stateHash() };
}

describe('replay', () => {
  it('playback reproduces the recorded final hash and checkpoints', () => {
    const { replay, hash } = record(600, 60);
    expect(replay.checkpoints).toHaveLength(10);
    const json: unknown = JSON.parse(JSON.stringify(replay));
    const result = playReplay(parseReplay(json), create);
    expect(result).toEqual({ finalHash: hash, ticks: 600, divergence: null });
  });

  it('formatReplay is valid JSON, one frame per line, and round-trips', () => {
    const { replay } = record(120, 60);
    const text = formatReplay(replay);
    expect(parseReplay(JSON.parse(text))).toEqual(replay);
    expect(text.split('\n').length).toBeGreaterThan(replay.frames.length);
    const empty = formatReplay({ ...replay, frames: [], checkpoints: [] });
    expect(parseReplay(JSON.parse(empty)).frames).toEqual([]);
  });

  it('detects divergence at the first bad checkpoint', () => {
    const { replay } = record(120, 30);
    const first = replay.frames[0];
    if (first === undefined) throw new Error('script produced no input');
    const tampered: Replay = {
      ...replay,
      frames: [
        { t: first.t, c: [{ type: 'move', forward: 0.123, strafe: 0 }] },
        ...replay.frames.slice(1),
      ],
    };
    const result = playReplay(tampered, create);
    expect(result.divergence?.t).toBe(30);
    expect(result.divergence?.expected).not.toBe(result.divergence?.actual);
  });

  it('recorder without checkpoints and with gaps', () => {
    const rec = new ReplayRecorder(seed(1), 60);
    rec.record(0, []);
    rec.record(1, [{ type: 'action', action: 'use', pressed: true }]);
    rec.afterStep(create(seed(1)));
    expect(() => {
      rec.record(5, []);
    }).toThrow('Expected tick 2');
    const r = rec.finish();
    expect(r.length).toBe(2);
    expect(r.frames).toEqual([{ t: 1, c: [{ type: 'action', action: 'use', pressed: true }] }]);
    expect(r.checkpoints).toEqual([]);
  });

  it('rejects malformed replays', () => {
    const base = {
      format: 'war-replay',
      version: 1,
      seed: 1,
      tickRate: 60,
      length: 3,
      frames: [],
      checkpoints: [],
    };
    expect(() => parseReplay({ ...base, version: 2 })).toThrow();
    const move = [{ type: 'move', forward: 0, strafe: 0 }];
    expect(() =>
      parseReplay({
        ...base,
        frames: [
          { t: 1, c: move },
          { t: 1, c: move },
        ],
      }),
    ).toThrow('strictly increasing');
    expect(() => parseReplay({ ...base, frames: [{ t: 3, c: move }] })).toThrow('beyond length');
    expect(parseReplay(base).length).toBe(3);
  });

  it('rejects a simulation with a different tick rate', () => {
    const { replay } = record(10, 0);
    const other = (s: ReturnType<typeof seed>): Simulation =>
      new Simulation({ seed: s, tickRate: 30, world: new World(), systems: [] });
    expect(() => playReplay(replay, other)).toThrow('tickRate');
  });
});
