# ADR-0007: Procedural audio engine and dynamic soundscape

- Status: Accepted
- Date: 2026-11-08

## Context

Every sound must be synthesised in code. The ambience must react to zone, time, danger, enemy
proximity, health and the space the player is in. Sound must be spatial (HRTF), reverberate according
to geometry, and be occluded by walls. The acceptance criteria are "zones sound distinct" and
"unit tests on synthesis pass", which need synthesis that can run and be measured outside a browser.

## Decision

**One DSP codebase, two runtimes.** `infrastructure/audio/dsp/*` is pure TypeScript working on
`Float32Array` blocks:

- noise colours, biquads and smoothers;
- ten ambient layers (wind, hum, insects, drips, creaks, rumble, room tone, rain, heartbeat,
  tinnitus);
- `AmbienceRenderer`;
- reverb impulse responses, distant one-shots and footsteps.

The same code runs inside an `AudioWorklet` (`ambience.worklet.ts`, loaded with Vite's
`?worker&url`, about 12 kB) and offline in Node for tests. Zod is kept out of the worklet graph by
splitting `zones-schema.ts` from the zone data.

**Layering.**

- **Data and pure rules (domain):** `domain/audio/zones.ts` holds the five zone soundscapes and
  distant-event weights. `mix.ts` maps the situation to layer targets; each rule is unit-tested
  (insects fall silent near enemies, low health muffles to about 700 Hz and adds heartbeat and
  tinnitus, indoors filters wind, rain masks insects). `acoustics.ts` estimates RT60 from ray probes.
- **Application:** `SoundscapeDirector` runs on the render clock and never touches simulation
  state. It probes geometry (4×/s), blends zones by position (8 m cross-fades), updates the mix
  (10×/s) and schedules distant events through an `AudioPort`.
- **Web Audio implementation:** `AudioEngine` implements the `AudioPort`.

**Room acoustics.** 19 rays (a horizontal ring plus up and diagonals) give a mean free path ℓ and an
average absorption ᾱ, with escaped rays treated as perfect absorbers. RT60 = 0.161·ℓ/(4·ᾱ), which is
Sabine with ℓ = 4V/S, so no room volume is needed. Hit directions become panned early reflections.
Surfaces carry absorption coefficients.

**Reverb.** A procedural stereo impulse response has a pre-delay, discrete early reflections and an
exponentially decaying, progressively darker, decorrelated noise tail at the target RT60. It is
energy-normalised and played through a `ConvolverNode`. Two convolvers crossfade, and the IR is only
rebuilt when RT60 changes by more than ±15%, the wet level changes, or cover changes. A test measures
the generated IR with Schroeder integration and requires it to be within ±25% of the target.

**Spatial one-shots.** These use HRTF `PannerNode`s with inverse-distance falloff, a low-pass from
air absorption and occlusion (3 rays from listener to source; the blocked fraction maps to gain and
cutoff), feeding both the dry bus and the reverb send.

**Master chain.** A muffle low-pass driven by health feeds a limiter. The ambience bed also has a
soft clipper.

**Acceptance.** `tests/acceptance/zones-distinct.test.ts` renders 4 s of each zone with the worklet's
DSP and builds a feature vector: the 9-band octave spectrum shape, onset rate and hum tonality. It
requires every pair of zones to be clearly apart and checks each zone's signature:

- forest has the most 4 kHz insect energy;
- subway has the most 32 Hz rumble and the most transients;
- industrial has stronger hum than the city.

`e2e/audio.spec.ts` checks the same in the running game via worklet meters.

**Budget.** The ambience renderer must run faster than 15× real time in Node (a unit test). In
practice it uses a few percent of one core.

## Consequences

- Danger, enemy proximity and health have no gameplay sources yet. They are wired through the mix
  and exposed as debug overrides, and AI (stage 6–7) and damage (stage 4) will feed them.
- Rain and night exist as inputs. Weather and the time-of-day cycle (stage 5) will drive them.
- Distant events are pre-baked variants (3 per kind). More variety is a data change.
