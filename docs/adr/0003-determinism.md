# ADR-0003: Determinism, replays and zero allocation

- Status: Accepted
- Date: 2026-11-08

## Context

Golden replays are the backbone of testing: world state after N ticks must be a pure function of
(seed, per-tick input commands, N), on every machine and JS engine.

## Decision

1. **Fixed timestep** at 60 Hz (`FixedStepAccumulator`), max 5 catch-up steps per frame; excess
   time is dropped and reported. Rendering interpolates with `alpha`.
2. **One root seed, named streams**: `RngStreams.get('ai')` derives an independent sfc32 stream
   from `(rootSeed, name)`. Adding draws in one subsystem never shifts another's sequence.
3. **Forbidden in `domain/` and `application/`** (lint-enforced): `Math.random`, `Date`,
   `performance`, timers, DOM globals, and **non-exact `Math` functions**
   (`sin, cos, atan2, exp, pow, log, …`). ECMAScript leaves those implementation-approximated, so
   results can differ between V8 versions, SpiderMonkey and JSC. Simulation code uses
   `domain/math/dmath` (built only from `+ - * / sqrt`, which IEEE-754 makes exact). Rendering
   and audio may use `Math.*` freely.
4. **State hash**: a streaming 64-bit hash over tick, RNG stream states (sorted by name) and every
   component row in entity-slot order. Slot order (not packed order) means the hash reflects
   logical state, independent of add/remove history.
5. **Replay format** `war-replay` v1: seed, tickRate, length, sparse frames `{t, c[]}` and periodic
   hash checkpoints. Serialised one frame per line for readable diffs; validated with Zod.
   Playback reports the first diverging checkpoint.
6. **Zero allocation in hot paths**, verified by `scripts/perf-gate.ts`, which counts minor GCs
   during millions of ticks. Findings already baked in:
   - Iterating a _frozen_ array with `for…of` allocates an iterator per loop in V8.
   - uint32 values ≥ 2³⁰ stored in object fields are boxed (HeapNumber) on each write, so PRNG
     state lives in a `Uint32Array`, and entity handles are kept below 2³⁰.
   - Hot loops use indexed `for`, so `prefer-for-of` is disabled.

## Consequences

- `dmath` is slower than native `Math.sin` (~12 ns vs ~5 ns); acceptable at simulation rates.
- Physics (stage 2) must use Rapier's deterministic build and only receive inputs from the
  simulation, never from the frame loop.
- Saves (stage 8) can reuse the hash walk order and `RngStreams.snapshot()`.
