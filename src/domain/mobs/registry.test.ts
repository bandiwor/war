import { describe, expect, it } from 'vitest';
import { RACES } from '../combat/races';
import { hotPatch, sameKeys } from '../core/hot-patch';
import { UTILITY_ACTIONS } from '../ai/utility';
import { MOBS, MOB_IDS, MobSpecSchema, isMobId, mobAt, mobIndex, utilityWeights } from './registry';

describe('mob registry', () => {
  it('every entry validates, ids round-trip, and every race has a placeholder', () => {
    for (const id of MOB_IDS) {
      expect(MobSpecSchema.safeParse(MOBS[id]).success, id).toBe(true);
      expect(mobAt(mobIndex(id))).toBe(id);
      expect(isMobId(id)).toBe(true);
    }
    expect(isMobId('dragon')).toBe(false);
    for (const race of RACES)
      expect(
        MOB_IDS.some((id) => MOBS[id].race === race),
        race,
      ).toBe(true);
  });

  it('every mob can be perceived somehow and has the animations its AI uses', () => {
    for (const id of MOB_IDS) {
      const m = MOBS[id];
      expect(
        m.senses.sight !== null || m.senses.hearing !== null || m.senses.proximity !== null,
      ).toBe(true);
      expect(m.animations).toContain('idle');
      if (m.body.runSpeed > 0)
        expect(m.animations).toEqual(expect.arrayContaining(['walk', 'run']));
      expect(utilityWeights(m, [])).toHaveLength(UTILITY_ACTIONS.length);
    }
  });
});

describe('hot patch', () => {
  it('updates values in place and keeps object identity', () => {
    const live = { a: { speed: 1, tags: [1, 2] }, b: { speed: 2, old: true } };
    const inner = live.a;
    hotPatch(live, { a: { speed: 5, tags: [3] }, b: { speed: 2 } });
    expect(live.a).toBe(inner);
    expect(live).toEqual({ a: { speed: 5, tags: [3] }, b: { speed: 2 } });
    expect(sameKeys(live, { a: 1, b: 2 })).toBe(true);
    expect(sameKeys(live, { a: 1, c: 2 })).toBe(false);
  });
});
