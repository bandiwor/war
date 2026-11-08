import { Biquad } from './biquad';
import { BrownNoise, PinkNoise, Smoother, WhiteNoise } from './noise';

/**
 * Ambient layer generators. Each adds stereo samples into the given block
 * (left/right arrays, `n` frames) at a gain the renderer smooths. Parameters
 * that need filter recomputation are applied per block, never per sample.
 */
export interface Layer {
  process(left: Float32Array, right: Float32Array, n: number, gain: number): void;
}

const TAU = Math.PI * 2;

/** Gusting wind: pink noise through drifting band-passes (L/R decorrelated), plus whistle at strong gusts. */
export class Wind implements Layer {
  gustiness = 0.5;
  brightness = 0.5;
  private readonly nl: PinkNoise;
  private readonly nr: PinkNoise;
  private readonly wn: WhiteNoise;
  private readonly bpl: Biquad;
  private readonly bpr: Biquad;
  private readonly whistle: Biquad;
  private gust: Smoother;
  private gustTarget = 0.4;
  private untilChange = 0;

  constructor(
    private readonly sr: number,
    seed: number,
  ) {
    this.nl = new PinkNoise(seed);
    this.nr = new PinkNoise(seed + 1);
    this.wn = new WhiteNoise(seed + 2);
    this.bpl = new Biquad('bandpass', 400, 0.6, sr);
    this.bpr = new Biquad('bandpass', 420, 0.6, sr);
    this.whistle = new Biquad('bandpass', 900, 14, sr);
    this.gust = new Smoother(0.4, 1.2, sr / 128);
  }

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    this.untilChange -= n;
    if (this.untilChange <= 0) {
      this.gustTarget = 0.15 + this.wn.unit() * (0.3 + 0.7 * this.gustiness);
      this.untilChange = Math.round(this.sr * (0.6 + 2.5 * this.wn.unit()));
    }
    const g = this.gust.step(this.gustTarget);
    const center = 150 + 1400 * this.brightness * (0.35 + g);
    this.bpl.set('bandpass', center, 0.6, this.sr);
    this.bpr.set('bandpass', center * 1.07, 0.6, this.sr);
    this.whistle.set('bandpass', 600 + 900 * g, 14, this.sr);
    const amp = gain * (0.25 + 1.6 * g * g) * 2.2;
    const whistleAmp = gain * Math.max(0, g - 0.65) * 3;
    for (let i = 0; i < n; i++) {
      const w = this.whistle.process(this.wn.next()) * whistleAmp;
      left[i] = (left[i] ?? 0) + this.bpl.process(this.nl.next()) * amp + w;
      right[i] = (right[i] ?? 0) + this.bpr.process(this.nr.next()) * amp + w * 0.8;
    }
  }
}

/** Mains hum with harmonics, slow beating and slight stereo detune. */
export class Hum implements Layer {
  freq = 50;
  harmonics = 0.5;
  private phase = 0;
  private wobble = 0;
  private readonly amps = new Float32Array(6);

  constructor(private readonly sr: number) {}

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    for (let k = 0; k < 6; k++) {
      const h = k + 1;
      // Odd harmonics dominate transformer hum; `harmonics` shifts energy upward.
      this.amps[k] = (h === 1 ? 1 : (h % 2 === 1 ? 0.8 : 0.45) * this.harmonics) / h;
    }
    const inc = (TAU * this.freq) / this.sr;
    const wobInc = (TAU * 0.27) / this.sr;
    for (let i = 0; i < n; i++) {
      this.phase += inc;
      if (this.phase > TAU * 64) this.phase -= TAU * 64;
      this.wobble += wobInc;
      let s = 0;
      for (let k = 0; k < 6; k++) s += Math.sin(this.phase * (k + 1)) * (this.amps[k] ?? 0);
      const beat = 0.85 + 0.15 * Math.sin(this.wobble);
      const v = s * gain * beat * 0.5;
      left[i] = (left[i] ?? 0) + v;
      right[i] = (right[i] ?? 0) + v * (0.9 + 0.1 * Math.sin(this.wobble * 1.3));
    }
  }
}

