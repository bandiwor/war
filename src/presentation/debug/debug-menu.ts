import type { GameLoop } from '../../application/loop/game-loop';
import type { Simulation } from '../../application/simulation';
import {
  EFFECT_IDS,
  POST_EFFECTS,
  getEffectParam,
  setEffectParam,
  type EffectId,
} from '../../domain/bodycam/effects';
import type { BodycamPresenter } from '../../infrastructure/render/bodycam-presenter';
import { FRAME_BUDGETS } from '../../infrastructure/render/budgets';
import { installWorldTab, type WorldDebugApi } from './world-tab';
import { installBestiaryTab, type BestiaryApi } from './bestiary-tab';
import { installStoryTab, type StoryDebugApi } from './story-tab';
import { QUALITY_PRESETS } from '../../infrastructure/render/quality';
import { downloadReplay, playReplayFile, type GameSession } from '../session';
import { createRenderView, readRenderView } from '../../application/scenes/sandbox';
import { DISTANT_KINDS, ZONE_IDS, ZONE_SOUNDSCAPES, isZoneId } from '../../domain/audio/zones';
import { LAYER_IDS, type LayerId } from '../../infrastructure/audio/dsp/ambience-renderer';
import { resetTargets } from '../../application/combat/combat-systems';
import { WEAPON_IDS } from '../../domain/weapons/registry';
import type { HitRecord } from '../combat-log';
import { el, slider, sparkline } from './widgets';

/** Marker string checked by scripts/check-bundle.mjs to prove tree-shaking. */
export const DEBUG_MENU_MARKER = 'WAR_DEBUG_MENU';

export interface DebugMenuDeps {
  readonly root: HTMLElement;
  readonly simulation: Simulation;
  readonly loop: GameLoop | null;
  readonly presenter: BodycamPresenter;
  readonly session: GameSession;
}

/** Programmatic handle used by e2e tests and the console (DEV only). */
export interface WarDebugApi {
  setEffect(id: string, enabled: boolean): boolean;
  setAllEffects(enabled: boolean): void;
  setParam(id: string, key: string, value: number): boolean;
  setStimulus(damage: number, fear: number, emi: number): void;
  triggerSignalLoss(): void;
  stats(): {
    fps: number;
    cpuMs: number;
    /** Simulation cost per tick: mean and p99 (ms). */
    simMs: number;
    simP99Ms: number;
    gpuMs: number | null;
    drawCalls: number;
    triangles: number;
    graph: string;
    footsteps: number;
    audioPlayed: number;
    replayTicks: number;
  };
  setColliders(enabled: boolean): void;
  pauseAtTick(tick: number): void;
  selectWeapon(id: string): boolean;
  /** Turn the view so the sight line points at a world position. */
  aimAt(x: number, y: number, z: number): void;
  /** Press and release fire (optionally holding aim) on the next ticks. */
  fire(ads?: boolean): void;
  setPaths(show: boolean): void;
  resetTargets(): void;
  combatLog(): {
    shots: number;
    hits: number;
    kills: number;
    impacts: number;
    explosions: number;
    recent: readonly HitRecord[];
  };
  weaponState(): {
    id: string | null;
    phase: string;
    mag: number;
    chambered: boolean;
    reserve: number;
    wear: number;
  };
  setZone(zone: string | null): boolean;
  setAudioOverride(key: OverrideKey, value: number | null): void;
  worldStats: WorldDebugApi['worldStats'];
  setEnv: WorldDebugApi['setEnv'];
  teleport: WorldDebugApi['teleport'];
  setChunkOverlay: WorldDebugApi['setChunkOverlay'];
  bestiary: BestiaryApi['bestiary'];
  previewMob: BestiaryApi['previewMob'];
  previewState: BestiaryApi['previewState'];
  spawnMob: BestiaryApi['spawnMob'];
  mobCount: BestiaryApi['mobCount'];
  inspectNearest: BestiaryApi['inspectNearest'];
  setAiOverlay: BestiaryApi['setAiOverlay'];
  cheat: BestiaryApi['cheat'];
  storyState: StoryDebugApi['storyState'];
  storyGo: StoryDebugApi['storyGo'];
  storyUse: StoryDebugApi['storyUse'];
  saveGame: StoryDebugApi['saveGame'];
  loadGame: StoryDebugApi['loadGame'];
  saveSlots: StoryDebugApi['saveSlots'];
  audioStats(): {
    zones: Partial<Record<string, number>>;
    levels: Partial<Record<string, number>>;
    rt60: number | null;
    enclosure: number | null;
    distantPlayed: number;
    workletReady: boolean;
    /** Head-locked one-shots played (own weapon and hands). */
    localPlayed: number;
    heartbeat: number;
  } | null;
}

