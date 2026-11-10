import { describe, expect, it } from 'vitest';
import {
  effectiveAggression,
  fearFromHit,
  initialHunger,
  PROVOKED_SECONDS,
  type DriveInputs,
} from './drives';

const wolf = (over: Partial<DriveInputs> = {}): number =>
  effectiveAggression({
    baseAggression: 0.35,
    hungerRate: 1.2,
    hunger: 0.5,
    pack: 0.25,
    packmates: 0,
    fear: 0,
    sinceHit: 99,
    territory: 0,
    targetFromHome: Infinity,
    night: 0,
    ...over,
  });

describe('animal drives', () => {
  it('hunger makes it bolder; a fed animal has little appetite for a fight', () => {
    expect(wolf({ hunger: 1 })).toBeGreaterThan(wolf({ hunger: 0.5 }));
    expect(wolf({ hunger: 0.05 })).toBeLessThan(0.2);
  });

  it('a pack is brave, a lone pack animal is not', () => {
    expect(wolf({ packmates: 2 })).toBeGreaterThan(wolf({ packmates: 0 }) + 0.4);
  });

  it('provocation fades, fear takes the fight out of it, night emboldens predators', () => {
    expect(wolf({ sinceHit: 1 })).toBeGreaterThan(wolf({ sinceHit: PROVOKED_SECONDS + 1 }));
    expect(wolf({ fear: 1, packmates: 3 })).toBeLessThan(wolf({ packmates: 3 }));
    expect(wolf({ night: 1 })).toBeGreaterThan(wolf({ night: 0 }));
  });

  it('anything inside its territory is attacked; at its edge it is not', () => {
    const boar = {
      baseAggression: 0.2,
      hungerRate: 0.3,
      hunger: 0.1,
      pack: 0,
      packmates: 0,
      fear: 0,
      sinceHit: 99,
      territory: 9,
      night: 0,
    };
    expect(effectiveAggression({ ...boar, targetFromHome: 5 })).toBeGreaterThan(0.9);
    expect(effectiveAggression({ ...boar, targetFromHome: 14 })).toBeLessThan(0.2);
  });

  it('wounds frighten more the weaker it is; initial hunger is deterministic and in range', () => {
    expect(fearFromHit(0.2)).toBeGreaterThan(fearFromHit(1));
    for (let i = 0; i < 200; i++) {
      const h = initialHunger(i);
      expect(h).toBeGreaterThanOrEqual(0.2);
      expect(h).toBeLessThanOrEqual(0.8);
      expect(initialHunger(i)).toBe(h);
    }
  });
});
