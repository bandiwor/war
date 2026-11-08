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
import { QUALITY_PRESETS } from '../../infrastructure/render/quality';
import { el, slider, sparkline } from './widgets';

/** Marker string checked by scripts/check-bundle.mjs to prove tree-shaking. */
export const DEBUG_MENU_MARKER = 'WAR_DEBUG_MENU';

export interface DebugMenuDeps {
  readonly root: HTMLElement;
  readonly simulation: Simulation;
  readonly loop: GameLoop | null;
  readonly presenter: BodycamPresenter;
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
    gpuMs: number | null;
    drawCalls: number;
    triangles: number;
    graph: string;
  };
}

declare global {
  interface Window {
    __warDebug?: WarDebugApi;
  }
}

/**
 * DEV-only debug menu (toggle with `~`). Sections are generated from the
 * registries: adding an effect to POST_EFFECTS adds its toggle and sliders here.
 */
export function installDebugMenu({ root, simulation, loop, presenter }: DebugMenuDeps): void {
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
  render.append(renderInfo, graph.canvas, el('label', '', 'quality '), quality);

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
      gpuMs: p.gpuTimingAvailable && p.gpuMs.count > 0 ? p.gpuMs.mean() : null,
      drawCalls: p.drawCalls,
      triangles: p.triangles,
      graph: presenter.graphSummary,
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
  };

  const refresh = (): void => {
    if (!panel.hidden) {
      simInfo.textContent = [
        `seed   ${String(simulation.seed)}`,
        `tick   ${String(simulation.tick)}`,
        `hash   ${simulation.stateHash()}`,
        `order  ${simulation.systemOrder.join(' → ')}`,
      ].join('\n');
      const s = stats();
      const p = presenter.profiler;
      const size = presenter.internalSize;
      const over = (v: number, budget: number): string => (v > budget ? ' ⚠ over budget' : '');
      renderInfo.textContent = [
        `fps      ${s.fps.toFixed(1)}   (p99 frame ${p.frameMs.percentile(0.99).toFixed(1)} ms)`,
        `cpu      ${s.cpuMs.toFixed(2)} ms${over(s.cpuMs, FRAME_BUDGETS.cpuRender)}`,
        `gpu      ${s.gpuMs === null ? 'n/a (timer query unavailable)' : `${s.gpuMs.toFixed(2)} ms${over(s.gpuMs, FRAME_BUDGETS.gpu)}`}`,
        `draws    ${String(s.drawCalls)}   tris ${String(s.triangles)}`,
        `internal ${String(size.width)}×${String(size.height)}`,
        `memory   ${heapMb()}`,
        `post     ${s.graph}`,
        `bake     ${[...presenter.bakeTimes].map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join(', ')}`,
      ].join('\n');
      graph.draw(p.frameMs, FRAME_BUDGETS.frame);
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
