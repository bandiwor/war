# Stages and their acceptance

The plan from the brief, stage by stage: what the stage delivered, its acceptance criterion, and
the tests that demonstrate it. Every test listed runs in `npm run ci` (unit, property, golden,
perf and level gates) or `npm run test:e2e` (Playwright).

| #   | Stage                   | Acceptance criterion                                                          | Demonstrated by                                                                                                                                                     |
| --- | ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Skeleton                | An empty world ticks deterministically; the state-hash test passes            | `tests/golden/golden.test.ts`, `src/application/simulation.test.ts`, `src/domain/math/prng.test.ts`                                                                 |
| 1   | Rendering and bodycam   | Every post effect toggles from the debug menu; visual tests pass              | `e2e/visual.spec.ts` (+ snapshots), `e2e/boot.spec.ts`                                                                                                              |
| 2   | Physics and player      | Golden replay passes                                                          | `tests/golden/sandbox-replay.test.ts`, `tests/integration/sandbox.test.ts`, `src/domain/player/movement.test.ts`, `e2e/player.spec.ts`                              |
| 3   | Audio                   | Zones sound distinct; synthesis unit tests pass                               | `tests/acceptance/zones-distinct.test.ts`, `src/infrastructure/audio/dsp/*.test.ts`, `e2e/audio.spec.ts`                                                            |
| 4   | Weapons                 | Ballistics tests pass; the debug shooting range works                         | `src/domain/weapons/ballistics.test.ts`, `tests/integration/range.test.ts`, `e2e/range.spec.ts`                                                                     |
| 5   | World                   | Frame budgets hold while streaming                                            | `tests/integration/world.test.ts`, `tests/golden/world-replay.test.ts`, `e2e/world.spec.ts`, perf gate `worldStreaming`                                             |
| 6   | AI core and bestiary    | All placeholder mobs appear in the bestiary automatically                     | `e2e/bestiary.spec.ts`, `tests/integration/ai.test.ts`                                                                                                              |
| 7   | Races                   | Per race: geometry and animation in code, sound signature, AI, scenario tests | `tests/integration/{zombies,animals,plants,robots}.test.ts`, `src/infrastructure/audio/dsp/mob-sounds.test.ts`, `src/infrastructure/render/mobs/mob-models.test.ts` |
| 8   | Story and saves         | Three endings reachable; saves round-trip and migrate                         | `tests/integration/story.test.ts`, `tests/integration/saves.test.ts`, `src/domain/story/*.test.ts`, `src/domain/save/save.test.ts`, `e2e/story.spec.ts`             |
| 9   | Level editor            | Editor on the same engine, undo/redo, play from here, automatic level checks  | `src/domain/level/*.test.ts`, `tests/integration/levels.test.ts`, `e2e/editor.spec.ts`, `npm run level:check`                                                       |
| 10  | Optimisation and polish | Profiling, quality scaling, balance, final run of tests and benchmarks        | `src/domain/perf/governor.test.ts`, `e2e/quality.spec.ts`, `src/domain/balance/balance.test.ts`, perf gate, [performance.md](performance.md)                        |

## Design records

One ADR per stage decision: [ADR index](adr/README.md). The lore that the races and the story
follow is in [lore/](lore/), and the guides for extending the game are in [guides/](guides/).
