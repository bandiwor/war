import { clamp } from '../math/dmath';
import { DISTANT_KINDS, ZONE_IDS, ZONE_SOUNDSCAPES, type DistantKind, type ZoneId } from './zones';

/**
 * Turns the game situation into ambient layer targets. Pure: the same context
 * always gives the same mix, so the rules below are unit-tested directly.
 */
export interface AmbienceContext {
  /** Zone weights at the listener (blend across boundaries); need not sum to 1. */
  zones: Partial<Record<ZoneId, number>>;
  /** 0 = dusk, 1 = deep night. */
  night: number;
  /** Overall threat level (combat, alarms). */
  danger: number;
  /** 0 = no enemy nearby, 1 = enemy right here. */
  enemyProximity: number;
  /** 1 = healthy, 0 = dying. */
  health: number;
  /** 0 = open air, 1 = fully enclosed (from acoustic probes). */
  indoor: number;
  rain: number;
}

export interface AmbientMix {
  wind: { gain: number; gustiness: number; brightness: number };
  hum: { gain: number; freq: number; harmonics: number };
  insects: { gain: number; density: number; pitch: number; cicada: number };
  drips: { gain: number; rate: number; pitch: number };
  creaks: { gain: number; ratePerMinute: number; metal: number };
  rumble: { gain: number; freq: number };
  roomTone: { gain: number; brightness: number };
  rain: { gain: number };
  heartbeat: { gain: number; bpm: number };
  tinnitus: { gain: number };
  /** Master low-pass (Hz): muffles the world when badly hurt. */
  muffleHz: number;
  distantRatePerMinute: number;
  distantWeights: Record<DistantKind, number>;
}

export function createAmbienceContext(): AmbienceContext {
  return {
    zones: { abandonedCity: 1 },
    night: 0.7,
    danger: 0,
    enemyProximity: 0,
    health: 1,
    indoor: 0,
    rain: 0,
  };
}

export function createMix(): AmbientMix {
  return {
    wind: { gain: 0, gustiness: 0, brightness: 0 },
    hum: { gain: 0, freq: 50, harmonics: 0 },
    insects: { gain: 0, density: 0, pitch: 4000, cicada: 0 },
    drips: { gain: 0, rate: 0, pitch: 0 },
    creaks: { gain: 0, ratePerMinute: 0, metal: 0 },
    rumble: { gain: 0, freq: 40 },
    roomTone: { gain: 0, brightness: 0 },
    rain: { gain: 0 },
    heartbeat: { gain: 0, bpm: 70 },
    tinnitus: { gain: 0 },
    muffleHz: 20000,
    distantRatePerMinute: 0,
    distantWeights: { bark: 0, howl: 0, clang: 0, siren: 0, chirp: 0, shot: 0 },
  };
}

function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Blends zone profiles by weight (weights are normalised; empty → abandoned city). */
function blendZones(zones: AmbienceContext['zones'], out: AmbientMix): void {
  let total = 0;
  for (const id of ZONE_IDS) total += Math.max(0, zones[id] ?? 0);
  const fallback = total <= 0;
  const zeroed = createMix();
  Object.assign(out.wind, zeroed.wind);
  Object.assign(out.hum, { gain: 0, freq: 0, harmonics: 0 });
  Object.assign(out.insects, { gain: 0, density: 0, pitch: 0, cicada: 0 });
  Object.assign(out.drips, zeroed.drips);
  Object.assign(out.creaks, zeroed.creaks);
  Object.assign(out.rumble, { gain: 0, freq: 0 });
  Object.assign(out.roomTone, zeroed.roomTone);
  out.distantRatePerMinute = 0;
  for (const k of DISTANT_KINDS) out.distantWeights[k] = 0;
  for (const id of ZONE_IDS) {
    const w = fallback ? (id === 'abandonedCity' ? 1 : 0) : Math.max(0, zones[id] ?? 0) / total;
    if (w === 0) continue;
    const z = ZONE_SOUNDSCAPES[id];
    out.wind.gain += w * z.wind.level;
    out.wind.gustiness += w * z.wind.gustiness;
    out.wind.brightness += w * z.wind.brightness;
    out.hum.gain += w * z.hum.level;
    out.hum.freq += w * z.hum.freq;
    out.hum.harmonics += w * z.hum.harmonics;
    out.insects.gain += w * z.insects.level;
    out.insects.density += w * z.insects.density;
    out.insects.pitch += w * z.insects.pitch;
    out.insects.cicada += w * z.insects.cicada;
    out.drips.gain += w * z.drips.level;
    out.drips.rate += w * z.drips.rate;
    out.drips.pitch += w * z.drips.pitch;
    out.creaks.gain += w * z.creaks.level;
    out.creaks.ratePerMinute += w * z.creaks.ratePerMinute;
    out.creaks.metal += w * z.creaks.metal;
    out.rumble.gain += w * z.rumble.level;
    out.rumble.freq += w * z.rumble.freq;
    out.roomTone.gain += w * z.roomTone.level;
    out.roomTone.brightness += w * z.roomTone.brightness;
    out.distantRatePerMinute += w * z.distant.ratePerMinute;
    for (const k of DISTANT_KINDS) out.distantWeights[k] += w * z.distant.weights[k];
  }
}

/**
 * Situation rules (each is a deliberate design choice, tested individually):
 *  - night brings insects up and calms the wind a little;
 *  - insects fall silent when an enemy is close (the classic "it went quiet");
 *  - danger adds sub rumble, a heartbeat and more distant events;
 *  - low health muffles the world, adds the heartbeat and tinnitus;
 *  - being indoors filters the wind and brings up room tone;
 *  - rain masks insects.
 */
export function computeMix(ctx: AmbienceContext, out: AmbientMix): AmbientMix {
  blendZones(ctx.zones, out);
  const night = clamp(ctx.night, 0, 1);
  const danger = clamp(ctx.danger, 0, 1);
  const prox = clamp(ctx.enemyProximity, 0, 1);
  const health = clamp(ctx.health, 0, 1);
  const indoor = clamp(ctx.indoor, 0, 1);
  const rain = clamp(ctx.rain, 0, 1);

  out.insects.gain *=
    (0.35 + 0.65 * night) * (1 - 0.95 * smooth(0.1, 0.6, prox)) * (1 - 0.7 * rain) * (1 - indoor);
  out.wind.gain *= (1 - 0.25 * night) * (1 - 0.85 * indoor);
  out.wind.brightness *= 1 - 0.7 * indoor;
  out.roomTone.gain = Math.max(out.roomTone.gain, 0.35 * indoor);
  out.rumble.gain = clamp(out.rumble.gain + 0.45 * danger, 0, 1);
  out.rain.gain = rain * (1 - 0.6 * indoor);

  const hurt = 1 - health;
  out.heartbeat.gain = clamp(0.7 * smooth(0.35, 1, danger) + 0.9 * smooth(0.55, 0.95, hurt), 0, 1);
  out.heartbeat.bpm = 62 + 70 * Math.max(danger, smooth(0.5, 1, hurt));
  out.tinnitus.gain = 0.35 * smooth(0.7, 1, hurt);
  out.muffleHz = 20000 - (20000 - 700) * smooth(0.45, 0.95, hurt);
  out.distantRatePerMinute *= 1 + 1.5 * danger;
  return out;
}
