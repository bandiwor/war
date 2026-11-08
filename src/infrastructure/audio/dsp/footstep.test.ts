import { describe, expect, it } from 'vitest';
import { Rng } from '../../../domain/math/prng';
import {
  SURFACES,
  SURFACE_IDS,
  FootstepAcousticsSchema,
  isSurfaceId,
  surfaceAcoustics,
} from '../../../domain/world/surfaces';
import { Biquad } from './biquad';
import { decayTime, normalise, rms, synthesizeFootstep, zeroCrossingRate } from './footstep';

const SR = 48000;
const synth = (id: keyof typeof SURFACES, seed = 1, intensity = 0.6) =>
  synthesizeFootstep(surfaceAcoustics(id), Rng.fromSeed(seed), { sampleRate: SR, intensity });

describe('surface registry', () => {
  it('every surface validates', () => {
    for (const id of SURFACE_IDS)
      expect(FootstepAcousticsSchema.safeParse(SURFACES[id]).success).toBe(true);
    expect(isSurfaceId('metal')).toBe(true);
    expect(isSurfaceId('lava')).toBe(false);
  });
});

describe('footstep synthesis', () => {
  it.each(SURFACE_IDS)(
    '%s: deterministic per seed, varies across seeds, bounded, no click at the end',
    (id) => {
      const a = synth(id, 7);
      expect(Array.from(synth(id, 7))).toEqual(Array.from(a));
      expect(Array.from(synth(id, 8))).not.toEqual(Array.from(a));
      expect(a.length).toBe(Math.round(0.45 * SR));
      const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak).toBeLessThanOrEqual(1);
      expect(peak).toBeGreaterThan(0.3);
      expect(Math.abs(a[a.length - 1] ?? 1)).toBeLessThan(1e-3);
    },
  );

  it('louder gait means louder steps', () => {
    expect(rms(synth('concrete', 3, 1))).toBeGreaterThan(rms(synth('concrete', 3, 0.2)) * 2);
  });

  it('surfaces sound distinct: metal rings long, concrete is brighter than dirt, water splashes', () => {
    const metal = synth('metal');
    const concrete = synth('concrete');
    expect(decayTime(metal, SR)).toBeGreaterThan(decayTime(concrete, SR) * 2);
    expect(zeroCrossingRate(concrete, SR)).toBeGreaterThan(
      zeroCrossingRate(synth('dirt'), SR) * 0.8,
    );
    // Splash energy sits late (after the strikes) in the water step.
    const water = synth('water');
    const late = (b: Float32Array): number =>
      rms(b, Math.round(0.15 * SR), Math.round(0.3 * SR)) / rms(b);
    expect(late(water)).toBeGreaterThan(late(concrete));
  });

  it('heel and toe are two separate impacts', () => {
    const b = synth('concrete', 2);
    const env = (from: number, to: number): number =>
      rms(b, Math.round(from * SR), Math.round(to * SR));
    expect(env(0, 0.01)).toBeGreaterThan(env(0.035, 0.05));
    expect(Math.max(env(0.055, 0.07), env(0.07, 0.085), env(0.085, 0.1))).toBeGreaterThan(
      env(0.035, 0.05),
    );
  });
});

describe('dsp helpers', () => {
  it('biquad lowpass passes DC and kills Nyquist; highpass the opposite', () => {
    const lp = new Biquad('lowpass', 1000, 0.707, SR);
    const hp = new Biquad('highpass', 1000, 0.707, SR);
    let dcLp = 0;
    let dcHp = 0;
    for (let i = 0; i < 4000; i++) {
      dcLp = lp.process(1);
      dcHp = hp.process(1);
    }
    expect(dcLp).toBeCloseTo(1, 3);
    expect(Math.abs(dcHp)).toBeLessThan(1e-3);
    lp.reset();
    let ny = 0;
    for (let i = 0; i < 4000; i++) ny = lp.process(i % 2 === 0 ? 1 : -1);
    expect(Math.abs(ny)).toBeLessThan(0.01);
  });

  it('normalise handles silence and decayTime of silence is 0', () => {
    const z = new Float32Array(100);
    normalise(z, 0.5);
    expect(z.every((v) => v === 0)).toBe(true);
    expect(decayTime(z, SR)).toBe(0);
  });
});
