import { describe, expect, it } from 'vitest';
import { LightMap } from './light-map';

describe('light map', () => {
  it('lamps light a pool that fades to their edge; beacons less; dead sources and windows not at all', () => {
    const m = new LightMap();
    m.addLights([
      {
        kind: 'sodiumLamp',
        position: [0, 6, 0],
        color: [1, 0.5, 0.2],
        intensity: 60,
        range: 20,
        flicker: 0,
      },
      {
        kind: 'emergencyBeacon',
        position: [40, 1, 0],
        color: [1, 0, 0],
        intensity: 40,
        range: 18,
        flicker: 0,
      },
      {
        kind: 'window',
        position: [80, 3, 0],
        color: [1, 1, 1],
        intensity: 2,
        range: 6,
        flicker: 0,
      },
    ]);
    expect(m.at(0, 0)).toBe(1);
    expect(m.at(4.5, 0)).toBeCloseTo(0.5, 5);
    expect(m.at(9.5, 0)).toBe(0);
    expect(m.at(40, 0)).toBeCloseTo(0.55, 5);
    expect(m.at(80, 0)).toBe(0);
    m.removeChunk(0, 0);
    expect(m.at(0, 0)).toBe(0);
  });

  it('the flashlight lights its cone, brightest near and on axis', () => {
    const m = new LightMap();
    m.setFlashlight(true, 1, 0, 0, 0); // facing −Z
    expect(m.beamAt(0, -5)).toBeGreaterThan(m.beamAt(0, -15));
    expect(m.beamAt(0, -5)).toBeGreaterThan(m.beamAt(2.5, -5));
    expect(m.beamAt(0, 5)).toBe(0); // behind
    expect(m.beamAt(0, -30)).toBe(0); // beyond reach
    m.setFlashlight(false, 1, 0, 0, 0);
    expect(m.beamAt(0, -5)).toBe(0);
  });

  it('lit flares and the sky add light', () => {
    const m = new LightMap();
    m.flares[0] = 10;
    m.flares[1] = 10;
    m.flares[2] = 6;
    m.flareCount = 1;
    expect(m.at(10, 10)).toBe(1);
    expect(m.at(13, 10)).toBeCloseTo(0.5, 5);
    m.sky = 0.45;
    expect(m.at(100, 100)).toBeCloseTo(0.5, 5);
    m.sky = 1;
    expect(m.at(100, 100)).toBe(1);
  });
});
