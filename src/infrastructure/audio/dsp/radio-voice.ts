import { Biquad } from './biquad';
import { normalise } from './footstep';
import { WhiteNoise } from './noise';

/**
 * The voices of the story, as the bodycam hears them: never words (there
 * are no recordings and no TTS), but a voice-shaped murmur under the
 * subtitle. A glottal pulse train at the speaker's pitch runs through
 * moving vowel formants in syllable-length bursts, then through the
 * channel: a radio band (300–3000 Hz) with hiss and squelch clicks at
 * both ends, or a worn tape (low-passed, wow and flutter).
 */
type Buf = Float32Array<ArrayBuffer>;
const TAU = Math.PI * 2;

export type VoiceChannel = 'radio' | 'tape';

/** Vowel formant pairs (F1, F2) the murmur moves between. */
const VOWELS: readonly (readonly [number, number])[] = [
  [730, 1090],
  [270, 2290],
  [300, 870],
  [530, 1840],
  [570, 840],
  [440, 1020],
];

/** A stable pitch per speaker (Hz), from the name: the handler, Reyes and WARDEN differ. */
export function speakerPitch(speaker: string): number {
  let h = 2166136261;
  for (let i = 0; i < speaker.length; i++) h = Math.imul(h ^ speaker.charCodeAt(i), 16777619);
  const u = ((h >>> 0) % 1000) / 1000;
  // Machine voices sit flat and low; people between 95 and 230 Hz.
  return speaker === 'WARDEN' ? 70 : 95 + 135 * u;
}

export function synthesizeVoice(
  speaker: string,
  seconds: number,
  channel: VoiceChannel,
  sr: number,
  seed: number,
): Buf {
  const len = Math.min(8, Math.max(0.3, seconds * 0.85));
  const out = new Float32Array(Math.round(sr * len));
  const n = new WhiteNoise(Math.imul(seed + 1, 0x9e3779b1) ^ speaker.length);
  const f0 = speakerPitch(speaker);
  const machine = speaker === 'WARDEN';
  let ph = 0;
  // Syllables: 3.5–5.5 per second, with short pauses between words.
  let syl = 0;
  let sylLen = 1;
  let next = 1;
  let gap = false;
  let f1 = new Biquad('bandpass', 500, 4, sr);
  let f2 = new Biquad('bandpass', 1500, 6, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if (syl >= sylLen) {
      syl = 0;
      gap = !gap && n.unit() < 0.25;
      sylLen = Math.round(sr * (gap ? 0.08 + 0.1 * n.unit() : 0.18 + 0.1 * n.unit()));
      const v = VOWELS[next] ?? [500, 1500];
      next = Math.floor(n.unit() * VOWELS.length);
      f1 = new Biquad('bandpass', v[0], 4, sr);
      f2 = new Biquad('bandpass', v[1], 6, sr);
    }
    const k = syl / sylLen;
    syl++;
    // Each syllable swells and dies away to near silence (consonant gaps).
    const swell = Math.sin(Math.PI * Math.min(1, k * 1.15));
    const env = gap || k > 0.87 ? 0 : swell * swell * (0.6 + 0.4 * Math.sin(TAU * 0.4 * t));
    // Intonation: a slow fall over the phrase, a little jitter.
    const pitch = f0 * (1.1 - 0.2 * (t / len)) * (machine ? 1 : 1 + 0.01 * n.next());
    ph += pitch / sr;
    const pulse = ph % 1 < (machine ? 0.5 : 0.1) ? 1 : -0.1;
    const breath = n.next() * 0.15;
    const x = pulse + breath;
    out[i] = (f1.process(x) + 0.6 * f2.process(x)) * env;
  }
  // The channel.
  if (channel === 'radio') {
    const hp = new Biquad('highpass', 300, 0.7, sr);
    const lp = new Biquad('lowpass', 3000, 0.7, sr);
    const hiss = new Biquad('bandpass', 2500, 0.5, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const squelch = t < 0.04 || t > len - 0.06 ? n.next() * 1.2 : 0;
      out[i] = lp.process(hp.process(out[i] ?? 0)) + hiss.process(n.next()) * 0.05 + squelch;
    }
  } else {
    const lp = new Biquad('lowpass', 2400, 0.7, sr);
    const copy = out.slice();
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      // Wow (0.6 Hz) and flutter (9 Hz): read the copy at a wobbling position.
      const pos = i + sr * 0.002 * Math.sin(TAU * 0.6 * t) + sr * 0.0003 * Math.sin(TAU * 9 * t);
      const a = Math.floor(pos);
      const fr = pos - a;
      const s = (copy[a] ?? 0) * (1 - fr) + (copy[a + 1] ?? 0) * fr;
      out[i] = lp.process(s) + n.next() * 0.02;
    }
  }
  normalise(out, 0.8);
  return out;
}
