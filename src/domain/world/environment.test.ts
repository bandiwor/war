import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createWeather,
  daylight,
  fogDensity,
  FRONT_SECONDS,
  frontRegime,
  nightness,
  perceptionScale,
  START_TIME_OF_DAY,
  sunAzimuth,
  sunElevation,
  visibilityMeters,
  weatherAt,
  windVector,
  WIND_MAX_MPS,
} from './environment';

const H = 3600;
const DEG = Math.PI / 180;

describe('sun', () => {
  it('rises ~06:50, peaks ~32° at midday and sets ~18:20', () => {
    expect(sunElevation(6 * H + 50 * 60)).toBeCloseTo(0, 6);
    expect(sunElevation(18 * H + 20 * 60)).toBeCloseTo(0, 6);
    expect(sunElevation(12.58 * H)).toBeCloseTo(32 * DEG, 3);
    expect(sunElevation(0)).toBeLessThan(-20 * DEG);
    expect(sunElevation(-3 * H)).toBeCloseTo(sunElevation(21 * H), 9);
  });

  it('sets in the west', () => {
    const az = sunAzimuth(18 * H + 20 * 60);
    expect(Math.sin(az)).toBeLessThan(-0.9); // toward −X
  });

  it('the game starts in dusk and full night falls within ~90 game minutes', () => {
    const start = sunElevation(START_TIME_OF_DAY);
    expect(start).toBeLessThan(0);
    expect(daylight(start)).toBeGreaterThan(0.2);
    expect(nightness(start)).toBeLessThan(0.6);
    expect(nightness(sunElevation(START_TIME_OF_DAY + 1.5 * H))).toBe(1);
    expect(daylight(sunElevation(22 * H))).toBe(0);
  });

  it('daylight falls monotonically through dusk', () => {
    let prev = Infinity;
    for (let t = 18 * H; t <= 21 * H; t += 300) {
      const L = daylight(sunElevation(t));
      expect(L).toBeLessThanOrEqual(prev);
      prev = L;
    }
  });
});

describe('weather', () => {
  it('stays in range for any seed and time', () => {
    const w = createWeather();
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        (s, t) => {
          weatherAt(s, t, w);
          for (const v of [w.fog, w.rain, w.wind]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
          expect(Number.isFinite(w.windDir)).toBe(true);
        },
      ),
    );
  });

  it('changes smoothly (no jumps between fronts)', () => {
    const a = createWeather();
    const b = createWeather();
    for (let t = 0; t < 10 * FRONT_SECONDS; t += 7) {
      weatherAt(42, t, a);
      weatherAt(42, t + 1, b);
      expect(Math.abs(a.fog - b.fog)).toBeLessThan(0.01);
      expect(Math.abs(a.rain - b.rain)).toBeLessThan(0.01);
      expect(Math.abs(a.wind - b.wind)).toBeLessThan(0.01);
    }
  });

  it('is deterministic per seed, starts misty, and varies between fronts', () => {
    expect(frontRegime(1, 0)).toBe('mist');
    expect(weatherAt(5, 1234, createWeather())).toEqual(weatherAt(5, 1234, createWeather()));
    const regimes = new Set(Array.from({ length: 60 }, (_, i) => frontRegime(9, i)));
    expect(regimes.size).toBeGreaterThanOrEqual(4);
    const opening = weatherAt(9, 0, createWeather());
    expect(opening.fog).toBeGreaterThan(0.5);
  });
});

describe('visibility and perception', () => {
  it('reproduces the stage-1 street fog on a clear night', () => {
    expect(fogDensity({ fog: 0, rain: 0, wind: 0, windDir: 0 }, 0)).toBeCloseTo(0.034, 9);
  });

  it('fog and rain reduce visibility; darkness and rain reduce what mobs perceive', () => {
    const clear = { fog: 0, rain: 0, wind: 0.2, windDir: 0 };
    const foggy = { ...clear, fog: 1 };
    const storm = { ...clear, rain: 1, wind: 1 };
    expect(visibilityMeters(foggy, 0)).toBeLessThan(visibilityMeters(clear, 0) / 2);
    expect(visibilityMeters(clear, 1)).toBeGreaterThan(visibilityMeters(clear, 0));
    expect(perceptionScale(clear, 0).sight).toBeLessThan(perceptionScale(clear, 1).sight);
    expect(perceptionScale(storm, 0).hearing).toBeLessThan(perceptionScale(clear, 0).hearing);
    for (const w of [clear, foggy, storm]) {
      const p = perceptionScale(w, 0.5);
      expect(p.sight).toBeGreaterThanOrEqual(0);
      expect(p.sight).toBeLessThanOrEqual(1);
      expect(p.hearing).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('wind blows toward its direction at up to WIND_MAX_MPS', () => {
    const v = windVector({ fog: 0, rain: 0, wind: 1, windDir: 0 }, { x: 0, z: 0 });
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.z).toBeCloseTo(-WIND_MAX_MPS, 9);
  });
});
