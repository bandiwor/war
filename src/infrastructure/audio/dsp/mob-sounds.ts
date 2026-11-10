import type { Race } from '../../../domain/combat/races';
import { Biquad } from './biquad';
import { normalise } from './footstep';
import { BrownNoise, WhiteNoise } from './noise';
import { saturate } from './weapon-sounds';

/**
 * The races' sound signatures (stage 7), synthesised offline into variants
 * like the weapon sounds. Each race has its own spectral home so a player
 * can tell what is out there in the dark by ear alone:
 *  - zombies: breath rasping through a ruined throat (noise through moving
 *    vocal formants), wet gurgles, feet dragging — all noise, no pitch;
 *  - robots: servo whine (pitched, harmonic, gliding), clean beeps, radio
 *    static with dropouts, the laser's falling chirp;
 *  - plants: dry rustles and creaks, the woody snap of jaws, a wet hiss of spit;
 *  - animals: voiced, low and pulsed — growls (a glottal pulse train
 *    through formants), a howl's long vibrato glide, the boar's grunt.
 */
type Buf = Float32Array<ArrayBuffer>;
const TAU = Math.PI * 2;

export const MOB_SOUNDS = [
  // zombie
  'rasp',
  'gurgle',
  'shuffle',
  'shriek',
  // robot
  'servo',
  'beep',
  'static',
  'laser',
  // plant
  'rustle',
  'snap',
  'spit',
  'creak',
  // animal
  'growl',
  'snarl',
  'howl',
  'grunt',
] as const;
export type MobSound = (typeof MOB_SOUNDS)[number];

/** What each race says, by situation. */
export interface RaceVoice {
  /** Idle, unaware: breathing, humming, rustling. */
  readonly idle: MobSound;
  /** Aware and hunting. */
  readonly alert: MobSound;
  /** Moving (steps, wheels, roots). */
  readonly move: MobSound;
  /** Lunging or biting. */
  readonly attack: MobSound;
}

export const RACE_VOICES: Readonly<Record<Race, RaceVoice>> = {
  zombie: { idle: 'rasp', alert: 'gurgle', move: 'shuffle', attack: 'shriek' },
  robot: { idle: 'servo', alert: 'beep', move: 'servo', attack: 'laser' },
  plant: { idle: 'rustle', alert: 'creak', move: 'rustle', attack: 'snap' },
  animal: { idle: 'growl', alert: 'snarl', move: 'grunt', attack: 'snarl' },
};

/** Seconds per sound (keeps the banks small). */
const LENGTH: Readonly<Record<MobSound, number>> = {
  rasp: 1.4,
  gurgle: 0.9,
  shuffle: 0.8,
  shriek: 0.9,
  servo: 0.7,
  beep: 0.5,
  static: 1.2,
  laser: 0.45,
  rustle: 0.9,
  snap: 0.4,
  spit: 0.6,
  creak: 0.9,
  growl: 1.2,
  snarl: 0.8,
  howl: 2.4,
  grunt: 0.45,
};

/** Formant filter bank: a crude vocal tract (sum of band-passes). */
class Tract {
  private readonly bands: Biquad[];
  constructor(
    private readonly formants: readonly (readonly [number, number, number])[],
    sr: number,
  ) {
    this.bands = formants.map(([f, q]) => new Biquad('bandpass', f, q, sr));
  }
  process(x: number): number {
    let y = 0;
    for (let i = 0; i < this.bands.length; i++)
      y += (this.bands[i]?.process(x) ?? 0) * (this.formants[i]?.[2] ?? 0);
    return y;
  }
}

const env = (t: number, attack: number, length: number): number =>
  Math.min(1, t / attack) * Math.min(1, Math.max(0, (length - t) / (length * 0.35)));

/** Breath noise through drifting formants: inhale/exhale pairs. */
function rasp(out: Buf, sr: number, n: WhiteNoise, scream: boolean): void {
  const len = out.length / sr;
  const tract = new Tract(
    scream
      ? [
          [900, 4, 1],
          [1900, 6, 0.8],
          [3200, 8, 0.4],
        ]
      : [
          [520, 3, 1],
          [1250, 5, 0.6],
          [2600, 7, 0.3],
        ],
    sr,
  );
  const crackle = new Biquad('highpass', 2500, 0.7, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    // Breath: two phrases (in, out) for the idle rasp, one ragged burst for the shriek.
    const phrase = scream ? 1 : 0.5 + 0.5 * Math.sin((TAU * t) / len - Math.PI / 2);
    const flutter = 0.6 + 0.4 * Math.sin(TAU * (scream ? 23 : 11) * t + 3 * Math.sin(TAU * 2 * t));
    const x = n.next();
    const pop = n.unit() > 0.997 ? crackle.process(n.next() * 6) : crackle.process(0);
    out[i] = (tract.process(x) * flutter * phrase + pop * 0.3) * env(t, 0.05, len);
  }
}

