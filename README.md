# War

A realistic first-person survival shooter for the browser, shown as **chest-mounted bodycam
footage** at night. A semi-open world of hub zones, four hostile races (zombies, robots, plants,
animals) and a story told through found logs, radio chatter and camera recordings.

**Play it:** <https://bandiwor.github.io/war/> (desktop: click to capture the mouse; phones and
tablets get on-screen controls, best in landscape).

**Everything is generated in code**: no texture, model or sound files. The simulation is fully
deterministic: seed + input commands + tick number ⇒ identical world state, verified by golden
replays.

> Status: **stage 8, the story.** You are KESTREL-2, the last of a recovery team sent into the
> Varn quarantine zone. The campaign runs five chapters across the five hubs and ends in one of
> three endings. It is told over the radio (subtitled, with a synthesised radio voice), in found
> notes, audio logs and other people's bodycam recordings, and kept in a journal (J). The story
> is data: quests, objectives, triggers, logs, radio and interactables, all validated, with every
> race's origin, motive and weakness told in some log. Saves (F5 quicksave, F9 quickload,
> autosave at each chapter) are versioned JSON with migrations. Replays can start from a save.
> Story: [docs/lore/story.md](docs/lore/story.md).
> Previously: **stage 7, the races.** Zombies hunt by smell through a diffusing pheromone field,
> recruit each other with alarm scent and flee light. Animals have hunger, fear, packs and
> territory, warn before they attack and fear the flashlight. Plants bite, spit acid that pools
> and burns, and creepers leap and latch on until shaken off. Robots see through cameras you can
> blind, share sightings over a network, flank, take cover, call reinforcements, chase flares,
> and their radio interference disturbs the bodycam. Each race has its own looks in code (fungus
> and rags, wheels and tally lights, jaws and L-system vines, tusks and tails) and its own sound
> signature. Lore: [docs/lore/races.md](docs/lore/races.md).
> Previously: **stage 6, AI and bestiary.** Eight placeholder mobs (two per race), all registry data.
> A utility AI senses you (camera cones that need light, hearing, short-range scent), remembers
> where you were, searches, chases, attacks and flees. Mobs path around obstacles on a
> deterministic nav grid within fixed per-tick budgets, and the open world populates itself zone
> by zone. The debug bestiary lists every mob, weapon, effect and material automatically, with a
> test stage (orbit, animations, slow motion, bones, hitboxes, vision cone). Registry edits
> hot-reload into the running game.
> Previously: **stage 5, the open world.** A 512 m world of five hub zones (abandoned city, industrial
> yards, subway station, forest, research complex) joined by roads, generated chunk by chunk from
> the seed and streamed around you. Colliders stream deterministically in the simulation, and
> meshes are built in Web Workers within a per-frame budget. A dusk-to-night clock and drifting
> weather (fog, rain, wind) change the light, the fog, the lens and the soundscape.
> Previously: **stage 4, weapons.** Registry-driven firearms, melee and throwables with drag ballistics,
> chamber-aware reloads, jams, recoil patterns, per-race hit zones, synthesized gunshots, and a
> debug shooting range (`/?scene=range`). Previously: **stage 3, audio.** A procedural soundscape in an AudioWorklet (wind, hum, insects, drips,
> creaks, rumble…) that changes with zone, night, danger and health, reverb computed from the
> surrounding geometry, occlusion, and distant events (feral dogs, sirens, robot radio).
> Previously: **stage 2, physics and player.** A Rapier-driven first-person body (walk, sprint with
> stamina, crouch, jump, curb step-ups) with synthesized footsteps per surface, and replays
> verified by a golden physics replay. Previously: **stage 1, rendering and bodycam.** A procedural night street (PBR materials baked from
> seeds in Web Workers), a flashlight, and a 15-module bodycam post stack driven by gameplay stimulus,
> all toggleable from the debug menu. See [the plan](#roadmap).

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL and click to capture the mouse.

| Input        | Action                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Mouse        | Look                                                                                            |
| W A S D      | Walk                                                                                            |
| Shift        | Sprint (drains stamina)                                                                         |
| Space        | Jump                                                                                            |
| Left mouse   | Fire / swing / throw                                                                            |
| Right mouse  | Aim down sights (rifle: 6× optic)                                                               |
| R            | Reload (also clears a jam)                                                                      |
| 1–9, 0, -    | Select weapon slot (`-` is the RPG-7); mouse wheel / B for next / fire mode                     |
| Left Ctrl    | Crouch (hold; you stay down under low ceilings)                                                 |
| F            | Flashlight on/off (drains the battery shown in the OSD)                                         |
| E            | Use (take a log, start a generator, access a terminal) when the prompt shows                    |
| J            | Journal: chapter, tasks, every log found                                                        |
| F5 / F9      | Quicksave / quickload (autosave at each new chapter; `?load=quick` or `?load=auto`)             |
| <kbd>~</kbd> | Debug menu (dev builds only): Sim · Render · Bodycam · Range · World · Story · Bestiary · Audio |

On a phone or tablet the game shows touch controls. It also starts at `?quality=low`.

| Touch              | Action                                              |
| ------------------ | --------------------------------------------------- |
| Left half: drag    | Walk (a floating stick appears under your thumb)    |
| Right half: drag   | Look (dragging from FIRE also aims while you shoot) |
| FIRE               | Fire (hold)                                         |
| AIM · DUCK · RUN   | Toggles: aim down sights, crouch, sprint            |
| R · JUMP · USE     | Reload, jump, use                                   |
| WPN · MODE · LIGHT | Next weapon, fire mode, flashlight                  |

Use `?touch=1` to force the touch controls on (for example, to try them on a desktop) and `?touch=0` to force them off.

The game opens in the streamed open world. `?scene=street` loads the fixed stage-1 test street and
`?scene=range` the shooting range. In dev builds, the debug menu's **World** tab sets the clock
and its speed, overrides fog, rain and wind, teleports you to any hub, and draws the chunk
overlay: green chunks are solid in the simulation, amber ones are only drawn.

Mobs hurt you. Hits and nearby threats show in the footage (red tint, shake, tunnel vision)
and in the soundscape. At zero health you go down and respawn at the start. The **Bestiary**
tab has god mode, noclip and heal; overlays for mob senses, paths and the nav grid; and the
nearest mob's live utility scores. See [adding a mob](docs/guides/adding-a-mob.md).

Useful URL options (see `src/presentation/url-options.ts`): `?seed=N`, `?quality=low|medium|high`,
`?fx=none|all|bloom,vignette`, and `?stim=damage:0.5,fear:0.3,emi:0.8` to preview the look reacting to
gameplay.

```bash
npm run headless -- --seed 42 --ticks 216000 --scene world
```

That simulates one hour of game time in Node and prints the state hash and throughput.

## Scripts

| Script                  | What it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run dev`           | Vite dev server with HMR                                         |
| `npm run build`         | Typecheck + production build to `dist/`                          |
| `npm run typecheck`     | `tsc --noEmit` (strict)                                          |
| `npm run lint`          | ESLint, type-aware, layer and determinism rules, zero warnings   |
| `npm test`              | Vitest unit, property and golden tests                           |
| `npm run test:coverage` | Same, with coverage thresholds                                   |
| `npm run test:e2e`      | Playwright browser tests                                         |
| `npm run bench`         | Micro-benchmarks (tinybench)                                     |
| `npm run perf`          | CI perf gate: ticks/s floor and zero-allocation (minor GC) check |
| `npm run golden:update` | Regenerate golden hashes/replays (review the diff!)              |
| `npm run ci`            | Every local gate in sequence                                     |

## Architecture

Layers: `domain → application → infrastructure → presentation`, plus a `headless` root. See
[docs/architecture.md](docs/architecture.md) and the [ADRs](docs/adr/README.md).

Guides: [add a system](docs/guides/adding-a-system.md) ·
[add a bodycam effect](docs/guides/adding-an-effect.md) ·
[add a material](docs/guides/adding-a-material.md) ·
[add a zone soundscape](docs/guides/adding-a-zone-soundscape.md) ·
[add a weapon](docs/guides/adding-a-weapon.md).

## Roadmap

0. ✅ Skeleton: strict TS, lint, tests, CI, deterministic PRNG and fixed-step loop
1. ✅ Rendering and bodycam post-processing
2. ✅ Physics and player controller, input replays
3. ✅ Procedural audio engine
4. ✅ Weapons
5. ✅ World streaming, time of day, weather
6. ✅ AI core, bestiary, HMR
7. Races: zombies → animals → plants → robots
8. Story, quests, saves
9. Level editor
10. Optimisation and polish
