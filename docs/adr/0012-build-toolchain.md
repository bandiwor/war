# ADR-0012: Build toolchain: Rolldown, Oxc, Lightning CSS; no source maps in releases

- Status: Accepted
- Date: 2026-11-10

## Context

The game is published on GitHub Pages. Release builds shipped source maps, which exposed the full
TypeScript sources and doubled the download. Vite 8 already uses Rolldown and Oxc internally;
CSS still went through the default pipeline.

## Decision

`vite.config.ts` names the toolchain explicitly:

- **Rolldown** bundles. Its `codeSplitting` groups put Three.js, Rapier (mostly its embedded
  WASM) and the remaining vendor code in their own content-hashed chunks, so a game update does
  not re-download them.
- **Oxc** transforms TypeScript and minifies JavaScript (`oxc`, `build.minify: 'oxc'`).
- **Lightning CSS** transforms and minifies CSS (`css.transformer`, `build.cssMinify`). The game's
  CSS is the inline `<style>` of `index.html`.
- **No source maps** in production (`build.sourcemap: false`).

`scripts/check-bundle.mjs`, run in CI, enforces three things:

- no debug code in the bundle;
- no `.map` files;
- a size budget per chunk (app, Three.js, vendor, Rapier).

Those per-chunk budgets replace Vite's single global chunk-size warning, which Rapier's ~4.3 MB of
embedded WASM always triggered.

## Consequences

- Stack traces from the published site point into minified code. Debug locally with `npm run dev`
  or a local build with `--sourcemap`.
- Lightning CSS and Oxc are Vite's own pinned versions, so toolchain upgrades come with Vite
  upgrades.
