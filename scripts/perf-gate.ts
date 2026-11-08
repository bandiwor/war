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
import { seed } from '../src/domain/core/brand';
import { createChurnWorld } from '../tests/fixtures/churn-world';

const Budget = z.object({ minTicksPerSecond: z.number(), maxMinorGcPerMillionTicks: z.number() });
const budgets = z
  .object({ emptyWorld: Budget, churnWorld: Budget, sandbox: Budget })
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
  sandbox: await measure('sandbox', await walkingSandbox(), 100_000),
};
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
if (failed) process.exit(1);
console.log('perf gate: OK');