/** Wet bubbles: short resonant low bursts at random. */
function gurgle(out: Buf, sr: number, n: WhiteNoise): void {
  const len = out.length / sr;
  let bubble = 0;
  let f = 300;
  let ph = 0;
  const low = new Biquad('lowpass', 900, 0.8, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if (bubble <= 0 && n.unit() > 0.9993) {
      bubble = Math.round(sr * (0.02 + 0.04 * n.unit()));
      f = 180 + 420 * n.unit();
    }
    let b = 0;
    if (bubble > 0) {
      bubble--;
      f *= 1.00004; // bubbles rise in pitch as they shrink
      ph += (TAU * f) / sr;
      b = Math.sin(ph) * Math.min(1, bubble / (sr * 0.01));
    }
    out[i] = (b * 0.8 + low.process(n.next()) * 0.25) * env(t, 0.03, len);
  }
}

/** Feet and knees dragging over grit. */
function shuffle(out: Buf, sr: number, n: WhiteNoise): void {
  const len = out.length / sr;
  const grit = new Biquad('bandpass', 1400, 0.9, sr);
  const body = new Biquad('lowpass', 300, 0.7, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    // Two drags per sound, with a heel scuff at each start.
    const k = (t / len) * 2;
    const drag = Math.sin(Math.PI * (k % 1)) * (0.6 + 0.4 * n.unit());
    out[i] =
      (grit.process(n.next()) * drag + body.process(n.next()) * drag * 0.5) * env(t, 0.02, len);
  }
}

/** Servo: a sawtooth whine that glides up, holds, glides down; gear-noise grit. */
function servo(out: Buf, sr: number, n: WhiteNoise): void {
  const len = out.length / sr;
  const base = 340 + 120 * n.unit();
  let ph = 0;
  const gear = new Biquad('bandpass', 4200, 3, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const u = t / len;
    const glide = u < 0.3 ? u / 0.3 : u > 0.7 ? (1 - u) / 0.3 : 1;
    const f = base * (0.7 + 0.6 * glide);
    ph += f / sr;
    const saw = 2 * (ph % 1) - 1;
    const ripple = 1 + 0.1 * Math.sin(TAU * 31 * t);
    out[i] = (saw * 0.5 * ripple + gear.process(n.next()) * 0.3 * glide) * env(t, 0.03, len);
  }
}

/** Two short square-ish beeps: the robot's identify / acknowledge chirp. */
function beep(out: Buf, sr: number, n: WhiteNoise): void {
  const f1 = 1800 + 400 * n.unit();
  const f2 = f1 * (n.unit() > 0.5 ? 1.25 : 0.8);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const on1 = t > 0.02 && t < 0.12;
    const on2 = t > 0.18 && t < 0.28;
    const f = on1 ? f1 : f2;
    const s = Math.sin(TAU * f * t);
    out[i] = (on1 || on2 ? Math.tanh(3 * s) * 0.6 : 0) * Math.min(1, (0.5 - t) / 0.1);
  }
}

/** Radio interference: band-limited hiss with dropouts, carrier whistle and clicks. */
function radioStatic(out: Buf, sr: number, n: WhiteNoise): void {
  const len = out.length / sr;
  const band = new Biquad('bandpass', 1800, 0.6, sr);
  const whistle = 2600 + 800 * n.unit();
  let gate = 1;
  let hold = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if (hold-- <= 0) {
      hold = Math.round(sr * (0.01 + 0.06 * n.unit()));
      gate = n.unit() > 0.3 ? 0.4 + 0.6 * n.unit() : 0.02;
    }
    const click = n.unit() > 0.9985 ? n.next() * 3 : 0;
    const carrier = Math.sin(TAU * (whistle + 300 * Math.sin(TAU * 0.7 * t)) * t) * 0.08;
    out[i] = (band.process(n.next()) * gate + carrier + click) * env(t, 0.01, len);
  }
}

/** The laser: a bright zap, chirping down fast, with a crackling discharge. */
function laser(out: Buf, sr: number, n: WhiteNoise): void {
  let ph = 0;
  const crackle = new Biquad('highpass', 3000, 0.7, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = 4200 * Math.exp(-t / 0.06) + 380;
    ph += (TAU * f) / sr;
    const tone = Math.sin(ph) + 0.4 * Math.sin(2 * ph);
    out[i] =
      (tone * Math.exp(-t / 0.12) * 0.7 + crackle.process(n.next()) * Math.exp(-t / 0.05) * 0.5) *
      Math.min(1, t / 0.001);
  }
}

/** Leaves and dry stems brushing: many tiny high clicks. */
function rustle(out: Buf, sr: number, n: WhiteNoise): void {
  const len = out.length / sr;
  const hi = new Biquad('bandpass', 5200, 1.2, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const swell = 0.4 + 0.6 * Math.sin((Math.PI * t) / len);
    const tick = n.unit() > 0.985 ? n.next() * 2 : n.next() * 0.25;
    out[i] = hi.process(tick) * swell * env(t, 0.05, len);
  }
}

/** Jaws closing: a woody knock, a fibrous crunch. */
function snap(out: Buf, sr: number, n: WhiteNoise): void {
  const knock = new Biquad('bandpass', 700 + 300 * n.unit(), 6, sr);
  const crunch = new Biquad('bandpass', 2400, 1.5, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const x = n.next();
    out[i] =
      knock.process(i < sr * 0.003 ? x * 8 : 0) * 1.2 +
      crunch.process(x) * Math.exp(-t / 0.05) * 0.6;
  }
}

