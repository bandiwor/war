import { describe, expect, it } from 'vitest';
import { RACES } from '../../../domain/combat/races';
import { MOBS, MOB_IDS } from '../../../domain/mobs/registry';
import { OCTAVE_BANDS, bandEnergies, goertzel, peak } from './analysis';
import { MOB_SOUNDS, RACE_VOICES, synthesizeMobSound, type MobSound } from './mob-sounds';

const SR = 48000;
const sound = (k: MobSound, seed = 1): Float32Array => synthesizeMobSound(k, SR, seed);

/** Spectral centroid over the octave bands (Hz, log-weighted). */
function centroid(b: Float32Array): number {
  const e = bandEnergies(b, SR);
  let num = 0;
  let den = 1e-12;
  e.forEach((v, i) => {
    num += v * Math.log2(OCTAVE_BANDS[i] ?? 1);
    den += v;
  });
  return 2 ** (num / den);
}

/** Pitchedness: spectral crest (strongest line against the mean) over a fine Goertzel sweep. */
function tonality(b: Float32Array): number {
  let best = 0;
  let sum = 0;
  let n = 0;
  for (let f = 100; f < 6000; f *= 1.004, n++) {
    const g = goertzel(b, f, SR);
    best = Math.max(best, g);
    sum += g;
  }
  return best / Math.max(1e-12, sum / n);
}

describe('mob sounds', () => {
  it('every sound synthesises deterministically, within full scale and not silent', () => {
    for (const k of MOB_SOUNDS) {
      const a = sound(k, 3);
      expect(Array.from(sound(k, 3)), k).toEqual(Array.from(a));
      expect(peak(a), k).toBeLessThanOrEqual(1);
      expect(peak(a), k).toBeGreaterThan(0.5);
      expect(a.every(Number.isFinite), k).toBe(true);
      // Variants differ.
      expect(Array.from(sound(k, 4)), k).not.toEqual(Array.from(a));
    }
  });

  it('every race has a full voice, and every mob a race voice', () => {
    for (const race of RACES)
      for (const s of Object.values(RACE_VOICES[race])) expect(MOB_SOUNDS).toContain(s);
    for (const id of MOB_IDS) expect(RACE_VOICES[MOBS[id].race]).toBeDefined();
  });

  it('races sound distinct: robots are pitched, zombies are breath, animals are low and voiced, plants are dry and high', () => {
    // Robots' servo whine and beeps are far more tonal than a zombie's rasp.
    expect(tonality(sound('beep'))).toBeGreaterThan(tonality(sound('rasp')) * 5);
    expect(tonality(sound('servo'))).toBeGreaterThan(tonality(sound('shuffle')) * 3);
    // Animals' growls sit low; plants' rustles high; zombie breath in between.
    expect(centroid(sound('growl'))).toBeLessThan(centroid(sound('rasp')));
    expect(centroid(sound('rasp'))).toBeLessThan(centroid(sound('rustle')));
    expect(centroid(sound('grunt'))).toBeLessThan(centroid(sound('creak')) * 1.5);
    // The howl is the longest call; the laser and the snap are short.
    expect(sound('howl').length).toBeGreaterThan(sound('growl').length);
    expect(sound('laser').length).toBeLessThan(sound('static').length);
  });
});
