import { defineConfig } from 'vite';

/**
 * Toolchain (ADR-0012): Rolldown bundles, Oxc transforms TypeScript and
 * minifies JavaScript, Lightning CSS transforms and minifies CSS. Release
 * builds ship no source maps.
 */
export default defineConfig({
  base: './',
  // Oxc: TypeScript/JSX transform (Vite 8's default, configured here explicitly).
  oxc: {},
  css: { transformer: 'lightningcss' },
  build: {
    target: 'es2023',
    // No source maps in release builds: smaller deploys, no shipped sources.
    sourcemap: false,
    // The Rapier chunk is ~4.3 MB of embedded WASM (data, not code); per-chunk code limits
    // live in scripts/check-bundle.mjs instead of this single global threshold.
    chunkSizeWarningLimit: 4500,
    minify: 'oxc',
    cssMinify: 'lightningcss',
    rolldownOptions: {
      output: {
        // Vendor libraries in their own long-cacheable chunks: a game update does not
        // re-download Three.js or the physics WASM.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 2 },
            { name: 'rapier', test: /node_modules[\\/]@dimforge[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  server: {
    // Cross-origin isolation enables SharedArrayBuffer for worker pipelines (later stages).
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
