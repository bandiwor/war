import type { Rng } from '../../../domain/math/prng';
import type { FootstepAcoustics } from '../../../domain/world/surfaces';
import { Biquad } from './biquad';

/**
 * Physically-flavoured footstep: a heel strike followed ~70 ms later by the
 * toe/roll, each made of
 *  - thump: decaying low sine with a pitch drop (the body of the impact)
 *  - click: band-passed noise burst (sole on a hard surface)
 *  - ring:  decaying partials (metal plates, hollow wood)
 *  - grit:  sparse random micro-impulses (gravel, debris)
 *  - splash: low-passed noise with a slow swell (puddles)
 * Deterministic for a given Rng state, so variants can be pre-baked from a seed.
 */
export interface FootstepOptions {
  readonly sampleRate: number;
  /** 0..1 gait loudness (crouch quiet, sprint loud). */
  readonly intensity: number;
  readonly durationSeconds?: number;
}

export function synthesizeFootstep(
  a: FootstepAcoustics,
  rng: Rng,
  o: FootstepOptions,
): Float32Array<ArrayBuffer> {
  const sr = o.sampleRate;
  const out = new Float32Array(Math.round((o.durationSeconds ?? 0.45) * sr));
  // Heel then toe, with natural variation in timing and force.
  const toeDelay = rng.range(0.055, 0.09);
  const toeForce = rng.range(0.35, 0.6);
  addStrike(out, a, rng, sr, 0, rng.range(0.85, 1.05));
  addStrike(out, a, rng, sr, Math.round(toeDelay * sr), toeForce);
  normalise(out, 0.25 + 0.65 * Math.min(1, Math.max(0, o.intensity)));
  return out;
}

function addStrike(
  out: Float32Array,
  a: FootstepAcoustics,
  rng: Rng,
  sr: number,
  start: number,
  force: number,
): void {
  const n = out.length;
  const pitch = rng.range(0.9, 1.12);

  // Thump with a falling pitch.
  let phase = 0;
  const thumpLen = Math.min(n - start, Math.round(a.thump.decay * 6 * sr));
  for (let i = 0; i < thumpLen; i++) {
    const t = i / sr;
    const f = a.thump.freq * pitch * (1 + 0.6 * Math.exp(-t / 0.008));
    phase += (2 * Math.PI * f) / sr;
    const env = Math.exp(-t / a.thump.decay) * Math.min(1, t / 0.002);
    out[start + i] = (out[start + i] ?? 0) + Math.sin(phase) * env * a.thump.level * force;
  }

  // Click: band-passed noise burst.
  const bp = new Biquad('bandpass', a.click.freq * pitch, a.click.q, sr);
  const clickLen = Math.min(n - start, Math.round(a.click.decay * 6 * sr));
  for (let i = 0; i < clickLen; i++) {
    const t = i / sr;
    const env = Math.exp(-t / a.click.decay);
    out[start + i] =
      (out[start + i] ?? 0) + bp.process(rng.range(-1, 1)) * env * a.click.level * force * 3;
  }

  // Ring: decaying partials with slight inharmonic jitter.
  if (a.ring.level > 0) {
    const ringLen = Math.min(n - start, Math.round(a.ring.decay * 5 * sr));
    a.ring.freqs.forEach((f0, k) => {
      const f = f0 * pitch * rng.range(0.98, 1.02);
      const amp = a.ring.level * force * (1 / (k + 1)) * rng.range(0.7, 1);
      const decay = a.ring.decay / (1 + k * 0.4);
      const ph0 = rng.range(0, Math.PI * 2);
      for (let i = 0; i < ringLen; i++) {
        const t = i / sr;
        out[start + i] =
          (out[start + i] ?? 0) +
          Math.sin(ph0 + 2 * Math.PI * f * t) * Math.exp(-t / decay) * amp * Math.min(1, t / 0.001);
      }
    });
  }

  // Grit: sparse impulses through a highpass.
  if (a.grit.level > 0) {
    const hp = new Biquad('highpass', 1800, 0.7, sr);
    const gritLen = Math.min(n - start, Math.round(0.12 * sr));
    for (let i = 0; i < gritLen; i++) {
      const t = i / sr;
      const grain = rng.nextFloat() < a.grit.density * 0.02 ? rng.range(-1, 1) : 0;
      out[start + i] =
        (out[start + i] ?? 0) + hp.process(grain) * Math.exp(-t / 0.05) * a.grit.level * force * 2;
    }
  }

  // Splash: low-passed noise that swells and fades.
  if (a.splash > 0) {
    const lp = new Biquad('lowpass', 2200, 0.5, sr);
    const splashLen = Math.min(n - start, Math.round(0.3 * sr));
    for (let i = 0; i < splashLen; i++) {
      const t = i / sr;
      const env = (t / 0.02) * Math.exp(1 - t / 0.02) * 0.6 + Math.exp(-t / 0.12) * 0.4;
      out[start + i] =
        (out[start + i] ?? 0) + lp.process(rng.range(-1, 1)) * env * a.splash * force;
    }
  }
}

/** Scale to the target peak and apply a short fade-out so variants never click. */
export function normalise(buf: Float32Array, peak: number): void {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const k = max > 0 ? peak / max : 0;
  const fade = Math.min(buf.length, 256);
  for (let i = 0; i < buf.length; i++) {
    const tail = i >= buf.length - fade ? (buf.length - i) / fade : 1;
    buf[i] = (buf[i] ?? 0) * k * tail;
  }
}

/** Simple analysis helpers (tests, debug). */
export function rms(buf: Float32Array, from = 0, to = buf.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += (buf[i] ?? 0) ** 2;
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Zero-crossing rate per second: a cheap brightness proxy. */
export function zeroCrossingRate(buf: Float32Array, sampleRate: number): number {
  let z = 0;
  for (let i = 1; i < buf.length; i++) if ((buf[i - 1] ?? 0) >= 0 !== (buf[i] ?? 0) >= 0) z++;
  return (z / buf.length) * sampleRate;
}

/** Seconds until the signal stays below `threshold` of its peak. */
export function decayTime(buf: Float32Array, sampleRate: number, threshold = 0.01): number {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  for (let i = buf.length - 1; i >= 0; i--)
    if (Math.abs(buf[i] ?? 0) > peak * threshold) return i / sampleRate;
  return 0;
}
