/**
 * Performance gate run in CI: measures headless tick throughput and counts
 * minor (scavenge) GCs during the measured window. A zero-allocation hot path
 * produces no young-generation garbage, so scavenges ~= 0.
 */
import { readFileSync } from 'node:fs';
import { PerformanceObserver, constants, performance } from 'node:perf_hooks';
import { z } from 'zod';
import { createEmptyWorld } from '../src/application/scenes/empty-world';
import { createSandbox } from '../src/application/scenes/sandbox';
import { createRapierPhysics } from '../src/infrastructure/physics/rapier-physics';
import type { Simulation } from '../src/application/simulation';
import type { InputCommand } from '../src/domain/input/commands';
import { MOB_IDS } from '../src/domain/mobs/registry';
import { spawnMob } from '../src/application/ai/systems';
import { Mob } from '../src/application/ai/components';
import { seed } from '../src/domain/core/brand';
import { createChurnWorld } from '../tests/fixtures/churn-world';
import { AmbienceRenderer } from '../src/infrastructure/audio/dsp/ambience-renderer';
import { computeMix, createAmbienceContext, createMix } from '../src/domain/audio/mix';

/**
 * The ambient bed's DSP cost: seconds of audio rendered per second of CPU
 * for the densest mix (forest, rain, full danger), best of five 2 s renders.
 * Measured here, alone and without coverage instrumentation, not in the
 * unit tests, where a parallel suite makes wall-clock budgets meaningless.
 */
function measureAmbience(): number {
  const sr = 48000;
  const r = new AmbienceRenderer(sr, 3);
  r.setMix(
    computeMix(
      { ...createAmbienceContext(), zones: { forest: 1 }, rain: 1, danger: 1 },
      createMix(),
    ),
  );
  r.settle();
  const l = new Float32Array(sr * 2);
  const rr = new Float32Array(sr * 2);
  r.render(l, rr); // warm-up
  let ms = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    r.render(l, rr);
    ms = Math.min(ms, performance.now() - t0);
  }
  return 2000 / ms;
}

const Budget = z.object({ minTicksPerSecond: z.number(), maxMinorGcPerMillionTicks: z.number() });
const budgets = z
  .object({
    emptyWorld: Budget,
    churnWorld: Budget,
    sandbox: Budget,
    worldStreaming: Budget.extend({ maxP999TickMs: z.number() }),
    aiCrowd: Budget.extend({ maxP999TickMs: z.number() }),
    ambience: z.object({ minRealtimeFactor: z.number() }),
  })
  .parse(JSON.parse(readFileSync(new URL('../perf-budgets.json', import.meta.url), 'utf8')));

let minorGcs = 0;
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    // Node attaches { kind } to GC entries; the DOM PerformanceEntry type does not declare it.
    const kind = z.object({ detail: z.object({ kind: z.number() }) }).safeParse(entry.toJSON());
    if (kind.success && kind.data.detail.kind === constants.NODE_PERFORMANCE_GC_MINOR) minorGcs++;
  }
});
observer.observe({ entryTypes: ['gc'] });

