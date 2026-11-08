import { describe, expect, it } from 'vitest';
import { WEAPONS, WEAPON_IDS } from '../../../domain/weapons/registry';
import { bandEnergies, peak } from './analysis';
import { decayTime, rms } from './footstep';
import {
  EXPLOSION_SOUNDS,
  IMPACT_SOUNDS,
  MECHANICAL_SOUNDS,
  synthesizeCasing,
  synthesizeExplosion,
  synthesizeGunshot,
  synthesizeImpact,
  synthesizeMechanical,
} from './weapon-sounds';

const SR = 48000;
const gun = (id: 'pistol' | 'carbine' | 'rifle' | 'shotgun', suppressed = false) => {
  const w = WEAPONS[id];
  if (w.kind !== 'firearm') throw new Error(id);
  return synthesizeGunshot({ ...w.sound, suppressed }, SR, 1);
};
const lowShare = (b: Float32Array): number => {
  const e = bandEnergies(b, SR);
  return ((e[1] ?? 0) + (e[2] ?? 0) + (e[3] ?? 0)) / e.reduce((a, v) => a + v, 1e-12);
};

describe('gunshots', () => {
  it('every firearm synthesises deterministically and within full scale', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      if (w.kind !== 'firearm') continue;
      const a = synthesizeGunshot({ ...w.sound, suppressed: false }, SR, 3);
      expect(Array.from(synthesizeGunshot({ ...w.sound, suppressed: false }, SR, 3))).toEqual(
        Array.from(a),
      );
      expect(peak(a)).toBeLessThanOrEqual(1);
      expect(peak(a)).toBeGreaterThan(0.9);
    }
  });

  it('bigger cartridges ring out longer; the shotgun is boomier than the pistol', () => {
    expect(decayTime(gun('rifle'), SR, 0.02)).toBeGreaterThan(decayTime(gun('pistol'), SR, 0.02));
    expect(lowShare(gun('shotgun'))).toBeGreaterThan(lowShare(gun('pistol')));
  });

  it('a suppressor makes it quieter and darker', () => {
    const open = gun('carbine');
    const muffled = gun('carbine', true);
    expect(peak(muffled)).toBeLessThan(peak(open));
    const hi = (b: Float32Array): number => {
      const e = bandEnergies(b, SR);
      return ((e[7] ?? 0) + (e[8] ?? 0)) / e.reduce((a, v) => a + v, 1e-12);
    };
    expect(hi(muffled)).toBeLessThan(hi(open));
  });
});

describe('mechanics, impacts, casings, explosions', () => {
  it.each(MECHANICAL_SOUNDS)('mechanical %s is audible and bounded', (k) => {
    const b = synthesizeMechanical(k, SR, 2);
    expect(peak(b)).toBeGreaterThan(0.5);
    expect(peak(b)).toBeLessThanOrEqual(0.71);
  });

  it.each(IMPACT_SOUNDS)('impact %s is audible and bounded', (k) => {
    const b = synthesizeImpact(k, SR, 2);
    expect(peak(b)).toBeGreaterThan(0.5);
    expect(peak(b)).toBeLessThanOrEqual(0.81);
  });

  it('metal rings far longer than dirt; flesh is the dullest', () => {
    expect(decayTime(synthesizeImpact('metal', SR, 4), SR)).toBeGreaterThan(
      decayTime(synthesizeImpact('dirt', SR, 4), SR) * 2,
    );
    expect(lowShare(synthesizeImpact('flesh', SR, 4))).toBeGreaterThan(
      lowShare(synthesizeImpact('concrete', SR, 4)),
    );
  });

  it('brass casings ping brighter than plastic shotgun shells', () => {
    const e = (b: Float32Array): number => {
      const x = bandEnergies(b, SR);
      return (x[8] ?? 0) / x.reduce((a, v) => a + v, 1e-12);
    };
    expect(e(synthesizeCasing(false, SR, 1))).toBeGreaterThan(e(synthesizeCasing(true, SR, 1)));
  });

  it.each(EXPLOSION_SOUNDS)('explosion %s', (k) => {
    const b = synthesizeExplosion(k, SR, 1);
    expect(peak(b)).toBeLessThanOrEqual(0.96);
    expect(rms(b)).toBeGreaterThan(0.01);
  });

  it('the frag has far more sub-bass (31–63 Hz) than any gunshot', () => {
    const sub = (b: Float32Array): number => {
      const e = bandEnergies(b, SR);
      return ((e[0] ?? 0) + (e[1] ?? 0)) / e.reduce((a, v) => a + v, 1e-12);
    };
    const frag = sub(synthesizeExplosion('frag', SR, 1));
    for (const id of ['pistol', 'carbine', 'rifle', 'shotgun'] as const)
      expect(frag).toBeGreaterThan(sub(gun(id)));
  });
});
