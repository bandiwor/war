import { clamp } from '../math/dmath';

/**
 * Utility AI (ADR-0011): every action scores how much it makes sense right
 * now from a few normalised inputs; the mob's registry weights scale each
 * score; the best one wins, with a little inertia so mobs do not dither.
 * Pure functions over plain numbers, so every rule is unit-tested and the
 * bestiary can show the live scores.
 */
export const UTILITY_ACTIONS = [
  'idle',
  'wander',
  'investigate',
  'chase',
  'attack',
  'search',
  'flee',
  'home',
  // Appended in stage 7 (the score columns follow this order).
  'warn',
] as const;
export type UtilityAction = (typeof UTILITY_ACTIONS)[number];
export const ACTION_COUNT = UTILITY_ACTIONS.length;

export interface UtilityInputs {
  /** 0..1: how sure the mob is that its target is there. */
  awareness: number;
  /** Senses report the target this moment. */
  sensing: boolean;
  /** A last known target position is held in memory. */
  hasLastKnown: boolean;
  /** Distance to the target (sensed) or to the last known position (m). */
  distance: number;
  attackRange: number;
  /** The attack is ready (cooldown over). */
  attackReady: boolean;
  /** The mob can move at all (rooted plants cannot). */
  mobile: boolean;
  /** Health fraction 0..1. */
  health: number;
  fleeBelow: number;
  aggression: number;
  /** Reached the last known position and is looking around (seconds left). */
  searchLeft: number;
  /** Distance from its spawn point / allowed roam radius. */
  homeDistance: number;
  roam: number;
  /** 0..1 fear from wounds, a lost pack or a fright (animals). */
  fear: number;
  /** 0..1 light on the mob × how much it fears light (zombies panic in the beam). */
  light: number;
  /** Territory radius (0 = none) and how far the target is from the mob's home. */
  territory: number;
  targetFromHome: number;
}

export function createUtilityInputs(): UtilityInputs {
  return {
    awareness: 0,
    sensing: false,
    hasLastKnown: false,
    distance: Infinity,
    attackRange: 1,
    attackReady: true,
    mobile: true,
    health: 1,
    fleeBelow: 0,
    aggression: 1,
    searchLeft: 0,
    homeDistance: 0,
    roam: 0,
    fear: 0,
    light: 0,
    territory: 0,
    targetFromHome: Infinity,
  };
}

/**
 * Inertia for the current action: a switch needs a clear win (no dithering).
 * Mostly proportional, so it does not pin low-weighted actions in place.
 */
export const INERTIA = 0.02;
export const INERTIA_GAIN = 1.15;

function ramp(x: number, lo: number, hi: number): number {
  return clamp((x - lo) / (hi - lo), 0, 1);
}

/** Unweighted score of each action, written into `out` (length ACTION_COUNT). */
export function scoreActions(i: UtilityInputs, out: Float64Array): Float64Array {
  const move = i.mobile ? 1 : 0;
  const calm = 1 - clamp(i.awareness, 0, 1);
  const threat = i.sensing ? 1 : clamp(i.awareness, 0, 1);
  const inReach = i.distance <= i.attackRange ? 1 : 0;
  const hurt = i.fleeBelow > 0 ? 1 - ramp(i.health, i.fleeBelow * 0.6, i.fleeBelow) : 0;
  out[0] = 0.25; // idle: the floor everything else must beat
  out[1] = move * calm * (i.roam > 0 ? 0.35 : 0); // wander
  // investigate (a badly hurt mob does not go looking for whoever hurt it: it stays in cover)
  out[2] =
    move *
    (i.hasLastKnown && !i.sensing && i.searchLeft <= 0 ? 0.3 + 0.6 * threat : 0) *
    (1 - 0.9 * hurt);
  // chase: how aggressive it is decides whether it goes after what it senses
  out[3] = move * (i.sensing ? i.aggression : 0) * (1 - inReach * 0.8);
  // attack: only what it senses right now (a remembered position is not something to bite)
  out[4] = i.sensing && threat > 0.5 ? inReach * i.aggression * (i.attackReady ? 1 : 0.6) : 0;
  out[5] = move * (i.hasLastKnown && !i.sensing && i.searchLeft > 0 ? 0.75 : 0); // search
  // flee: wounds, fear and light; light panics even without a target in mind
  const fear = clamp(i.fear, 0, 1);
  const lit = clamp(i.light, 0, 1);
  out[6] = move * Math.max(hurt * threat * 1.3, fear * threat * 1.2, lit * lit * 1.5);
  out[7] = move * calm * ramp(i.homeDistance, i.roam, i.roam * 1.5 + 1) * 0.6; // home
  // warn: a target near the edge of its territory, or one it senses but has no stomach for
  const edge =
    i.territory > 0 && i.targetFromHome > i.territory && i.targetFromHome < i.territory * 1.8
      ? 0.85
      : 0;
  out[8] = threat * Math.max(edge, i.sensing ? 0.5 * (1 - i.aggression) : 0);
  return out;
}

/** Index of the best action after weights and inertia. Ties go to the earlier action. */
export function pickAction(
  scores: Float64Array,
  weights: readonly number[],
  current: number,
): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let a = 0; a < ACTION_COUNT; a++) {
    const raw = (scores[a] ?? 0) * (weights[a] ?? 0);
    const s = a === current ? raw * INERTIA_GAIN + INERTIA : raw;
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}

export function actionIndex(a: UtilityAction): number {
  return UTILITY_ACTIONS.indexOf(a);
}
