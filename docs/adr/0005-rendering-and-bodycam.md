# ADR-0005: Rendering pipeline and bodycam post-processing

- Status: Accepted
- Date: 2026-11-08

## Context

Stage 1 needs a night-time PBR scene with no asset files, and a "chest bodycam footage" look built
from many independently toggleable effects whose strength reacts to gameplay. The renderer must stay
replaceable (WebGPU later) and cheap enough for 60 FPS on integrated graphics.

## Decision

**Layering.** The simulation exposes a read model (`RenderView`, interpolated by `alpha`). The
WebGL presenter (`infrastructure/render/bodycam-presenter.ts`) implements the application's
`Presenter` port and never touches the ECS directly.

**Render graph.** `infrastructure/render/graph/render-graph.ts` is a backend-agnostic compiler with no
Three.js imports. Passes are `chain` passes (transform the image; when disabled they alias to their
input, so a disabled effect costs nothing) or `aux` passes (produce side resources such as `bloom`
and `exposure`; when disabled, consumers get `null` and fall back). Unused producers are culled.
Pooled targets are assigned by lifetime, so 15 passes run through 2 LDR targets and 2 HDR targets.
The pipeline recompiles only when the set of enabled effects changes (a bitmask compare), and keeps
a precomputed plan so a frame allocates nothing.

**Effects are data.** `domain/bodycam/effects.ts` lists every effect with its stage, order and
parameter specs (default, range, step), plus a Zod schema for saved settings.
`EffectFactories` is a mapped type over the effect ids, so an entry without an implementation is a
compile error. The debug menu builds its toggles and sliders from the same table.

Chain order (HDR → tonemap → LDR) follows the physical signal path of a cheap camera:
`autoExposure*, motionBlur, bloom*, overexposure → tonemap/grade → lensDistortion,
chromaticAberration, lensDirt, vignette (optics) → rollingShutter, shadowNoise, grain (sensor) →
compression, signalLoss (encoder/transmission) → osd (recorder burn-in)`. `*` = aux producer.
`cameraShake` is a camera-stage effect applied to the view transform.

**Gameplay coupling.** `modulatePostFx(base, {damage, fear, emi})` is a pure domain function. It
scales parameters (it never enables or disables effects) and is unit-tested for each direction.

**Tonemap/grade** is core, not an effect: ACES fit, then the shared palette (desaturated, cold
shadows and mids, warm highlights kept for emergency accents), with sRGB encoding done in the
shader. Three's own tone mapping and output conversion are disabled.

**Materials.** Recipes are data (`domain/procgen/materials.ts`). A pure, deterministic baker
(tileable gradient, FBM, Worley and domain-warp noise) outputs albedo, normal and ORM+height (glTF
channel layout, so Three reads AO, roughness and metalness from one texture). Baking runs in a
module-worker pool and results are transferred zero-copy. A golden-style test asserts the baked
bytes are reproducible per seed.

**Camera.** The camera sits at chest height (eye height − 0.3 m), follows yaw and 90% of pitch, and
adds procedural breathing and footstep shake. The flashlight is a shadow-casting spot with a
procedural cookie, mounted slightly below the lens and angled down.

**Determinism boundary.** Rendering may use `Math.*` and wall time; nothing flows back into the
simulation. Visual tests use frozen-time mode (`?vt=`), which fixes render time, removes random
events, settles exposure instantly and can fake camera spin (`?spin=`) for the motion effects.

## Consequences

- Each LDR effect is its own fullscreen pass (clear, testable, individually toggleable). Fusing
  adjacent passes into an uber-shader is a known stage-10 optimisation if GPU profiling demands it.
- Forward lighting caps practical light count (about 10 dynamic lights here); lit windows are emissive
  only. Clustered lighting can come with world streaming (stage 5) if needed.
- Visual baselines are produced by SwiftShader (headless Chromium). CI must use the same rasterizer;
  comparisons allow 1% pixel drift.
- The 60 FPS target can't be verified in a GPU-less container. The in-game profiler (debug menu →
  Render) reports CPU and GPU time, the latter via `EXT_disjoint_timer_query_webgl2` where the browser
  exposes it, against the budgets in `infrastructure/render/budgets.ts`.
