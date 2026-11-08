/**
 * Analytic two-bone IK (shoulder → elbow → hand) with a pole vector that
 * chooses the bend plane. Pure math on plain tuples so it is unit-tested
 * without Three.js; the viewmodel uses it to put hands on grips.
 */
export type V3 = [number, number, number];

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function len(a: V3): number {
  return Math.sqrt(dot(a, a));
}
function scale(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/**
 * @returns elbow position and the (possibly clamped) hand position.
 * Targets beyond reach are pulled in to a fully extended arm.
 */
export function solveTwoBone(
  shoulder: V3,
  target: V3,
  upper: number,
  fore: number,
  pole: V3,
): { elbow: V3; hand: V3 } {
  const toTarget = sub(target, shoulder);
  const rawDist = len(toTarget);
  const maxReach = (upper + fore) * 0.9999;
  const minReach = Math.abs(upper - fore) * 1.0001 + 1e-6;
  const d = Math.min(maxReach, Math.max(minReach, rawDist));
  const dir: V3 = rawDist > 1e-9 ? scale(toTarget, 1 / rawDist) : [0, 0, -1];
  const hand: V3 = [shoulder[0] + dir[0] * d, shoulder[1] + dir[1] * d, shoulder[2] + dir[2] * d];
  // Law of cosines at the shoulder.
  const cosA = Math.max(-1, Math.min(1, (upper * upper + d * d - fore * fore) / (2 * upper * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  // Bend direction: pole projected perpendicular to the shoulder→hand axis.
  const toPole = sub(pole, shoulder);
  let n = sub(toPole, scale(dir, dot(toPole, dir)));
  let nl = len(n);
  if (nl < 1e-9) {
    n = Math.abs(dir[1]) < 0.9 ? [0, -1, 0] : [1, 0, 0];
    n = sub(n, scale(dir, dot(n, dir)));
    nl = len(n);
  }
  n = scale(n, 1 / nl);
  const elbow: V3 = [
    shoulder[0] + dir[0] * upper * cosA + n[0] * upper * sinA,
    shoulder[1] + dir[1] * upper * cosA + n[1] * upper * sinA,
    shoulder[2] + dir[2] * upper * cosA + n[2] * upper * sinA,
  ];
  return { elbow, hand };
}
