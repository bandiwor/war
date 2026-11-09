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
  /** 'launcher' = rocket launch (booster bang + sustainer whoosh). */
  readonly kind?: 'gun' | 'launcher';
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

/**
 * Gunshot as layers, each tied to a physical cause:
 *  - snap:   the muzzle shock front, a 1–2 ms N-wave with a bright noise edge;
 *  - bark:   expanding propellant gas, band-limited noise around `body`
 *            that decays in tens of ms (the weapon's "voice");
 *  - thump:  low-frequency pressure pulse whose pitch falls as the gas
 *            bubble expands (bigger bore = lower, longer);
 *  - tail:   the blast rolling away, noise that gets darker and decays over
 *            hundreds of ms, with slow flutter and two slap echoes;
 *  - action: bolt/slide clacks.
 * The sum is driven into a soft clipper, as a real microphone (and a real
 * ear) saturates on gunfire: that is what makes it dense and loud instead
 * of a thin click. Geometry reverb is added at playback.
 */
export function synthesizeGunshot(p: GunshotParams, sr: number, seed: number): Buf {
  if (p.kind === 'launcher') return synthesizeLaunch(p, sr, seed);
  const rng = new WhiteNoise(seed);
  const E = p.suppressed ? p.blast * 0.3 : p.blast;
  const tailDecay = 0.1 + 0.34 * E;
  const out = buffer(sr, Math.min(2.2, 0.25 + tailDecay * 5.5));

  // Snap: N-wave plus a high-passed noise edge.
  const snapLen = Math.round(sr * (0.0012 + 0.0012 * E));
  const hp = new Biquad('highpass', 2500, 0.7, sr);
  for (let i = 0; i < snapLen * 6 && i < out.length; i++) {
    const t = i / snapLen;
    const nwave = t < 1 ? (1 - 2 * t) * 1.6 : 0;
    out[i] =
      (out[i] ?? 0) + (nwave + hp.process(rng.next()) * 1.4 * Math.exp(-t / 1.5)) * (0.5 + E);
  }

  // Bark: two noise bands around the weapon's body frequency.
  const bark = new Biquad('bandpass', p.body * 2.2, 0.7, sr);
  const edge = new Biquad('bandpass', Math.min(6500, p.body * 9), 0.9, sr);
  const barkDecay = 0.018 + 0.05 * E;
  const barkLen = Math.min(out.length, Math.round(barkDecay * 8 * sr));
  for (let i = 0; i < barkLen; i++) {
    const t = i / sr;
    const n = rng.next();
    out[i] =
      (out[i] ?? 0) +
      (bark.process(n) * 3.2 * Math.exp(-t / barkDecay) +
        edge.process(n) * 1.6 * Math.exp(-t / (barkDecay * 0.45))) *
        (0.4 + E);
  }

  // Thump: sine falling from 1.6×body to 0.45×body.
  let ph = 0;
  const thumpDecay = 0.035 + 0.075 * E;
  const thumpLen = Math.min(out.length, Math.round(thumpDecay * 7 * sr));
  for (let i = 0; i < thumpLen; i++) {
    const t = i / sr;
    const f = p.body * (0.45 + 1.15 * Math.exp(-t / 0.018));
    ph += (TAU * f) / sr;
    out[i] =
      (out[i] ?? 0) + Math.sin(ph) * Math.exp(-t / thumpDecay) * 1.5 * E * Math.min(1, t / 0.0008);
  }

  // Tail: darkening noise with flutter (one-pole low-pass whose cutoff closes over time).
  if (!p.suppressed) {
    let lp = 0;
    let flutter = 0;
    const start = Math.round(0.006 * sr);
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / sr;
      const cutoff = 350 + 4200 * Math.exp(-t / (tailDecay * 0.6));
      const k = 1 - Math.exp((-TAU * cutoff) / sr);
      lp += (rng.next() - lp) * k;
      flutter += (rng.next() - flutter) * 0.0015;
      out[i] =
        (out[i] ?? 0) +
        lp * (1 + 6 * flutter) * Math.exp(-t / tailDecay) * 1.1 * E * Math.min(1, t / 0.004);
    }
    // Slap echoes off nearby hard surfaces (ground, walls).
    for (const [delay, gain] of [
      [0.021 + rng.unit() * 0.006, 0.28],
      [0.067 + rng.unit() * 0.02, 0.16],
    ] as const) {
      const d = Math.round(delay * sr);
      const slap = new Biquad('lowpass', 2600, 0.7, sr);
      const src = Math.round(0.03 * sr);
      for (let i = 0; i < src && d + i < out.length; i++)
        out[d + i] = (out[d + i] ?? 0) + slap.process(out[i] ?? 0) * gain;
    }
  }

  // Action noise: louder relative to the blast on suppressed weapons.
  if (p.mechanism > 0) {
    const g = p.mechanism * (p.suppressed ? 1.1 : 0.45);
    burst(out, sr, rng, 0.014, 3300, 3, 0.004, g);
    burst(out, sr, rng, 0.048 + rng.unit() * 0.01, 2300, 2.5, 0.006, g * 0.8);
  }

  if (p.suppressed) {
    const dark = new Biquad('lowpass', 1500, 0.7, sr);
    for (let i = 0; i < out.length; i++) out[i] = dark.process(out[i] ?? 0);
  }
  saturate(out, p.suppressed ? 1.2 : 1.6 + 2.2 * E);
  normalise(out, p.suppressed ? 0.45 : 0.98);
  return out;
}

/** Rocket launch: booster bang, then the sustainer's roaring whoosh flying away. */
function synthesizeLaunch(p: GunshotParams, sr: number, seed: number): Buf {
  const rng = new WhiteNoise(seed);
  const out = buffer(sr, 2.2);
  // Booster: a dull, heavy bang with backblast.
  const body = new Biquad('lowpass', p.body * 5, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < Math.round(0.5 * sr); i++) {
    const t = i / sr;
    ph += (TAU * p.body * (0.4 + 1.2 * Math.exp(-t / 0.03))) / sr;
    out[i] =
      body.process(rng.next()) * 3 * Math.exp(-t / 0.07) + Math.sin(ph) * 1.8 * Math.exp(-t / 0.12);
  }
  // Sustainer ignites ~0.1 s later: band-passed roar that sweeps down (Doppler, distance) and fades.
  const roar = new Biquad('bandpass', 900, 0.8, sr);
  const hiss = new Biquad('highpass', 3000, 0.7, sr);
  const start = Math.round(0.09 * sr);
  for (let i = start; i < out.length; i++) {
    const t = (i - start) / sr;
    if (i % 64 === 0) roar.set('bandpass', 1300 - 800 * Math.min(1, t / 1.2), 0.8, sr);
    const n = rng.next();
    const env = Math.min(1, t / 0.03) * Math.exp(-t / 0.55);
    out[i] =
      (out[i] ?? 0) + (roar.process(n) * 2.6 + hiss.process(n) * 0.5 * Math.exp(-t / 0.2)) * env;
  }
  burst(out, sr, rng, 0.004, 2800, 3, 0.005, p.mechanism);
  saturate(out, 2.5);
  normalise(out, 0.98);
  return out;
}

/** Soft clipper: x → tanh(drive·x) on a peak-normalised signal. Adds density without overs. */
export function saturate(buf: Float32Array, drive: number): void {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max === 0) return;
  const norm = 1 / Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(((buf[i] ?? 0) / max) * drive) * norm;
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
