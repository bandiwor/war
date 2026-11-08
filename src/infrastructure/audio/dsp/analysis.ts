import { Biquad } from './biquad';

/** Offline analysis helpers for tests, acceptance checks and debug meters. */

/** Power of a single frequency (Goertzel), normalised by length. */
export function goertzel(buf: Float32Array, freq: number, sampleRate: number): number {
  const k = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (const x of buf) {
    const s = x + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (s1 * s1 + s2 * s2 - k * s1 * s2) / (buf.length * buf.length);
}

export const OCTAVE_BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;

/** Mean-square energy per octave band. */
export function bandEnergies(buf: Float32Array, sampleRate: number): number[] {
  return OCTAVE_BANDS.map((f) => {
    const bp = new Biquad('bandpass', f, 1.41, sampleRate);
    let e = 0;
    for (const x of buf) {
      const y = bp.process(x);
      e += y * y;
    }
    return e / buf.length;
  });
}

/** Transient events per second: rises of the 5 ms envelope above 2× its slow average. */
export function onsetRate(buf: Float32Array, sampleRate: number): number {
  const win = Math.max(1, Math.round(sampleRate * 0.005));
  let onsets = 0;
  let slow = 1e-6;
  let armed = true;
  for (let i = 0; i + win <= buf.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += (buf[j] ?? 0) ** 2;
    e /= win;
    if (armed && e > slow * 4 && e > 1e-7) {
      onsets++;
      armed = false;
    } else if (e < slow * 1.5) {
      armed = true;
    }
    slow = slow * 0.97 + e * 0.03;
  }
  return onsets / (buf.length / sampleRate);
}

/** RT60 of an impulse response via Schroeder backward integration (T20 fit, extrapolated). */
export function schroederRt60(ir: Float32Array, sampleRate: number): number {
  const edc = new Float64Array(ir.length);
  let acc = 0;
  for (let i = ir.length - 1; i >= 0; i--) {
    acc += (ir[i] ?? 0) ** 2;
    edc[i] = acc;
  }
  const total = edc[0] ?? 1;
  const db = (i: number): number => 10 * Math.log10((edc[i] ?? 0) / total + 1e-30);
  let i5 = -1;
  let i25 = -1;
  for (let i = 0; i < ir.length; i++) {
    const d = db(i);
    if (i5 < 0 && d <= -5) i5 = i;
    if (d <= -25) {
      i25 = i;
      break;
    }
  }
  if (i5 < 0 || i25 < 0) return 0;
  return ((i25 - i5) / sampleRate) * 3; // 20 dB of decay → 60 dB
}

export function peak(buf: Float32Array): number {
  let m = 0;
  for (const x of buf) m = Math.max(m, Math.abs(x));
  return m;
}