/** Night insects: chirping crickets (pulse trains) blended with a cicada drone. */
export class Insects implements Layer {
  density = 0.5;
  pitch = 4500;
  cicada = 0;
  private readonly rng: WhiteNoise;
  private readonly voices: {
    freq: number;
    pan: number;
    period: number;
    t: number;
    phase: number;
  }[] = [];
  private cicadaPhase = 0;
  private cicadaAm = 0;
  private cicadaSwell = 0;

  constructor(
    private readonly sr: number,
    seed: number,
  ) {
    this.rng = new WhiteNoise(seed);
    for (let v = 0; v < 8; v++) {
      this.voices.push({
        freq: 1,
        pan: this.rng.next() * 0.9,
        period: 0.45 + this.rng.unit() * 0.9,
        t: this.rng.unit(),
        phase: 0,
      });
    }
  }

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    const active = Math.round(this.density * this.voices.length);
    const dt = 1 / this.sr;
    const cricketGain = gain * (1 - this.cicada) * 0.5;
    for (let v = 0; v < active; v++) {
      const voice = this.voices[v];
      if (voice === undefined) continue;
      voice.freq = this.pitch * (0.9 + 0.2 * (v / 8));
      const inc = (TAU * voice.freq) / this.sr;
      const gl = cricketGain * (1 - voice.pan) * 0.5;
      const gr = cricketGain * (1 + voice.pan) * 0.5;
      for (let i = 0; i < n; i++) {
        voice.t += dt;
        if (voice.t >= voice.period) voice.t -= voice.period;
        // A chirp = 3 pulses of 14 ms, 32 ms apart, at the start of each period.
        const k = Math.floor(voice.t / 0.032);
        const within = voice.t - k * 0.032;
        let env = 0;
        if (k < 3 && within < 0.014) env = Math.sin((within / 0.014) * Math.PI);
        voice.phase += inc;
        if (voice.phase > TAU) voice.phase -= TAU;
        if (env > 0) {
          const s = Math.sin(voice.phase) * env;
          left[i] = (left[i] ?? 0) + s * gl;
          right[i] = (right[i] ?? 0) + s * gr;
        }
      }
    }
    if (this.cicada > 0.01) {
      const cg = gain * this.cicada * 0.35;
      const inc = (TAU * (this.pitch * 1.4)) / this.sr;
      const amInc = (TAU * 140) / this.sr;
      const swellInc = (TAU * 0.08) / this.sr;
      for (let i = 0; i < n; i++) {
        this.cicadaPhase += inc;
        this.cicadaAm += amInc;
        this.cicadaSwell += swellInc;
        if (this.cicadaPhase > TAU) this.cicadaPhase -= TAU;
        if (this.cicadaAm > TAU) this.cicadaAm -= TAU;
        const am = Math.max(0, Math.sin(this.cicadaAm)) ** 3;
        const swell = 0.55 + 0.45 * Math.sin(this.cicadaSwell);
        const s = (Math.sin(this.cicadaPhase) + 0.3 * this.rng.next()) * am * swell * cg;
        left[i] = (left[i] ?? 0) + s;
        right[i] = (right[i] ?? 0) + s * 0.85;
      }
    }
  }
}

/** Water drips: Minnaert-style rising "plink" (bubble resonance) per drop, random pan. */
export class Drips implements Layer {
  rate = 1;
  pitch = 0.5;
  private readonly rng: WhiteNoise;
  private readonly voices = Array.from({ length: 8 }, () => ({
    active: false,
    t: 0,
    f0: 0,
    phase: 0,
    decay: 0.03,
    pan: 0,
    amp: 0,
  }));

