import type { DistantKind } from '../../../domain/audio/zones';
import { Biquad } from './biquad';
import { normalise } from './footstep';
import { WhiteNoise } from './noise';

/**
 * Distant one-shots that tell the world's story from afar: feral dogs,
 * wolves, metal falling in empty buildings, a malfunctioning civil-defence
 * siren, robot radio chatter, gunfire from other survivors. Mono, dry;
 * distance, air absorption, occlusion and reverb are applied at playback.
 */
export function synthesizeDistant(
  kind: DistantKind,
  sampleRate: number,
  seed: number,
): Float32Array<ArrayBuffer> {
  const rng = new WhiteNoise(seed);
  switch (kind) {
    case 'bark':
      return bark(sampleRate, rng);
    case 'howl':
      return howl(sampleRate, rng);
    case 'clang':
      return clang(sampleRate, rng);
    case 'siren':
      return siren(sampleRate, rng);
    case 'chirp':
      return chirp(sampleRate, rng);
    case 'shot':
      return shot(sampleRate, rng);
  }
}

const TAU = Math.PI * 2;

/** 2–4 barks: harmonic source with a falling pitch contour through two formants. */
function bark(sr: number, rng: WhiteNoise): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(sr * 1.6));
  const count = 2 + Math.floor(rng.unit() * 3);
  let start = 0;
  for (let b = 0; b < count; b++) {
    const len = Math.round(sr * (0.12 + 0.08 * rng.unit()));
    const f0 = 380 + 160 * rng.unit();
    const f1 = new Biquad('bandpass', 900 + 300 * rng.unit(), 4, sr);
    const f2 = new Biquad('bandpass', 2200 + 500 * rng.unit(), 6, sr);
    let ph = 0;
    for (let i = 0; i < len && start + i < out.length; i++) {
      const t = i / len;
      const f = f0 * (1.15 - 0.45 * t);
      ph += (TAU * f) / sr;
      // Pulse-ish glottal source: rectified sine plus breath noise.
      const src = Math.max(0, Math.sin(ph)) ** 3 + 0.25 * rng.next();
      const env = Math.sin(Math.PI * Math.min(1, t * 1.3)) * (1 - t * 0.4);
      out[start + i] = (f1.process(src) + 0.6 * f2.process(src)) * env;
    }
    start += len + Math.round(sr * (0.15 + 0.2 * rng.unit()));
  }
  normalise(out, 0.9);
  return out;
}

/** Wolf howl: slow rising-falling glide with vibrato and a breathy edge. */
function howl(sr: number, rng: WhiteNoise): Float32Array<ArrayBuffer> {
  const dur = 2.2 + rng.unit() * 1.2;
  const out = new Float32Array(Math.round(sr * dur));
  const base = 330 + 80 * rng.unit();
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    const glide = 1 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.2 * t;
    const vib = 1 + 0.012 * Math.sin(TAU * 5.5 * (i / sr));
    ph += (TAU * base * glide * vib) / sr;
    const env = Math.min(1, t * 6) * Math.min(1, (1 - t) * 3);
    out[i] = (Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.05 * rng.next()) * env;
  }
  normalise(out, 0.85);
  return out;
}

/** Metal impact: inharmonic plate partials with long, uneven decays. */
function clang(sr: number, rng: WhiteNoise): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(sr * 2.2));
  const base = 180 + 260 * rng.unit();
  const ratios = [1, 2.32, 4.25, 6.63, 9.38];
  ratios.forEach((r, k) => {
    const f = base * r * (0.97 + 0.06 * rng.unit());
    const decay = (0.9 - k * 0.12) * (0.7 + 0.6 * rng.unit());
    const amp = 1 / (k + 1);
    const ph0 = rng.unit() * TAU;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      out[i] = (out[i] ?? 0) + Math.sin(ph0 + TAU * f * t) * Math.exp(-t / decay) * amp;
    }
  });
  // A second, smaller bounce.
  const bounce = Math.round(sr * (0.25 + 0.2 * rng.unit()));
  for (let i = out.length - 1; i >= bounce; i--)
    out[i] = (out[i] ?? 0) + (out[i - bounce] ?? 0) * 0.35;
  normalise(out, 0.8);
  return out;
}

/** Failing civil-defence siren: a wail that stutters and dies. */
function siren(sr: number, rng: WhiteNoise): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(sr * 4));
  let ph = 0;
  const stutter = 0.4 + 0.5 * rng.unit();
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = 420 + 300 * (0.5 - 0.5 * Math.cos(TAU * 0.35 * t)) * (1 - 0.15 * (t / 4));
    ph += (TAU * f) / sr;
    // Square-ish rotor tone, with power dropouts.
    const tone = Math.tanh(3 * Math.sin(ph)) + 0.3 * Math.sin(3 * ph);
    const power = Math.sin(TAU * stutter * t) > -0.85 ? 1 : 0.15;
    const env = Math.min(1, t * 2) * Math.min(1, (4 - t) * 1.5);
    out[i] = tone * env * power;
  }
  normalise(out, 0.7);
  return out;
}

/** Robot radio chatter: FM beeps and data bursts. */
function chirp(sr: number, rng: WhiteNoise): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(sr * 1.2));
  let t0 = 0;
  while (t0 < out.length - sr * 0.1) {
    const len = Math.round(sr * (0.03 + 0.08 * rng.unit()));
    const fc = 900 + 2600 * rng.unit();
    const fm = 30 + 220 * rng.unit();
    const depth = 200 + 900 * rng.unit();
    for (let i = 0; i < len && t0 + i < out.length; i++) {
      const t = i / sr;
      const env = Math.sin((Math.PI * i) / len);
      out[t0 + i] = Math.sin(TAU * fc * t + (depth / fm) * Math.sin(TAU * fm * t)) * env;
    }
    t0 += len + Math.round(sr * (0.02 + 0.12 * rng.unit()));
  }
  normalise(out, 0.6);
  return out;
}

/** Far gunshot: a dull crack followed by a long rolling echo off buildings. */
function shot(sr: number, rng: WhiteNoise): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(sr * 2.5));
  const lp = new Biquad('lowpass', 1800, 0.7, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const crack = Math.exp(-t / 0.012);
    const roll = 0.35 * Math.exp(-t / 0.7) * (0.6 + 0.4 * Math.sin(TAU * 1.7 * t + rng.unit()));
    out[i] = lp.process(rng.next() * (crack + roll * Math.min(1, t / 0.05)));
  }
  normalise(out, 0.9);
  return out;
}