/** Sandbox with the player walking and the flashlight on: exercises movement, dmath and battery drain. */
async function walkingSandbox(): Promise<Simulation> {
  const sim = createSandbox(seed(1), await createRapierPhysics(60)).simulation;
  sim.step([
    { type: 'move', forward: 1, strafe: 0.3 },
    { type: 'look', yaw: 0.01, pitch: 0 },
  ]);
  return sim;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

/**
 * AI under load: 64 mobs of every kind around the player on the street, all
 * perceiving, deciding, pathing and attacking (the player is invulnerable and
 * keeps circling so they keep chasing). Throughput, GC and slowest ticks.
 */
async function measureCrowd(ticks: number): Promise<{ tps: number; gcPerM: number; p999: number }> {
  const sb = createSandbox(seed(2), await createRapierPhysics(60));
  const sim = sb.simulation;
  for (let i = 0; i < 64; i++) {
    const id = MOB_IDS[i % MOB_IDS.length] ?? 'shambler';
    const a = (i / 64) * Math.PI * 2;
    const r = 8 + (i % 5) * 4;
    const x = Math.sin(a) * Math.min(r, 7);
    const z = -40 + Math.cos(a) * r;
    if (sb.ai.nav.walkableAt(x, z)) spawnMob(sim.world, sb.ai, id, x, z, a);
  }
  const start: InputCommand[] = [
    { type: 'cheat', key: 'god', on: true },
    { type: 'move', forward: 1, strafe: 0 },
  ];
  const turn: InputCommand[] = [{ type: 'look', yaw: 0.02, pitch: 0 }];
  for (let t = 0; t < 5_000; t++) sim.step(t === 0 ? start : turn); // warm-up
  await flush();
  minorGcs = 0;
  const times = new Float64Array(ticks);
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) {
    const a = performance.now();
    sim.step(turn);
    times[i] = performance.now() - a;
  }
  const elapsed = performance.now() - t0;
  await flush();
  const sorted = Array.from(times).sort((x, y) => x - y);
  const p999 = sorted[Math.floor(sorted.length * 0.999)] ?? 0;
  const tps = Math.round((ticks / elapsed) * 1000);
  const gcPerM = (minorGcs / ticks) * 1_000_000;
  console.log(
    `aiCrowd: ${tps.toLocaleString('en')} ticks/s with ${String(sim.world.store(Mob).size)} mobs, ${String(minorGcs)} minor GCs, tick p99.9 ${p999.toFixed(3)} ms, ${String(sb.ai.stats.searches)} path searches, ${String(sb.ai.stats.attacks)} attacks`,
  );
  return { tps, gcPerM, p999 };
}

/**
 * Open world: sprint along the main avenue and turn back every 40 s, so
 * collider chunks keep streaming in and out. Besides throughput, every tick
 * is timed: chunk loads are time-sliced, so even the slowest ticks must stay
 * inside the simulation's frame budget.
 */
async function measureWorld(
  ticks: number,
): Promise<{ tps: number; gcPerM: number; p999: number; max: number; loads: number }> {
  const sb = createSandbox(seed(1), await createRapierPhysics(60), { kind: 'world' });
  const sim = sb.simulation;
  const go: InputCommand[] = [
    { type: 'move', forward: 1, strafe: 0 },
    { type: 'action', action: 'sprint', pressed: true },
  ];
  const turn: InputCommand[] = [{ type: 'look', yaw: Math.PI, pitch: 0 }];
  const commandsAt = (t: number): readonly InputCommand[] =>
    t === 0 ? go : t % 2400 === 0 ? turn : [];
  for (let t = 0; t < 20_000; t++) sim.step(commandsAt(sim.tick)); // JIT warm-up
  await flush();
  minorGcs = 0;
  const times = new Float64Array(ticks);
  const loads0 = sb.chunks?.loadsTotal ?? 0;
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) {
    const a = performance.now();
    sim.step(commandsAt(sim.tick));
    times[i] = performance.now() - a;
  }
  const elapsed = performance.now() - t0;
  await flush();
  const sorted = Array.from(times).sort((x, y) => x - y);
  const p999 = sorted[Math.floor(sorted.length * 0.999)] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const tps = Math.round((ticks / elapsed) * 1000);
  const gcPerM = (minorGcs / ticks) * 1_000_000;
  const loads = (sb.chunks?.loadsTotal ?? 0) - loads0;
  console.log(
    `worldStreaming: ${tps.toLocaleString('en')} ticks/s, ${String(minorGcs)} minor GCs, ${String(loads)} chunk loads, tick p99.9 ${p999.toFixed(3)} ms, max ${max.toFixed(3)} ms over ${ticks.toLocaleString('en')} ticks`,
  );
  return { tps, gcPerM, p999, max, loads };
}

async function measure(
  name: string,
  sim: Simulation,
  ticks: number,
): Promise<{ tps: number; gcPerM: number }> {
  for (let i = 0; i < 20_000; i++) sim.step(); // JIT warm-up
  await flush();
  minorGcs = 0;
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) sim.step();
  const elapsed = performance.now() - t0;
  await flush();
  const tps = Math.round((ticks / elapsed) * 1000);
  const gcPerM = (minorGcs / ticks) * 1_000_000;
  console.log(
    `${name}: ${tps.toLocaleString('en')} ticks/s, ${String(minorGcs)} minor GCs over ${ticks.toLocaleString('en')} ticks`,
  );
  return { tps, gcPerM };
}

