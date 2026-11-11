# Performance report

_Final run of stage 10 (2026-11-11). Reproduce with `npm run perf`, `npm run profile`,
`npm run build` and `npm run test:e2e`. The numbers below come from the shared 4-core CI
container this project is built on. It is noisy: identical runs differ by up to 30%, so the
gates use floors far below these values and judge allocations and the slowest ticks, not raw
speed._

## Simulation (headless, `npm run perf`)

| Scenario       | What it runs                                           | Throughput (ticks/s) | Real time at 60 Hz | Minor GCs / M ticks | Slowest tick (p99.9) |
| -------------- | ------------------------------------------------------ | -------------------- | ------------------ | ------------------- | -------------------- |
| emptyWorld     | ECS + schedule only                                    | ~36 000 000          | ~600 000×          | 0                   | —                    |
| churnWorld     | spawn/despawn churn                                    | ~200 000–300 000     | ~4 000×            | ~10                 | —                    |
| sandbox        | walking player, physics, flashlight                    | ~180 000             | ~3 000×            | ~130                | —                    |
| worldStreaming | sprinting the open world: 1 415 chunk loads, AI, story | ~15 000–16 000       | ~250×              | ~780                | ~0.9–1.0 ms          |
| aiCrowd        | 49 mobs of every kind hunting the player               | ~7 000               | ~115×              | ~2 050              | ~0.75 ms             |
| ambience DSP   | the densest ambient mix (forest, rain, full danger)    | ~40× real time       | —                  | —                   | —                    |

The simulation frame budget is 2 ms per tick (`FRAME_BUDGETS.simulation`). The slowest 0.1% of
ticks, including chunk loads, stay at about half of it. The remaining minor GCs come from
Rapier's JS wrapper: every character move and ray query allocates a small object. Our own
systems allocate nothing per tick (ADR-0006, ADR-0011).

## Profiling and what it changed

`npm run profile -- world|crowd|level` times every simulation system through the simulation's own
instrumentation (`Simulation.setProfiler`, an external clock: timings never feed back into the
simulation). It also takes a V8 CPU profile through `node:inspector`. In the game, the debug
menu's **Sim** tab shows the same per-system table live ("profile systems").

Two optimisations came out of the stage-10 profiles. Both keep every golden hash unchanged, so
behaviour is identical:

| Hot spot                                  | Cause                                                                                                                                              | Fix                                                                                                                            | Effect                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `physics.step`, 53% of an open-world tick | Rapier's `world.step()` resyncs its JS handle maps after every step, with one WASM call per collider: O(streamed colliders) whenever a chunk loads | Step the physics pipeline directly. The game never lets the pipeline create or remove anything, so the resync is pure overhead | Profile route 5 900 → 12 700 ticks/s (2.1×); perf-gate route +4–5%, fewer GCs |
| `ai.network`, 10% of a crowd tick         | Each robot that sees you rescanned every mob, with a registry lookup each, to find networked robots                                                | Collect the networked robots once per tick                                                                                     | 0.027 → 0.011 ms per tick (−58%)                                              |

## Rendering

The brief's target is a stable 60 FPS on a mid-range laptop with integrated graphics. In the
browser, three mechanisms keep the frame inside its 16.7 ms budget:

1. **Quality presets** (`low`, `medium`, `high`): internal resolution, texture size, shadow map,
   MSAA, bloom levels, view distance and the real-light pool. Phones start at `low`.
2. **Automatic quality scaling** (ADR-0016), on by default (`?auto=0` turns it off, and the
   `?bench` mode measures the preset as asked). It works in
   this order:
   - the internal resolution goes down to 50% of the preset;
   - then the flashlight's shadows go;
   - then motion blur and bloom go.

   Each is given back when there is headroom. Measured on this container's software GL at the
   `high` preset (`e2e/quality.spec.ts`): with scaling on, 1.7 fps after 20 s, at 50% resolution
   and the last tier; with `?auto=0`, 0.6 fps. That is 3× the frame rate. Software GL cannot
   reach 60 FPS at all, and the governor's job is to get as close as the machine allows. On a
   machine that already holds 60 FPS, it changes nothing (the same test checks this).

3. **Budgets in config** (`src/infrastructure/render/budgets.ts`): CPU render 4 ms, GPU 11 ms,
   simulation 2 ms, streaming 1.5 ms. The debug menu's Render tab flags overruns and shows the
   governor's state. Chunk meshes are built in Web Workers and attached within the 1.5 ms
   streaming budget (`e2e/world.spec.ts` checks it while streaming through every hub).

GPU timings need `EXT_disjoint_timer_query_webgl2`, which browsers often hide. Where it is
missing, the governor falls back to the frame interval: it is capped by vsync, so it only ever
says "too slow", which is the case that matters.

## Bundle (`npm run build`, `npm run check:bundle`)

| Chunk                 | Size         | gzip     | Loaded                |
| --------------------- | ------------ | -------- | --------------------- |
| index (game)          | 386 kB       | 134 kB   | always                |
| three                 | 560 kB       | 139 kB   | always                |
| rapier (WASM inlined) | 4 365 kB     | 1 677 kB | always                |
| vendor                | 97 kB        | 27 kB    | always                |
| editor-app            | 50 kB        | 14 kB    | only with `?editor=1` |
| chunk / bake workers  | 120 / 108 kB | —        | in workers            |
| ambience worklet      | 12 kB        | —        | in the audio worklet  |

There are no source maps in release builds. The debug menu is tree-shaken out of production
(`check:bundle` asserts both).

## Tests in the final run

- `npm run ci`, all green:
  - typecheck and lint;
  - 621 unit, property, golden and integration tests, with coverage at 98% statements and 83%
    branches;
  - level checks, build, bundle check, perf gate.
- `npm run test:e2e`: every Playwright test passes.
