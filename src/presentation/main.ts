import { BenchmarkInput } from '../application/benchmark-input';
import { GameLoop } from '../application/loop/game-loop';
import type { InputSource, Presenter } from '../application/loop/ports';
import { SoundscapeDirector } from '../application/audio/soundscape-director';
import { ReplayRecorder } from '../application/replay/replay';
import { RecordingInput, ReplayInput } from '../application/replay/replay-input';
import { TICK_RATE } from '../application/scenes/empty-world';
import { createSandbox, type Sandbox, type SandboxKind } from '../application/scenes/sandbox';
import { CommandQueue } from '../application/replay/command-queue';
import { CombatLog } from './combat-log';
import type { Simulation } from '../application/simulation';
import { seed } from '../domain/core/brand';
import type { InputCommand } from '../domain/input/commands';
import { AudioEngine } from '../infrastructure/audio/audio-engine';
import { FootstepPlayer } from '../infrastructure/audio/footstep-player';
import { WeaponAudio } from '../infrastructure/audio/weapon-audio';
import { MobAudio } from '../infrastructure/audio/mob-audio';
import { StoryAudio } from '../infrastructure/audio/story-audio';
import { SaveStore, browserStorage, type SaveSlot } from '../infrastructure/browser/save-store';
import { captureSave, restoreSave } from '../application/save/save-game';
import type { SaveGame } from '../domain/save/save';
import { StoryHud } from './story-hud';
import { openEditor, readLevelHandoff } from './editor/handoff';
import { createLevelSandbox } from '../application/level/play-level';
import { KeyboardMouseInput } from '../infrastructure/browser/keyboard-input';
import { TouchInput } from '../infrastructure/browser/touch-input';
import { RafFrameSource } from '../infrastructure/browser/raf-frame-source';
import { createRapierPhysics } from '../infrastructure/physics/rapier-physics';
import { BodycamPresenter } from '../infrastructure/render/bodycam-presenter';
import { EFFECT_FACTORIES } from '../infrastructure/render/postfx/effects';
import type { EffectFactories } from '../infrastructure/render/postfx/types';
import { QUALITY_PRESETS } from '../infrastructure/render/quality';
import { createTextureBaker } from '../infrastructure/render/textures/texture-baker';
import { loadSessionReplay, type GameSession, type StoryUi } from './session';
import { isTouchDevice, mountTouchControls } from './touch-controls';
import { applyFxSelection, parseUrlOptions, unknownEffects } from './url-options';

