import { describe, expect, it } from 'vitest';
import { estimateAcoustics, probeDirections } from '../../../domain/audio/acoustics';
import { DISTANT_KINDS } from '../../../domain/audio/zones';
import { computeMix, createAmbienceContext, createMix } from '../../../domain/audio/mix';
import { AmbienceRenderer, LAYER_IDS } from './ambience-renderer';
import { OCTAVE_BANDS, bandEnergies, goertzel, onsetRate, peak, schroederRt60 } from './analysis';
import { synthesizeDistant } from './distant';
import { Creaks, Drips, Heartbeat, Hum, Insects, Wind } from './layers';
import { BrownNoise, PinkNoise, Smoother, WhiteNoise } from './noise';
import { generateImpulseResponse } from './reverb-ir';

const SR = 48000;
const buf = (seconds: number) => new Float32Array(Math.round(seconds * SR));
function renderLayer(
  layer: { process(l: Float32Array, r: Float32Array, n: number, g: number): void },
  seconds: number,
): Float32Array {
  const l = buf(seconds);
  const r = buf(seconds);
  for (let off = 0; off < l.length; off += 128)
    layer.process(
      l.subarray(off, off + 128),
      r.subarray(off, off + 128),
      Math.min(128, l.length - off),
      1,
    );
  return l;
}
const fill = (gen: { next(): number }, n: number) =>
  Float32Array.from({ length: n }, () => gen.next());

describe('noise colours', () => {
  it('pink falls ~3 dB/oct and brown ~6 dB/oct relative to white', () => {
    // dB per octave between the 500 Hz and 4 kHz bands. The constant-Q filter bank adds
    // the same +3 dB/oct bias to every colour, so colours are compared to white.
    const slope = (b: Float32Array): number => {
      const e = bandEnergies(b, SR);
      const lo = OCTAVE_BANDS.indexOf(500);
      const hi = OCTAVE_BANDS.indexOf(4000);
      return (10 * Math.log10((e[hi] ?? 1) / (e[lo] ?? 1))) / (hi - lo);
    };
    const white = slope(fill(new WhiteNoise(1), SR));
    expect(white).toBeCloseTo(3, 0);
    expect(slope(fill(new PinkNoise(1), SR)) - white).toBeCloseTo(-3, 0);
    expect(slope(fill(new BrownNoise(1), SR)) - white).toBeGreaterThan(-7.5);
    expect(slope(fill(new BrownNoise(1), SR)) - white).toBeLessThan(-4.5);
  });

  it('is deterministic per seed; smoother converges', () => {
    expect(fill(new WhiteNoise(5), 64)).toEqual(fill(new WhiteNoise(5), 64));
    expect(new WhiteNoise(0).next()).not.toBeNaN();
    const s = new Smoother(0, 0.1, 100);
    for (let i = 0; i < 100; i++) s.step(1);
    expect(s.value).toBeGreaterThan(0.99);
  });
});

describe('layers', () => {
  it('hum has energy at its fundamental and harmonics, not between', () => {
    const h = new Hum(SR);
    h.freq = 50;
    h.harmonics = 1;
    const b = renderLayer(h, 1);
    expect(goertzel(b, 50, SR)).toBeGreaterThan(goertzel(b, 75, SR) * 100);
    expect(goertzel(b, 150, SR)).toBeGreaterThan(goertzel(b, 125, SR) * 100);
  });

  it('crickets chirp in their pitch band at a regular rate', () => {
    const ins = new Insects(SR, 3);
    ins.density = 0.13; // one voice
    ins.pitch = 4500;
    const b = renderLayer(ins, 4);
    const e = bandEnergies(b, SR);
    expect(e.indexOf(Math.max(...e))).toBe(OCTAVE_BANDS.indexOf(4000));
    expect(onsetRate(b, SR)).toBeGreaterThan(1);
  });

  it('drip rate follows the parameter', () => {
    const slow = new Drips(SR, 4);
    slow.rate = 1;
    const fast = new Drips(SR, 4);
    fast.rate = 8;
    expect(onsetRate(renderLayer(fast, 6), SR)).toBeGreaterThan(
      onsetRate(renderLayer(slow, 6), SR) * 2.5,
    );
  });

  it('metal creaks are brighter than wood creaks', () => {
    const centroidBand = (metal: number): number => {
      const c = new Creaks(SR, 9);
      c.ratePerMinute = 600;
      c.metal = metal;
      const e = bandEnergies(renderLayer(c, 4), SR);
      return e.reduce((acc, v, i) => acc + v * i, 0) / e.reduce((a, v) => a + v, 1e-12);
    };
    expect(centroidBand(1)).toBeGreaterThan(centroidBand(0));
  });

  it('heartbeat period matches its bpm (envelope autocorrelation)', () => {
    const period = (bpm: number): number => {
      const h = new Heartbeat(SR);
      h.bpm = bpm;
      const b = renderLayer(h, 8);
      const hop = SR / 100; // 10 ms envelope
      const env: number[] = [];
      for (let i = 0; i + hop <= b.length; i += hop) {
        let e = 0;
        for (let j = i; j < i + hop; j++) e += (b[j] ?? 0) ** 2;
        env.push(e);
      }
      let best = 0;
      let bestLag = 0;
      for (let lag = 30; lag <= 150; lag++) {
        let c = 0;
        for (let i = 0; i + lag < env.length; i++) c += (env[i] ?? 0) * (env[i + lag] ?? 0);
        if (c > best) {
          best = c;
          bestLag = lag;
        }
      }
      return bestLag / 100;
    };
    expect(period(60)).toBeCloseTo(1, 1);
    expect(period(100)).toBeCloseTo(0.6, 1);
  });

  it('gustier wind fluctuates more', () => {
    const variance = (gust: number): number => {
      const w = new Wind(SR, 2);
      w.gustiness = gust;
      const b = renderLayer(w, 8);
      const win = SR / 4;
      const levels: number[] = [];
      for (let i = 0; i + win <= b.length; i += win) {
        let e = 0;
        for (let j = i; j < i + win; j++) e += (b[j] ?? 0) ** 2;
        levels.push(Math.sqrt(e / win));
      }
      const m = levels.reduce((a, v) => a + v, 0) / levels.length;
      return levels.reduce((a, v) => a + (v - m) ** 2, 0) / levels.length / (m * m);
    };
    expect(variance(1)).toBeGreaterThan(variance(0));
  });
});

