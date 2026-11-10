# ADR-0009: Touch controls and GitHub Pages deployment

- Status: Accepted
- Date: 2026-11-10

## Context

The game should be playable on phones, and it should be published at a public URL.

## Decision

**Touch input.** The touch input is a second `InputSource` adapter,
`infrastructure/browser/touch-input.ts`. It wraps the keyboard source, so a tablet with a keyboard
can use both.

- The DOM overlay (`presentation/touch-controls.ts`) uses pointer events only and tracks each
  finger by `pointerId`. It calls into the adapter, which buffers input and drains it once per
  tick, under the same contract as the keyboard.
- The touch commands are ordinary `move`/`look`/`action` commands. They pass through the
  `CommandQueue` and the replay recorder like keyboard input. A touch session therefore records a
  normal replay, and the simulation is unchanged: golden hashes and replays are untouched.
- The stick is analog. Its output is snapped to a 1/16 grid with a dead zone, so a trembling
  thumb doesn't emit a `move` every tick and bloat replays.
- Each tick carries at most one edge per action. A tap's release, or a press and release that fall
  inside one frame, moves to the next tick. This keeps the press/release invariant the weapon
  systems rely on.
- Aim, crouch and sprint are toggles, because holding them with a thumb would occupy a whole hand.
  Fire is a hold, and dragging from FIRE also steers the view.
- The controls are enabled when `(pointer: coarse)` matches. `?touch=1|0` overrides this. Touch
  devices default to `quality=low`.

**Deployment.** `.github/workflows/pages.yml` builds with Vite and publishes `dist/` through the
official Pages actions (`configure-pages`, `upload-pages-artifact`, `deploy-pages`).

- `base: './'` makes every asset URL relative, including the bake worker, the audio worklet and
  the inlined Rapier WASM, so the build runs from the `/war/` project subpath with no extra
  configuration.
- Pages can't send COOP/COEP headers. Nothing needs them: no `SharedArrayBuffer`.

## Consequences

- Repository owners must set Settings → Pages → Source to "GitHub Actions" once.
- The workflow deploys every push to the working branch, so the live page tracks development.
- The debug menu is dev-only and has no touch entry point. Debugging on a device needs a dev
  server.
