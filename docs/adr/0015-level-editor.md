# ADR-0015: The level editor, level format and automatic level checks

- Status: Accepted
- Date: 2026-11-11

## Context

Stage 9 adds a level editor, built into the game. The brief requires it to:

- switch between game and editor;
- use the same engine, registries and serialisation as the game;
- place and move objects, mobs, lights, triggers, spawn zones, patrol paths and quest triggers;
- offer terrain and decor brushes;
- support undo/redo and grid snapping;
- preview with real lighting and the bodycam shaders;
- store levels as versioned JSON with a schema, validation, migrations and diff-friendly output;
- test a level with one button ("play from here");
- run automatic checks: reachability and no stuck spots.

## Decision

**A level compiles to the layout the engine already runs** (`domain/level/compile.ts`).

- Every scene in the game is a `StreetLayout`: boxes, blockers, props, lights, zones, spawn. A
  level is compiled to one, so colliders, the nav grid, the renderer and the soundscape need
  nothing level-specific. This is what "the same engine" means here.
- **Terrain** is a 2 m grid of height digits (0–9 × 0.15 m) and palette materials. Cells of
  equal height and material merge greedily into few boxes. Heights up to 0.3 m are floor the
  player steps onto; 0.45 m and above is a raised block (a wall, a dock). The player's step
  height and the nav grid's floor threshold already agreed on this line.
- **Objects** become boxes, **decor** becomes props, **lights** become lights, and invisible
  walls close the edges.
- **Mobs**, **patrol paths**, **spawn zones** and the **story** (quests, logs, radio,
  interactables, triggers; the stage-8 schema) ride along as `LevelContent`.

**Format** (`domain/level/level.ts`, version 2).

- Zod-validated.
- `parseLevel` migrates v1 (a flat floor, no patrols) and validates every step.
- `serializeLevel` is canonical and diff-friendly: two-space JSON, one terrain row per line, short
  numeric arrays on one line, entities in authoring order, −0 written as 0. Moving a crate is a
  one-line diff.
- `levels/*.level.json` must be canonical (CI checks this).

**Editing is the command pattern** (`domain/level/editor.ts`, pure, no DOM).

- `EditorDocument` executes commands with exact `do`/`undo`: `AddEntity`, `RemoveEntity`,
  `UpdateEntity`, `PaintTerrain`, `SetField`, `Batch`.
- Commands that share a merge key merge into one undo step: a drag, a brush stroke.
- History is bounded at 300 steps.
- Snapping to a 0.5, 1 or 2 m grid and 15° angles.
- A terrain brush (raise, lower, flatten, paint) and a seeded decor brush (scatter with spacing,
  plus an eraser).
- Picking.
- A property test shows that any sequence of edits undoes and redoes byte for byte.

**Engine support** (`application/level`).

- Placed mobs spawn at level load.
- A patrolling mob's `wander` follows its path: loops go round, open paths go back and forth.
- A `level.spawn` system keeps each zone topped up, deterministically, never within 12 m of the
  player.
- `createLevelSandbox(level, physics, from?)` is "play from here".

**Checks** (`domain/level/checks.ts`) run live in the editor, in tests and in CI
(`npm run level:check`, part of `npm run ci`).

- References: duplicate ids, unknown patrols, terrain shape and palette, story validation, bounds.
- Budgets: lights, merged boxes, mobs, decor.
- Navigation, on the game's own nav grid with the A* neighbour rule. Connected components of
  walkable 1 m cells are found and then:
  - a spawn inside geometry is a stuck player;
  - a mob inside geometry is stuck;
  - a mob walled off from the player is unreachable;
  - an interactable whose reach has no reachable cell is an error;
  - a spawn zone with no reachable ground is an error;
  - every patrol leg is searched with the mobs' A*;
  - walled-off walkable pockets (≥ 4 m²) are reported.

**The editor UI** (`presentation/editor`, `infrastructure/render/editor`).

- It is a code-split chunk loaded by `?editor=1`. F4 switches between game and editor.
- Palettes come from the registries: `MOB_IDS`, prop and light kinds, interactable kinds,
  `MATERIALS`, zones.
- The viewport builds the level with the game's `buildStreetScene` and the game's baked
  materials. Placed mobs show as their real models.
- "Night" mode lights the level with its own lamps only (real lighting). The full bodycam look is
  "play from here", which reloads into the real game on the level, starting where the editor
  camera looks (or at the spawn if that spot is not walkable).
- The inspector edits any entity as JSON, validated through the level schema, plus quick fields.
- The story is edited as JSON with the story schema.
- Changes autosave to localStorage. Export and Open handle files.

## Consequences

- One path from the editor to play, and no second engine.
- An edit that changes geometry rebuilds the editor's scene, which takes milliseconds for levels
  of this size. Overlays are rebuilt on every change.
- Sessions played from the editor are not recorded as replays: a level is not one of the
  replayable scenes yet. Recording the level itself in the replay is the obvious extension.
- Terrain is a heightfield of low steps, not sculpted hills. That keeps the colliders, the nav
  grid and the player controller in exact agreement.
