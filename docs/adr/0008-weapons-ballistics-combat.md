# ADR-0008: Weapons, ballistics and combat

- Status: Accepted
- Date: 2026-11-08

## Context

Stage 4 adds realistic weapons. The requirements cover:

- ballistics, recoil patterns and spread;
- wear and jams, and reloads that know whether a round is chambered;
- synthesised sound, effects and procedural animation;
- hits per body part with race-specific vulnerabilities;
- melee and throwables (flares, grenades, improvised devices).

Combat must be deterministic and replayable like the rest of the simulation.

## Decision

**Data.** `domain/weapons/registry.ts` holds ammo, weapons and attachments, all Zod-validated.
Ballistic numbers come from published data. The drag constant `k = ½ρC_dA/m` is fitted so retained
velocity at range matches references (5.56: 930 → ~680 m/s at 300 m; .308: 850 → ~600 m/s at
500 m). Each weapon also carries:

- its recoil pattern, spread model and wear/jam curve;
- reload timings and gunshot timbre;
- the procedural model parts with grip, support, muzzle and ejection anchors.

**Ballistics** (`domain/weapons/ballistics.ts`) uses a point mass with gravity plus quadratic drag,
integrated with RK2 midpoint in 4 substeps per tick. Midpoint is exact for constant acceleration,
so the drag-free case matches the analytic parabola; with drag it is second-order and within 2 mm
of a 100× finer reference at 300 m. Weapons are zeroed by bisection on the bore angle (sight height
above bore, zero distance). Spread is a uniform cone (aim, hip, moving, bloom, wear) sampled from
the simulation's `weapons` RNG stream.

**Weapon state machine** (`domain/weapons/weapon-state.ts`) is pure, with `phase` as the
discriminant (ready, cycling, reloading[stage], jammed, clearing, drawing, swinging), covering:

- **Chamber:** tracked separately from the magazine (17+1); a tactical reload keeps the chambered
  round and returns the partial magazine to the pouch; an empty reload ends with chambering.
- **Actions:** tube-fed shotguns reload shell by shell (the trigger interrupts); bolt and pump
  actions cycle manually.
- **Jams:** probability `jamBase + (jamAtFullWear − jamBase)·wear²`; the reload key clears a jam
  and the stuck round is lost.
- **Recoil:** patterns loop from `loopFrom` and recover proportionally.

Output is a bitmask of events, so ticks allocate nothing. Stored in the ECS as `WeaponItem` rows.

**Projectiles** are entities. Each tick they integrate, then sweep the tick's segment against world
geometry (Rapier ray with normal) and target hitboxes, and the nearest hit wins. Damage is
`base × falloff(distance) × race type vulnerability × part multiplier`. Hit events report distance,
drop below the bore line and time of flight (the range's ballistics log). Pellets are separate
projectiles.

**Hitboxes** (`domain/combat/hitboxes.ts`) are per-race archetypes made of spheres, capsules and
boxes. Exact ray tests are property-checked against brute-force marching.

**Races** (`domain/combat/races.ts`):

- zombie headshots ×4, light ×3, EMP ×0;
- robot chassis armour ×0.5 with fragile cameras ×3 and EMP ×6;
- plants ×4 vs fire with the bulb as weak point;
- animals ordinary.

**Throwables** bounce off world geometry and bodies (restitution), with fuses or shatter-on-impact
(Molotov). Explosions do radial damage with line-of-sight cover (25% behind walls). Flares and fires
leave `Hazard` entities that deal light or fire damage over time; light hurts only what fears it.

**Presentation.** Combat events (shot, hit, impact, explosion, weaponFx) are consumed after every
tick by the presenter and the weapon audio.

- **Viewmodel:** a separate depth-cleared pass, so the weapon never clips into walls, with
  procedural sway, bob, ADS, recoil springs and part animations. The springs are semi-implicit with
  fixed 1/240 s substeps; explicit steps exploded below about 15 fps (caught in SwiftShader). Two-bone
  IK puts the hands on the grip and support anchors.
- **World effects:** pooled, so there is no allocation or shader recompile when an effect appears
  (lights stay in the scene at zero intensity, and effect shaders are compiled during warm-up).
- **Sound:** synthesised (crack, blast body, thump, mechanism; suppressed variant; mechanics;
  surface impacts with ricochet; casings; explosions) and unit-tested, then played spatially with
  air absorption and the geometry reverb.

**Debug range.** `?scene=range` is a 320 m floodlit lane with each race's dummies at 10, 25, 50, 100,
200 and 300 m and infinite ammo. The Range tab offers weapon buttons, a hit log (distance, part,
damage, drop, flight time), bullet paths and target reset. The debug API injects ordinary input
commands through a `CommandQueue`, so tool-driven sessions stay replayable.

**Acceptance.**

- `src/domain/weapons/ballistics.test.ts` covers the analytic, closed-form, convergence and
  real-world checks.
- `tests/integration/range.test.ts` covers headshots, holdover at 300 m, armour vs camera, pellets,
  explosives and limited ammo.
- `tests/golden/range-replay.test.ts` is a bit-exact combat replay.
- `e2e/range.spec.ts` drives the range in the browser.

## Consequences

- Ballistic penetration and ricochet trajectories are not simulated (impacts end the projectile;
  the ricochet is sound only).
- Wind drift is not modelled yet (weather arrives in stage 5; the integrator takes acceleration
  terms, so wind is one more).
- Attachments exist as data, but only the light is visible; suppressor and optic effects on sound
  and spread are data hooks for the loadout UI later.
- Rapier's JS wrapper allocates per character move (about 85 minor GCs per million ticks). The
  perf budget documents this; our own systems allocate nothing per tick.

## Amendment: gunshot audio fix and the RPG-7

**Gunshot audio.** Two defects were found by inspection and measurement:

- **Playback:** the player's own shots and reload clicks went through the HRTF panner at a point
  centimetres below the listener, which renders as "below the chin". They now use
  `AudioEngine.playLocal`: head-locked, slightly panned, still feeding the geometry reverb. Other
  shooters will use the 3D path.
- **Synthesis:** all firearms shared one envelope (a noise puff 5 dB down after 5 ms, RMS about 0.12
  over 300 ms). Shots are now layered by physical cause: snap, bark around the weapon's body
  frequency, falling thump, a darkening tail whose length scales with cartridge energy, and two slap
  echoes. The sum goes through a soft clipper for density (RMS 0.20–0.34). Unit tests lock in the
  density, the immediate attack, and the caliber-ordered tails.

**RPG-7.** Added purely through the registry plus one projectile type:

- **Data:** `projectile: { kind: 'rocket', thrust, ignite, burnout, armMeters, fuseSeconds,
explosion }` on firearms (default `bullet`), a caseless `pg7v` ammo entry, a `single` action (one
  round in the tube, nothing to cycle) and a `warhead` model role.
- **Flight:** `integrateRocket` applies thrust along the velocity during the burn window, then drag
  and gravity. Launch is 115 m/s and the peak about 295 m/s. Zeroing flies the same function at the
  simulation tick, so sights match flight.
- **Terminal effects:** a direct hit does 600 damage. An armed rocket explodes (5 m radius, 220
  damage, the same cover rules as grenades). Inside 5 m it is a dud, and it self-destructs at 4.5 s.
- **Loadout:** an 11th slot (the `-` key). Weapon ids are appended, so indices recorded in older
  replays stay valid.

Backblast is visual and audible only; it does not yet damage what stands behind the shooter.