/** Browser composition root: the only place concrete adapters are wired together. */
async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) throw new Error('#app missing');
  const opts = parseUrlOptions(window.location.search, isTouchDevice());
  for (const id of unknownEffects(opts.fx)) console.warn(`Unknown effect in ?fx: ${id}`);

  if (opts.editor) {
    // The editor is its own code-split chunk: the game never loads it unless asked.
    const { startEditor } = await import('./editor/editor-app');
    await startEditor(root);
    return;
  }

  const status = document.createElement('div');
  status.className = 'boot';
  status.textContent = 'WAR · generating world…';
  root.append(status);

  const playing = opts.replay === 'session' ? loadSessionReplay() : null;
  if (playing !== null && playing.scene === 'empty')
    throw new Error('Empty-world replays have no renderable scene');
  // A session starts from a save when it replays one that did, or when asked to load a slot.
  const saves = new SaveStore(browserStorage());
  const startSave: SaveGame | null =
    playing !== null ? playing.save : opts.load !== null ? saves.read(opts.load) : null;
  const sceneName = playing?.scene ?? startSave?.scene ?? null;
  const kind: SandboxKind =
    sceneName === null
      ? opts.scene
      : sceneName === 'range'
        ? 'range'
        : sceneName === 'world'
          ? 'world'
          : 'street';
  const runSeed = seed(playing?.seed ?? startSave?.seed ?? opts.seed);
  // "Play from here": the editor's level, from where its camera looked.
  const handoff = opts.level === 'session' && playing === null ? readLevelHandoff() : null;
  const physics = await createRapierPhysics(TICK_RATE);
  const sandbox =
    handoff !== null
      ? createLevelSandbox(handoff.level, physics, handoff.from)
      : createSandbox(runSeed, physics, { kind });
  if (handoff !== null) root.dataset['level'] = handoff.level.id;
  if (startSave !== null) restoreSave(sandbox, startSave);
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
  // A benchmark measures the preset as asked: no automatic scaling during it.
  presenter.governor.enabled = opts.autoQuality && opts.benchSeconds === 0;
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
  const weaponAudio = audio === null ? null : new WeaponAudio(audio, runSeed);
  const mobAudio = audio === null ? null : new MobAudio(audio, runSeed);
  const storyAudio = audio === null ? null : new StoryAudio(audio, runSeed);
  const story = sandbox.story;
  const hud =
    story === null
      ? null
      : new StoryHud(root, story, {
          loadLatest: () => {
            reloadWith({ load: saves.read('quick') !== null ? 'quick' : 'auto' });
          },
          newGame: () => {
            reloadWith({ load: null });
          },
        });
  const saveTo = (slot: SaveSlot): boolean => {
    if (playing !== null || story?.engine.ended === true) return false;
    const ok = saves.write(slot, captureSave(sandbox));
    hud?.toast(ok ? `SAVED · ${slot}` : 'SAVE FAILED');
    return ok;
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F4') {
      e.preventDefault();
      openEditor();
    }
  });
  if (playing === null && opts.benchSeconds === 0) {
    // F5 quicksave, F9 quickload (the page reloads into the save: a clean, deterministic start).
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F5') {
        e.preventDefault();
        saveTo('quick');
      } else if (e.code === 'F9') {
        e.preventDefault();
        if (saves.read('quick') !== null) reloadWith({ load: 'quick' });
      }
    });
  }
  if (weaponAudio !== null) {
    presenter.combatFx.onCasingLanded = (x, y, z, shell) => {
      weaponAudio.casingLanded(x, y, z, shell);
    };
  }
  if (audio !== null) {
    const unlock = (): void => {
      audio.unlock();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  let input: InputSource;
  let recorder: ReplayRecorder | null = null;
  let commands: CommandQueue | null = null;
  if (playing !== null) {
    input = new ReplayInput(playing);
  } else if (opts.benchSeconds > 0) {
    input = new BenchmarkInput();
    window.setTimeout(() => {
      reportBenchmark(root, presenter, opts.benchSeconds);
    }, opts.benchSeconds * 1000);
  } else {
    const keyboard = new KeyboardMouseInput(canvas);
    let device: InputSource = keyboard;
    if (opts.touch) {
      // Phones: on-screen stick, look pad and buttons, layered over the keyboard (tablets with keyboards).
      const touch = new TouchInput(keyboard);
      mountTouchControls(root, touch);
      root.dataset['touch'] = '1';
      device = touch;
    } else {
      canvas.addEventListener('click', () => {
        void canvas.requestPointerLock();
      });
    }
    // Black box: every live session records its input from tick 0.
    // Debug tools inject through the queue, before recording: injected commands are replayable.
    commands = new CommandQueue(device);
    const recording = new RecordingInput(commands);
    recorder = new ReplayRecorder(
      kind === 'range' ? 'range' : kind === 'world' ? 'world' : 'sandbox',
      runSeed,
      TICK_RATE,
      TICK_RATE,
      startSave,
    );
    // A level from the editor is not one of the replayable scenes: its sessions are not recorded.
    recording.recorder = handoff === null ? recorder : null;
    if (handoff !== null) recorder = null;
    input = recording;
  }

  const storyUi: StoryUi = {
    hud,
    save: saveTo,
    load: (slot) => {
      reloadWith({ load: slot });
    },
    slots: () => saves.list(),
  };
  const session = newSession(
    sandbox,
    recorder,
    playing,
    audio,
    footsteps,
    director,
    commands,
    storyUi,
  );
  const onTick = (s: Simulation): void => {
    markTick();
    recorder?.afterStep(s);
    const events = s.events;
    session.footstepCount += events.footstep.size;
    presenter.consumeEvents(events);
    if (weaponAudio !== null) {
      const v = presenter.view;
      weaponAudio.hands.x = v.x;
      weaponAudio.hands.y = v.y - 0.4;
      weaponAudio.hands.z = v.z;
      weaponAudio.consume(events);
    }
    mobAudio?.consume(events);
    storyAudio?.consume(events);
    hud?.consume(events);
    // Autosave at every new chapter.
    for (let i = 0; i < events.story.size; i++)
      if (events.story.at(i)?.note.kind === 'chapter') saveTo('auto');
    session.combat.record(events);
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
      const dt = Math.min(0.25, (now - lastFrame) / 1000);
      director?.update(presenter.view, dt);
      if (mobAudio !== null) {
        const v = presenter.view;
        mobAudio.listener.x = v.x;
        mobAudio.listener.y = v.y;
        mobAudio.listener.z = v.z;
        mobAudio.update(sandbox, dt);
        mobAudio.interference(v.stimulus.emi, dt);
      }
      hud?.update(dt, presenter.view.x, presenter.view.z);
      lastFrame = now;
    },
  };
  const loop = new GameLoop({
    simulation: sim,
    frames: new RafFrameSource(),
    input,
    presenter: presentWithAudio,
    onTick,
    clock: () => performance.now(),
    onTickTime: (ms) => {
      presenter.profiler.simMs.push(ms);
    },
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

/** Reloads the page with the given save slot (or none: a new game), keeping other options. */
function reloadWith(o: { load: 'quick' | 'auto' | null }): void {
  const url = new URL(window.location.href);
  if (o.load === null) url.searchParams.delete('load');
  else url.searchParams.set('load', o.load);
  url.searchParams.delete('replay');
  window.location.href = url.toString();
}

function newSession(
  sandbox: Sandbox,
  recorder: ReplayRecorder | null,
  playing: GameSession['playing'],
  audio: AudioEngine | null = null,
  footsteps: FootstepPlayer | null = null,
  director: SoundscapeDirector | null = null,
  commands: CommandQueue | null = null,
  story: StoryUi | null = null,
): GameSession {
  return {
    sandbox,
    story,
    recorder,
    playing,
    audio,
    footsteps,
    director,
    commands,
    combat: new CombatLog(),
    footstepCount: 0,
  };
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
    simP99: Number(p.simMs.percentile(0.99).toFixed(3)),
    ...(presenter.world === null
      ? {}
      : {
          streamP99: Number(presenter.world.chunks.frameMs.percentile(0.99).toFixed(3)),
          streamMax: Number(presenter.world.chunks.maxFrameMs.toFixed(3)),
          chunks: presenter.world.chunks.attachedTotal,
        }),
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
