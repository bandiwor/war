import { describe, expect, it } from 'vitest';
import {
  hearingStrength,
  proximityStrength,
  sightStrength,
  stepAwareness,
  targetLight,
} from './perception';
import {
  ACTION_COUNT,
  INERTIA,
  UTILITY_ACTIONS,
  actionIndex,
  createUtilityInputs,
  pickAction,
  scoreActions,
  type UtilityInputs,
} from './utility';

const ONES = UTILITY_ACTIONS.map(() => 1);
const decide = (
  over: Partial<UtilityInputs>,
  weights: readonly number[] = ONES,
  current = 0,
): string => {
  const scores = scoreActions(
    { ...createUtilityInputs(), roam: 10, ...over },
    new Float64Array(ACTION_COUNT),
  );
  return UTILITY_ACTIONS[pickAction(scores, weights, current)] ?? '?';
};

describe('utility AI', () => {
  it('a calm mob wanders; a rooted one idles', () => {
    expect(decide({})).toBe('wander');
    expect(decide({ mobile: false })).toBe('idle');
  });

  it('chases what it senses and attacks within reach', () => {
    expect(decide({ sensing: true, awareness: 1, distance: 10, attackRange: 1.5 })).toBe('chase');
    expect(decide({ sensing: true, awareness: 1, distance: 1, attackRange: 1.5 })).toBe('attack');
  });

  it('investigates a lost target, then searches when it gets there', () => {
    expect(decide({ hasLastKnown: true, awareness: 0.6, distance: 12 })).toBe('investigate');
    expect(decide({ hasLastKnown: true, awareness: 0.3, distance: 1, searchLeft: 5 })).toBe(
      'search',
    );
  });

  it('flees when badly hurt (if it ever flees) and goes home when calm and far away', () => {
    expect(decide({ sensing: true, awareness: 1, distance: 5, health: 0.1, fleeBelow: 0.3 })).toBe(
      'flee',
    );
    expect(decide({ sensing: true, awareness: 1, distance: 5, health: 0.1, fleeBelow: 0 })).toBe(
      'chase',
    );
    expect(decide({ homeDistance: 40, roam: 10 })).toBe('home');
  });

  it('registry weights reshape choices; zero disables an action', () => {
    const noChase = ONES.map((w, i) => (i === actionIndex('chase') ? 0 : w));
    expect(decide({ sensing: true, awareness: 1, distance: 10 }, noChase)).not.toBe('chase');
  });

  it('inertia keeps the current action against a marginally better one', () => {
    const scores = new Float64Array(ACTION_COUNT);
    scores[1] = 0.5;
    scores[2] = 0.5 + INERTIA / 2;
    expect(pickAction(scores, ONES, 1)).toBe(1);
    expect(pickAction(scores, ONES, 0)).toBe(2);
  });
});

describe('perception', () => {
  const eyes = { range: 30, fovDeg: 90, needsLight: 1 };

  it('sees inside the cone and range, not behind', () => {
    // Facing −Z (yaw 0): a target at z = −10 is ahead, z = +10 behind.
    expect(sightStrength(eyes, 0, 0, 0, 0, -10, 1, 1)).toBeGreaterThan(0.5);
    expect(sightStrength(eyes, 0, 0, 0, 0, 10, 1, 1)).toBe(0);
    expect(sightStrength(eyes, 0, 0, 0, 9, -10, 1, 1)).toBeGreaterThan(0); // 42° off-axis: in a 90° cone
    expect(sightStrength(eyes, 0, 0, 0, 11, -10, 1, 1)).toBe(0); // 48°: out
  });

  it('light-dependent eyes are blind to an unlit target; fog shortens all sight', () => {
    expect(sightStrength(eyes, 0, 0, 0, 0, -10, targetLight(false, 0), 1)).toBe(0);
    expect(sightStrength(eyes, 0, 0, 0, 0, -10, targetLight(true, 0), 1)).toBeGreaterThan(0);
    const thermal = { ...eyes, needsLight: 0 };
    expect(sightStrength(thermal, 0, 0, 0, 0, -10, 0, 1)).toBeGreaterThan(0);
    expect(sightStrength(thermal, 0, 0, 0, 0, -20, 0, 0)).toBe(0); // thick fog
  });

  it('hearing scales with the noise, the ears and the weather; proximity ignores everything', () => {
    expect(hearingStrength(1, 20, 10, 1)).toBeCloseTo(0.5);
    expect(hearingStrength(1, 20, 10, 0.4)).toBe(0);
    expect(hearingStrength(2, 20, 30, 1)).toBeGreaterThan(0);
    expect(proximityStrength(5, 2)).toBeCloseTo(0.6);
    expect(proximityStrength(0, 0)).toBe(0);
  });

  it('awareness builds while sensing and fades over the forget time', () => {
    let a = 0;
    for (let i = 0; i < 30; i++) a = stepAwareness(a, 1, 1 / 60, 5);
    expect(a).toBeGreaterThan(0.9);
    for (let i = 0; i < 60 * 5; i++) a = stepAwareness(a, 0, 1 / 60, 5);
    expect(a).toBe(0);
  });
});
