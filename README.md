# War

A realistic first-person survival shooter for the browser, shown as **chest-mounted bodycam
footage** at night. A semi-open world of hub zones, four hostile races (zombies, robots, plants,
animals) and a story told through found logs, radio chatter and camera recordings.

**Play it:** <https://bandiwor.github.io/war/> (desktop: click to capture the mouse; phones and
tablets get on-screen controls, best in landscape).

**Everything is generated in code**: no texture, model or sound files. The simulation is fully
deterministic: seed + input commands + tick number ⇒ identical world state, verified by golden
replays.

All eleven stages of the plan (0–10) are done. [docs/stages.md](docs/stages.md) lists each
stage, its acceptance criterion and the tests that demonstrate it.

**What is in the game**

- **Bodycam footage.** A night world lit by your flashlight, lamps, emergency beacons and
  bioluminescence. It is seen through 15 post-processing modules (fisheye, rolling shutter,
  compression, signal loss, an on-screen display…) that react to damage, fear and the robots'
  radio interference.
- **A semi-open world.** Five hub zones (abandoned city, industrial yards, subway station,
  forest, research complex) are generated from the seed and streamed in chunks. A clock runs
  from dusk into night, and fog, rain and wind change what you see and hear.
- **Four races.** Each has its own AI, looks and sound, defined in the lore:
  - zombies hunt by smell through a pheromone field and flee light;
  - robots see through cameras, network, flank and take cover;
  - plants bite, spit acid and leap onto you;
  - animals have hunger, fear, packs and territory.
- **Weapons.** Real ballistics, recoil, chamber-aware reloads and jams. Damage depends on body
  part and race. Balance is checked against design targets; see
  [docs/balance.md](docs/balance.md).
- **A story.** Five chapters and three endings, told over the radio, in found logs and in other
  people's camera recordings. There is a journal, and versioned saves with migrations.
- **A level editor built into the game** (`?editor=1`, F4). Levels are diff-friendly JSON, and
  automatic checks cover reachability and stuck spots. "Play from here" drops you into the level.
- **Automatic quality scaling.** Resolution drops first, then shadows, then costly post effects,
  to hold the frame budget. A profiler times every simulation system.
  [docs/performance.md](docs/performance.md) has the measurements.

Lore: [the story](docs/lore/story.md) · [the races](docs/lore/races.md).

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
| F4           | Switch between the game and the level editor                                                    |
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

| Script                  | What it does                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`           | Vite dev server with HMR                                                                     |
| `npm run build`         | Typecheck + production build to `dist/`                                                      |
| `npm run typecheck`     | `tsc --noEmit` (strict)                                                                      |
| `npm run lint`          | ESLint, type-aware, layer and determinism rules, zero warnings                               |
| `npm test`              | Vitest unit, property and golden tests                                                       |
| `npm run test:coverage` | Same, with coverage thresholds                                                               |
| `npm run test:e2e`      | Playwright browser tests                                                                     |
| `npm run bench`         | Micro-benchmarks (tinybench)                                                                 |
| `npm run perf`          | CI perf gate: ticks/s floor and zero-allocation (minor GC) check                             |
| `npm run profile`       | Per-system timings and a CPU profile of a heavy headless scenario (`-- world\|crowd\|level`) |
| `npm run balance`       | Regenerate the balance sheet (`docs/balance.md`) from the registries                         |
| `npm run level:check`   | Automatic checks over every shipped level (`levels/*.level.json`)                            |
| `npm run golden:update` | Regenerate golden hashes/replays (review the diff!)                                          |
| `npm run ci`            | Every local gate in sequence                                                                 |

## Architecture

Layers: `domain → application → infrastructure → presentation`, plus a `headless` root. See
[docs/architecture.md](docs/architecture.md) and the [ADRs](docs/adr/README.md).

Guides: [add a system](docs/guides/adding-a-system.md) ·
[add a bodycam effect](docs/guides/adding-an-effect.md) ·
[add a material](docs/guides/adding-a-material.md) ·
[add a zone soundscape](docs/guides/adding-a-zone-soundscape.md) ·
[add a weapon](docs/guides/adding-a-weapon.md) · [add a mob](docs/guides/adding-a-mob.md) ·
[add a quest](docs/guides/adding-a-quest.md) · [make a level](docs/guides/adding-a-level.md).

## Stages

0. ✅ Skeleton: strict TS, lint, tests, CI, deterministic PRNG and fixed-step loop
1. ✅ Rendering and bodycam post-processing
2. ✅ Physics and player controller, input replays
3. ✅ Procedural audio engine
4. ✅ Weapons
5. ✅ World streaming, time of day, weather
6. ✅ AI core, bestiary, HMR
7. ✅ Races: zombies → animals → plants → robots
8. ✅ Story, quests, logs and radio, endings, saves with migrations
9. ✅ Level editor with automatic checks
10. ✅ Optimisation and polish: profiling, quality scaling, balance, final run
