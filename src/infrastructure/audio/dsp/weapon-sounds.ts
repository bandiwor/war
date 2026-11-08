import { Biquad } from './biquad';
import { normalise } from './footstep';
import { WhiteNoise } from './noise';

/**
 * Physically-flavoured weapon sounds, synthesised offline into variants.
 * The environment tail (reverb from geometry) is added at playback, so these
 * are close-mic'd dry sources.
 */
export interface GunshotParams {
  /** 0..1 muzzle energy. */
  readonly blast: number;
  /** Blast body frequency (Hz). */
  readonly body: number;
  /** 0..1 mechanical action noise. */
  readonly mechanism: number;
  readonly suppressed: boolean;
}

type Buf = Float32Array<ArrayBuffer>;
const TAU = Math.PI * 2;

function buffer(sr: number, seconds: number): Buf {
  return new Float32Array(Math.round(sr * seconds));
}

/** Adds a band-passed noise burst (clicks, clacks, scrapes). */
function burst(
  out: Buf,
  sr: number,
  rng: WhiteNoise,
  start: number,
  freq: number,
  q: number,
  decay: number,
  gain: number,
): void {
  const bp = new Biquad('bandpass', freq, q, sr);
  const s0 = Math.round(start * sr);
  const n = Math.min(out.length - s0, Math.round(decay * 6 * sr));
  for (let i = 0; i < n; i++)
    out[s0 + i] = (out[s0 + i] ?? 0) + bp.process(rng.next()) * Math.exp(-i / sr / decay) * gain;
}

/** Adds a decaying sinusoid (ring, thump). */
function tone(
  out: Buf,
  sr: number,
  start: number,
  freq: number,
  decay: number,
  gain: number,
  glide = 0,
): void {
  const s0 = Math.round(start * sr);
  const n = Math.min(out.length - s0, Math.round(decay * 6 * sr));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * freq * (1 + glide * Math.exp(-t / 0.02))) / sr;
    out[s0 + i] =
      (out[s0 + i] ?? 0) + Math.sin(ph) * Math.exp(-t / decay) * gain * Math.min(1, t / 0.0005);
  }
}

export function synthesizeGunshot(p: GunshotParams, sr: number, seed: number): Buf {
  const rng = new WhiteNoise(seed);
  const out = buffer(sr, 0.9);
  const energy = p.suppressed ? p.blast * 0.35 : p.blast;
  // 1. The crack: an N-wave-like pressure spike, broadband, a few ms.
  const crackLen = Math.round(sr * (0.002 + 0.003 * energy));
  for (let i = 0; i < crackLen; i++) {
    const t = i / crackLen;
    out[i] = (out[i] ?? 0) + (1 - 2 * t) * (1 - t) * 2.2 * energy + rng.next() * 0.6 * energy;
  }
  // 2. Blast body: low-passed noise whose decay grows with energy.
  const lp = new Biquad('lowpass', p.body * (p.suppressed ? 3 : 9), 0.7, sr);
  const bodyDecay = 0.025 + 0.09 * energy;
  const n = Math.round(bodyDecay * 7 * sr);
  for (let i = 0; i < n && i < out.length; i++) {
    const t = i / sr;
    out[i] = (out[i] ?? 0) + lp.process(rng.next()) * Math.exp(-t / bodyDecay) * 2.2 * energy;
  }
  // 3. Thump: the low end you feel.
  tone(out, sr, 0, p.body * 0.5, 0.05 + 0.05 * energy, 0.9 * energy, 0.8);
  // 4. Action: bolt carrier / slide clacks.
  if (p.mechanism > 0) {
    burst(out, sr, rng, 0.012, 3200, 3, 0.004, p.mechanism * (p.suppressed ? 1.2 : 0.6));
    burst(
      out,
      sr,
      rng,
      0.045 + rng.unit() * 0.01,
      2400,
      2.5,
      0.006,
      p.mechanism * (p.suppressed ? 1 : 0.5),
    );
  }
  if (p.suppressed) {
    // Suppressors strip the highs from the blast.
    const lp2 = new Biquad('lowpass', 1800, 0.7, sr);
    for (let i = 0; i < out.length; i++) out[i] = lp2.process(out[i] ?? 0);
  }
  normalise(out, p.suppressed ? 0.5 : 0.98);
  return out;
}

