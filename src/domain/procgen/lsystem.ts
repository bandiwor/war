import { cos, sin } from '../math/dmath';
import { Rng } from '../math/prng';

/**
 * L-systems for plant geometry (the brief's "procedural generation via
 * L-systems"): string rewriting with optional stochastic alternatives, then
 * a 3D turtle that turns the string into tapering branch segments and leaf
 * points. Pure and seeded: the same plant every time for the same seed.
 *
 * Alphabet: F forward (draws), f forward (no draw), + − yaw, & ^ pitch,
 * \ / roll, [ ] push / pop, L leaf/bud. Other letters only rewrite.
 */
export interface LSystemSpec {
  readonly axiom: string;
  /** Each symbol rewrites to one of its alternatives (picked by the seeded rng). */
  readonly rules: Readonly<Record<string, readonly string[]>>;
  readonly iterations: number;
  /** Turn angle (rad) and its random jitter. */
  readonly angle: number;
  readonly jitter: number;
  /** First segment length (m), length and radius factor per branch level. */
  readonly step: number;
  readonly lengthDecay: number;
  readonly radius: number;
  readonly radiusDecay: number;
  /** Upward pull per segment (0 = none), like phototropism. */
  readonly tropism: number;
}

export interface Segment {
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly r0: number;
  readonly r1: number;
  readonly depth: number;
}

export interface Plant {
  readonly segments: readonly Segment[];
  readonly leaves: readonly (readonly [number, number, number])[];
}

const MAX_LENGTH = 20000;

export function expand(spec: LSystemSpec, seed: number): string {
  const rng = Rng.fromSeed(seed);
  let s = spec.axiom;
  for (let i = 0; i < spec.iterations; i++) {
    let out = '';
    for (const ch of s) {
      const alts = spec.rules[ch];
      out +=
        alts === undefined || alts.length === 0 ? ch : (alts[rng.int(0, alts.length - 1)] ?? ch);
      if (out.length > MAX_LENGTH) break;
    }
    s = out;
  }
  return s;
}

type Vec = [number, number, number];

function rotate(v: Vec, axis: Vec, angle: number): Vec {
  // Rodrigues' rotation formula.
  const c = cos(angle);
  const s = sin(angle);
  const [x, y, z] = v;
  const [kx, ky, kz] = axis;
  const dot = kx * x + ky * y + kz * z;
  return [
    x * c + (ky * z - kz * y) * s + kx * dot * (1 - c),
    y * c + (kz * x - kx * z) * s + ky * dot * (1 - c),
    z * c + (kx * y - ky * x) * s + kz * dot * (1 - c),
  ];
}

function normalize(v: Vec): Vec {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

interface Turtle {
  pos: Vec;
  heading: Vec;
  left: Vec;
  up: Vec;
  depth: number;
  radius: number;
  step: number;
}

/** Interprets an expanded string with a 3D turtle starting at the origin, heading +Y. */
export function interpret(spec: LSystemSpec, symbols: string, seed: number): Plant {
  const rng = Rng.fromSeed(seed ^ 0x51ed);
  const segments: Segment[] = [];
  const leaves: (readonly [number, number, number])[] = [];
  const stack: Turtle[] = [];
  let t: Turtle = {
    pos: [0, 0, 0],
    heading: [0, 1, 0],
    left: [-1, 0, 0],
    up: [0, 0, 1],
    depth: 0,
    radius: spec.radius,
    step: spec.step,
  };
  const turn = (): number => spec.angle + rng.range(-spec.jitter, spec.jitter);
  for (const ch of symbols) {
    switch (ch) {
      case 'F':
      case 'f': {
        let h = t.heading;
        if (spec.tropism > 0) h = normalize([h[0], h[1] + spec.tropism, h[2]]);
        t.heading = h;
        const b: Vec = [
          t.pos[0] + h[0] * t.step,
          t.pos[1] + h[1] * t.step,
          t.pos[2] + h[2] * t.step,
        ];
        const r1 = t.radius * 0.92;
        if (ch === 'F') segments.push({ a: t.pos, b, r0: t.radius, r1, depth: t.depth });
        t.pos = b;
        t.radius = r1;
        break;
      }
      case '+':
      case '-': {
        const a = ch === '+' ? turn() : -turn();
        t.heading = rotate(t.heading, t.up, a);
        t.left = rotate(t.left, t.up, a);
        break;
      }
      case '&':
      case '^': {
        const a = ch === '&' ? turn() : -turn();
        t.heading = rotate(t.heading, t.left, a);
        t.up = rotate(t.up, t.left, a);
        break;
      }
      case '\\':
      case '/': {
        const a = ch === '\\' ? turn() : -turn();
        t.left = rotate(t.left, t.heading, a);
        t.up = rotate(t.up, t.heading, a);
        break;
      }
      case '[':
        stack.push({ ...t });
        t = {
          ...t,
          depth: t.depth + 1,
          radius: t.radius * spec.radiusDecay,
          step: t.step * spec.lengthDecay,
        };
        break;
      case ']':
        t = stack.pop() ?? t;
        break;
      case 'L':
        leaves.push(t.pos);
        break;
      default:
        break;
    }
  }
  return { segments, leaves };
}

export function growPlant(spec: LSystemSpec, seed: number): Plant {
  return interpret(spec, expand(spec, seed), seed);
}

/** The plants' shared vocabulary: vines creeping up a stem, tendrils around a trap. */
export const PLANT_SYSTEMS = {
  vine: {
    axiom: 'A',
    rules: { A: ['F[&+A]F[^-AL]A', 'F[/&A]FA', 'F[\\^AL]F'], F: ['F', 'FF'] },
    iterations: 4,
    angle: 0.5,
    jitter: 0.25,
    step: 0.12,
    lengthDecay: 0.8,
    radius: 0.035,
    radiusDecay: 0.65,
    tropism: 0.08,
  },
  tendril: {
    axiom: 'B',
    rules: { B: ['F[+B]F[-BL]', 'F[&B]F[^B]L', 'FFB'] },
    iterations: 3,
    angle: 0.7,
    jitter: 0.3,
    step: 0.15,
    lengthDecay: 0.75,
    radius: 0.03,
    radiusDecay: 0.6,
    tropism: 0.02,
  },
} as const satisfies Record<string, LSystemSpec>;
