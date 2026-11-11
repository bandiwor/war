# ADR-0016: Automatic quality scaling, profiling and balance as tests

- Status: Accepted
- Date: 2026-11-11

## Context

Stage 10 is optimisation and polish: profiling, automatic quality scaling, balance, and a final
run of the tests and benchmarks. The brief's performance target is a stable 60 FPS on a
mid-range laptop with integrated graphics. It asks for per-frame budgets in config, a built-in
profiler and budget limiter, and automatic quality scaling (dynamic resolution, presets).

## Decision

**A pure governor drives quality** (`domain/perf/governor.ts`).

- It is fed one frame cost per frame: GPU time where the browser reports it, else the frame
  interval.
- Decisions are made on time, not frame count: every ~0.5 s of frame time, with at least three
  frames. A machine running at 2 fps therefore reacts within seconds.
- Decisions use the window's mean, so one long frame (GC, shader compile) changes nothing.
- It lowers the internal resolution first, in steps sized to the overload (cost ∝ pixels ≈
  scale²), down to 50% of the preset.
- Then it gives up features in tiers: flashlight shadows, then motion blur and bloom. It changes
  only the effective configuration, never the user's settings.
- It climbs back after several calm decisions.
- **Anti-oscillation:**
  - every change starts a cooldown and a fresh measurement window;
  - a step down leaves a ceiling that decays over 10 s, so the governor does not climb straight
    back into the overload it left.
- A property test shows it stays in bounds and settles under any load model.
- `?auto=0` turns it off. The debug menu shows its state and has a toggle.

**Profiling is built in and deterministic-safe.**

- `Simulation.setProfiler(clock)` times every system with a clock supplied from outside, so the
  simulation still never reads wall-clock time, and timings are observed, never used.
- The debug menu shows the per-system table live.
- `npm run profile` adds a V8 CPU profile (`node:inspector`) of heavy headless scenarios.
- Optimisations must keep the golden hashes. Both stage-10 optimisations did:
  - stepping Rapier's pipeline directly, skipping an O(colliders) JS resync;
  - collecting networked robots once per tick.

**Balance is a model plus targets.**

- `domain/balance` computes exactly what the combat systems compute: shots and seconds to kill
  for every weapon × mob × aim (weak spot or centre mass) × range (5, 20, 60, 150 m), and every
  mob's best damage per second against the player.
- Multi-pellet weapons use a pellet-cone model: the share of pellets landing on a part is its
  cross-section against the cone's at that distance. Without it, the shotgun "one-shots" a
  9 cm lens at 150 m.
- Design targets are tests (`balance.test.ts`):
  - weak spots never take more hits;
  - each race's lore weakness holds (EMP drops robots, molotovs burn plants, light burns only
    zombies, robots are armoured);
  - nothing is immune to guns;
  - each firearm owns a job: the shotgun close quarters, the carbine the middle distance, the
    rifle long range with the fewest shots, the pistol as the reliable sidearm;
  - melee is viable against the dead;
  - no mob kills a full-health player in under 5 s, and no ranged attack out-damages a bite;
  - the campaign's ammunition covers its ambushes.
- The targets forced two changes:
  - plants no longer take light damage (a road flare killed a flytrap, contradicting the lore);
  - shotgun pellets went from 17 to 24 damage (one pump to the chest at room distance).
- `docs/balance.md` is generated (`npm run balance`), and a test fails when it is stale.

**Perf-gate floors are alarms, not budgets.**

- The shared CI container measured the unchanged stage-9 code anywhere from 3.6k to 5.7k
  ticks/s on the crowd scenario.
- Heavy scenarios run twice and keep the better run.
- Throughput floors are set well under the measured values, still above 60× real time.
- The budgets that matter are unchanged: minor GCs per million ticks, and the p99.9 tick inside
  the 2 ms simulation frame.

## Consequences

- On weak hardware the game degrades gracefully instead of stuttering. On strong hardware the
  governor does nothing.
- Balance changes are visible in a reviewed diff of `docs/balance.md` and are checked against
  explicit targets.
- The pellet model assumes a centred aim and uniform pellets. Aim error, bloom and recoil are
  not in the balance model, so it describes a skilled player's best case.
