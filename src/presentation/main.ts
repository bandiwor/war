import { GameLoop } from '../application/loop/game-loop';
import type { InputSource } from '../application/loop/ports';
import { BenchmarkInput } from '../application/benchmark-input';
import { createSandbox } from '../application/scenes/sandbox';
import { seed } from '../domain/core/brand';
import type { InputCommand } from '../domain/input/commands';
import { KeyboardMouseInput } from '../infrastructure/browser/keyboard-input';
import { RafFrameSource } from '../infrastructure/browser/raf-frame-source';
import { BodycamPresenter } from '../infrastructure/render/bodycam-presenter';
import { EFFECT_FACTORIES } from '../infrastructure/render/postfx/effects';
import type { EffectFactories } from '../infrastructure/render/postfx/types';
import { QUALITY_PRESETS } from '../infrastructure/render/quality';
import { createTextureBaker } from '../infrastructure/render/textures/texture-baker';
import { applyFxSelection, parseUrlOptions, unknownEffects } from './url-options';

/** Browser composition root: the only place concrete adapters are wired together. */
async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) throw new Error('#app missing');
  const opts = parseUrlOptions(window.location.search);
  for (const id of unknownEffects(opts.fx)) console.warn(`Unknown effect in ?fx: ${id}`);

  const status = document.createElement('div');
  status.className = 'boot';
  status.textContent = 'WAR · generating world…';
  root.append(status);

  const sandbox = createSandbox(seed(opts.seed));
  const canvas = document.createElement('canvas');
  canvas.className = 'view';
  canvas.dataset['testid'] = 'view';
  root.append(canvas);

  const baker = createTextureBaker();
  const presenter = await BodycamPresenter.create({
    canvas,
    sandbox,
    quality: QUALITY_PRESETS[opts.quality],
    factories: EFFECT_FACTORIES,
    baker,
    clock: () => performance.now(),
    ...(opts.frozenTime === undefined
      ? {}
      : { frozenTime: opts.frozenTime, frozenSpin: opts.spin }),
  });
  baker.dispose();
  applyFxSelection(presenter.postFx, opts.fx);
  if (opts.stimulus !== null) presenter.stimulusOverride = opts.stimulus;
  if (opts.signal > 0) presenter.signal.force(opts.signal);
  status.remove();

  const sim = sandbox.simulation;
  const scripted: InputCommand[] = [];
  if (opts.preTicks > 0) {
    // Deterministic scripted pre-roll: look, optionally walk, then simulate.
    sim.step([
      { type: 'look', yaw: opts.look[0], pitch: opts.look[1] },
      ...(opts.walk ? [{ type: 'move' as const, forward: 1, strafe: 0 }] : []),
    ]);
    for (let i = 1; i < opts.preTicks; i++) sim.step(scripted);
  }
  const markTick = (): void => {
    root.dataset['tick'] = String(sim.tick);
  };

  if (opts.frozenTime !== undefined) {
    presenter.present(1);
    presenter.present(1); // second frame: exposure/history settled
    markTick();
    root.dataset['ready'] = '1';
    installDev(root, presenter, null, sandbox);
    return;
  }

  let inputSource: InputSource;
  if (opts.benchSeconds > 0) {
    inputSource = new BenchmarkInput();
    window.setTimeout(() => {
      reportBenchmark(root, presenter, opts.benchSeconds);
    }, opts.benchSeconds * 1000);
  } else {
    const input = new KeyboardMouseInput(canvas);
    canvas.addEventListener('click', () => {
      void canvas.requestPointerLock();
    });
    inputSource = input;
  }
  const loop = new GameLoop({
    simulation: sim,
    frames: new RafFrameSource(),
    input: inputSource,
    presenter,
    onTick: markTick,
  });
  loop.start();
  root.dataset['ready'] = '1';
  installDev(root, presenter, loop, sandbox);

  if (import.meta.hot) {
    // Shader / effect HMR: swap pass implementations, keep simulation and settings.
    import.meta.hot.accept('../infrastructure/render/postfx/effects/index.ts', (mod) => {
      const next: unknown = mod?.['EFFECT_FACTORIES'];
      if (isEffectFactories(next)) presenter.setFactories(next);
    });
  }
}

/** Frame-time summary after a ?bench run; also exposed as data attributes for automation. */
function reportBenchmark(root: HTMLElement, presenter: BodycamPresenter, seconds: number): void {
  const p = presenter.profiler;
  const size = presenter.internalSize;
  const result = {
    seconds,
    fps: Number(p.fps.toFixed(1)),
    frameP50: Number(p.frameMs.percentile(0.5).toFixed(2)),
    frameP95: Number(p.frameMs.percentile(0.95).toFixed(2)),
    frameP99: Number(p.frameMs.percentile(0.99).toFixed(2)),
    cpuMs: Number(p.cpuMs.mean().toFixed(2)),
    gpuMs: p.gpuTimingAvailable && p.gpuMs.count > 0 ? Number(p.gpuMs.mean().toFixed(2)) : null,
    internal: `${String(size.width)}x${String(size.height)}`,
    drawCalls: p.drawCalls,
    meets60: p.frameMs.percentile(0.95) <= 1000 / 55,
  };
  root.dataset['bench'] = JSON.stringify(result);
  const panel = document.createElement('pre');
  panel.className = 'bench-report';
  panel.textContent =
    `BENCHMARK (${String(seconds)} s)\n` +
    Object.entries(result)
      .map(([k, v]) => `${k.padEnd(10)} ${String(v)}`)
      .join('\n');
  root.append(panel);
  console.warn('[war] benchmark', result);
}

/** HMR payloads are untyped: accept a new factory table only if every effect has a function. */
function isEffectFactories(value: unknown): value is EffectFactories {
  if (typeof value !== 'object' || value === null) return false;
  return Object.keys(EFFECT_FACTORIES).every(
    (key) => typeof Reflect.get(value, key) === 'function',
  );
}

function installDev(
  root: HTMLElement,
  presenter: BodycamPresenter,
  loop: GameLoop | null,
  sandbox: ReturnType<typeof createSandbox>,
): void {
  if (import.meta.env.DEV) {
    // Dynamic import inside a DEV-only branch: Vite removes it (and the whole
    // debug package) from production builds.
    void import('./debug/debug-menu').then(({ installDebugMenu }) => {
      installDebugMenu({ root, simulation: sandbox.simulation, loop, presenter });
    });
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  const root = document.getElementById('app');
  if (root !== null) {
    root.dataset['error'] = String(error);
    root.textContent = `WAR failed to start: ${error instanceof Error ? error.message : String(error)}`;
  }
});
