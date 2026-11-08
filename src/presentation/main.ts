import { BenchmarkInput } from '../application/benchmark-input';
import { GameLoop } from '../application/loop/game-loop';
import type { InputSource, Presenter } from '../application/loop/ports';
import { SoundscapeDirector } from '../application/audio/soundscape-director';
import { ReplayRecorder } from '../application/replay/replay';
import { RecordingInput, ReplayInput } from '../application/replay/replay-input';
import { TICK_RATE } from '../application/scenes/empty-world';
import { createSandbox, type Sandbox } from '../application/scenes/sandbox';
import type { Simulation } from '../application/simulation';
import { seed } from '../domain/core/brand';
import type { InputCommand } from '../domain/input/commands';
import { AudioEngine } from '../infrastructure/audio/audio-engine';
import { FootstepPlayer } from '../infrastructure/audio/footstep-player';
import { KeyboardMouseInput } from '../infrastructure/browser/keyboard-input';
import { RafFrameSource } from '../infrastructure/browser/raf-frame-source';
import { createRapierPhysics } from '../infrastructure/physics/rapier-physics';
import { BodycamPresenter } from '../infrastructure/render/bodycam-presenter';
import { EFFECT_FACTORIES } from '../infrastructure/render/postfx/effects';
import type { EffectFactories } from '../infrastructure/render/postfx/types';
import { QUALITY_PRESETS } from '../infrastructure/render/quality';
import { createTextureBaker } from '../infrastructure/render/textures/texture-baker';
import { loadSessionReplay, type GameSession } from './session';
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

  const playing = opts.replay === 'session' ? loadSessionReplay() : null;
  if (playing !== null && playing.scene !== 'sandbox')
    throw new Error(`Replay is for scene "${playing.scene}"`);
  const runSeed = seed(playing?.seed ?? opts.seed);
  const sandbox = createSandbox(runSeed, await createRapierPhysics(TICK_RATE));
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
    playback: playing !== null,
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
  const markTick = (): void => {
    root.dataset['tick'] = String(sim.tick);
  };

  if (opts.frozenTime !== undefined) {
    preRoll(sim, opts.preTicks, opts.look, opts.walk);
    presenter.present(1);
    presenter.present(1); // second frame: exposure/history settled
    markTick();
    root.dataset['ready'] = '1';
    installDev(root, presenter, null, newSession(sandbox, null, null));
    return;
  }

  const audio = createAudio(runSeed);
  const director =
    audio === null ? null : new SoundscapeDirector(sandbox.layout, sandbox.physics, audio, runSeed);
  const footsteps = audio === null ? null : new FootstepPlayer(audio, runSeed);
  if (audio !== null) {
    const unlock = (): void => {
      audio.unlock();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  let input: InputSource;
  let recorder: ReplayRecorder | null = null;
  if (playing !== null) {
    input = new ReplayInput(playing);
  } else if (opts.benchSeconds > 0) {
    input = new BenchmarkInput();
    window.setTimeout(() => {
      reportBenchmark(root, presenter, opts.benchSeconds);
    }, opts.benchSeconds * 1000);
  } else {
    const keyboard = new KeyboardMouseInput(canvas);
    canvas.addEventListener('click', () => {
      void canvas.requestPointerLock();
    });
    // Black box: every live session records its input from tick 0.
    const recording = new RecordingInput(keyboard);
    recorder = new ReplayRecorder('sandbox', runSeed, TICK_RATE, TICK_RATE);
    recording.recorder = recorder;
    input = recording;
  }

  const session = newSession(sandbox, recorder, playing, audio, footsteps, director);
  const onTick = (s: Simulation): void => {
    markTick();
    recorder?.afterStep(s);
    const events = s.events;
    session.footstepCount += events.footstep.size;
    if (footsteps !== null) {
      for (let i = 0; i < events.footstep.size; i++) {
        const e = events.footstep.at(i);
        if (e) footsteps.footstep(e);
      }
      for (let i = 0; i < events.land.size; i++) {
        const e = events.land.at(i);
        if (e) footsteps.land(e);
      }
    }
  };
  // The soundscape follows the rendered (interpolated) view on the wall clock.
  let lastFrame = performance.now();
  const presentWithAudio: Presenter = {
    present(alpha) {
      presenter.present(alpha);
      const now = performance.now();
      director?.update(presenter.view, Math.min(0.25, (now - lastFrame) / 1000));
      lastFrame = now;
    },
  };
  const loop = new GameLoop({
    simulation: sim,
    frames: new RafFrameSource(),
    input,
    presenter: presentWithAudio,
    onTick,
  });
  loop.start();
  root.dataset['ready'] = '1';
  installDev(root, presenter, loop, session);

  if (import.meta.hot) {
    // Shader / effect HMR: swap pass implementations, keep simulation and settings.
    import.meta.hot.accept('../infrastructure/render/postfx/effects/index.ts', (mod) => {
      const next: unknown = mod?.['EFFECT_FACTORIES'];
      if (isEffectFactories(next)) presenter.setFactories(next);
    });
  }
}

function newSession(
  sandbox: Sandbox,
  recorder: ReplayRecorder | null,
  playing: GameSession['playing'],
  audio: AudioEngine | null = null,
  footsteps: FootstepPlayer | null = null,
  director: SoundscapeDirector | null = null,
): GameSession {
  return { sandbox, recorder, playing, audio, footsteps, director, footstepCount: 0 };
}

function createAudio(runSeed: number): AudioEngine | null {
  try {
    return AudioEngine.create(runSeed);
  } catch (error) {
    console.warn('Audio unavailable', error);
    return null;
  }
}

/** Deterministic scripted pre-roll for visual tests: look, optionally walk, then simulate. */
function preRoll(
  sim: Simulation,
  ticks: number,
  look: readonly [number, number],
  walk: boolean,
): void {
  if (ticks <= 0) return;
  const first: InputCommand[] = [{ type: 'look', yaw: look[0], pitch: look[1] }];
  if (walk) first.push({ type: 'move', forward: 1, strafe: 0 });
  sim.step(first);
  for (let i = 1; i < ticks; i++) sim.step();
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
  session: GameSession,
): void {
  if (import.meta.env.DEV) {
    // Dynamic import inside a DEV-only branch: Vite removes it (and the whole
    // debug package) from production builds.
    void import('./debug/debug-menu').then(({ installDebugMenu }) => {
      installDebugMenu({ root, simulation: session.sandbox.simulation, loop, presenter, session });
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
