# How to make a level

Open the editor: `?editor=1` in the game URL, or **F4** in the game. It opens your last level, or
the sample, `levels/yard.level.json`.

| Key / mouse                        | Does                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------- |
| 1 select                           | Click to select, drag to move (snapped), **Del** deletes, **R** rotates 15° |
| 2 place                            | Pick from the palette (built from the registries), click to place           |
| 3 zone                             | Drag a rectangle: a spawn zone (mobs and population in the inspector)       |
| 4 patrol                           | Click points, **Enter** to finish; assign it to a mob in the inspector      |
| 5 terrain                          | Raise, lower, flatten, paint; drag for a stroke                             |
| 6 decor                            | Drag to scatter props, **Shift** to erase                                   |
| Right drag / Shift+right or middle | Orbit / pan; wheel zooms; **F** frames the selection                        |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y      | Undo, redo (a whole drag or stroke is one step)                             |
| G                                  | Grid: 1 m, 0.5 m, off, 2 m                                                  |
| P                                  | Play from here: the real game, bodycam and all, where the camera looks      |

The **checks** panel updates as you work. Click an issue to fly to it. Errors:

- a stuck spawn or mob (inside geometry);
- a story object nobody can reach;
- a patrol with no path;
- a spawn zone with no reachable ground;
- broken references.

Warnings:

- a mob walled off from the player;
- walled-off pockets of floor;
- budgets.

Quests, logs, radio calls and triggers are the level's **story**: edit them as JSON in the level
panel (the schema is the stage-8 one, see [adding-a-quest.md](adding-a-quest.md)), then place
interactables from the palette's `story:` entries.

To ship a level:

1. **Export** it and put the file in `levels/` as `<id>.level.json`.
2. Run `npm run level:check`. CI runs it too: the file must be canonical (exactly as the editor
   exports it) and have no errors.
3. Commit it. The JSON diffs line by line, so a moved crate is a one-line change.

Format changes go through a new version in `src/domain/level/level.ts` with a migration in
`parseLevel` (see v1 → v2).