type OverrideKey = 'danger' | 'enemyProximity' | 'health' | 'rain' | 'night' | 'wind';
const OVERRIDE_KEYS: readonly OverrideKey[] = [
  'danger',
  'enemyProximity',
  'health',
  'rain',
  'night',
  'wind',
];

declare global {
  interface Window {
    __warDebug?: WarDebugApi;
  }
}

/**
 * DEV-only debug menu (toggle with `~`). Sections are generated from the
 * registries: adding an effect to POST_EFFECTS adds its toggle and sliders here.
 */
export function installDebugMenu({
  root,
  simulation,
  loop,
  presenter,
  session,
}: DebugMenuDeps): void {
  const panel = el('div', 'debug-menu');
  panel.dataset['testid'] = 'debug-menu';
  panel.dataset['marker'] = DEBUG_MENU_MARKER;
  panel.hidden = true;
  const tabs = el('div', 'debug-tabs');
  const body = el('div', 'debug-body');
  panel.append(tabs, body);
  root.append(panel);

  const sections = new Map<string, HTMLElement>();
  const addSection = (name: string): HTMLElement => {
    const section = el('section', 'debug-section');
    section.dataset['section'] = name;
    const tab = el('button', 'debug-tab', name);
    tab.type = 'button';
    tab.addEventListener('click', () => {
      for (const [n, s] of sections) s.hidden = n !== name;
      for (const t of tabs.children) t.classList.toggle('active', t === tab);
    });
    tabs.append(tab);
    body.append(section);
    sections.set(name, section);
    section.hidden = sections.size > 1;
    if (sections.size === 1) tab.classList.add('active');
    return section;
  };

  // --- Simulation -----------------------------------------------------------
  const sim = addSection('Sim');
  const simInfo = el('pre');
  sim.append(simInfo);
  if (loop !== null) {
    const pause = el('button', '', 'Pause');
    pause.type = 'button';
    pause.addEventListener('click', () => {
      loop.setPaused(!loop.isPaused);
      pause.textContent = loop.isPaused ? 'Resume' : 'Pause';
    });
    const step = el('button', '', 'Step');
    step.type = 'button';
    step.addEventListener('click', () => {
      loop.stepOnce();
    });
    sim.append(pause, step);
  }
  const replayBox = el('fieldset');
  replayBox.append(
    el(
      'legend',
      '',
      session.playing === null ? 'black-box replay (recording since tick 0)' : 'playing replay',
    ),
  );
  if (session.recorder !== null) {
    const save = el('button', '', 'Download replay');
    save.type = 'button';
    save.addEventListener('click', () => {
      downloadReplay(session);
    });
    replayBox.append(save);
  }
  const load = el('input');
  load.type = 'file';
  load.accept = '.json,application/json';
  load.addEventListener('change', () => {
    const file = load.files?.[0];
    if (file !== undefined) {
      playReplayFile(file).catch((error: unknown) => {
        window.alert(`Invalid replay: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  });
  replayBox.append(el('label', '', 'play file '), load);
  sim.append(replayBox);

  // --- Render ---------------------------------------------------------------
  const render = addSection('Render');
  const renderInfo = el('pre');
  const graph = sparkline(220, 48);
  const quality = el('select');
  for (const name of Object.keys(QUALITY_PRESETS)) quality.append(new Option(name, name));
  quality.value = new URLSearchParams(window.location.search).get('quality') ?? 'medium';
  quality.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('quality', quality.value);
    window.location.href = url.toString(); // textures and targets are rebuilt on load
  });
  const colliders = el('input');
  colliders.type = 'checkbox';
  colliders.dataset['toggle'] = 'colliders';
  colliders.addEventListener('change', () => {
    presenter.setColliderOverlay(colliders.checked);
  });
  const colliderLabel = el('label', '', ' physics colliders');
  colliderLabel.prepend(colliders);
  render.append(
    renderInfo,
    graph.canvas,
    el('label', '', 'quality '),
    quality,
    el('br'),
    colliderLabel,
  );

  // --- Bodycam --------------------------------------------------------------
  const cam = addSection('Bodycam');
  const stim = { damage: 0, fear: 0, emi: 0 };
  const applyStim = (): void => {
    presenter.stimulusOverride = stim.damage + stim.fear + stim.emi > 0 ? { ...stim } : null;
  };
  const stimBox = el('fieldset');
  stimBox.append(el('legend', '', 'gameplay stimulus'));
  for (const key of ['damage', 'fear', 'emi'] as const) {
    stimBox.append(
      slider(key, 0, 1, 0.01, 0, (v) => {
        stim[key] = v;
        applyStim();
      }).row,
    );
  }
  const signalBtn = el('button', '', 'Trigger signal loss');
  signalBtn.type = 'button';
  signalBtn.addEventListener('click', () => {
    presenter.signal.trigger(performance.now() / 1000);
  });
  const allOn = el('button', '', 'All on');
  allOn.type = 'button';
  const allOff = el('button', '', 'All off');
  allOff.type = 'button';
  cam.append(stimBox, signalBtn, allOn, allOff);

  const checkboxes = new Map<EffectId, HTMLInputElement>();
  for (const id of EFFECT_IDS) {
    const spec = POST_EFFECTS[id];
    const details = el('details', 'debug-effect');
    const summary = el('summary');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = presenter.postFx[id].enabled;
    box.dataset['effect'] = id;
    box.addEventListener('change', () => {
      presenter.postFx[id].enabled = box.checked;
    });
    box.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    checkboxes.set(id, box);
    summary.append(box, ` ${spec.label}`);
    details.append(summary);
    for (const [key, p] of Object.entries(spec.params)) {
      details.append(
        slider(
          key,
          p.min,
          p.max,
          p.step,
          getEffectParam(presenter.postFx, id, key) ?? p.default,
          (v) => {
            setEffectParam(presenter.postFx, id, key, v);
          },
        ).row,
      );
    }
    cam.append(details);
  }
  const setAll = (on: boolean): void => {
    for (const id of EFFECT_IDS) {
      presenter.postFx[id].enabled = on;
      const box = checkboxes.get(id);
      if (box) box.checked = on;
    }
  };
  allOn.addEventListener('click', () => {
    setAll(true);
  });
  allOff.addEventListener('click', () => {
    setAll(false);
  });

  // --- Range ----------------------------------------------------------------
  const rangeTab = addSection('Range');
  const weaponInfo = el('pre');
  const hitTable = el('pre');
  const queue = session.commands;
  const selectWeapon = (id: string): boolean => {
    const slot = WEAPON_IDS.findIndex((w) => w === id);
    if (slot < 0 || queue === null) return false;
    queue.push({ type: 'select', slot });
    return true;
  };
  const weaponButtons = el('div');
  for (const id of WEAPON_IDS) {
    const b = el('button', '', id);
    b.type = 'button';
    b.dataset['weapon'] = id;
    b.addEventListener('click', () => {
      selectWeapon(id);
    });
    weaponButtons.append(b);
  }
  const paths = el('input');
  paths.type = 'checkbox';
  paths.addEventListener('change', () => {
    presenter.combatFx.showPaths = paths.checked;
  });
  const pathLabel = el('label', '', ' bullet paths');
  pathLabel.prepend(paths);
  const resetBtn = el('button', '', 'Reset targets');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    resetTargets(simulation.world);
  });
  const openRange = el(
    'button',
    '',
    session.sandbox.kind === 'range' ? 'Back to the world' : 'Open shooting range',
  );
  openRange.type = 'button';
  openRange.addEventListener('click', () => {
    const url = new URL(window.location.href);
    if (session.sandbox.kind === 'range') url.searchParams.delete('scene');
    else url.searchParams.set('scene', 'range');
    url.searchParams.delete('replay');
    window.location.href = url.toString();
  });
  rangeTab.append(weaponInfo, weaponButtons, pathLabel, el('br'), resetBtn, openRange, hitTable);

  // --- World ----------------------------------------------------------------
  const worldTab = installWorldTab(addSection('World'), session.sandbox, presenter, queue);
  const storyTab = installStoryTab(addSection('Story'), session.sandbox, queue, session.story);

  // --- Bestiary ---------------------------------------------------------------
  const bestiaryTab = installBestiaryTab(
    addSection('Bestiary'),
    session.sandbox,
    presenter,
    queue,
    () => !panel.hidden,
  );

  // --- Audio ----------------------------------------------------------------
  const audioTab = addSection('Audio');
  const audioInfo = el('pre');
  audioTab.append(audioInfo);
  const director = session.director;
  const engine = session.audio;
  const meters = new Map<LayerId, HTMLElement>();
  if (director !== null && engine !== null) {
    const zone = el('select');
    zone.dataset['control'] = 'zone';
    zone.append(new Option('auto (from position)', ''));
    for (const id of ZONE_IDS) zone.append(new Option(ZONE_SOUNDSCAPES[id].label, id));
    zone.addEventListener('change', () => {
      director.overrides.zone = isZoneId(zone.value) ? zone.value : null;
    });
    audioTab.append(el('label', '', 'zone '), zone);
    const box = el('fieldset');
    box.append(el('legend', '', 'situation overrides (move a slider to override)'));
    const defaults: Record<OverrideKey, number> = {
      danger: 0,
      enemyProximity: 0,
      health: 1,
      rain: 0,
      wind: 0.35,
      night: 0.7,
    };
    for (const key of OVERRIDE_KEYS) {
      box.append(
        slider(key, 0, 1, 0.01, defaults[key], (v) => {
          director.overrides[key] = v;
        }).row,
      );
    }
    const reset = el('button', '', 'Clear overrides');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      for (const key of OVERRIDE_KEYS) director.overrides[key] = null;
      director.overrides.zone = null;
      zone.value = '';
    });
    box.append(reset);
    audioTab.append(box);
    const layers = el('fieldset');
    layers.append(el('legend', '', 'ambient layers (level · mute)'));
    for (const id of LAYER_IDS) {
      const row = el('label', 'debug-slider');
      const bar = el('span', 'debug-meter');
      const mute = el('input');
      mute.type = 'checkbox';
      mute.addEventListener('change', () => {
        engine.setLayerMuted(id, mute.checked);
      });
      row.append(el('span', 'debug-label', id), bar, mute);
      meters.set(id, bar);
      layers.append(row);
    }
    audioTab.append(layers);
    const events = el('fieldset');
    events.append(el('legend', '', 'distant events (60 m ahead)'));
    for (const kind of DISTANT_KINDS) {
      const b = el('button', '', kind);
      b.type = 'button';
      b.addEventListener('click', () => {
        engine.unlock();
        const v = presenter.view;
        engine.playDistant(kind, v.x - Math.sin(v.yaw) * 60, v.y + 3, v.z - Math.cos(v.yaw) * 60, {
          gain: 1,
          cutoffHz: 18000,
        });
      });
      events.append(b);
    }
    audioTab.append(events);
  } else {
    audioInfo.textContent = 'audio unavailable in this mode';
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && document.pointerLockElement !== null) document.exitPointerLock();
      e.preventDefault();
    }
  });

  const stats = (): ReturnType<WarDebugApi['stats']> => {
    const p = presenter.profiler;
    return {
      fps: p.fps,
      cpuMs: p.cpuMs.mean(),
      simMs: p.simMs.mean(),
      simP99Ms: p.simMs.percentile(0.99),
      gpuMs: p.gpuTimingAvailable && p.gpuMs.count > 0 ? p.gpuMs.mean() : null,
      drawCalls: p.drawCalls,
      triangles: p.triangles,
      graph: presenter.graphSummary,
      footsteps: session.footstepCount,
      audioPlayed: session.audio?.played ?? 0,
      replayTicks: session.recorder?.ticks ?? 0,
    };
  };

  window.__warDebug = {
    setEffect(id, enabled) {
      const box = [...checkboxes.entries()].find(([k]) => k === id);
      if (box === undefined) return false;
      presenter.postFx[box[0]].enabled = enabled;
      box[1].checked = enabled;
      return true;
    },
    setAllEffects: setAll,
    setParam(id, key, value) {
      const effect = EFFECT_IDS.find((e) => e === id);
      return effect !== undefined && setEffectParam(presenter.postFx, effect, key, value);
    },
    setStimulus(damage, fear, emi) {
      stim.damage = damage;
      stim.fear = fear;
      stim.emi = emi;
      applyStim();
    },
    triggerSignalLoss() {
      presenter.signal.trigger(performance.now() / 1000);
    },
    stats,
    setZone(zone) {
      if (director === null) return false;
      if (zone === null) {
        director.overrides.zone = null;
        return true;
      }
      if (!isZoneId(zone)) return false;
      director.overrides.zone = zone;
      return true;
    },
    setAudioOverride(key, value) {
      if (director !== null) director.overrides[key] = value;
    },
    audioStats() {
      if (director === null || engine === null) return null;
      return {
        zones: { ...director.context.zones },
        levels: { ...engine.levels },
        rt60: director.acoustics?.rt60 ?? null,
        enclosure: director.acoustics?.enclosure ?? null,
        distantPlayed: engine.distantPlayed,
        workletReady: engine.workletReady,
        localPlayed: engine.localPlayed,
        heartbeat: director.mix.heartbeat.gain,
      };
    },
    selectWeapon,
    ...worldTab.api,
    ...bestiaryTab.api,
    ...storyTab.api,
    aimAt(x, y, z) {
      const v = presenter.view;
      const yaw = Math.atan2(-(x - v.x), -(z - v.z));
      const pitch = Math.atan2(y - v.y, Math.hypot(x - v.x, z - v.z));
      queue?.push({ type: 'look', yaw: yaw - v.yaw, pitch: pitch - v.pitch });
    },
    fire(ads = true) {
      if (queue === null) return;
      if (ads) queue.push({ type: 'action', action: 'aim', pressed: true });
      queue.push(
        { type: 'action', action: 'fire', pressed: true },
        { type: 'action', action: 'fire', pressed: false },
      );
      if (ads) queue.push({ type: 'action', action: 'aim', pressed: false });
    },
    setPaths(show) {
      paths.checked = show;
      presenter.combatFx.showPaths = show;
    },
    resetTargets() {
      resetTargets(simulation.world);
    },
    combatLog() {
      const c = session.combat;
      return {
        shots: c.shots,
        hits: c.hits,
        kills: c.kills,
        impacts: c.impacts,
        explosions: c.explosions,
        recent: [...c.recent],
      };
    },
    weaponState() {
      const w = presenter.view.weapon;
      return {
        id: w.id,
        phase: w.phase,
        mag: w.mag,
        chambered: w.chambered,
        reserve: w.reserve,
        wear: w.wear,
      };
    },
    pauseAtTick(tick) {
      loop?.pauseAtTick(tick);
    },
    setColliders(enabled) {
      colliders.checked = enabled;
      presenter.setColliderOverlay(enabled);
    },
  };

  const view = createRenderView();
  let lastRefresh = performance.now();
  const refresh = (): void => {
    const now = performance.now();
    bestiaryTab.refresh(Math.min(0.1, (now - lastRefresh) / 1000));
    lastRefresh = now;
    if (!panel.hidden) {
      const v = readRenderView(session.sandbox, 1, view);
      simInfo.textContent = [
        `seed   ${String(simulation.seed)}`,
        `tick   ${String(simulation.tick)}`,
        `hash   ${simulation.stateHash()}`,
        `order  ${simulation.systemOrder.join(' → ')}`,
        '',
        `pos    ${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.z.toFixed(2)}  speed ${v.speed.toFixed(2)} m/s`,
        `body   ${v.grounded ? 'grounded' : 'airborne'}  crouch ${v.crouch.toFixed(2)}  stamina ${(v.stamina * 100).toFixed(0)}%`,
        `steps  ${String(session.footstepCount)}  last surface ${session.footsteps?.lastSurface.value ?? '-'}`,
        `audio  ${session.audio === null ? 'unavailable' : session.audio.running ? `running, ${String(session.audio.played)} sounds` : 'locked (click to start)'}`,
        `replay ${session.playing !== null ? `playing ${String(session.playing.length)} ticks` : `${String(session.recorder?.ticks ?? 0)} ticks recorded`}`,
      ].join('\n');
      const s = stats();
      const p = presenter.profiler;
      const size = presenter.internalSize;
      const over = (v: number, budget: number): string => (v > budget ? ' ⚠ over budget' : '');
      renderInfo.textContent = [
        `fps      ${s.fps.toFixed(1)}   (p99 frame ${p.frameMs.percentile(0.99).toFixed(1)} ms)`,
        `cpu      ${s.cpuMs.toFixed(2)} ms${over(s.cpuMs, FRAME_BUDGETS.cpuRender)}`,
        `sim      ${s.simMs.toFixed(3)} ms/tick  p99 ${s.simP99Ms.toFixed(3)}${over(s.simP99Ms, FRAME_BUDGETS.simulation)}`,
        `gpu      ${s.gpuMs === null ? 'n/a (timer query unavailable)' : `${s.gpuMs.toFixed(2)} ms${over(s.gpuMs, FRAME_BUDGETS.gpu)}`}`,
        `draws    ${String(s.drawCalls)}   tris ${String(s.triangles)}`,
        `internal ${String(size.width)}×${String(size.height)}`,
        `memory   ${heapMb()}`,
        `post     ${s.graph}`,
        `bake     ${[...presenter.bakeTimes].map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join(', ')}`,
      ].join('\n');
      graph.draw(p.frameMs, FRAME_BUDGETS.frame);
      worldTab.refresh();
      storyTab.refresh();
      const w = presenter.view.weapon;
      weaponInfo.textContent = [
        `weapon  ${w.id ?? '-'}  (${w.phase}${w.phase === 'reloading' ? ` · ${w.stage}` : ''})`,
        `loaded  ${String(w.mag)}${w.chambered ? '+1' : ''}   reserve ${w.infinite ? '∞' : String(w.reserve)}   wear ${(w.wear * 100).toFixed(1)}%`,
        `log     ${String(session.combat.shots)} shots · ${String(session.combat.hits)} hits · ${String(session.combat.kills)} kills`,
      ].join('\n');
      hitTable.textContent = [
        'weapon    race    part     dist    dmg   drop   ToF  ',
        ...session.combat.recent
          .slice(0, 10)
          .map(
            (h) =>
              `${h.weapon.padEnd(9)} ${h.race.padEnd(7)} ${h.part.padEnd(7)} ${h.distance.toFixed(1).padStart(6)}m ${h.damage.toFixed(0).padStart(5)} ${h.dropCm.toFixed(0).padStart(4)}cm ${h.timeMs.toFixed(0).padStart(4)}ms${h.killed ? ' ✝' : ''}`,
          ),
      ].join('\n');
      if (director !== null && engine !== null) {
        const a = director.acoustics;
        const zones = Object.entries(director.context.zones)
          .map(([z, w]) => `${z} ${w.toFixed(2)}`)
          .join(', ');
        audioInfo.textContent = [
          `engine   ${engine.running ? 'running' : 'locked (click the view)'}  worklet ${engine.workletReady ? 'ready' : 'loading'}`,
          `zone     ${zones || '-'}`,
          `night    ${director.context.night.toFixed(2)}  indoor ${director.context.indoor.toFixed(2)}`,
          `room     ${a === null ? '-' : `RT60 ${a.rt60.toFixed(2)} s  enclosure ${a.enclosure.toFixed(2)}  ${a.covered ? 'covered' : 'open sky'}  wet ${a.wet.toFixed(2)}`}`,
          `distant  ${String(engine.distantPlayed)} played, last ${director.lastDistant ?? '-'}`,
          `muffle   ${director.mix.muffleHz.toFixed(0)} Hz  heartbeat ${director.mix.heartbeat.gain.toFixed(2)} @ ${director.mix.heartbeat.bpm.toFixed(0)} bpm`,
        ].join('\n');
        for (const [id, bar] of meters) {
          const level = engine.levels[id] ?? 0;
          bar.style.width = `${String(Math.min(100, Math.round(Math.sqrt(level) * 220)))}%`;
        }
      }
    }
    requestAnimationFrame(refresh);
  };
  requestAnimationFrame(refresh);
  root.dataset['debug'] = '1';
}

function heapMb(): string {
  const mem: unknown = Reflect.get(performance, 'memory');
  const used: unknown =
    typeof mem === 'object' && mem !== null ? Reflect.get(mem, 'usedJSHeapSize') : undefined;
  return typeof used === 'number' ? `${(used / 1048576).toFixed(1)} MB JS heap` : 'n/a';
}
