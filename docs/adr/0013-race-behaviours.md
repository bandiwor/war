# ADR-0013: Race behaviours, sound signatures and looks

- Status: Accepted
- Date: 2026-11-10

## Context

Stage 7 turns stage 6's placeholders into four races that play differently, one at a time:
zombies, then animals, then plants, then robots. Each race needs:

- its own way of sensing and deciding;
- geometry and animation in code;
- a sound signature;
- scenario tests;
- a style that follows the lore (`docs/lore/races.md`).

Everything stays deterministic, allocation-free in hot paths and inside per-tick budgets. A race
remains registry data (ADR-0011), so its new behaviour has to be fields, not code paths keyed on
mob ids.

## Decision

**Race behaviour is registry fields read by shared systems.** The schema gains the following
fields; the AI systems read only these, never a mob id:

- `senses.pheromone`
- `ranged` (laser, spit, leap)
- `temperament.lightFear`, `territory`, `pack`, `hunger`
- `tactics` (network, flank, cover, reinforce)
- the `warn` utility action
- `look.form`

**Zombies: the pheromone field** (`domain/ai/pheromone.ts`).

- Two channels on 2 m cells in a 48×48 window that follows the player:
  - prey scent: the player, scaled by bleeding and running;
  - alarm: laid by zombies that have prey.
- Explicit diffusion and decay, stepped every 4 ticks.
- Walls are closed cells, so scent goes around them.
- Only the occupied bounding box is stepped.
- Deposits are divided by cell area.
- The field runs only while a pheromone-led mob is within the far LOD.
- Zombies climb the prey gradient. With no prey in the nose, they climb the alarm gradient: this
  recruitment is the emergent crowd behaviour.
- The field is part of the state hash (`hashExtras`).

**Light** (`application/ai/light-map.ts`).

- A light map sums:
  - static lamps, binned per chunk;
  - sky light;
  - burning flares;
  - the flashlight cone.
- Light-shy mobs refuse steps onto brighter ground where `light × lightFear > 0.5`.
- The flashlight beam (power, distance, cone) adds panic: flee score ∝ light², and the flee goal
  is the darkest nearby point.

**Animals: drives as a pure function** (`domain/ai/drives.ts`, `effectiveAggression`). It combines:

- hunger;
- packmates;
- provocation;
- territory;
- night;
- fear, from wounds, gunfire, the beam and lost packmates.

`drivesSystem` runs between perceive and decide. It shares a pack's sightings, and feeding
lowers hunger. A target at the territory edge (or sensed with low aggression) scores `warn`
instead of `attack`.

**Ranged attacks are reflexes, not utility actions** (`ranged-system.ts`). They have a range
window and a cooldown:

- laser: needs a facing cone and a clear ray;
- spit: spawns an `Acid` entity, lobbed and landing where the player stood;
- leap: a ballistic hop, then a latch.

`clingSystem` turns the player's struggle (yaw and pitch deltas, jump, use) into progress toward
shaking a creeper off, and a creeper thrown off is stunned. Movement and melee skip mobs that are
leaping, attached or stunned.

**Robots: tactics as two systems** (`tactics-system.ts`).

- `networkSystem` (before decide):
  - blinding from the flashlight in the lens;
  - fear on hits;
  - flare deception;
  - sharing sightings with the same race within `network` metres.
- `tacticsSystem` (after decide):
  - EMI into the player's vitals;
  - a reinforcement call queue: hidden spawns that arrive informed;
  - flank goals for the second and later engaged robot (`hasGoal = 2`);
  - a cover search, using physics rays, for spots out of the player's line of sight.

**Sound signatures** (`infrastructure/audio/dsp/mob-sounds.ts`). They are synthesised offline into
seeded variants, and each race has its own spectral home:

- zombies: breath and noise, no pitch;
- robots: pitched and harmonic;
- plants: dry, high transients;
- animals: low voiced pulse trains through formants.

`MobAudio` plays attacks and ranged events spatially. It also plays ambient calls chosen by
`vocalFor(state)` on per-mob timers, with a calls-per-second budget. Robots' EMI turns into
static in the bodycam's own microphone. Unit tests check that the signatures are distinct
(tonality, spectral centroid, length).

**Looks** (`mob-details.ts`).

- Details per `look.form`, built once per kind and riding on the race rig's bones:
  - zombies: torn clothes and bioluminescent fungus;
  - robots: lens hoods, antennae, tally lights, plus wheels or spider legs;
  - plants: jaws with teeth, a `jaw` bone, root-legs, L-system vines and tendrils with glowing
    buds;
  - animals: snout, ears, ruff, hocks, tusks, a `tail` bone.
- Details carry no hitboxes: bullets still test the archetype shapes.
- `signalMob` blinks robot lights (faster when hunting), makes the sensor sputter while blinded,
  and makes the glow of plants and fungus breathe.
- `MobFx` draws lasers, acid globs and the acid pools read from the `Acid` entities.

**Debug.** The AI overlay adds the pheromone field and the light map. The bestiary inspector shows
each mob's light, scent, hunger, fear, aggression, blindness, network and latch state.

## Consequences

- Every behaviour is pinned by a scenario test: five per race and ten for robots.
  - Zombies: a silent player leaves nothing to smell, trail following around a corner,
    recruitment by alarm, waiting at a lamp's edge, flashlight panic.
  - Animals: territory warning, a fed loner versus a hungry pack, pack calls, provoked or fleeing,
    beam fear.
  - Plants: bite and spit, acid soaking away, leap, latch and struggling free, a dead creeper
    dropping off, the leap's range window.
  - Robots: laser line of sight, network range, flanking, cover (checked with a physics ray),
    reinforcements, blinding, the blind side, flare deception, EMI.
- New behaviour composes from fields. A fire-fearing animal is `lightFear` on an animal, and a
  networked turret is `tactics.network` on a plant.
- Physics rays for lasers and cover allocate inside Rapier's JS wrapper. The perf gate's GC
  budgets went from 800 to 1000 (world) and from 2000 to 2500 (crowd) per million ticks, recorded
  in `perf-budgets.json`. Throughput stays above about 22k ticks/s for the world and about
  10k ticks/s for the 49-mob crowd.
- Sound banks add about 16 sounds × 3 variants of 0.4–2.4 s each at startup; synthesis is
  offline and once.
- Placeholder animation remains procedural; skeletal clips are out of scope.