  constructor(
    private readonly sr: number,
    seed: number,
  ) {
    this.rng = new WhiteNoise(seed);
  }

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    const p = this.rate / this.sr;
    const dt = 1 / this.sr;
    for (let i = 0; i < n; i++) {
      if (this.rng.unit() < p) this.spawn();
      let l = 0;
      let r = 0;
      for (const v of this.voices) {
        if (!v.active) continue;
        v.t += dt;
        const f = v.f0 * (1 + (0.9 * v.t) / v.decay);
        v.phase += (TAU * f) / this.sr;
        const env = Math.exp(-v.t / v.decay);
        if (env < 0.002) {
          v.active = false;
          continue;
        }
        const s = Math.sin(v.phase) * env * v.amp;
        l += s * (1 - v.pan);
        r += s * (1 + v.pan);
      }
      left[i] = (left[i] ?? 0) + l * gain * 0.5;
      right[i] = (right[i] ?? 0) + r * gain * 0.5;
    }
  }

  private spawn(): void {
    const v = this.voices.find((x) => !x.active);
    if (v === undefined) return;
    v.active = true;
    v.t = 0;
    v.phase = 0;
    v.f0 = 500 + 2400 * this.pitch * (0.6 + 0.8 * this.rng.unit());
    v.decay = 0.012 + 0.03 * this.rng.unit();
    v.pan = this.rng.next() * 0.8;
    v.amp = 0.4 + 0.6 * this.rng.unit();
  }
}

/** Structural creaks: stick-slip impulse trains exciting two resonances (metal: high Q). */
export class Creaks implements Layer {
  ratePerMinute = 3;
  metal = 0.5;
  private readonly rng: WhiteNoise;
  private readonly r1: Biquad;
  private readonly r2: Biquad;
  private remaining = 0;
  private duration = 1;
  private nextPulse = 0;
  private pan = 0;

  constructor(
    private readonly sr: number,
    seed: number,
  ) {
    this.rng = new WhiteNoise(seed);
    this.r1 = new Biquad('bandpass', 400, 8, sr);
    this.r2 = new Biquad('bandpass', 1200, 8, sr);
  }

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    if (this.remaining <= 0 && this.rng.unit() < (this.ratePerMinute / 60) * (n / this.sr)) {
      this.duration = 0.4 + 1.1 * this.rng.unit();
      this.remaining = this.duration;
      this.pan = this.rng.next() * 0.8;
      const m = this.metal;
      this.r1.set('bandpass', (250 + 450 * m) * (0.8 + 0.4 * this.rng.unit()), 4 + 30 * m, this.sr);
      this.r2.set(
        'bandpass',
        (800 + 1100 * m) * (0.8 + 0.4 * this.rng.unit()),
        4 + 30 * m,
        this.sr,
      );
    }
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (this.remaining > 0) {
        this.remaining -= 1 / this.sr;
        const progress = 1 - this.remaining / this.duration;
        this.nextPulse -= 1;
        if (this.nextPulse <= 0) {
          // Slip rate sweeps 25 → 90 Hz with jitter: the "groan" pitch rises.
          const rate = 25 + 65 * progress;
          this.nextPulse = (this.sr / rate) * (0.7 + 0.6 * this.rng.unit());
          x = (0.5 + this.rng.unit()) * Math.sin(Math.PI * progress);
        }
      }
      const s = (this.r1.process(x) + 0.6 * this.r2.process(x)) * gain * 1.6;
      left[i] = (left[i] ?? 0) + s * (1 - this.pan);
      right[i] = (right[i] ?? 0) + s * (1 + this.pan);
    }
  }
}

/** Sub rumble: low-passed brown noise with slow swells (distant machinery, collapsing structures). */
export class Rumble implements Layer {
  freq = 40;
  private readonly noise: BrownNoise;
  private readonly lp: Biquad;
  private swell = 0;

  constructor(
    private readonly sr: number,
    seed: number,
  ) {
    this.noise = new BrownNoise(seed);
    this.lp = new Biquad('lowpass', 40, 0.9, sr);
  }

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    this.lp.set('lowpass', this.freq, 0.9, this.sr);
    const inc = (TAU * 0.05) / this.sr;
    for (let i = 0; i < n; i++) {
      this.swell += inc;
      const s = this.lp.process(this.noise.next()) * gain * (0.6 + 0.4 * Math.sin(this.swell)) * 6;
      left[i] = (left[i] ?? 0) + s;
      right[i] = (right[i] ?? 0) + s;
    }
  }
}

