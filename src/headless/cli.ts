import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { seed } from '../domain/core/brand';
import { runHeadless } from './run';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1337' },
    ticks: { type: 'string', default: '216000' },
    input: { type: 'boolean', default: true },
  },
});

const ticks = Number(values.ticks);
const started = performance.now();
const result = runHeadless(seed(Number(values.seed) >>> 0), ticks, values.input);
const elapsed = performance.now() - started;
const simulatedSeconds = ticks / 60;
console.log(
  JSON.stringify({
    ...result,
    elapsedMs: Math.round(elapsed),
    ticksPerSecond: Math.round((ticks / elapsed) * 1000),
    realtimeFactor: Math.round(simulatedSeconds / (elapsed / 1000)),
  }),
);
