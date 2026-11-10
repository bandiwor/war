# ADR-0010: Open world: chunk streaming, time of day and weather

- Status: Accepted
- Date: 2026-11-10

## Context

Stage 5 turns the single test street into the semi-open world the brief describes:

- hub zones (city, industrial yards, subway, forest, research complex) joined by routes;
- procedural detail on top of an authored structure;
- zones loaded in chunks;
- a dusk-to-night clock and weather (fog, rain, wind) that affect visibility, sound and, from
  stage 6, mob behaviour.

The acceptance criterion is that frame budgets hold while all of this runs. Determinism
(ADR-0003) and golden replays (ADR-0006) must survive streaming.

## Decision

**Authored structure, procedural detail.**

- `domain/world/world-map.ts` holds the authored layer. It defines five hub rectangles, one per
  soundscape zone, an axis-aligned road network, the quarantine wall and the spawn.
- A chunk (32 m square, 16×16 chunks, 512 m across) takes the zone of the hub nearest its centre.
- `domain/world/chunk-gen.ts` is the procedural layer. `generateChunk(seed, cx, cz)` is a pure
  function, built in three steps:
  1. 1 m ground cells are classified as road, pavement or bare ground, then greedily merged
     into non-overlapping rectangles.
  2. A per-zone generator places buildings, container stacks, station pavilions, trees,
     fences, lamps, debris and fungus on free cells, using rejection sampling on an occupancy
     grid.
  3. The quarantine wall closes the edge chunks.
- Everything stays inside its chunk, so chunks never overlap and can load in any order.
  Lamp lights hanging over the edge are the one exception, and they are render-only.
- Per-chunk caps bound the worst case.

**Two independent streamers, one source of truth.** The simulation and the renderer both call
`generateChunk` themselves and stream around their own centres.

- _Simulation (`application/world/chunk-colliders.ts`)_ streams colliders around the player's
  feet, driven by ticks, never by frames:
  - the player's chunk and its 8 neighbours are required, so they load in the same tick, before
    the motor runs (a teleport never drops the player through the floor);
  - ring 2 is prefetched, one chunk per tick;
  - chunks beyond ring 3 unload, two per tick (hysteresis).
- Because streaming depends only on the simulated position, a replay loads and unloads the same
  chunks on the same ticks. The Rapier snapshot in the state hash covers the loaded set.
- `PhysicsPort` gained collider ids, `removeCollider` and `setCharacterFeet` (teleport).
- _Renderer (`infrastructure/render/world/`)_ works as follows:
  - Workers run generation plus meshing (`chunk-mesher.ts`, no Three.js, unit-tested in Node).
    They return typed arrays: boxes merged per material, prop instance matrices and an emissive
    mesh for windows, bulbs and beacon domes.
  - The main thread only wraps those arrays in GPU buffers, inside a per-frame streaming budget
    (`FRAME_BUDGETS.streaming`, 1.5 ms). Another chunk is attached only if a running average of
    attach cost still fits, and at least one is attached per frame so streaming never starves.
  - Disposing waits for spare time.
  - Small props are drawn only in the near rings (geometry LOD).
  - The view radius and detail radius come from the quality preset.

**Lights: a fixed pool.** Changing the number of Three.js lights recompiles every lit shader.

- The world has a constant set of real lights: sodium lamps, glows and beacon rigs, counts per
  quality preset.
- Each frame they are handed to the nearest streamed light sources.
- Unused lights stay in the scene at zero intensity.
- Sources without a pooled light still glow through emissive geometry.
- At boot, shader warm-up compiles every material and prop variant, including zones that have
  not streamed in yet. Streaming therefore never compiles a shader.

**Time and weather are simulation state.**

- The `Environment` component holds:
  - the clock: seconds since midnight, starting 18:50 at 6× speed;
  - the weather clock;
  - the current fog, rain and wind;
  - the overrides.
- It changes only through ticks and the new `env` input command, so replays reproduce a session
  in which the debug menu changed the weather. Teleport is a `teleport` command for the same
  reason.
- Weather is stateless. `weatherAt(seed, clock)` blends 20-minute fronts drawn from a few regimes
  (clear, mist, drizzle, storm, windy) with an integer hash, so it costs no allocation and any
  moment can be evaluated directly. The first front is always mist.
- Pure functions derive the rest:
  - sun elevation and azimuth (October, ~50° N);
  - daylight and nightness;
  - fog extinction;
  - visibility (Koschmieder);
  - `perceptionScale` (sight and hearing multipliers that stage 6 AI will use);
  - wind velocity.

**Effects.**

- _Render:_ the sky dome, sun or moon, hemisphere light and fog are all scaled by the same sky
  light, so bodycam auto-exposure can hold sky and street together. A clear full night
  reproduces the stage-1 street exactly (fog 0.034, `#05070b`, moon 0.05; a unit test checks
  this).
- _Rain:_ GPU-animated streaks wrap in a world-anchored box around the camera and catch the
  flashlight. Rain also adds droplets to the bodycam lens (`applyWeatherToPostFx`).
- _Audio:_ night comes from the sun, rain from the weather, and weather wind scales and roughens
  the wind layer. The scaling is neutral at the authored strength, so stage-3 zone tests are
  unchanged.
- _OSD:_ the clock shows the world time.

**Scenes.**

- `?scene=world` is the default.
- The stage-1 street (`?scene=street`) and the range stay as fixed, clock-less test scenes. Their
  golden hashes, replays and visual snapshots are unchanged.

## Consequences

- Budgets are measured in two places:
  - the perf gate sprints a streaming route (~1,700 chunk loads per 200k ticks) and requires the
    p99.9 tick ≤ 2 ms (measured 0.5 ms), ≥ 20k ticks/s (measured 54k) and a GC ceiling;
  - `e2e/world.spec.ts` tours every hub and requires streaming ≤ 1.5 ms on 95% of frames and
    simulation ≤ 2 ms on 99% of ticks.
- Render timings under headless software GL are not meaningful. The in-game `?bench=N` report
  (now with simulation and streaming figures) is the tool for real hardware. Automatic quality
  scaling is stage 10.
- Chunk loads allocate: generation, collider creation and buffers. Between loads the simulation
  allocates nothing, the same as before.
- Projectiles beyond the collider rings (more than ~64 m from the player) fly through unloaded
  geometry. The ring radius is a constant to raise if long-range fights need it.
- The world is flat (no terrain heightfield). Interiors and the underground subway are not done
  yet: the station entrances are sealed. Doors, elevators, generators and loot are
  interactive-object work for later stages.