const results = {
  emptyWorld: await measure('emptyWorld', createEmptyWorld(seed(1)).simulation, 2_000_000),
  churnWorld: await measure('churnWorld', createChurnWorld(seed(1)), 200_000),
  sandbox: await measure('sandbox', await walkingSandbox(), 300_000),
};
/**
 * Shared runners are noisy (the same scenario has measured 3.6k and 5.6k ticks/s in back-to-back
 * runs): each heavy scenario runs twice and keeps its better run. Both runs are deterministic, so
 * GCs, loads and the slowest ticks only differ by the machine's noise.
 */
const better = <T extends { tps: number }>(a: T, b: T): T => (b.tps > a.tps ? b : a);
const world = better(await measureWorld(200_000), await measureWorld(200_000));
const crowd = better(await measureCrowd(100_000), await measureCrowd(100_000));
observer.disconnect();

let failed = false;
for (const name of ['emptyWorld', 'churnWorld', 'sandbox'] as const) {
  const r = results[name];
  const b = budgets[name];
  if (r.tps < b.minTicksPerSecond) {
    console.error(`FAIL ${name}: ${String(r.tps)} ticks/s < ${String(b.minTicksPerSecond)}`);
    failed = true;
  }
  if (r.gcPerM > b.maxMinorGcPerMillionTicks) {
    console.error(
      `FAIL ${name}: ${r.gcPerM.toFixed(1)} minor GCs per 1M ticks > ${String(b.maxMinorGcPerMillionTicks)}`,
    );
    failed = true;
  }
}
const wb = budgets.worldStreaming;
if (world.loads < 50) {
  console.error(
    `FAIL worldStreaming: only ${String(world.loads)} chunk loads; the route no longer streams`,
  );
  failed = true;
}
if (world.tps < wb.minTicksPerSecond) {
  console.error(
    `FAIL worldStreaming: ${String(world.tps)} ticks/s < ${String(wb.minTicksPerSecond)}`,
  );
  failed = true;
}
if (world.gcPerM > wb.maxMinorGcPerMillionTicks) {
  console.error(
    `FAIL worldStreaming: ${world.gcPerM.toFixed(1)} minor GCs per 1M ticks > ${String(wb.maxMinorGcPerMillionTicks)}`,
  );
  failed = true;
}
if (world.p999 > wb.maxP999TickMs) {
  console.error(
    `FAIL worldStreaming: tick p99.9 ${world.p999.toFixed(3)} ms > ${String(wb.maxP999TickMs)} ms`,
  );
  failed = true;
}
const cb = budgets.aiCrowd;
if (crowd.tps < cb.minTicksPerSecond) {
  console.error(`FAIL aiCrowd: ${String(crowd.tps)} ticks/s < ${String(cb.minTicksPerSecond)}`);
  failed = true;
}
if (crowd.gcPerM > cb.maxMinorGcPerMillionTicks) {
  console.error(
    `FAIL aiCrowd: ${crowd.gcPerM.toFixed(1)} minor GCs per 1M ticks > ${String(cb.maxMinorGcPerMillionTicks)}`,
  );
  failed = true;
}
if (crowd.p999 > cb.maxP999TickMs) {
  console.error(
    `FAIL aiCrowd: tick p99.9 ${crowd.p999.toFixed(3)} ms > ${String(cb.maxP999TickMs)} ms`,
  );
  failed = true;
}
const ambience = measureAmbience();
console.log(`ambience: ${ambience.toFixed(1)}× real time (densest mix)`);
if (ambience < budgets.ambience.minRealtimeFactor) {
  console.error(
    `FAIL ambience: ${ambience.toFixed(1)}× real time < ${String(budgets.ambience.minRealtimeFactor)}×`,
  );
  failed = true;
}
if (failed) process.exit(1);
console.log('perf gate: OK');
