# War

A realistic first-person survival shooter for the browser, shown as **chest-mounted bodycam
footage** at night. A semi-open world of hub zones, four hostile races (zombies, robots, plants,
animals) and a story told through found logs, radio chatter and camera recordings.

**Everything is generated in code**: no texture, model or sound files. The simulation is fully
deterministic: seed + input commands + tick number ⇒ identical world state, verified by golden
replays.

> Status: **stage 2, physics and player.** A Rapier-driven first-person body (walk, sprint with
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

| Input        | Action                                                  |
| ------------ | ------------------------------------------------------- |
| Mouse        | Look                                                    |
| W A S D      | Walk                                                    |
| Shift        | Sprint (drains stamina)                                 |
| Space        | Jump                                                    |
| Left Ctrl    | Crouch (hold; you stay down under low ceilings)         |
| F            | Flashlight on/off (drains the battery shown in the OSD) |
| <kbd>~</kbd> | Debug menu (dev builds only): Sim · Render · Bodycam    |

Useful URL options (see `src/presentation/url-options.ts`): `?seed=N`, `?quality=low|medium|high`,
`?fx=none|all|bloom,vignette`, and `?stim=damage:0.5,fear:0.3,emi:0.8` to preview the look reacting to
gameplay.

```bash
npm run headless -- --seed 42 --ticks 216000 --scene sandbox
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
[add a material](docs/guides/adding-a-material.md).

## Roadmap

0. ✅ Skeleton: strict TS, lint, tests, CI, deterministic PRNG and fixed-step loop
1. ✅ Rendering and bodycam post-processing
2. ✅ Physics and player controller, input replays
3. Procedural audio engine
4. Weapons
5. World streaming, time of day, weather
6. AI core, bestiary, HMR
7. Races: zombies → animals → plants → robots
8. Story, quests, saves
9. Level editor
10. Optimisation and polish
