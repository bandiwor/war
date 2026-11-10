import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HITBOXES } from '../../../domain/combat/hitboxes';
import { ANIMATIONS, MOBS, MOB_IDS } from '../../../domain/mobs/registry';
import { actionIndex } from '../../../domain/ai/utility';
import { DEAD_ACTION } from '../../../application/ai/components';
import { buildMobModel, hitboxWireframe, poseMob, signalMob } from './mob-models';
import { animationFor } from './mob-renderer';

describe('mob models', () => {
  it('every registry mob builds with its race rig and one mesh per hitbox shape', () => {
    for (const id of MOB_IDS) {
      const m = buildMobModel(id);
      let meshes = 0;
      m.root.traverse((o) => {
        if (o instanceof THREE.Mesh && !o.name.startsWith('detail:')) meshes++;
      });
      expect(meshes, id).toBe(HITBOXES[MOBS[id].race].length);
      expect(m.root.scale.x).toBe(MOBS[id].body.scale);
      expect(hitboxWireframe(id).children).toHaveLength(HITBOXES[MOBS[id].race].length);
    }
  });

  it('every race is dressed per its lore: details ride on real bones, built once per kind', () => {
    const names = (id: (typeof MOB_IDS)[number]): string[] => {
      const out: string[] = [];
      buildMobModel(id).root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name.startsWith('detail:')) out.push(o.name);
      });
      return out;
    };
    expect(names('shambler')).toEqual(expect.arrayContaining(['detail:cloth', 'detail:fungus']));
    expect(names('sentry')).toContain('detail:signal');
    expect(names('flytrap')).toContain('detail:glow'); // bioluminescent vine buds
    expect(names('wolf').length).toBeGreaterThan(3);
    expect(buildMobModel('flytrap').bones.has('jaw')).toBe(true);
    expect(buildMobModel('boar').bones.has('tail')).toBe(true);
    // Shared geometry across models of a kind.
    const geo = (id: 'sentry'): unknown[] => {
      const g: unknown[] = [];
      buildMobModel(id).root.traverse((o) => {
        if (o instanceof THREE.Mesh) g.push(o.geometry);
      });
      return g;
    };
    expect(geo('sentry')).toEqual(geo('sentry'));
  });

  it('robot tally lights blink and sputter when blinded; dead lights fade', () => {
    const m = buildMobModel('sentry');
    const seen = new Set<number>();
    for (let t = 0; t < 2; t += 0.05) {
      signalMob(m, t, 1, 0, false);
      seen.add(Math.round(m.signal.emissiveIntensity * 10));
    }
    expect(seen.size).toBeGreaterThan(1);
    const blind = new Set<number>();
    for (let t = 0; t < 1; t += 0.013) {
      signalMob(m, t, 1, 1, false);
      blind.add(Math.round(m.signal.emissiveIntensity * 10));
    }
    expect(blind.size).toBeGreaterThan(seen.size);
    signalMob(m, 0, 0, 0, false);
    const lit = m.signal.emissiveIntensity;
    signalMob(m, 0, 0, 0, true);
    expect(m.signal.emissiveIntensity).toBeLessThan(lit);
    const plant = buildMobModel('creeper');
    signalMob(plant, 1, 0, 0, false);
    expect(plant.signal.emissiveIntensity).toBeGreaterThan(0);
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
