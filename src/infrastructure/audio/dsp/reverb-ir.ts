import type { RoomAcoustics } from '../../../domain/audio/acoustics';
import { WhiteNoise } from './noise';

/**
 * Procedural reverb impulse response from estimated room acoustics:
 *  - pre-delay from the nearest reflecting surface,
 *  - discrete early reflections (delay, gain, pan) from the geometry probes,
 *  - an exponentially decaying, decorrelated stereo noise tail with the
 *    target RT60, getting darker over time (air + surface HF absorption).
 * Played through a ConvolverNode; regenerated only when acoustics change.
 */
export interface StereoIr {
  readonly left: Float32Array<ArrayBuffer>;
  readonly right: Float32Array<ArrayBuffer>;
}

export function generateImpulseResponse(
  a: RoomAcoustics,
  sampleRate: number,
  seed: number,
): StereoIr {
  const length = Math.round(Math.min(4.5, Math.max(0.25, a.rt60 * 1.15)) * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const nl = new WhiteNoise(seed);
  const nr = new WhiteNoise(seed ^ 0x5bd1e995);
  const preDelay = Math.round((a.early[0]?.delay ?? 0.004) * 0.5 * sampleRate);
  const decayPerSample = 6.907755 / (a.rt60 * sampleRate); // ln(1000) → −60 dB at rt60
  // Low-pass that closes over time: HF decays faster than LF.
  let lpL = 0;
  let lpR = 0;
  for (let i = preDelay; i < length; i++) {
    const t = (i - preDelay) / sampleRate;
    const env = Math.exp(-(i - preDelay) * decayPerSample);
    const k = Math.max(0.04, 0.95 - (0.5 + a.damping) * (t / a.rt60));
    lpL += (nl.next() - lpL) * k;
    lpR += (nr.next() - lpR) * k;
    // Tail fades in over 25 ms so early reflections stay distinct.
    const fadeIn = Math.min(1, t / 0.025);
    left[i] = lpL * env * fadeIn;
    right[i] = lpR * env * fadeIn;
  }
  for (const e of a.early) {
    const idx = Math.round(e.delay * sampleRate);
    if (idx >= length) continue;
    left[idx] = (left[idx] ?? 0) + e.gain * (1 - e.pan) * 0.7;
    right[idx] = (right[idx] ?? 0) + e.gain * (1 + e.pan) * 0.7;
  }
  normaliseEnergy(left, right);
  return { left, right };
}

/** Unit total energy, so changing RT60 changes character, not loudness. */
function normaliseEnergy(left: Float32Array, right: Float32Array): void {
  let e = 0;
  for (let i = 0; i < left.length; i++) e += (left[i] ?? 0) ** 2 + (right[i] ?? 0) ** 2;
  const k = e > 0 ? 1 / Math.sqrt(e) : 0;
  for (let i = 0; i < left.length; i++) {
    left[i] = (left[i] ?? 0) * k;
    right[i] = (right[i] ?? 0) * k;
  }
}
