import { clamp } from '../math/dmath';

/**
 * Animals' needs and emotions, as pure rules (ADR-0013). An animal's base
 * aggression from the registry is shaped by:
 *  - hunger: a fed animal rarely attacks first; a starving one does;
 *  - its pack: each packmate nearby adds courage, a lone pack animal has little;
 *  - provocation: being shot makes it angry for a while;
 *  - its territory: anything inside it is attacked;
 *  - the night: predators are bolder in the dark;
 *  - fear: wounds, gunfire, the flashlight and lost packmates take the fight out of it.
 */
export interface DriveInputs {
  baseAggression: number;
  /** Registry hunger rate (0 = the animal has no hunger drive). */
  hungerRate: number;
  hunger: number;
  /** Aggression per packmate nearby (0 = loner) and how many are near. */
  pack: number;
  packmates: number;
  fear: number;
  /** Seconds since it was last hit. */
  sinceHit: number;
  territory: number;
  /** Distance of the target from the animal's home. */
  targetFromHome: number;
  /** 0 = day, 1 = deep night. */
  night: number;
}

/** Seconds a hit keeps an animal angry. */
export const PROVOKED_SECONDS = 8;

export function effectiveAggression(d: DriveInputs): number {
  const hungerFactor = d.hungerRate > 0 ? 0.3 + 1.4 * clamp(d.hunger, 0, 1) : 1;
  let a = d.baseAggression * hungerFactor;
  a += d.pack * d.packmates;
  if (d.pack > 0 && d.packmates === 0) a -= 0.1; // alone, a pack animal loses its nerve
  if (d.sinceHit < PROVOKED_SECONDS) a += 0.5 * (1 - d.sinceHit / PROVOKED_SECONDS);
  if (d.hungerRate > 0) a += 0.15 * clamp(d.night, 0, 1);
  if (d.territory > 0 && d.targetFromHome < d.territory) a = Math.max(a, 0.95);
  a -= 0.8 * clamp(d.fear, 0, 1);
  return clamp(a, 0, 1);
}

/** Fear decays this much per second. */
export const FEAR_DECAY = 0.08;

/** Fear from one hit: wounds frighten more the weaker the animal already is. */
export function fearFromHit(health: number): number {
  return 0.25 + 0.3 * (1 - clamp(health, 0, 1));
}

/** Hunger an animal loses when its bite lands (it fed). */
export const FED_PER_BITE = 0.35;

/** Initial hunger of a newly spawned animal, from its entity index (deterministic, 0.2–0.8). */
export function initialHunger(entityIndex: number): number {
  const h = Math.imul(entityIndex + 1, 0x9e3779b9) >>> 0;
  return 0.2 + 0.6 * ((h % 1000) / 1000);
}
