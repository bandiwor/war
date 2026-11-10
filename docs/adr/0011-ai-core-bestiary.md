# ADR-0011: AI core, navigation, spawning, bestiary and registry hot reload

- Status: Accepted
- Date: 2026-11-10

## Context

Stage 6 adds the AI pipeline from the brief (perception → memory → decision → movement →
animation). It also adds spawning, a bestiary built automatically from the registry, and hot
reload of registry data.

Stage 6 ships one placeholder per mob idea, two per race. Each race gets its real behaviour in
stage 7: zombie pheromones and light fear, robot networks and tactics, plant leaps and
attachment, animal needs and packs.

The AI must be deterministic, testable through scenario tests and replays, fast (spatial
queries, time slicing, LOD, budgets) and free of allocations in its hot paths.

## Decision

**Mobs are data.** `domain/mobs/registry.ts` defines each mob with a Zod-validated entry:

- race, lore line;
- body: scale, radius, speeds, turn rate, eye height;
- health scale;
- senses: sight cone with range, field of view and how much light it needs; hearing multiplier;
  close-range proximity;
- memory: forget time, search time;
- attack, temperament;
- a weight per utility action;
- spawn rules: zones, weight, group size, night preference;
- animations and look.

A mob's body is the combat `Target` component, so weapons, hitboxes and race vulnerabilities
apply to mobs with no AI code. Hitboxes gained a scale factor for mobs of different sizes.

**Decision-making: utility AI, not behaviour trees.**

- Utility AI suits a registry-driven game. Each action (idle, wander, investigate, chase, attack,
  search, flee, home) scores itself from a handful of normalised inputs: awareness, sensing,
  distance, reach, health, search time left, distance from home.
- The registry's weights reshape behaviour per mob without code; zero turns an action off.
- The bestiary can show the live scores, so tuning is visible.
- A small inertia bonus stops dithering. A behaviour tree would put structure in code that a data
  entry cannot change.
- The scoring functions (`domain/ai/utility.ts`) are pure and unit-tested rule by rule. Stage 7
  adds race-specific inputs and actions, not a new architecture.

**Perception and memory** (`domain/ai/perception.ts`, `application/ai/systems.ts`):

- _Sight_ is a cone with a range. Light-dependent eyes see less in the dark: the player's
  flashlight and sky light matter, and fog shortens all sight. A line of sight is a physics ray.
- _Hearing_ reacts to the tick's footstep, landing, gunshot and explosion events, scaled by the
  weather's masking.
- _Proximity_ works through walls and darkness (a stand-in for zombie pheromones in stage 7).
- _Being shot_ tells a mob where the shooter is.
- Sudden events (a hit, a noise) set awareness at once. Steady senses build it up, and it fades
  over the mob's forget time.
- Memory keeps the last known position. On arrival the mob searches nearby for its search time,
  then gives up.

**Navigation: a deterministic nav grid, not recast-navigation.** The brief names
recast-navigation. We chose a nav grid (`domain/nav/`) because:

- the world is flat and made of axis-aligned or slightly rotated boxes and round props;
- streaming chunks map one-to-one onto grid tiles;
- the grid is rasterised from exactly the content that becomes colliders (floors, curbs,
  obstacles inflated by the agent radius, headroom under roofs), so navigation and physics never
  disagree;
- it is pure TypeScript, bit-identical everywhere, needs no WASM initialisation, and unit- and
  property-tests in Node.

Searching uses A* on 1 m cells, 8-connected without corner cutting, inside a 96 m window, with
deterministic tie-breaking and string-pulled waypoints.

The grid is replaceable behind the same calls (`walkable`, `find`) if multi-level interiors (the
subway underground, building floors) need a real navmesh later. That decision belongs to the
stage that adds those levels.

**Movement:**

- mobs follow waypoints and replan when the goal moves or the grid changes;
- they keep apart from each other through a spatial hash;
- turning is rate-limited, and they move slower while turning;
- they slide along walls and stand on the grid's floor height.

They are not physics bodies. This is cheap, and it is enough until mobs need ragdolls or
pushing.

**Budgets are counts, not milliseconds.** Time-based budgets would make results depend on the
machine. Per tick, the AI may cast 24 sight rays and expand 4,000 A* nodes (at most 1,500 per
search); unserved work waits for a later tick.

Time slicing and LOD:

| Distance to player | Sight checks   | Decisions      |
| ------------------ | -------------- | -------------- |
| Within 40 m        | every 4 ticks  | every 10 ticks |
| 40–90 m            | every 16 ticks | every 30 ticks |
| Beyond 90 m        | frozen         | frozen         |

Mobs are staggered by row, and a decision is made at once when something changes.

**Zero allocation in practice.** Per-mob work lives in small functions: V8 then inlines the maths
helpers, which return boxed numbers when they are not inlined. AI loops read typed arrays
directly, and scratch objects are reused. What remains is Rapier's ray wrapper and occasional
non-inlined trig. The perf gate measures it: 64 mobs at ~13k ticks/s, slowest 0.1% of ticks
~0.7 ms (budget 2 ms).

**Spawning.**

- `spawn` commands put any registry mob on walkable ground. The debug menu and tests use them,
  and replays record them.
- In the open world a spawner keeps 12 living mobs around the player. It spawns groups 28–55 m
  away, choosing the mob by the zone at that point, the registry weights and night preference.
- It clears corpses after 25 s, mobs that stay more than 80 m away for 8 s, and mobs standing on
  unloaded ground.

**Player vitals.**

- Attacks reduce the player's health.
- Damage and nearby aware hostiles drive the bodycam's damage and fear looks, and the
  soundscape's danger, proximity and health.
- At zero health the player goes down for 3 s and respawns at the scene's start.
- Cheats are commands: god mode, noclip, heal.

**Bestiary (debug menu).**

- It lists every mob, weapon, effect and material from the registries.
- A test stage with its own WebGL view shows the selected mob: orbit camera, any animation, slow
  motion, bones, hitboxes and vision cone.
- In the world:
  - spawn the selected mob in front of you;
  - overlay sense cones, paths and the nav grid;
  - inspect the nearest mob's action, awareness and utility scores.
- Models are placeholders built from each race's hitbox archetype on a small bone rig and
  animated procedurally, so what you see is what bullets hit.

**Hot reload.** The mob and weapon registries accept their own Vite HMR updates. The
new module's validated data is deep-patched into the live registry object, so every reference the
game holds stays valid and a running game picks up new speeds, senses, weights or ballistics
without reloading or losing state. Adding or removing an id (ECS columns index by id) falls back
to a reload.

This is the one place the domain touches the build tool: `import.meta.hot` is undefined in Node
and removed from production builds. Vite only recognises the literal `import.meta.hot.accept(`
call, so it is written out in full. Hot changes are dev-only and do not record into replays.

## Consequences

- Golden hashes and replays were regenerated. Two new component stores (`Mob`, `PlayerVitals`)
  enter every scene's hash, and the open world now holds mobs. The replays' semantic checks
  (surfaces, kills, streaming) still pass unchanged, so the street and range behave exactly as
  before.
- Mobs' paths live in a side table (derived, recomputable state) rather than ECS columns, so
  they are not in the state hash. Divergence would show in positions within ticks, and saves
  (stage 8) can recompute them.
- Not done yet:
  - pheromone fields, robot networks and tactics, plant leaps, animal needs and packs: stage 7;
  - workers for AI batches: the simulation must stay single-threaded and deterministic; a worker
    could precompute advisory data (for example flow fields) later;
  - a typed command console.
