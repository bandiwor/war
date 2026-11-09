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
  saturate,
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

describe('gunshot character (regression for the thin, samey shots)', () => {
  const level = (b: Float32Array, fromMs: number, toMs: number): number =>
    20 *
    Math.log10(rms(b, Math.round((fromMs / 1000) * SR), Math.round((toMs / 1000) * SR)) + 1e-9);

  it('is dense, not a click: the first 300 ms carry real energy', () => {
    for (const id of ['pistol', 'carbine', 'rifle', 'shotgun'] as const)
      expect(rms(gun(id), 0, SR * 0.3)).toBeGreaterThan(0.17);
  });

  it('has a tail that scales with the cartridge: rifle > carbine > pistol at 150–250 ms', () => {
    const tail = (id: 'pistol' | 'carbine' | 'rifle'): number => level(gun(id), 150, 250);
    expect(tail('rifle')).toBeGreaterThan(tail('carbine') + 2);
    expect(tail('carbine')).toBeGreaterThan(tail('pistol') + 2);
    // …and still decays to silence, with no click at the end.
    const b = gun('rifle');
    expect(level(b, 1800, 2000)).toBeLessThan(-50);
  });

  it('the attack is immediate: the loudest 5 ms window is the first one', () => {
    for (const id of ['pistol', 'rifle'] as const) {
      const b = gun(id);
      expect(level(b, 0, 5)).toBeGreaterThan(level(b, 30, 35));
    }
  });

  it('saturate keeps peaks at full scale and raises density; silence stays silent', () => {
    const b = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * 0.5);
    const before = rms(b);
    saturate(b, 3);
    expect(peak(b)).toBeCloseTo(1, 5);
    expect(rms(b)).toBeGreaterThan(before * 2);
    const z = new Float32Array(10);
    saturate(z, 3);
    expect(peak(z)).toBe(0);
  });

  it('RPG-7 launch: a low bang, then a whoosh that is still audible half a second later', () => {
    const w = WEAPONS.rpg7;
    if (w.kind !== 'firearm') throw new Error('rpg7');
    const b = synthesizeGunshot({ ...w.sound, suppressed: false }, SR, 1);
    expect(Array.from(synthesizeGunshot({ ...w.sound, suppressed: false }, SR, 1))).toEqual(
      Array.from(b),
    );
    expect(peak(b)).toBeLessThanOrEqual(1);
    expect(level(b, 400, 600)).toBeGreaterThan(level(gun('rifle'), 400, 600) + 6);
    expect(lowShare(b)).toBeGreaterThan(lowShare(gun('pistol')));
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
