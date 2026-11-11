/**
 * Profiling (stage 10): runs a heavy headless scenario and reports where the
 * simulation spends its time, two ways:
 *  - per system, from the simulation's own instrumentation (setProfiler);
 *  - per function, from a V8 CPU profile (node:inspector), self time.
 * Usage: npm run profile [-- world|crowd|level] [ticks]
 */
import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { performance } from 'node:perf_hooks';
import { spawnMob } from '../src/application/ai/systems';
import { createLevelSandbox } from '../src/application/level/play-level';
import { createSandbox, type Sandbox } from '../src/application/scenes/sandbox';
import { systemTimings } from '../src/application/simulation';
import { seed } from '../src/domain/core/brand';
import { parseLevel } from '../src/domain/level/level';
import { MOB_IDS } from '../src/domain/mobs/registry';
import { createRapierPhysics } from '../src/infrastructure/physics/rapier-physics';

const scenario = process.argv[2] ?? 'world';
const ticks = Number(process.argv[3] ?? 20_000);

async function build(): Promise<{
  sb: Sandbox;
  input: (t: number) => Parameters<Sandbox['simulation']['step']>[0];
}> {
  const physics = await createRapierPhysics(60);
  if (scenario === 'crowd') {
    const sb = createSandbox(seed(2), physics);
    sb.simulation.step([{ type: 'cheat', key: 'god', on: true }]);
    MOB_IDS.forEach((id, i) => {
      for (let k = 0; k < 6; k++)
        spawnMob(sb.simulation.world, sb.ai, id, -8 + k * 3, -40 + i * 10, 0);
    });
    return {
      sb,
      input: (t) =>
        t % 240 === 0
          ? [
              { type: 'look', yaw: 0.5, pitch: 0 },
              { type: 'move', forward: 1, strafe: 0.4 },
            ]
          : [],
    };
  }
  if (scenario === 'level') {
    const level = parseLevel(
      JSON.parse(readFileSync(new URL('../levels/yard.level.json', import.meta.url), 'utf8')),
    );
    const sb = createLevelSandbox(level, physics);
    sb.simulation.step([{ type: 'cheat', key: 'god', on: true }]);
    return {
      sb,
      input: (t) =>
        t % 300 === 0
          ? [
              { type: 'look', yaw: 1.2, pitch: 0 },
              { type: 'move', forward: 1, strafe: 0 },
            ]
          : [],
    };
  }
  const sb = createSandbox(seed(1337), physics, { kind: 'world' });
  sb.simulation.step([
    { type: 'cheat', key: 'god', on: true },
    { type: 'cheat', key: 'noclip', on: true },
  ]);
  return {
    sb,
    input: (t) =>
      t % 600 === 0
        ? [
            { type: 'look', yaw: 0.9, pitch: 0 },
            { type: 'move', forward: 1, strafe: 0 },
            { type: 'action', action: 'sprint', pressed: true },
          ]
        : [],
  };
}

interface Node {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number | undefined;
}

const { sb, input } = await build();
const sim = sb.simulation;
const prof = sim.setProfiler(() => performance.now());
const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: 200 });
await session.post('Profiler.start');
const t0 = performance.now();
for (let t = 0; t < ticks; t++) sim.step(input(t));
const wall = performance.now() - t0;
const { profile } = await session.post('Profiler.stop');
session.disconnect();

console.log(
  `scenario ${scenario}: ${String(ticks)} ticks in ${wall.toFixed(0)} ms (${((ticks / wall) * 1000).toFixed(0)} ticks/s)\n`,
);
console.log('per system (mean ms/tick, share):');
if (prof !== null)
  for (const s of systemTimings(prof).slice(0, 16))
    console.log(
      `  ${s.name.padEnd(22)} ${s.ms.toFixed(4)}  ${(s.share * 100).toFixed(1).padStart(5)}%`,
    );

// The inspector's profile nodes already carry these fields (typed by node:inspector).
const nodes: readonly Node[] = profile.nodes;
const total = nodes.reduce((s, n) => s + (n.hitCount ?? 0), 0) || 1;
const byFn = new Map<string, number>();
for (const n of nodes) {
  const url = n.callFrame.url.replace(/^.*\/war\//, '');
  const key = `${n.callFrame.functionName || '(anonymous)'}  ${url}:${String(n.callFrame.lineNumber + 1)}`;
  byFn.set(key, (byFn.get(key) ?? 0) + (n.hitCount ?? 0));
}
console.log('\nhottest functions (self time):');
for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(`  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
