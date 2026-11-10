import type { CommandQueue } from '../../application/replay/command-queue';
import type { Sandbox } from '../../application/scenes/sandbox';
import type { EnvKey } from '../../domain/input/commands';
import {
  daylight,
  frontRegime,
  FRONT_SECONDS,
  nightness,
  perceptionScale,
  sunElevation,
  visibilityMeters,
} from '../../domain/world/environment';
import { chunkCoord } from '../../domain/world/chunks';
import { HUBS, WORLD_SPAWN, hubAt } from '../../domain/world/world-map';
import type { BodycamPresenter } from '../../infrastructure/render/bodycam-presenter';
import { FRAME_BUDGETS } from '../../infrastructure/render/budgets';
import { formatTimeOfDay } from '../../infrastructure/render/osd/format';
import { el, slider, sparkline } from './widgets';

/** What tests and the console can read about the open world. */
export interface WorldDebugStats {
  timeOfDay: number;
  timeScale: number;
  fog: number;
  rain: number;
  wind: number;
  daylight: number;
  visibility: number;
  zone: string;
  simChunks: number;
  colliders: number;
  renderChunks: number;
  pendingChunks: number;
  streamMeanMs: number;
  streamP95Ms: number;
  streamP99Ms: number;
  streamMaxMs: number;
  poolLights: number;
}

export interface WorldDebugApi {
  worldStats(): WorldDebugStats | null;
  /** Send an `env` command (value −1 hands weather back to the simulation). */
  setEnv(key: EnvKey, value: number): void;
  /** Teleport to a hub by label/zone id, 'spawn', or a point. */
  teleport(target: string | readonly [number, number, number]): boolean;
  setChunkOverlay(enabled: boolean): void;
}

const SCALES: readonly number[] = [0, 1, 6, 60, 600];

