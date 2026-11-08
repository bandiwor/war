# ADR-0001: Technology stack

- Status: Accepted
- Date: 2026-11-08

## Context

War is a browser FPS with hard constraints: every asset generated in code, deterministic
simulation (golden replays), 60 FPS on integrated GPUs, a built-in editor and debug tooling.
We need a stack that is typed end to end, fast to iterate on, and runnable headless in Node.

## Decision

| Concern          | Choice                                                                               | Why                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Language         | TypeScript 5.9, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | Catches the classes of bug that matter most in a large simulation codebase.            |
| Build/dev server | Vite                                                                                 | Fast HMR (needed for live registry/shader editing), native ESM, worker bundling.       |
| Rendering        | Three.js (WebGL2) behind our own render-graph + renderer port                        | Mature WebGL2 layer; our port keeps a WebGPU backend possible (stage 1).               |
| Physics          | Rapier (WASM, its cross-platform deterministic build)                                | Cross-platform deterministic build, good character controller (stage 2).               |
| Navigation       | recast-navigation (WASM)                                                             | Industry-standard navmesh + dynamic obstacles (stage 6).                               |
| Validation       | Zod 4                                                                                | Runtime schemas with inferred static types for registries, levels, saves, replays.     |
| PRNG             | Own sfc32 + splitmix32 stream derivation                                             | 32-bit integer only ⇒ bit-identical on all engines; cheap; serialisable 128-bit state. |
| Unit tests       | Vitest + fast-check                                                                  | Same transform pipeline as Vite; property-based tests for math/serialisation.          |
| E2E / visual     | Playwright (Chromium)                                                                | Real WebGL, screenshot comparison for shader regression.                               |
| Benchmarks       | tinybench (`npm run bench`) + a GC-counting perf gate                                | Vitest 5 reworked its bench API; tinybench is stable and what Vitest used underneath.  |
| Lint             | ESLint 10 flat config + typescript-eslint `strictTypeChecked`                        | Type-aware rules plus our own layer-boundary and determinism rules.                    |
| Audio            | Web Audio API + AudioWorklet                                                         | The only way to synthesise all sound procedurally in the browser (stage 3).            |

Three.js, Rapier and recast are added in the stages that first use them, to keep each stage's
diff reviewable.

## Consequences

- No game engine (Unity/Godot web export): we own the loop, ECS and render graph. More work, but
  required for headless determinism and zero-asset procedural generation.
- Determinism forbids some conveniences in simulation code (`Math.sin`, `Date.now`, see ADR-0003).
- Cross-origin isolation headers are set in dev/preview so `SharedArrayBuffer` is available to
  worker pipelines; production hosting must send the same headers.
