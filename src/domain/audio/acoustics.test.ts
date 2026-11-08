import { describe, expect, it } from 'vitest';
import {
  SPEED_OF_SOUND,
  acousticsChanged,
  airAbsorptionCutoff,
  estimateAcoustics,
  occlusion,
  probeDirections,
  type ProbeHit,
} from './acoustics';

const MAX = 40;
/** Synthetic probes: horizontal ring hits walls at `walls(i)`; `up` hits a ceiling at that height. */
function probes(
  walls: (dx: number, dz: number) => number | null,
  up: number | null,
  absorption = 0.03,
): ProbeHit[] {
  return probeDirections().map((d) => ({
    ...d,
    distance: d.dy > 0 ? (up === null ? null : up / d.dy) : walls(d.dx, d.dz),
    absorption,
  }));
}

describe('room acoustics', () => {
  it('probe set: unit vectors, ring plus upward rays', () => {
    const dirs = probeDirections();
    expect(dirs).toHaveLength(19);
    for (const d of dirs) expect(Math.hypot(d.dx, d.dy, d.dz)).toBeCloseTo(1, 4);
  });

  it('open field is dry and short; a concrete tunnel rings for seconds', () => {
    const open = estimateAcoustics(
      probes(() => null, null),
      MAX,
    );
    const tunnel = estimateAcoustics(
      probes(() => 3, 3),
      MAX,
    );
    expect(open.rt60).toBeLessThan(0.5);
    expect(open.enclosure).toBe(0);
    expect(open.covered).toBe(false);
    expect(tunnel.rt60).toBeGreaterThan(1.5);
    expect(tunnel.enclosure).toBe(1);
    expect(tunnel.covered).toBe(true);
    expect(tunnel.wet).toBeGreaterThan(open.wet);
  });

  it('a street canyon (walls left/right, open sky) sits in between with side reflections', () => {
    const canyon = estimateAcoustics(
      probes((dx) => (Math.abs(dx) > 0.5 ? 8 / Math.abs(dx) : null), null),
      MAX,
    );
    const open = estimateAcoustics(
      probes(() => null, null),
      MAX,
    );
    const tunnel = estimateAcoustics(
      probes(() => 3, 3),
      MAX,
    );
    expect(canyon.rt60).toBeGreaterThan(open.rt60);
    expect(canyon.rt60).toBeLessThan(tunnel.rt60);
    expect(canyon.early.length).toBeGreaterThan(0);
    // First reflection is the 8 m facade: 2*8/343 s.
    expect(canyon.early[0]?.delay).toBeCloseTo((2 * 8) / SPEED_OF_SOUND, 3);
    expect(canyon.early.some((e) => e.pan > 0.5) && canyon.early.some((e) => e.pan < -0.5)).toBe(
      true,
    );
  });

  it('soft surfaces shorten the decay and damp highs', () => {
    const hard = estimateAcoustics(
      probes(() => 4, 4, 0.02),
      MAX,
    );
    const soft = estimateAcoustics(
      probes(() => 4, 4, 0.4),
      MAX,
    );
    expect(soft.rt60).toBeLessThan(hard.rt60 / 5);
    expect(soft.damping).toBeGreaterThan(hard.damping);
  });

  it('early-reflection panning follows listener yaw', () => {
    const wallToEast = probes((dx) => (dx > 0.9 ? 5 : null), null);
    expect(estimateAcoustics(wallToEast, MAX, 0).early[0]?.pan).toBeGreaterThan(0.9);
    expect(estimateAcoustics(wallToEast, MAX, Math.PI).early[0]?.pan).toBeLessThan(-0.9);
  });

  it('change detection, errors, occlusion and air absorption', () => {
    const a = estimateAcoustics(
      probes(() => 4, 4),
      MAX,
    );
    expect(acousticsChanged(a, a)).toBe(false);
    expect(
      acousticsChanged(
        a,
        estimateAcoustics(
          probes(() => null, null),
          MAX,
        ),
      ),
    ).toBe(true);
    expect(acousticsChanged(a, { ...a, rt60: a.rt60 * 0.5 })).toBe(true);
    expect(() => estimateAcoustics([], MAX)).toThrow();
    expect(occlusion(0)).toEqual({ gain: 1, cutoffHz: 18000 });
    expect(occlusion(1).cutoffHz).toBe(650);
    expect(occlusion(1).gain).toBeCloseTo(0.25);
    expect(airAbsorptionCutoff(0)).toBe(20000);
    expect(airAbsorptionCutoff(150)).toBeLessThan(5000);
    expect(airAbsorptionCutoff(1e6)).toBe(900);
  });
});