/** Acid spit: a wet throat-pop then a sizzling hiss. */
function spit(out: Buf, sr: number, n: WhiteNoise): void {
  const pop = new Biquad('lowpass', 500, 1.2, sr);
  const hiss = new Biquad('highpass', 3500, 0.7, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const x = n.next();
    out[i] =
      pop.process(t < 0.02 ? x * 4 : 0) +
      hiss.process(x) * Math.min(1, t / 0.04) * Math.exp(-t / 0.25) * 0.7;
  }
}

/** A stem bending: stick-slip creaks, dense resonant pulses. */
function creak(out: Buf, sr: number, n: WhiteNoise): void {
  const len = out.length / sr;
  const wood = new Biquad('bandpass', 480, 8, sr);
  let next = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let x = 0;
    if (i >= next) {
      x = 1;
      // Slip rate wanders (the stem bends faster, then slower).
      next = i + Math.round(sr / (60 + 50 * Math.sin((TAU * t) / len) + 20 * n.unit()));
    }
    out[i] = wood.process(x * 3) * env(t, 0.06, len);
  }
}

/** Voiced animal: a glottal pulse train at `f0` through a long-throat tract. */
function voiced(
  out: Buf,
  sr: number,
  n: WhiteNoise,
  f0: (t: number) => number,
  formants: readonly (readonly [number, number, number])[],
  roughness: number,
  amp: (t: number) => number,
): void {
  const tract = new Tract(formants, sr);
  const breath = new BrownNoise(n.unit() * 1e9);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    // Jitter (rough voice): the period wanders.
    ph += (f0(t) * (1 + roughness * n.next() * 0.3)) / sr;
    const pulse = ph % 1 < 0.12 ? 1 : 0;
    out[i] = tract.process(pulse * 2 + breath.next() * roughness * 0.4) * amp(t);
  }
}

/** Seeded, deterministic, peak-normalised. */
export function synthesizeMobSound(kind: MobSound, sr: number, seed: number): Buf {
  const out = new Float32Array(Math.round(sr * LENGTH[kind]));
  const n = new WhiteNoise(Math.imul(seed + 1, 0x9e3779b1) + kind.length * 97);
  const len = LENGTH[kind];
  switch (kind) {
    case 'rasp':
      rasp(out, sr, n, false);
      break;
    case 'shriek':
      rasp(out, sr, n, true);
      saturate(out, 2.5);
      break;
    case 'gurgle':
      gurgle(out, sr, n);
      break;
    case 'shuffle':
      shuffle(out, sr, n);
      break;
    case 'servo':
      servo(out, sr, n);
      break;
    case 'beep':
      beep(out, sr, n);
      break;
    case 'static':
      radioStatic(out, sr, n);
      break;
    case 'laser':
      laser(out, sr, n);
      break;
    case 'rustle':
      rustle(out, sr, n);
      break;
    case 'snap':
      snap(out, sr, n);
      break;
    case 'spit':
      spit(out, sr, n);
      break;
    case 'creak':
      creak(out, sr, n);
      break;
    case 'growl': {
      const base = 70 + 20 * n.unit();
      voiced(
        out,
        sr,
        n,
        (t) => base + 8 * Math.sin(TAU * 3 * t),
        [
          [280, 4, 1],
          [750, 5, 0.6],
          [1600, 6, 0.2],
        ],
        0.8,
        (t) => env(t, 0.15, len) * (0.7 + 0.3 * Math.sin(TAU * 6 * t)),
      );
      break;
    }
    case 'snarl': {
      const base = 140 + 40 * n.unit();
      voiced(
        out,
        sr,
        n,
        (t) => base * (1 + 0.3 * Math.exp(-t / 0.2)),
        [
          [500, 3, 1],
          [1300, 4, 0.7],
          [2800, 5, 0.3],
        ],
        1,
        (t) => env(t, 0.02, len),
      );
      saturate(out, 2);
      break;
    }
    case 'howl': {
      const base = 380 + 60 * n.unit();
      voiced(
        out,
        sr,
        n,
        // Rises, holds with vibrato, falls away.
        (t) =>
          base *
          (0.75 + 0.35 * Math.min(1, t / 0.5) - 0.3 * Math.max(0, (t - 1.6) / 0.8)) *
          (1 + 0.02 * Math.sin(TAU * 5.5 * t)),
        [
          [700, 5, 1],
          [1100, 6, 0.5],
        ],
        0.15,
        (t) => env(t, 0.3, len),
      );
      break;
    }
    case 'grunt': {
      const base = 90 + 20 * n.unit();
      voiced(
        out,
        sr,
        n,
        (t) => base * (1.2 - 0.4 * (t / len)),
        [
          [220, 3, 1],
          [600, 4, 0.5],
        ],
        0.9,
        (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.12),
      );
      break;
    }
  }
  normalise(out, 0.95);
  return out;
}
