import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HITBOXES } from '../../../domain/combat/hitboxes';
import { ANIMATIONS, MOBS, MOB_IDS } from '../../../domain/mobs/registry';
import { actionIndex } from '../../../domain/ai/utility';
import { DEAD_ACTION } from '../../../application/ai/components';
import { buildMobModel, hitboxWireframe, poseMob } from './mob-models';
import { animationFor } from './mob-renderer';

describe('mob models', () => {
  it('every registry mob builds with its race rig and one mesh per hitbox shape', () => {
    for (const id of MOB_IDS) {
      const m = buildMobModel(id);
      let meshes = 0;
      m.root.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes++;
      });
      expect(meshes, id).toBe(HITBOXES[MOBS[id].race].length);
      expect(m.root.scale.x).toBe(MOBS[id].body.scale);
      expect(hitboxWireframe(id).children).toHaveLength(HITBOXES[MOBS[id].race].length);
    }
  });

  it('poses every animation without NaNs and returns to rest', () => {
    for (const id of MOB_IDS) {
      const m = buildMobModel(id);
      for (const anim of ANIMATIONS) {
        for (const time of [0, 0.15, 0.4, 2]) {
          poseMob(m, { anim, time, phase: time * 5, alert: 0.5 });
          m.root.traverse((o) => {
            expect(Number.isFinite(o.rotation.x + o.rotation.y + o.rotation.z)).toBe(true);
          });
        }
      }
    }
  });

  it('picks the animation from the AI state', () => {
    expect(animationFor('wolf', DEAD_ACTION, 1, 0, 99, 99).anim).toBe('die');
    expect(animationFor('wolf', actionIndex('attack'), 1, 0, 0.1, 99).anim).toBe('attack');
    expect(animationFor('wolf', actionIndex('chase'), 2, 6, 99, 99).anim).toBe('run');
    expect(animationFor('wolf', actionIndex('wander'), 2, 1, 99, 99).anim).toBe('walk');
    expect(animationFor('wolf', actionIndex('idle'), 2, 0, 99, 0.1).anim).toBe('hit');
    // The flytrap has no walk/run: it falls back to idle.
    expect(animationFor('flytrap', actionIndex('idle'), 2, 3, 99, 99).anim).toBe('idle');
  });
});
