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
  };
}

/** Bonus for the current action: a switch needs a clear win (no dithering). */
export const INERTIA = 0.08;

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
  out[2] = move * (i.hasLastKnown && !i.sensing && i.searchLeft <= 0 ? 0.3 + 0.6 * threat : 0); // investigate
  out[3] = move * (i.sensing ? 0.5 + 0.5 * i.aggression : 0) * (1 - inReach * 0.8); // chase
  out[4] = threat > 0.5 ? inReach * i.aggression * (i.attackReady ? 1 : 0.6) : 0; // attack
  out[5] = move * (i.hasLastKnown && !i.sensing && i.searchLeft > 0 ? 0.75 : 0); // search
  out[6] = move * hurt * threat * 1.3; // flee: survival beats the hunt
  out[7] = move * calm * ramp(i.homeDistance, i.roam, i.roam * 1.5 + 1) * 0.6; // home
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
    const s = (scores[a] ?? 0) * (weights[a] ?? 0) + (a === current ? INERTIA : 0);
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
