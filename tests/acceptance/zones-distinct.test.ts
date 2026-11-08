import { describe, expect, it } from 'vitest';
import { computeMix, createAmbienceContext, createMix } from '../../src/domain/audio/mix';
import { ZONE_IDS, type ZoneId } from '../../src/domain/audio/zones';
import { AmbienceRenderer } from '../../src/infrastructure/audio/dsp/ambience-renderer';
import {
  OCTAVE_BANDS,
  bandEnergies,
  goertzel,
  onsetRate,
} from '../../src/infrastructure/audio/dsp/analysis';

/**
 * Stage 3 acceptance: "zones sound distinct". Each zone's ambient bed is
 * rendered offline with the exact DSP the AudioWorklet runs, then reduced to
 * a feature vector (octave-band spectrum shape, transient rate, hum tonality).
 * Every pair of zones must be clearly separated in that space, and each zone
 * must show its signature.
 */
const SR = 48000;
const SECONDS = 4;

interface Features {
  spectrum: number[]; // log10 of band energy share
  onsets: number;
  hum: number; // log10 tonal energy at the zone hum frequencies relative to broadband
  loudness: number;
  bands: number[];
}

function features(zone: ZoneId): Features {
  const r = new AmbienceRenderer(SR, 1337);
  r.setMix(
    computeMix({ ...createAmbienceContext(), zones: { [zone]: 1 }, night: 0.8 }, createMix()),
  );
  r.settle();
  const left = new Float32Array(SR * SECONDS);
  const right = new Float32Array(SR * SECONDS);
  r.render(left, right);
  const mono = left.map((v, i) => 0.5 * (v + (right[i] ?? 0)));
  const bands = bandEnergies(mono, SR);
  const total = bands.reduce((a, v) => a + v, 1e-12);
  let ms = 0;
  for (const v of mono) ms += v * v;
  ms /= mono.length;
  const tonal = [50, 100, 120, 150].reduce((a, f) => a + goertzel(mono, f, SR), 0);
  return {
    spectrum: bands.map((e) => Math.log10(e / total + 1e-6)),
    onsets: onsetRate(mono, SR),
    hum: Math.log10(tonal / (ms + 1e-12) + 1e-6),
    loudness: Math.log10(ms + 1e-9),
    bands,
  };
}

function distance(a: Features, b: Features): number {
  let d = 0;
  a.spectrum.forEach((v, i) => (d += (v - (b.spectrum[i] ?? 0)) ** 2));
  d += ((Math.log10(a.onsets + 0.5) - Math.log10(b.onsets + 0.5)) * 2) ** 2;
  d += ((a.hum - b.hum) * 0.5) ** 2;
  return Math.sqrt(d);
}

describe('zones sound distinct (stage 3 acceptance)', () => {
  const table = new Map(ZONE_IDS.map((z) => [z, features(z)] as const));
  const get = (z: ZoneId): Features => {
    const v = table.get(z);
    if (v === undefined) throw new Error(z);
    return v;
  };

  it.each(ZONE_IDS.flatMap((a, i) => ZONE_IDS.slice(i + 1).map((b) => [a, b] as const)))(
    '%s vs %s are clearly separated',
    (a, b) => {
      expect(distance(get(a), get(b))).toBeGreaterThan(0.6);
    },
  );

  it('each zone shows its signature', () => {
    const band = (z: ZoneId, hz: (typeof OCTAVE_BANDS)[number]): number =>
      get(z).spectrum[OCTAVE_BANDS.indexOf(hz)] ?? -9;
    // Forest: the insect band dominates.
    for (const z of ZONE_IDS)
      if (z !== 'forest') expect(band('forest', 4000)).toBeGreaterThan(band(z, 4000));
    // Subway: the most sub-bass (32 Hz tunnel rumble) and the busiest transients (drips).
    for (const z of ZONE_IDS)
      if (z !== 'subway') expect(band('subway', 31.5)).toBeGreaterThan(band(z, 31.5));
    for (const z of ZONE_IDS)
      if (z !== 'subway') expect(get('subway').onsets).toBeGreaterThan(get(z).onsets);
    // Industrial vs city: much stronger mains hum.
    expect(get('industrial').hum).toBeGreaterThan(get('abandonedCity').hum);
    // Research complex: quietest, tonal (equipment hum, no wind/insects).
    expect(get('researchComplex').hum).toBeGreaterThan(get('forest').hum);
  });

  it('prints the feature table (for the stage report)', () => {
    for (const z of ZONE_IDS) {
      console.log(
        z.padEnd(16),
        get(z)
          .spectrum.map((v) => v.toFixed(2).padStart(6))
          .join(' '),
        ` onsets/s ${get(z).onsets.toFixed(1).padStart(5)}`,
        ` hum ${get(z).hum.toFixed(2)}`,
      );
    }
    expect(true).toBe(true);
  });
});
