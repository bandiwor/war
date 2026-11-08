import { TAU, clamp, cos, sin } from '../math/dmath';

/**
 * Room acoustics from geometry probes. Rays are cast from the listener; each
 * returns a hit distance and the surface's absorption, or escapes (open sky,
 * long distance), which acoustically behaves like a perfect absorber.
 *
 * Sabine: RT60 = 0.161·V / (S·ᾱ). With the mean free path ℓ = 4V/S (Kosten),
 * RT60 = 0.161·ℓ / (4·ᾱ), so ray statistics give a physically grounded decay
 * time without knowing the room's volume.
 */
export const SPEED_OF_SOUND = 343;

export interface ProbeHit {
  /** Unit direction of the ray. */
  dx: number;
  dy: number;
  dz: number;
  /** Hit distance in metres, or null if the ray escaped. */
  distance: number | null;
  /** Absorption of the hit surface (ignored when escaped). */
  absorption: number;
}

export interface EarlyReflection {
  /** Seconds after the direct sound. */
  delay: number;
  gain: number;
  /** -1 left … +1 right, in the listener's frame. */
  pan: number;
}

export interface RoomAcoustics {
  rt60: number;
  /** Fraction of probes that hit something within range. */
  enclosure: number;
  /** Whether something is overhead (roof, tunnel). */
  covered: boolean;
  meanFreePath: number;
  /** Wet/dry balance for the reverb send. */
  wet: number;
  /** High-frequency damping 0..1 (soft surfaces, open air). */
  damping: number;
  early: EarlyReflection[];
}

/** Probe directions: a horizontal ring plus up and two diagonals. Fixed so results are reproducible. */
export function probeDirections(ring = 16): { dx: number; dy: number; dz: number }[] {
  const dirs: { dx: number; dy: number; dz: number }[] = [];
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * TAU;
    dirs.push({ dx: roundDir(sin(a)), dy: 0, dz: roundDir(-cos(a)) });
  }
  dirs.push(
    { dx: 0, dy: 1, dz: 0 },
    { dx: 0.7071, dy: 0.7071, dz: 0 },
    { dx: -0.7071, dy: 0.7071, dz: 0 },
  );
  return dirs;
}

function roundDir(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * @param maxDistance rays beyond this are treated as escaped (open air).
 * @param listenerYaw listener yaw for panning early reflections (0 = looking down -Z).
 */
export function estimateAcoustics(
  hits: readonly ProbeHit[],
  maxDistance: number,
  listenerYaw = 0,
): RoomAcoustics {
  if (hits.length === 0) throw new Error('No probes');
  let hitCount = 0;
  let pathSum = 0;
  let absorptionSum = 0;
  let covered = false;
  for (const h of hits) {
    const escaped = h.distance === null || h.distance > maxDistance;
    // Escaped energy never comes back: an open direction is a perfect absorber.
    absorptionSum += escaped ? 1 : clamp(h.absorption, 0.01, 1);
    if (!escaped) {
      pathSum += h.distance ?? maxDistance;
      hitCount++;
      if (h.dy > 0.9) covered = true;
    }
  }
  // Mean free path between reflections, measured on the rays that do reflect.
  const meanFreePath = hitCount === 0 ? 0 : pathSum / hitCount;
  const alpha = absorptionSum / hits.length;
  const rt60 = clamp((0.161 * meanFreePath) / (4 * alpha), 0.12, 6);
  const enclosure = hitCount / hits.length;

  const sy = sin(listenerYaw);
  const cy = cos(listenerYaw);
  const early = hits
    .filter((h) => h.distance !== null && h.distance <= maxDistance && Math.abs(h.dy) < 0.5)
    .map((h) => {
      const d = h.distance ?? maxDistance;
      // Listener right vector for yaw: (cos, 0, -sin).
      const pan = clamp(h.dx * cy - h.dz * sy, -1, 1);
      return {
        delay: (2 * d) / SPEED_OF_SOUND,
        gain: (1 - clamp(h.absorption, 0, 1)) / (1 + 0.5 * d),
        pan,
      };
    })
    .sort((a, b) => a.delay - b.delay)
    .slice(0, 6);

  return {
    rt60,
    enclosure,
    covered,
    meanFreePath,
    wet: clamp(0.08 + 0.55 * enclosure * enclosure + (covered ? 0.15 : 0), 0, 0.85),
    damping: clamp(alpha * 1.2, 0, 1),
    early,
  };
}

/** True when two acoustic estimates differ enough to rebuild the reverb (avoids constant IR churn). */
export function acousticsChanged(a: RoomAcoustics, b: RoomAcoustics): boolean {
  const ratio = a.rt60 / b.rt60;
  // |ln(ratio)| > 0.15, without a transcendental call.
  return (
    ratio > 1.1618 ||
    ratio < 1 / 1.1618 ||
    Math.abs(a.wet - b.wet) > 0.08 ||
    a.covered !== b.covered
  );
}

/**
 * Occlusion from a fan of rays between source and listener: the fraction
 * blocked becomes attenuation and a low-pass (sound diffracts round edges
 * but loses its highs through walls).
 */
export function occlusion(blockedFraction: number): { gain: number; cutoffHz: number } {
  const b = clamp(blockedFraction, 0, 1);
  return { gain: 1 - 0.75 * b, cutoffHz: 18000 * (1 - b) + 650 * b };
}

/** Air absorption: distant sounds lose their highs (≈ ISO 9613 shape, simplified). */
export function airAbsorptionCutoff(distance: number): number {
  return clamp(20000 / (1 + distance / 35), 900, 20000);
}