export const MECHANICAL_SOUNDS = [
  'magOut',
  'magIn',
  'rack',
  'dryFire',
  'shellIn',
  'pump',
  'bolt',
  'jam',
  'swing',
  'modeSwitch',
  'draw',
] as const;
export type MechanicalSound = (typeof MECHANICAL_SOUNDS)[number];

export function synthesizeMechanical(kind: MechanicalSound, sr: number, seed: number): Buf {
  const rng = new WhiteNoise(seed);
  const out = buffer(sr, 0.5);
  switch (kind) {
    case 'magOut':
      burst(out, sr, rng, 0, 4200, 4, 0.005, 0.7);
      burst(out, sr, rng, 0.02, 900, 1.2, 0.04, 0.5); // slide out
      break;
    case 'magIn':
      burst(out, sr, rng, 0, 1100, 1.5, 0.03, 0.4);
      burst(out, sr, rng, 0.06, 3000, 3, 0.008, 1);
      tone(out, sr, 0.06, 2300, 0.02, 0.2);
      break;
    case 'rack':
      burst(out, sr, rng, 0, 2600, 2.5, 0.01, 0.8);
      burst(out, sr, rng, 0.11, 3400, 3, 0.012, 1);
      tone(out, sr, 0.11, 1900, 0.03, 0.25);
      break;
    case 'dryFire':
      burst(out, sr, rng, 0, 5200, 6, 0.003, 0.6);
      break;
    case 'shellIn':
      burst(out, sr, rng, 0, 1500, 2, 0.02, 0.6);
      burst(out, sr, rng, 0.03, 2600, 3, 0.006, 0.5);
      break;
    case 'pump':
      burst(out, sr, rng, 0, 1200, 1.5, 0.03, 0.8);
      burst(out, sr, rng, 0.16, 2000, 2, 0.02, 1);
      tone(out, sr, 0.16, 1400, 0.04, 0.3);
      break;
    case 'bolt':
      burst(out, sr, rng, 0, 3000, 3, 0.01, 0.7);
      burst(out, sr, rng, 0.08, 1600, 2, 0.04, 0.5);
      burst(out, sr, rng, 0.22, 2800, 3, 0.012, 0.9);
      break;
    case 'jam':
      burst(out, sr, rng, 0, 1800, 0.8, 0.08, 0.6);
      tone(out, sr, 0.01, 760, 0.05, 0.2);
      break;
    case 'swing': {
      const bp = new Biquad('bandpass', 400, 1.5, sr);
      const n = Math.round(0.3 * sr);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        bp.set('bandpass', 300 + 1600 * Math.sin(Math.PI * t), 1.5, sr);
        out[i] = bp.process(rng.next()) * Math.sin(Math.PI * t) * 1.4;
      }
      break;
    }
    case 'modeSwitch':
      burst(out, sr, rng, 0, 4800, 5, 0.003, 0.5);
      break;
    case 'draw':
      burst(out, sr, rng, 0, 1400, 1, 0.06, 0.3);
      burst(out, sr, rng, 0.1, 3600, 4, 0.004, 0.4);
      break;
  }
  normalise(out, 0.7);
  return out;
}

export const IMPACT_SOUNDS = [
  'concrete',
  'metal',
  'wood',
  'dirt',
  'flesh',
  'robot',
  'plant',
] as const;
export type ImpactSound = (typeof IMPACT_SOUNDS)[number];

