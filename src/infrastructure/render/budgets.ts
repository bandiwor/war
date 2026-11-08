/** Per-frame budgets (ms) at the 60 FPS target. The profiler flags overruns; stage 10 adds auto-scaling. */
export const FRAME_BUDGETS = {
  frame: 1000 / 60,
  cpuRender: 4,
  gpu: 11,
  simulation: 2,
} as const;
