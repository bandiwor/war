import { describe, expect, it } from 'vitest';
import { computeMix, createAmbienceContext, createMix, type AmbienceContext } from './mix';
import { ZONE_IDS, ZONE_SOUNDSCAPES, isZoneId } from './zones';
import { SCHEMA_MATCHES, ZoneSoundscapeSchema } from './zones-schema';

const mix = (over: Partial<AmbienceContext> = {}) =>
  computeMix({ ...createAmbienceContext(), ...over }, createMix());

describe('zone registry', () => {
  it('every zone validates and ids are guarded', () => {
    for (const id of ZONE_IDS)
      expect(ZoneSoundscapeSchema.safeParse(ZONE_SOUNDSCAPES[id]).success).toBe(true);
    expect(isZoneId('subway')).toBe(true);
    expect(isZoneId('moon')).toBe(false);
    expect(SCHEMA_MATCHES).toBe(true);
  });
});

describe('ambient mix', () => {
  it('a single zone reproduces its profile (night 1, calm, healthy, outdoors)', () => {
    const m = mix({ zones: { industrial: 1 }, night: 1 });
    const z = ZONE_SOUNDSCAPES.industrial;
    expect(m.hum.gain).toBeCloseTo(z.hum.level);
    expect(m.hum.freq).toBeCloseTo(z.hum.freq);
    expect(m.creaks.ratePerMinute).toBeCloseTo(z.creaks.ratePerMinute);
    expect(m.wind.gain).toBeCloseTo(z.wind.level * 0.75);
    expect(m.heartbeat.gain).toBe(0);
    expect(m.muffleHz).toBe(20000);
  });

  it('blends zones by normalised weight; no zones falls back to the city', () => {
    const a = mix({ zones: { forest: 1 } }).insects.pitch;
    const b = mix({ zones: { subway: 1 } }).drips.rate;
    const half = mix({ zones: { forest: 2, subway: 2 } });
    expect(half.insects.pitch).toBeCloseTo((a + ZONE_SOUNDSCAPES.subway.insects.pitch) / 2);
    expect(half.drips.rate).toBeCloseTo((b + ZONE_SOUNDSCAPES.forest.drips.rate) / 2);
    expect(mix({ zones: {} }).hum.freq).toBe(ZONE_SOUNDSCAPES.abandonedCity.hum.freq);
  });

  it('insects get louder at night and go silent when an enemy is close', () => {
    const dusk = mix({ zones: { forest: 1 }, night: 0 }).insects.gain;
    const night = mix({ zones: { forest: 1 }, night: 1 }).insects.gain;
    expect(night).toBeGreaterThan(dusk * 2);
    expect(mix({ zones: { forest: 1 }, night: 1, enemyProximity: 1 }).insects.gain).toBeLessThan(
      night * 0.1,
    );
  });

  it('danger adds rumble, heartbeat and distant events', () => {
    const calm = mix();
    const tense = mix({ danger: 1 });
    expect(tense.rumble.gain).toBeGreaterThan(calm.rumble.gain);
    expect(tense.heartbeat.gain).toBeGreaterThan(0.5);
    expect(tense.heartbeat.bpm).toBeGreaterThan(120);
    expect(tense.distantRatePerMinute).toBeGreaterThan(calm.distantRatePerMinute * 2);
  });

  it('low health muffles the world and adds heartbeat and tinnitus', () => {
    const dying = mix({ health: 0.05 });
    expect(dying.muffleHz).toBeLessThan(1500);
    expect(dying.heartbeat.gain).toBeGreaterThan(0.8);
    expect(dying.tinnitus.gain).toBeGreaterThan(0.2);
    expect(mix({ health: 0.8 }).tinnitus.gain).toBe(0);
  });

  it('indoors filters the wind, brings up room tone, silences insects; rain masks insects', () => {
    const inside = mix({ indoor: 1 });
    const outside = mix();
    expect(inside.wind.gain).toBeLessThan(outside.wind.gain * 0.2);
    expect(inside.wind.brightness).toBeLessThan(outside.wind.brightness);
    expect(inside.roomTone.gain).toBeGreaterThan(0.3);
    expect(inside.insects.gain).toBe(0);
    const wet = mix({ zones: { forest: 1 }, rain: 1 });
    expect(wet.rain.gain).toBe(1);
    expect(wet.insects.gain).toBeLessThan(mix({ zones: { forest: 1 } }).insects.gain);
  });

  it('out-of-range inputs are clamped', () => {
    expect(mix({ danger: 9, health: -3, night: 7 })).toEqual(
      mix({ danger: 1, health: 0, night: 1 }),
    );
  });
});
