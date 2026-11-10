import { clamp, cos, PI, sin, TAU } from '../math/dmath';

/**
 * Time of day and weather: pure functions of the simulation's environment
 * state, so render, audio and (from stage 6) AI all read the same values.
 *
 * Clock: seconds since midnight on the incident date (mid-October, ~50° N).
 * The game starts in late dusk and runs at TIME_SCALE game seconds per real
 * second, so full night falls after ~14 minutes of play.
 *
 * Weather is stateless: a function of the seed and the weather clock (game
 * seconds since the start). Fronts last FRONT_SECONDS and blend smoothly into
 * the next; any moment can be evaluated directly (replay scrubbing, tests).
 */
export const DAY_SECONDS = 86400;
export const START_TIME_OF_DAY = 18 * 3600 + 50 * 60;
export const TIME_SCALE = 6;
export const FRONT_SECONDS = 20 * 60;

export interface Weather {
  /** 0 = clear air, 1 = thick fog. */
  fog: number;
  /** 0 = dry, 1 = downpour. */
  rain: number;
  /** 0 = still, 1 = gale (~18 m/s). */
  wind: number;
  /** Direction the wind blows toward, radians around +Y (0 = toward −Z). */
  windDir: number;
}

export function createWeather(): Weather {
  return { fog: 0, rain: 0, wind: 0, windDir: 0 };
}

export const WIND_MAX_MPS = 18;

export const WEATHER_REGIMES = ['clear', 'mist', 'drizzle', 'storm', 'windy'] as const;
export type WeatherRegime = (typeof WEATHER_REGIMES)[number];

/** Typical weather of each regime: [fog, rain, wind]. */
const REGIME: Readonly<Record<WeatherRegime, readonly [number, number, number]>> = {
  clear: [0.12, 0, 0.25],
  mist: [0.65, 0, 0.1],
  drizzle: [0.35, 0.35, 0.35],
  storm: [0.3, 0.9, 0.85],
  windy: [0.08, 0, 0.8],
};
/** How likely each regime is for a front (sums to 1). */
const REGIME_WEIGHTS: readonly number[] = [0.35, 0.2, 0.25, 0.08, 0.12];

/** 32-bit integer hash (lowbias32): allocation-free per-front randomness. */
function hash32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function unit(seed: number, front: number, salt: number): number {
  return hash32(hash32(seed ^ Math.imul(front + 1, 0x9e3779b9)) ^ salt) / 4294967296;
}

/** The regime of front `front` (the first front of a run is always misty: the incident night). */
export function frontRegime(seed: number, front: number): WeatherRegime {
  if (front === 0) return 'mist';
  let r = unit(seed, front, 0x51);
  for (let i = 0; i < WEATHER_REGIMES.length; i++) {
    r -= REGIME_WEIGHTS[i] ?? 0;
    if (r < 0) return WEATHER_REGIMES[i] ?? 'clear';
  }
  return 'clear';
}

function frontValue(seed: number, front: number, channel: 0 | 1 | 2): number {
  const base = REGIME[frontRegime(seed, front)][channel];
  const jitter = (unit(seed, front, 0x100 + channel) - 0.5) * 0.2;
  return clamp(base + jitter, 0, 1);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Weather at `clock` game seconds after the start. Writes into `out`. */
export function weatherAt(seed: number, clock: number, out: Weather): Weather {
  const t = Math.max(0, clock) / FRONT_SECONDS;
  const front = Math.floor(t);
  // The last 35% of each front blends into the next.
  const k = smoothstep(0.65, 1, t - front);
  out.fog = frontValue(seed, front, 0) * (1 - k) + frontValue(seed, front + 1, 0) * k;
  out.rain = frontValue(seed, front, 1) * (1 - k) + frontValue(seed, front + 1, 1) * k;
  out.wind = frontValue(seed, front, 2) * (1 - k) + frontValue(seed, front + 1, 2) * k;
  // Prevailing direction from the seed, veering slowly with each front.
  const base = unit(seed, -1, 0x77) * TAU;
  const veer =
    (unit(seed, front, 0x78) - 0.5) * 1.2 * (1 - k) + (unit(seed, front + 1, 0x78) - 0.5) * 1.2 * k;
  out.windDir = base + veer;
  return out;
}

/** Sun elevation (radians) for an October day at ~50° N: up 06:50, down 18:20, 32° at noon. */
export function sunElevation(timeOfDay: number): number {
  const hours = (((timeOfDay % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / 3600;
  const sunrise = 6 + 50 / 60;
  const daylength = 18 + 20 / 60 - sunrise;
  return ((32 * PI) / 180) * sin((PI * (hours - sunrise)) / daylength);
}

/** Sun azimuth (radians around +Y, 0 = toward −Z / north): east at sunrise, west at sunset. */
export function sunAzimuth(timeOfDay: number): number {
  const hours = (((timeOfDay % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / 3600;
  // 15° per hour, south (π) at solar noon ~12:35.
  return PI + ((hours - 12.58) * PI) / 12;
}

const DEG = PI / 180;

/** Sky light 0..1: full by +6° elevation, gone at −18° (end of astronomical twilight). */
export function daylight(elevation: number): number {
  const t = smoothstep(-18 * DEG, 6 * DEG, elevation);
  return t * t;
}

/** 0 = sun still up, 1 = full night (sun below −16°): drives insects, mob schedules. */
export function nightness(elevation: number): number {
  return 1 - smoothstep(-16 * DEG, 0, elevation);
}

/**
 * Fog extinction coefficient (1/m). The night street look of stage 1 is
 * 0.034; clear dusk air is thinner, fog and rain thicken it.
 */
export function fogDensity(w: Weather, light: number): number {
  const fog = clamp(w.fog, 0, 1);
  return 0.022 + 0.012 * (1 - light) + 0.075 * fog * fog + 0.014 * clamp(w.rain, 0, 1);
}

/** Meteorological visibility (m): where contrast falls to 5% (Koschmieder: 3 / extinction). */
export function visibilityMeters(w: Weather, light: number): number {
  return 3 / fogDensity(w, light);
}

/**
 * How weather and light scale what mobs can perceive (used from stage 6).
 * sight: ambient visibility, before flashlights and other light sources.
 * hearing: rain and wind mask footsteps and gunfire.
 */
export function perceptionScale(
  w: Weather,
  light: number,
  out: { sight: number; hearing: number } = { sight: 0, hearing: 0 },
): { sight: number; hearing: number } {
  out.sight = clamp(visibilityMeters(w, light) / 90, 0, 1) * (0.2 + 0.8 * light);
  out.hearing = clamp(1 - 0.45 * clamp(w.rain, 0, 1) - 0.25 * clamp(w.wind, 0, 1), 0.2, 1);
  return out;
}

/** Horizontal wind velocity (m/s) for particles and later ballistics. */
export function windVector(w: Weather, out: { x: number; z: number }): { x: number; z: number } {
  const speed = clamp(w.wind, 0, 1) * WIND_MAX_MPS;
  out.x = -sin(w.windDir) * speed;
  out.z = -cos(w.windDir) * speed;
  return out;
}
