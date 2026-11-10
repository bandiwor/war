# How to add a mob

A mob is one entry in `MOBS` (`src/domain/mobs/registry.ts`). Add one and it appears in the
bestiary, can be spawned, spawns in the world, and is hit by every weapon. No engine changes are
needed.

```ts
ghoul: {
  label: 'Ghoul',
  race: 'zombie',                       // hitboxes, vulnerabilities and base model come from the race
  description: 'One line of lore for the bestiary.',
  body: { scale: 1.1, radius: 0.35, walkSpeed: 0.7, runSpeed: 2.2, turnRate: 2, eyeHeight: 1.7 },
  healthScale: 1.5,                     // × the race's max health
  senses: {
    sight: null,                        // or { range, fovDeg, needsLight } (0 = thermal, 1 = blind in the dark)
    hearing: 0.5,                       // × a noise's radius; null = deaf
    proximity: 6,                       // metres, through walls; null = none
    pheromone: null,                    // zombies: { threshold, alarm } — smell the pheromone field instead
  },
  memory: { forget: 6, search: 8 },     // seconds
  attack: { range: 1.3, damage: 20, cooldown: 1.5 },
  ranged: null,                         // or { kind: 'laser' | 'spit' | 'leap', minRange, range, damage, cooldown }
  temperament: {
    aggression: 1, fleeBelow: 0, roam: 10,
    lightFear: 0.9,                     // avoids lit ground, panics in the flashlight beam
    territory: 0,                       // defended radius: warns at the edge, attacks inside
    pack: 0,                            // courage per packmate nearby
    hunger: 0,                          // hunger per minute (a fed animal rarely attacks first)
  },
  tactics: { network: 0, flank: false, cover: false, reinforce: 0 }, // robots
  utility: { idle: 0.4, wander: 0.5, investigate: 0.8, chase: 1, attack: 1.2, search: 0.6, flee: 0, home: 0.2, warn: 0 },
  spawn: { zones: ['abandonedCity'], weight: 2, group: [1, 3], night: 0.5 },
  animations: ['idle', 'walk', 'run', 'attack', 'hit', 'die', 'alert'],
  look: { color: 0x4a4436, emissive: 0x0b3a2c, form: 'humanoid' }, // form picks the race details (mob-details.ts)
},
```

- **Utility weights** scale each action's score. Watch them live in the debug menu: **Bestiary**
  → _in the world_ → the inspector shows the nearest mob's scores. Zero disables an action (a
  rooted plant has no `wander`). The rules behind each score are in
  `src/domain/ai/utility.ts`.
- **Senses** are what make a race feel different: robots see in a cone and need light, zombies
  sense only up close, animals hear well.
- **Race behaviour** comes from fields, not code (ADR-0013): `senses.pheromone` makes it follow
  scent, `lightFear` makes it shun light, `hunger`/`pack`/`territory` give it animal drives,
  `ranged` gives it a laser, spit or leap, and `tactics` gives it the robots' network, flanking,
  cover and reinforcements. The lore each race follows is in `docs/lore/races.md`.
- **Look and sound**: `look.form` picks the details the model is dressed in, and the race picks
  the voice (`RACE_VOICES` in `src/infrastructure/audio/dsp/mob-sounds.ts`).
- **Spawn**: `zones` are the hub zones it appears in, `night` shifts it toward night (1) or day
  (−1), and `weight` is relative to the other candidates in the zone.

While `npm run dev` is running, edits to an existing entry apply live, without a reload and
without losing state. A new id needs a page reload.

Check it:

1. `npm test`: the schema, `registry.test.ts` invariants, and `mob-models.test.ts`, which builds
   and poses every mob.
2. Debug menu → **Bestiary**: the mob is listed automatically. View it on the test stage (bones,
   hitboxes, vision cone, every animation), then press _Spawn 6 m ahead_.
3. Write a scenario test in `tests/integration/<race>s.test.ts` (shared helpers in
   `tests/fixtures/arena.ts`) for what makes it special, for
   example "the ghoul finds you through a wall at 6 m but not at 8".