describe('ambience renderer', () => {
  const render = (seed: number) => {
    const r = new AmbienceRenderer(SR, seed);
    r.setMix(
      computeMix({ ...createAmbienceContext(), danger: 1, health: 0.1, rain: 1 }, createMix()),
    );
    r.settle();
    const l = buf(1);
    const rr = buf(1);
    r.render(l, rr);
    return { r, l, rr };
  };

  it('is deterministic, finite and never clips even with every layer up', () => {
    const a = render(1);
    expect(Array.from(render(1).l)).toEqual(Array.from(a.l));
    expect(peak(a.l)).toBeLessThanOrEqual(1);
    expect(peak(a.rr)).toBeLessThanOrEqual(1);
    expect(a.l.every(Number.isFinite)).toBe(true);
    expect(Array.from(a.l)).not.toEqual(Array.from(a.rr)); // stereo, decorrelated
  });

  it('meters every active layer, and mute silences one', () => {
    const { r } = render(2);
    const levels = r.takeLevels();
    for (const id of LAYER_IDS) expect(levels[id]).toBeGreaterThanOrEqual(0);
    expect(levels.heartbeat).toBeGreaterThan(0);
    r.setMuted('heartbeat', true);
    r.settle();
    const l = buf(0.5);
    r.render(l, buf(0.5));
    r.render(l, buf(0.5));
    expect(r.takeLevels().heartbeat).toBeLessThan(1e-3);
    r.setMuted('heartbeat', false);
  });

  it('renders faster than 15x real time (audio budget)', () => {
    const r = new AmbienceRenderer(SR, 3);
    r.setMix(
      computeMix(
        { ...createAmbienceContext(), zones: { forest: 1 }, rain: 1, danger: 1 },
        createMix(),
      ),
    );
    r.settle();
    const l = buf(2);
    const rr = buf(2);
    r.render(l, rr); // warm-up
    // Best of three: a loaded CI box can stall any single run.
    let ms = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      r.render(l, rr);
      ms = Math.min(ms, performance.now() - t0);
    }
    expect(ms).toBeLessThan(2000 / 15);
  });
});

describe('reverb impulse responses', () => {
  const room = (wall: number, absorption: number, up: number | null) =>
    estimateAcoustics(
      probeDirections().map((d) => ({ ...d, distance: d.dy > 0 ? up : wall, absorption })),
      40,
    );

  it('measured RT60 matches the acoustic estimate (±25%)', () => {
    for (const a of [room(3, 0.03, 3), room(6, 0.1, 5), room(10, 0.05, null)]) {
      const ir = generateImpulseResponse(a, SR, 7);
      expect(schroederRt60(ir.left, SR)).toBeGreaterThan(a.rt60 * 0.75);
      expect(schroederRt60(ir.left, SR)).toBeLessThan(a.rt60 * 1.25);
    }
  });

  it('unit energy, stereo decorrelated, early reflections land at their delays', () => {
    const a = room(5, 0.05, null);
    const ir = generateImpulseResponse(a, SR, 1);
    let e = 0;
    for (let i = 0; i < ir.left.length; i++) e += (ir.left[i] ?? 0) ** 2 + (ir.right[i] ?? 0) ** 2;
    expect(e).toBeCloseTo(1, 5);
    expect(Array.from(ir.left.subarray(5000, 5100))).not.toEqual(
      Array.from(ir.right.subarray(5000, 5100)),
    );
    const first = a.early[0];
    if (first === undefined) throw new Error('expected an early reflection');
    const idx = Math.round(first.delay * SR);
    const local = Math.abs(ir.left[idx] ?? 0) + Math.abs(ir.right[idx] ?? 0);
    expect(local).toBeGreaterThan(Math.abs(ir.left[idx + 40] ?? 0) * 2);
    expect(schroederRt60(new Float32Array(100), SR)).toBe(0);
  });
});

describe('distant one-shots', () => {
  it.each(DISTANT_KINDS)('%s: deterministic, bounded, audible', (kind) => {
    const a = synthesizeDistant(kind, SR, 3);
    expect(Array.from(synthesizeDistant(kind, SR, 3))).toEqual(Array.from(a));
    expect(peak(a)).toBeLessThanOrEqual(0.95);
    expect(peak(a)).toBeGreaterThan(0.5);
    expect(a.length).toBeGreaterThan(SR * 0.5);
  });

  it('kinds are acoustically different: clang rings longest, chirp is brightest, howl is tonal', () => {
    const centroid = (b: Float32Array): number => {
      const e = bandEnergies(b, SR);
      return e.reduce((acc, v, i) => acc + v * i, 0) / e.reduce((acc, v) => acc + v, 1e-12);
    };
    const chirp = centroid(synthesizeDistant('chirp', SR, 1));
    for (const other of ['bark', 'howl', 'shot'] as const)
      expect(chirp).toBeGreaterThan(centroid(synthesizeDistant(other, SR, 1)));
  });
});
