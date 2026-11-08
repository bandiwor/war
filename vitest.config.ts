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
      ],
      // Branch thresholds are lower than line thresholds because every typed-array
      // read needs a `?? 0` fallback under noUncheckedIndexedAccess, and v8 counts
      // those unreachable fallbacks as branches (ADR-0004).
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
        'src/domain/**': { lines: 99, functions: 100, branches: 85, statements: 98 },
        'src/application/**': { lines: 99, functions: 100, branches: 85, statements: 98 },
      },
    },
  },
});
