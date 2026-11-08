# ADR-0002: Layered architecture (ports and adapters) and ECS

- Status: Accepted
- Date: 2026-11-08

## Context

Simulation must run in Node without a DOM, be deterministic and testable, and the renderer must be
replaceable (WebGL2 → WebGPU). Game content must be data, not code.

## Decision

```
src/
  domain/          pure logic: ECS, math, PRNG, hashing, input commands, (later) AI, ballistics, rules
  application/     use cases & orchestration: Simulation, fixed-step loop, replays, scenes, ports
  infrastructure/  adapters: browser frames/input, (later) Three renderer, Web Audio, storage, workers
  presentation/    UI & composition root for the browser, debug menu, (later) editor UI
  headless/        composition root for Node (CLI, CI determinism runs)
```

Dependencies point inward only: `presentation → infrastructure → application → domain`.
`headless` may use `application` and `domain` only. This is enforced by `no-restricted-imports`
rules generated in `eslint/architecture.js` and verified by `tests/lint-rules.test.ts`.
Engine packages (`three`, Rapier, recast) are forbidden in domain and application.

Application declares **ports** (`FrameSource`, `InputSource`, `Presenter`, …); infrastructure
implements them. Wiring happens only in composition roots (`presentation/main.ts`,
`headless/*`). No global singletons: everything is constructed and passed explicitly.

**ECS**: entities are 30-bit handles (20-bit slot + 10-bit generation; fits a V8 Smi).
Components are SoA typed arrays in sparse-set stores (packed rows, O(1) add/remove).
Systems declare `after`/`before`; the schedule is a stable topological sort computed once,
with cycle/unknown-dependency errors at startup.

## Consequences

- Systems iterate dense typed arrays — cache-friendly and allocation-free.
- Field arrays are replaced when a store grows, so code must not cache `store.fields.x` across
  calls that may add rows (documented on `ComponentStore`).
- A handful of type assertions are unavoidable (brand constructors, mapped-type construction in
  `ComponentStore`, the def→store map in `World`). Each carries an `eslint-disable` with a
  required description; all other assertions are lint errors.
