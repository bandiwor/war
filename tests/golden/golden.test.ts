import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayRecorder, formatReplay, parseReplay, playReplay, type Replay } from '../../src/application/replay/replay';
import { scriptedCommands } from '../../src/application/replay/scripted-input';
import { createEmptyWorld } from '../../src/application/scenes/empty-world';
import { createSandbox } from '../../src/application/scenes/sandbox';
import type { Simulation } from '../../src/application/simulation';
import { seed, type Seed } from '../../src/domain/core/brand';
import { Rng } from '../../src/domain/math/prng';
import { createChurnWorld } from '../fixtures/churn-world';
import { newPhysics } from '../fixtures/physics';

/**
 * Golden determinism tests. Expected hashes live in JSON next to this file;
 * regenerate deliberately with `npm run golden:update` and review the diff.
 * Any unintended change in simulation behaviour fails here.
 */
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const here = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

type Scene = 'empty' | 'churn' | 'sandbox' | 'world';
const SCENES: Readonly<Record<Scene, (s: Seed) => Simulation>> = {
  empty: (s) => createEmptyWorld(s).simulation,
  churn: createChurnWorld,
  sandbox: (s) => createSandbox(s, newPhysics()).simulation,
  world: (s) => createSandbox(s, newPhysics(), { kind: 'world' }).simulation,
};

interface GoldenCase {
  readonly scene: Scene;
  readonly seed: number;
  readonly ticks: number;
  readonly input: boolean;
}
const CASES: readonly GoldenCase[] = [
  { scene: 'empty', seed: 1337, ticks: 3600, input: false },
  { scene: 'empty', seed: 1337, ticks: 3600, input: true },
  { scene: 'empty', seed: 7, ticks: 36000, input: true },
  { scene: 'churn', seed: 1337, ticks: 3600, input: false },
  { scene: 'churn', seed: 2024, ticks: 10000, input: true },
  { scene: 'sandbox', seed: 1337, ticks: 3600, input: true },
  { scene: 'sandbox', seed: 99, ticks: 36000, input: true },
  { scene: 'world', seed: 1337, ticks: 3600, input: true },
  { scene: 'world', seed: 99, ticks: 36000, input: true },
];

function run(c: GoldenCase): string {
  const sim = SCENES[c.scene](seed(c.seed));
  const script = c.input ? scriptedCommands(Rng.stream(seed(c.seed), 'test.input'), c.ticks) : [];
  for (let t = 0; t < c.ticks; t++) sim.step(script[t] ?? []);
  return sim.stateHash();
}

const key = (c: GoldenCase): string => `${c.scene}/seed=${String(c.seed)}/ticks=${String(c.ticks)}/input=${String(c.input)}`;

describe('golden state hashes', () => {
  const file = here('state-hashes.json');
  const computed = Object.fromEntries(CASES.map((c) => [key(c), run(c)]));
  if (UPDATE) writeFileSync(file, JSON.stringify(computed, null, 2) + '\n');
  const expected: unknown = JSON.parse(readFileSync(file, 'utf8'));

  it.each(CASES.map(key))('%s', (k) => {
    expect(computed[k]).toBe(Object.entries(expected ?? {}).find(([name]) => name === k)?.[1]);
  });

  it('the same inputs on a second run give the same hash', () => {
    for (const c of CASES) expect(run(c)).toBe(computed[key(c)]);
  }, 60_000);

  it('a different seed gives a different hash', () => {
    expect(run({ scene: 'churn', seed: 1338, ticks: 3600, input: false })).not.toBe(
      computed[key({ scene: 'churn', seed: 1337, ticks: 3600, input: false })],
    );
  });
});

describe('golden replay file', () => {
  const file = here('replays/empty-world-scripted.replay.json');

  function recordReplay(): Replay {
    const s = seed(4242);
    const sim = createEmptyWorld(s).simulation;
    const script = scriptedCommands(Rng.stream(s, 'test.input'), 1800);
    const rec = new ReplayRecorder('empty', s, sim.tickRate, 300);
    for (const cmds of script) {
      rec.record(sim.tick, cmds);
      sim.step(cmds);
      rec.afterStep(sim);
    }
    return rec.finish();
  }

  if (UPDATE) writeFileSync(file, formatReplay(recordReplay()));

  it('plays back with every checkpoint matching', () => {
    const replay = parseReplay(JSON.parse(readFileSync(file, 'utf8')));
    const result = playReplay(replay, (s) => createEmptyWorld(s).simulation);
    expect(result.divergence).toBeNull();
    expect(result.finalHash).toBe(replay.checkpoints.at(-1)?.hash);
  });
});