/** Indoor room tone: steady filtered noise (ventilation, the building itself). */
export class RoomTone implements Layer {
  brightness = 0.5;
  private readonly nl: PinkNoise;
  private readonly nr: PinkNoise;
  private readonly lpl: Biquad;
  private readonly lpr: Biquad;

  constructor(
    private readonly sr: number,
    seed: number,
  ) {
    this.nl = new PinkNoise(seed);
    this.nr = new PinkNoise(seed + 5);
    this.lpl = new Biquad('lowpass', 800, 0.7, sr);
    this.lpr = new Biquad('lowpass', 800, 0.7, sr);
  }

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    const cutoff = 250 + 2500 * this.brightness;
    this.lpl.set('lowpass', cutoff, 0.7, this.sr);
    this.lpr.set('lowpass', cutoff, 0.7, this.sr);
    for (let i = 0; i < n; i++) {
      left[i] = (left[i] ?? 0) + this.lpl.process(this.nl.next()) * gain * 0.6;
      right[i] = (right[i] ?? 0) + this.lpr.process(this.nr.next()) * gain * 0.6;
    }
  }
}

/** Rain: high-passed hiss plus individual drop ticks. */
export class Rain implements Layer {
  private readonly wn: WhiteNoise;
  private readonly hpl: Biquad;
  private readonly hpr: Biquad;
  private readonly tick: Biquad;

  constructor(sr: number, seed: number) {
    this.wn = new WhiteNoise(seed);
    this.hpl = new Biquad('highpass', 900, 0.7, sr);
    this.hpr = new Biquad('highpass', 950, 0.7, sr);
    this.tick = new Biquad('bandpass', 4200, 3, sr);
  }

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    for (let i = 0; i < n; i++) {
      const drop = this.wn.unit() < 0.004 ? this.wn.next() * 6 : 0;
      const t = this.tick.process(drop);
      left[i] = (left[i] ?? 0) + (this.hpl.process(this.wn.next()) * 0.35 + t) * gain;
      right[i] = (right[i] ?? 0) + (this.hpr.process(this.wn.next()) * 0.35 + t * 0.7) * gain;
    }
  }
}

/** "Lub-dub" heartbeat: two low thumps per beat. Centred, felt more than heard. */
export class Heartbeat implements Layer {
  bpm = 70;
  private t = 0;
  private phase = 0;

  constructor(private readonly sr: number) {}

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    const period = 60 / Math.max(30, this.bpm);
    const dt = 1 / this.sr;
    for (let i = 0; i < n; i++) {
      this.t += dt;
      if (this.t >= period) {
        this.t -= period;
        this.phase = 0;
      }
      const t1 = this.t;
      const t2 = this.t - period * 0.3;
      let env = 0;
      if (t1 < 0.12) env += Math.exp(-t1 / 0.03);
      if (t2 > 0 && t2 < 0.12) env += 0.7 * Math.exp(-t2 / 0.03);
      this.phase += (TAU * (48 - 10 * Math.min(1, t1 / 0.1))) / this.sr;
      const s = Math.sin(this.phase) * env * gain * 0.9;
      left[i] = (left[i] ?? 0) + s;
      right[i] = (right[i] ?? 0) + s;
    }
  }
}

/** Post-trauma ringing: a high, slowly beating tone. */
export class Tinnitus implements Layer {
  private p1 = 0;
  private p2 = 0;

  constructor(private readonly sr: number) {}

  process(left: Float32Array, right: Float32Array, n: number, gain: number): void {
    const i1 = (TAU * 6400) / this.sr;
    const i2 = (TAU * 6403.5) / this.sr;
    for (let i = 0; i < n; i++) {
      this.p1 += i1;
      this.p2 += i2;
      if (this.p1 > TAU) this.p1 -= TAU;
      if (this.p2 > TAU) this.p2 -= TAU;
      const s = (Math.sin(this.p1) + Math.sin(this.p2)) * 0.5 * gain * 0.25;
      left[i] = (left[i] ?? 0) + s;
      right[i] = (right[i] ?? 0) + s;
    }
  }
}
