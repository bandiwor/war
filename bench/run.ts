/**
 * Micro-benchmarks for hot paths (`npm run bench`). Informational: hard CI
 * thresholds live in scripts/perf-gate.ts + perf-budgets.json.
 */
import { Bench } from 'tinybench';
import { createEmptyWorld } from '../src/application/scenes/empty-world';
import { seed } from '../src/domain/core/brand';
import { sin } from '../src/domain/math/dmath';
import { StateHasher } from '../src/domain/math/hash';
import { Rng } from '../src/domain/math/prng';
import { createChurnWorld } from '../tests/fixtures/churn-world';

const bench = new Bench({ time: 300 });
const rng = Rng.fromSeed(1);
const hasher = new StateHasher();
const empty = createEmptyWorld(seed(1)).simulation;
const churn = createChurnWorld(seed(1));
for (let i = 0; i < 600; i++) churn.step();
let sink = 0;

bench
  .add('Rng.nextFloat x1000', () => {
    for (let i = 0; i < 1000; i++) sink += rng.nextFloat();
  })
  .add('StateHasher.f64 x1000 + digest', () => {
    hasher.reset();
    for (let i = 0; i < 1000; i++) hasher.f64(i * 0.5);
    sink += hasher.digest().length;
  })
  .add('dmath.sin x1000', () => {
    for (let i = 0; i < 1000; i++) sink += sin(i * 0.01);
  })
  .add('empty world: 60 ticks', () => {
    for (let i = 0; i < 60; i++) empty.step();
  })
  .add('churn world (~100 entities): 60 ticks', () => {
    for (let i = 0; i < 60; i++) churn.step();
  })
  .add('churn world: stateHash', () => {
    sink += churn.stateHash().length;
  });

await bench.run();
console.table(bench.table());
if (sink === 0.5) console.log('unreachable');
