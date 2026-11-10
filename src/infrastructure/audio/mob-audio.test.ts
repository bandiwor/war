import { describe, expect, it } from 'vitest';
import { DEAD_ACTION } from '../../application/ai/components';
import { actionIndex } from '../../domain/ai/utility';
import { MOB_IDS } from '../../domain/mobs/registry';
import { RACE_VOICES } from './dsp/mob-sounds';
import { vocalFor } from './mob-audio';

describe('mob voices', () => {
  it('the dead are silent; every living mob has something to say', () => {
    for (const id of MOB_IDS) {
      expect(vocalFor(id, DEAD_ACTION, 0, 0, 0.5)).toBeNull();
      expect(vocalFor(id, actionIndex('idle'), 0, 0, 0.5)).not.toBeNull();
    }
  });

  it('hunting mobs call louder and more often than idle ones, in their race voice', () => {
    const idle = vocalFor('shambler', actionIndex('idle'), 0, 0, 0.5);
    const chase = vocalFor('shambler', actionIndex('chase'), 0, 1, 0.5);
    expect(chase?.sound).toBe(RACE_VOICES.zombie.alert);
    expect(chase?.interval ?? 99).toBeLessThan(idle?.interval ?? 0);
    expect(chase?.gain ?? 0).toBeGreaterThan(idle?.gain ?? 99);
    expect(vocalFor('sentry', actionIndex('wander'), 1, 0, 0.5)?.sound).toBe('servo');
  });

  it('a warning animal growls steadily; a hunting wolf sometimes howls', () => {
    expect(vocalFor('boar', actionIndex('warn'), 0, 1, 0.5)?.sound).toBe(RACE_VOICES.animal.idle);
    expect(vocalFor('wolf', actionIndex('chase'), 5, 1, 0.05)?.sound).toBe('howl');
    expect(vocalFor('wolf', actionIndex('chase'), 5, 1, 0.9)?.sound).toBe('snarl');
  });
});
