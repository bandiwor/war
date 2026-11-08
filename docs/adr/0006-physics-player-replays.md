# ADR-0006: Physics, first-person controller, events and replays v2

- Status: Accepted
- Date: 2026-11-08

## Context

Stage 2 adds collision and a first-person body. Golden replays (ADR-0003) must keep working with
physics in the loop, in both Node and browsers, and footsteps must sound different per surface.

## Decision

**Engine.** Rapier, via `@dimforge/rapier3d-deterministic-compat`. The deterministic build gives
cross-platform bit-identical results, and the `compat` flavour embeds the WASM, so there's no asset
file and the same import works in Node and Vite. Only `infrastructure/physics/rapier-physics.ts`
imports it. The simulation talks to an application-level `PhysicsPort` (static colliders,
characters, ground surface queries, `hashInto`), and lint forbids `@dimforge/*` in domain and
application.

**Layer rule change.** `headless` may now import platform-neutral infrastructure (physics), but still
not `infrastructure/browser`, `render` or `audio`. Integration tests that need real Rapier live in
`tests/`.

**Character.** A standalone capsule collider driven by Rapier's kinematic character controller
(collide-and-slide, 35 cm autostep, snap-to-ground, 45° slopes, 1 cm skin). Findings:

- Any downward push while grounded stalls the slide for a tick and blocks autostep, so grounded
  vertical motion is exactly 0 and snap-to-ground handles going down.
- A capsule spawned in contact with the floor hitches, so it spawns one skin width up.

**Motor.** `domain/player/movement.ts` is pure and uses `dmath` only:

- walk 1.5, sprint 3.6 and crouch 0.9 m/s, with slower backpedal and strafe;
- acceleration and friction, weak air control, a 0.45 m jump;
- stamina for sprinting and jumping;
- a crouch blend that refuses to stand under a ceiling (a shape-overlap test in the adapter).

`applyFeedback` reconciles velocity with what physics allowed (walls cancel velocity, ceilings
stop upward motion) and reports landings. Tuning is data (`PLAYER_TUNING`, Zod-validated).

**State hash.** `Simulation` takes `hashExtras`. The sandbox adds the Rapier world snapshot, so a
golden checkpoint covers ECS, RNG streams and physics.

**Stepping.** Rapier's JS wrapper allocates on every `world.step()` (measured: about 1.7 minor GCs per
1,000 ticks). With only static colliders and kinematic characters nothing needs integrating, and
collider positions update immediately. So the adapter steps only after colliders change. Dynamic
bodies (later stages) will step every tick and must be re-measured by the perf gate. The remaining
allocation (about 40 minor GCs per million ticks) comes from Rapier's `translation()` getter.

**Events.** `domain/events/bus.ts` has typed, pooled per-tick channels (`footstep`, `land`, `jump`).
The simulation clears them at the start of each tick, and outer layers read them in
`GameLoop.onTick`. Footsteps carry the surface (from a ray below the feet, mapped from collider to
material to surface), intensity, and an AI noise radius (gait × surface loudness) for later stages.

**Surfaces.** `domain/world/surfaces.ts` holds per-surface footstep acoustics as data, and every
material declares its `surface`. `infrastructure/audio/dsp/footstep.ts` synthesises heel and toe
strikes (thump, band-passed click, ringing partials, grit, splash), deterministically from a seed.
It's pure DSP, unit-tested in Node (decay, brightness, splash timing). The browser pre-bakes 6
variants per surface and plays them through HRTF panners with pitch and gain jitter.

**Replays v2.** Replays gain `scene`, and `parseReplay` migrates v1 → v2 (v1 implies `empty`). A
frozen v1 file is kept as a migration fixture. Live sessions always record from tick 0 (black box,
sparse commands plus a hash per second). The debug menu downloads it or loads a file into
`?replay=session` playback, where the OSD shows PLAY. `GameLoop.pauseAtTick` lets tests stop at an
exact tick.

**Acceptance.** `tests/golden/sandbox-route.replay.json` is a 21-second route: walk, step up the curb,
jump, crouch-walk, sprint along the facades, flashlight toggles, step down. It must reproduce all
21 checkpoints. Semantic assertions confirm the route really exercised those behaviours, and
`e2e/player.spec.ts` checks that the browser reaches the same hash at tick 600.

## Consequences

- Props are static colliders for now; kickable or dynamic props come with dynamic-body support.
- Footstep surface is only as fine as collider granularity (the whole road is asphalt; puddles are
  visual). A wetness mask query can come with weather (stage 5).
