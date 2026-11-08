/**
 * Deterministic transcendental functions for simulation code.
 *
 * ECMAScript only guarantees correctly rounded results for + - * / sqrt.
 * Math.sin/cos/atan2/exp/pow are "implementation-approximated" and differ
 * between engines and versions, which would break golden replays. These
 * versions use only exact IEEE operations, so they are bit-identical
 * everywhere. Accuracy is ~1e-9, more than enough for gameplay.
 * Rendering code may use Math.* freely; lint enforces this split.
 */
export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/** Reduce to [-PI, PI]. */
export function wrapAngle(x: number): number {
  if (x >= -PI && x <= PI) return x;
  const k = Math.floor((x + PI) / TAU);
  return x - k * TAU;
}

/** sin on [-PI/2, PI/2] via Taylor series to x^15 (error < 1e-12 on that interval). */
function sinCore(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

export function sin(x: number): number {
  let r = wrapAngle(x);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinCore(r);
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

/** atan on [-1, 1] via argument halving + series. */
function atanUnit(x: number): number {
  // Two halvings: atan(x) = 2*atan(x / (1 + sqrt(1 + x^2))) bring |x| <= tan(PI/16) ~ 0.199.
  let y = x / (1 + Math.sqrt(1 + x * x));
  y = y / (1 + Math.sqrt(1 + y * y));
  const y2 = y * y;
  let term = y;
  let sum = y;
  for (let n = 1; n < 12; n++) {
    term *= -y2;
    sum += term / (2 * n + 1);
  }
  return 4 * sum;
}

export function atan(x: number): number {
  if (x === 0) return x; // keep the sign of zero
  if (x > 1) return HALF_PI - atanUnit(1 / x);
  if (x < -1) return -HALF_PI - atanUnit(1 / x);
  return atanUnit(x);
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  const yNegative = y < 0 || Object.is(y, -0);
  if (x < 0 || Object.is(x, -0)) {
    if (x === 0 && y === 0) return yNegative ? -PI : PI;
    if (x < 0) return yNegative ? atan(y / x) - PI : atan(y / x) + PI;
  }
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return y; // +-0 keeps its sign, like Math.atan2
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
