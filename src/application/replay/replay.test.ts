import { describe, expect, it } from 'vitest';
import { seed, tick } from '../../domain/core/brand';
import { Rng } from '../../domain/math/prng';
import { createEmptyWorld } from '../scenes/empty-world';
import { Simulation } from '../simulation';
import { World } from '../../domain/ecs/world';
import { ReplayInput, RecordingInput } from './replay-input';
import { ReplayRecorder, formatReplay, parseReplay, playReplay, type Replay } from './replay';
import { scriptedCommands } from './scripted-input';

const create = (s: ReturnType<typeof seed>): Simulation => createEmptyWorld(s).simulation;

function record(ticks: number, checkpointEvery: number): { replay: Replay; hash: string } {
  const s = seed(77);
  const sim = create(s);
  const script = scriptedCommands(Rng.fromSeed(5), ticks);
  const rec = new ReplayRecorder('empty', s, sim.tickRate, checkpointEvery);
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
    const rec = new ReplayRecorder('empty', seed(1), 60);
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

  it('migrates v1 replays (stage 0, no scene) and v2 (no save) to v3 on the empty world', () => {
    const { replay, hash } = record(120, 60);
    const { scene: _scene, save: _save, ...rest } = replay;
    const v1 = { ...rest, version: 1 };
    const migrated = parseReplay(JSON.parse(JSON.stringify(v1)));
    expect(migrated.version).toBe(3);
    expect(migrated.scene).toBe('empty');
    expect(migrated.save).toBeNull();
    const v2 = parseReplay({ ...rest, version: 2, scene: 'empty' });
    expect(v2.save).toBeNull();
    expect(playReplay(v2, create).finalHash).toBe(hash);
    expect(playReplay(migrated, create).finalHash).toBe(hash);
    expect(() => parseReplay({ ...v1, frames: 'x' })).toThrow();
  });

  it('ReplayInput feeds frames back by tick; RecordingInput records through', () => {
    const { replay } = record(200, 0);
    const input = new ReplayInput(replay);
    const rec = new ReplayRecorder('empty', seed(77), 60);
    const recording = new RecordingInput(input);
    recording.recorder = rec;
    const sim = create(seed(77));
    for (let t = 0; t < 210; t++) sim.step(recording.commandsFor(sim.tick));
    expect(input.finished).toBe(true);
    expect(input.commandsFor(tick(5000))).toEqual([]);
    expect(rec.ticks).toBe(210);
    expect(rec.finish().frames).toEqual(replay.frames);
    expect(new ReplayInput(replay).commandsFor(tick(150))).toEqual(
      replay.frames.find((f) => f.t === 150)?.c ?? [],
    );
    const unrecorded = new RecordingInput(new ReplayInput(replay));
    expect(() => unrecorded.commandsFor(tick(0))).not.toThrow();
  });

  it('rejects a simulation with a different tick rate', () => {
    const { replay } = record(10, 0);
    const other = (s: ReturnType<typeof seed>): Simulation =>
      new Simulation({ seed: s, tickRate: 30, world: new World(), systems: [] });
    expect(() => playReplay(replay, other)).toThrow('tickRate');
  });
});
