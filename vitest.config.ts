import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Browser adapters and composition roots are covered by Playwright e2e.
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.bench.ts',
        'src/infrastructure/browser/**',
        'src/presentation/**',
        'src/headless/cli.ts',
        // WebGL/DOM-bound rendering: exercised by the Playwright visual suite (e2e/visual.spec.ts).
        'src/infrastructure/render/{bodycam-presenter,profiler,budgets,quality}.ts',
        'src/infrastructure/render/{gl,scene,textures,postfx/effects}/**',
        'src/infrastructure/render/postfx/{pipeline,simple-pass,tonemap,types}.ts',
        'src/infrastructure/render/osd/osd-canvas.ts',
        // Web Audio-bound playback: exercised by e2e/player.spec.ts (pure DSP is unit-tested).
        'src/infrastructure/audio/{audio-engine,footstep-player,ambience.worklet,weapon-audio}.ts',
        // Three.js viewmodel/effects: exercised by e2e/range.spec.ts and the visual suite.
        'src/infrastructure/render/weapons/{viewmodel,combat-fx,weapon-models}.ts',
        // Open world: WebGL shaders, the Worker pool and the scene rig, exercised by e2e/world.spec.ts
        // (meshing, streaming, the light pool and lighting are unit-tested).
        'src/infrastructure/render/world/{world-rig,rain,sky,chunk-overlay,chunk.worker,chunk-source}.ts',
      ],
      // Branch thresholds are lower than line thresholds because every typed-array
      // read needs a `?? 0` fallback under noUncheckedIndexedAccess, and v8 counts
      // those unreachable fallbacks as branches (ADR-0004).
      // The AI's per-mob loops read typed arrays inline (`a[i] ?? 0`) instead of through `at()`:
      // V8 does not inline `at()` there and boxes its result (2.4× the garbage, measured in the
      // perf gate), and each inline fallback is one more unreachable branch. Hence 80, not 85.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
        'src/domain/**': { lines: 99, functions: 100, branches: 85, statements: 98 },
        'src/application/**': { lines: 99, functions: 100, branches: 80, statements: 98 },
      },
    },
  },
});