export function installWorldTab(
  section: HTMLElement,
  sandbox: Sandbox,
  presenter: BodycamPresenter,
  queue: CommandQueue | null,
): { refresh(): void; api: WorldDebugApi } {
  const world = presenter.world;
  const info = el('pre');
  const graph = sparkline(220, 40);
  section.append(info);

  const push = (key: EnvKey, value: number): void => {
    queue?.push({ type: 'env', key, value });
  };

  const time = slider('time (h)', 0, 23.99, 0.05, presenter.view.env.timeOfDay / 3600, (h) => {
    push('timeOfDay', h * 3600);
  });
  const scale = el('select');
  for (const s of SCALES)
    scale.append(new Option(s === 0 ? 'clock paused' : `×${String(s)}`, String(s)));
  scale.value = String(presenter.view.env.timeScale);
  scale.addEventListener('change', () => {
    push('timeScale', Number(scale.value));
  });
  const weatherBox = el('fieldset');
  weatherBox.append(el('legend', '', 'weather (untick auto to override)'));
  for (const key of ['fog', 'rain', 'wind'] as const) {
    const auto = el('input');
    auto.type = 'checkbox';
    auto.checked = true;
    const s = slider(key, 0, 1, 0.01, 0, (v) => {
      auto.checked = false;
      push(key, v);
    });
    auto.addEventListener('change', () => {
      push(key, auto.checked ? -1 : Number(s.input.value));
    });
    const label = el('label', '', ' auto');
    label.prepend(auto);
    weatherBox.append(s.row, label);
  }

  const teleports = el('fieldset');
  teleports.append(el('legend', '', 'teleport'));
  const teleport = (target: string | readonly [number, number, number]): boolean => {
    if (queue === null) return false;
    const p: readonly [number, number, number] | null =
      typeof target !== 'string'
        ? target
        : target === 'spawn'
          ? WORLD_SPAWN.position
          : (HUBS.find((h) => h.zone === target || h.label === target)?.anchor ?? null);
    if (p === null) return false;
    queue.push({ type: 'teleport', x: p[0], y: p[1] + 0.05, z: p[2] });
    return true;
  };
  for (const h of HUBS) {
    const b = el('button', '', h.label);
    b.type = 'button';
    b.dataset['hub'] = h.zone;
    b.addEventListener('click', () => {
      teleport(h.zone);
    });
    teleports.append(b);
  }
  const overlay = el('input');
  overlay.type = 'checkbox';
  overlay.addEventListener('change', () => {
    world?.setChunkOverlay(overlay.checked);
  });
  const overlayLabel = el('label', '', ' chunk overlay');
  overlayLabel.prepend(overlay);
  section.append(
    time.row,
    el('label', '', 'speed '),
    scale,
    weatherBox,
    teleports,
    overlayLabel,
    el('br'),
    graph.canvas,
  );

  const stats = (): WorldDebugStats | null => {
    const v = presenter.view;
    const env = v.env;
    if (!env.active || world === null) return null;
    const L = daylight(sunElevation(env.timeOfDay));
    const p = world.chunks.frameMs;
    return {
      timeOfDay: env.timeOfDay,
      timeScale: env.timeScale,
      fog: env.weather.fog,
      rain: env.weather.rain,
      wind: env.weather.wind,
      daylight: L,
      visibility: visibilityMeters(env.weather, L),
      zone: hubAt(v.x, v.z).zone,
      simChunks: sandbox.chunks?.loadedCount ?? 0,
      colliders: sandbox.physics.staticColliderCount,
      renderChunks: world.chunks.loadedCount,
      pendingChunks: world.chunks.pendingCount,
      streamMeanMs: p.mean(),
      streamP95Ms: p.percentile(0.95),
      streamP99Ms: p.percentile(0.99),
      streamMaxMs: world.chunks.maxFrameMs,
      poolLights: world.pool.active,
    };
  };

  let frame = 0;
  const refresh = (): void => {
    const s = stats();
    if (s === null || world === null) {
      info.textContent = 'No open world in this scene (?scene=world).';
      return;
    }
    const v = presenter.view;
    const e = sunElevation(s.timeOfDay);
    const per = perceptionScale(v.env.weather, s.daylight);
    const front = Math.floor(v.env.clock / FRONT_SECONDS);
    info.textContent = [
      `clock    ${formatTimeOfDay(s.timeOfDay)}  ×${String(s.timeScale)}   sun ${((e * 180) / Math.PI).toFixed(1)}°  daylight ${s.daylight.toFixed(2)}  night ${nightness(e).toFixed(2)}`,
      `weather  fog ${s.fog.toFixed(2)}  rain ${s.rain.toFixed(2)}  wind ${s.wind.toFixed(2)}  (front: ${frontRegime(sandbox.simulation.seed, front)})`,
      `visible  ${s.visibility.toFixed(0)} m   mob sight ×${per.sight.toFixed(2)}  hearing ×${per.hearing.toFixed(2)}`,
      `zone     ${s.zone}   chunk ${String(chunkCoord(v.x))},${String(chunkCoord(v.z))}`,
      `physics  ${String(s.simChunks)} chunks, ${String(s.colliders)} colliders`,
      `render   ${String(s.renderChunks)} chunks (+${String(s.pendingChunks)} pending)  lights ${String(s.poolLights)}`,
      `stream   ${s.streamMeanMs.toFixed(2)} ms mean  p99 ${s.streamP99Ms.toFixed(2)}  max ${s.streamMaxMs.toFixed(2)}  (budget ${FRAME_BUDGETS.streaming.toFixed(1)} ms)`,
    ].join('\n');
    graph.draw(world.chunks.frameMs, FRAME_BUDGETS.streaming);
    if (overlay.checked && frame++ % 15 === 0) {
      world.refreshChunkOverlay((cx, cz) => sandbox.chunks?.isLoaded(cx, cz) ?? false);
    }
  };

  return {
    refresh,
    api: {
      worldStats: stats,
      setEnv: push,
      teleport,
      setChunkOverlay(enabled) {
        overlay.checked = enabled;
        world?.setChunkOverlay(enabled);
        if (enabled)
          world?.refreshChunkOverlay((cx, cz) => sandbox.chunks?.isLoaded(cx, cz) ?? false);
      },
    },
  };
}
