import { at, defineComponent } from '../../domain/ecs/component';
import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import type { World } from '../../domain/ecs/world';
import { clamp } from '../../domain/math/dmath';
import {
  createWeather,
  DAY_SECONDS,
  START_TIME_OF_DAY,
  TIME_SCALE,
  weatherAt,
  type Weather,
} from '../../domain/world/environment';
import type { SimContext } from '../simulation';

/**
 * The world's clock and weather, as simulation state: part of the state hash
 * and changed only through `env` commands, so replays reproduce them.
 * Overrides of −1 leave the weather to the seeded fronts.
 */
export const Environment = defineComponent('Environment', {
  /** Seconds since midnight. */
  timeOfDay: 'f64',
  /** Game seconds per simulated second. */
  timeScale: 'f64',
  /** Game seconds since the start: drives the weather fronts. */
  clock: 'f64',
  fog: 'f64',
  rain: 'f64',
  wind: 'f64',
  windDir: 'f64',
  fogOverride: 'f64',
  rainOverride: 'f64',
  windOverride: 'f64',
});

/** Largest time scale the debug menu may set (one game hour per real second). */
export const MAX_TIME_SCALE = 3600;

export function spawnEnvironment(world: World): EntityId {
  const e = world.spawn();
  const store = world.store(Environment);
  const row = store.add(e);
  const f = store.fields;
  f.timeOfDay[row] = START_TIME_OF_DAY;
  f.timeScale[row] = TIME_SCALE;
  f.fogOverride[row] = -1;
  f.rainOverride[row] = -1;
  f.windOverride[row] = -1;
  return e;
}

function override(value: number): number {
  return value < 0 ? -1 : clamp(value, 0, 1);
}

export function environmentSystem(entity: EntityId, seed: number): System<SimContext> {
  const weather: Weather = createWeather();
  return {
    name: 'world.environment',
    after: ['input.intent'],
    run(ctx) {
      const store = ctx.world.store(Environment);
      const row = store.rowOf(entity);
      if (row < 0) return;
      const f = store.fields;
      const commands = ctx.commands;
      for (let i = 0; i < commands.length; i++) {
        const c = commands[i];
        if (c?.type !== 'env') continue;
        switch (c.key) {
          case 'timeOfDay':
            f.timeOfDay[row] = clamp(c.value, 0, DAY_SECONDS - 1e-6);
            break;
          case 'timeScale':
            f.timeScale[row] = clamp(c.value, 0, MAX_TIME_SCALE);
            break;
          case 'fog':
            f.fogOverride[row] = override(c.value);
            break;
          case 'rain':
            f.rainOverride[row] = override(c.value);
            break;
          case 'wind':
            f.windOverride[row] = override(c.value);
            break;
        }
      }
      const advance = ctx.dt * at(f.timeScale, row);
      let tod = at(f.timeOfDay, row) + advance;
      if (tod >= DAY_SECONDS) tod -= DAY_SECONDS;
      f.timeOfDay[row] = tod;
      const clock = at(f.clock, row) + advance;
      f.clock[row] = clock;
      weatherAt(seed, clock, weather);
      const fo = at(f.fogOverride, row);
      const ro = at(f.rainOverride, row);
      const wo = at(f.windOverride, row);
      f.fog[row] = fo < 0 ? weather.fog : fo;
      f.rain[row] = ro < 0 ? weather.rain : ro;
      f.wind[row] = wo < 0 ? weather.wind : wo;
      f.windDir[row] = weather.windDir;
    },
  };
}

/** Read model of the environment for render and audio (no ECS types leak out). */
export interface EnvironmentView {
  /** False in scenes without a world clock (street, range): presenters use the fixed night look. */
  active: boolean;
  timeOfDay: number;
  timeScale: number;
  /** Game seconds since the start (weather fronts). */
  clock: number;
  weather: Weather;
}

export function createEnvironmentView(): EnvironmentView {
  return {
    active: false,
    timeOfDay: START_TIME_OF_DAY,
    timeScale: 0,
    clock: 0,
    weather: createWeather(),
  };
}

export function readEnvironment(world: World, out: EnvironmentView): EnvironmentView {
  const store = world.tryStore(Environment);
  if (store === null || store.size === 0) {
    out.active = false;
    return out;
  }
  const row = 0;
  const f = store.fields;
  out.active = true;
  out.timeOfDay = at(f.timeOfDay, row);
  out.timeScale = at(f.timeScale, row);
  out.clock = at(f.clock, row);
  out.weather.fog = at(f.fog, row);
  out.weather.rain = at(f.rain, row);
  out.weather.wind = at(f.wind, row);
  out.weather.windDir = at(f.windDir, row);
  return out;
}