export function synthesizeImpact(kind: ImpactSound, sr: number, seed: number): Buf {
  const rng = new WhiteNoise(seed);
  const out = buffer(sr, kind === 'metal' ? 0.9 : 0.4);
  switch (kind) {
    case 'concrete':
      burst(out, sr, rng, 0, 2800, 0.9, 0.012, 1);
      for (let k = 0; k < 6; k++)
        burst(out, sr, rng, 0.02 + rng.unit() * 0.12, 3500 + rng.unit() * 3000, 4, 0.004, 0.25); // debris
      break;
    case 'metal':
      burst(out, sr, rng, 0, 5000, 2, 0.004, 0.8);
      tone(out, sr, 0, 2400 + rng.unit() * 1800, 0.25, 0.5);
      tone(out, sr, 0, 5400 + rng.unit() * 900, 0.12, 0.25);
      // Ricochet whine: a falling glide.
      if (rng.unit() < 0.6) {
        let ph = 0;
        const n = Math.round(0.45 * sr);
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          ph += (TAU * (3800 - 2200 * (t / 0.45))) / sr;
          out[i] =
            (out[i] ?? 0) + Math.sin(ph) * Math.exp(-t / 0.18) * 0.35 * Math.min(1, t / 0.01);
        }
      }
      break;
    case 'wood':
      tone(out, sr, 0, 420, 0.03, 0.8);
      burst(out, sr, rng, 0, 1500, 1.2, 0.015, 0.7);
      break;
    case 'dirt':
      burst(out, sr, rng, 0, 600, 0.7, 0.03, 1);
      burst(out, sr, rng, 0.01, 2500, 1, 0.02, 0.3);
      break;
    case 'flesh':
      tone(out, sr, 0, 110, 0.04, 0.9, 0.5);
      burst(out, sr, rng, 0, 900, 0.8, 0.03, 0.8);
      break;
    case 'robot':
      burst(out, sr, rng, 0, 4200, 1.5, 0.005, 0.9);
      tone(out, sr, 0, 1700, 0.15, 0.5);
      burst(out, sr, rng, 0.03, 7000, 6, 0.05, 0.25); // electrical crackle
      break;
    case 'plant':
      burst(out, sr, rng, 0, 700, 0.6, 0.05, 1);
      burst(out, sr, rng, 0.02, 1800, 1, 0.04, 0.4);
      break;
  }
  normalise(out, 0.8);
  return out;
}

export function synthesizeCasing(shell: boolean, sr: number, seed: number): Buf {
  const rng = new WhiteNoise(seed);
  const out = buffer(sr, 0.4);
  if (shell) {
    tone(out, sr, 0, 700, 0.02, 0.6);
    burst(out, sr, rng, 0, 1200, 1, 0.015, 0.5);
  } else {
    // Brass: bright pings with a couple of bounces.
    for (const [t, g] of [
      [0, 1],
      [0.08 + rng.unit() * 0.04, 0.5],
      [0.15 + rng.unit() * 0.05, 0.25],
    ] as const) {
      tone(out, sr, t, 6200 + rng.unit() * 1500, 0.05, g * 0.6);
      tone(out, sr, t, 9800 + rng.unit() * 900, 0.03, g * 0.3);
    }
  }
  normalise(out, 0.5);
  return out;
}

export const EXPLOSION_SOUNDS = ['frag', 'emp', 'fire', 'flare'] as const;
export type ExplosionSound = (typeof EXPLOSION_SOUNDS)[number];

export function synthesizeExplosion(kind: ExplosionSound, sr: number, seed: number): Buf {
  const rng = new WhiteNoise(seed);
  const out = buffer(sr, kind === 'flare' ? 1.2 : 2.5);
  switch (kind) {
    case 'frag': {
      const lp = new Biquad('lowpass', 1400, 0.7, sr);
      let brown = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        brown = brown * 0.985 + rng.next() * 0.15;
        const env = Math.exp(-t / 0.35) * Math.min(1, t / 0.002);
        out[i] = lp.process(rng.next() * 0.7 + brown * 3) * env * 1.8;
      }
      tone(out, sr, 0, 48, 0.4, 1.2, 0.8);
      for (let k = 0; k < 12; k++)
        burst(out, sr, rng, 0.05 + rng.unit() * 0.6, 3000 + rng.unit() * 4000, 4, 0.004, 0.3); // fragments & debris
      break;
    }
    case 'emp':
      tone(out, sr, 0, 90, 0.6, 0.8, -0.5);
      for (let k = 0; k < 40; k++)
        burst(out, sr, rng, rng.unit() * 0.5, 4000 + rng.unit() * 6000, 6, 0.003, 0.5); // arcing
      tone(out, sr, 0.02, 1200, 0.3, 0.4, -0.6);
      break;
    case 'fire': {
      const bp = new Biquad('bandpass', 500, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const env = (t / 0.08) * Math.exp(1 - t / 0.08) * 0.7 + Math.exp(-t / 1) * 0.3;
        out[i] = bp.process(rng.next()) * env * 2.5;
      }
      burst(out, sr, rng, 0, 4500, 2, 0.02, 0.6); // glass breaking
      break;
    }
    case 'flare': {
      const hp = new Biquad('highpass', 2000, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        out[i] = hp.process(rng.next()) * Math.min(1, t / 0.05) * (0.6 + 0.4 * Math.exp(-t / 0.3));
      }
      break;
    }
  }
  normalise(out, 0.95);
  return out;
}
