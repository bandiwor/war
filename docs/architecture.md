# Architecture

```mermaid
flowchart TB
  subgraph presentation["presentation (browser composition root, UI, debug menu)"]
    main[main.ts]
    main --> debug[debug/ — DEV only, tree-shaken]
  end
  subgraph headless["headless (Node composition root)"]
    cli[cli.ts / run.ts]
  end
  subgraph infrastructure["infrastructure (adapters)"]
    raf[RafFrameSource]
    kbd[KeyboardMouseInput]
    rend[BodycamPresenter: render graph · post effects · workers]
  end
  subgraph application["application (use cases, ports)"]
    loop[GameLoop + FixedStepAccumulator]
    sim[Simulation]
    replay[Replay record / playback]
    scenes[scenes/]
    ports{{ports: FrameSource · InputSource · Presenter}}
  end
  subgraph domain["domain (pure, deterministic)"]
    ecs[ECS: entities · SoA stores · schedule]
    math[sfc32 Rng streams · StateHasher · dmath]
    data[registries: materials · bodycam effects · layouts]
    input[InputCommand schema]
  end
  presentation --> infrastructure --> application --> domain
  headless --> application
  raf -. implements .-> ports
  kbd -. implements .-> ports
  rend -. implements .-> ports
```

## Frame flow

1. `RafFrameSource` delivers a wall-clock timestamp (the only clock in the game).
2. `GameLoop` feeds the delta to `FixedStepAccumulator` → N fixed 60 Hz steps.
3. For each step: `InputSource.commandsFor(tick)` → `Simulation.step(commands)` → systems run in
   schedule order on a reused `SimContext` (world, RNG streams, tick, dt, commands).
4. `Presenter.present(alpha)` draws, interpolating between the last two ticks.

Replays record exactly the per-tick commands from step 3, so playback in Node reproduces the run.

## Open world streaming (ADR-0010)

```mermaid
flowchart LR
  gen["domain/world/chunk-gen<br/>generateChunk(seed, cx, cz)<br/>pure"]
  subgraph sim["simulation (per tick)"]
    cc["ChunkColliders<br/>ring 1 now · ring 2 prefetch · drop > 3"]
    rapier[(Rapier)]
  end
  subgraph render["renderer (per frame)"]
    w["chunk workers<br/>generate + mesh"]
    cr["ChunkRenderer<br/>attach within 1.5 ms"]
    pool["LightPool<br/>fixed real lights"]
  end
  gen --> cc --> rapier
  gen --> w --> cr --> pool
```

Both sides derive chunk content from the seed alone. The simulation streams around the player's
feet on ticks, so replays reproduce it. The renderer streams around the camera on frames, so it
never touches the state hash.

## Folder map

| Path                         | Contents                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/domain/core`            | Branded types (`Seed`, `Tick`), `assertNever`, `invariant`                                                              |
| `src/domain/math`            | `Rng`/`RngStreams`, `StateHasher`, deterministic `dmath`                                                                |
| `src/domain/ecs`             | `EntityAllocator`, `ComponentStore`, `World`, `buildSchedule`                                                           |
| `src/domain/input`           | `InputCommand` discriminated union + Zod schema                                                                         |
| `src/domain/procgen`         | Tileable noise, material recipe registry, texture baker                                                                 |
| `src/domain/bodycam`         | Bodycam effect registry, gameplay stimulus modulation                                                                   |
| `src/domain/world`           | World map (hubs, roads), chunk grid + generator, clock/weather, street & range layouts                                  |
| `src/infrastructure/render`  | WebGL presenter, render graph, post pipeline, effects, scene; `world/`: chunk workers, streaming, light pool, sky, rain |
| `src/application`            | `Simulation`, `loop/`, `replay/`, `scenes/`; `world/`: collider streaming, environment system                           |
| `src/infrastructure/browser` | rAF frame source, keyboard/mouse and touch input                                                                        |
| `src/presentation`           | Browser composition root, OSD, `debug/`                                                                                 |
| `src/headless`               | Node runner and CLI                                                                                                     |
| `tests/golden`               | Golden hashes and replay files                                                                                          |
| `tests/fixtures`             | Test-only worlds (e.g. the churn stress world)                                                                          |
| `eslint/architecture.js`     | Layer and determinism lint rules                                                                                        |
| `scripts/`                   | Perf gate, bundle check                                                                                                 |
| `docs/adr`                   | Architecture decision records                                                                                           |
