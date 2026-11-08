export interface Spring {
  pos: number;
  vel: number;
}

/**
 * Damped spring, integrated semi-implicitly in fixed 1/240 s substeps so it
 * stays stable at any frame rate (a single explicit step at 10 fps explodes).
 */
export function stepSpring(s: Spring, stiffness: number, damping: number, dt: number): void {
  const h = 1 / 240;
  for (let t = Math.min(dt, 0.25); t > 1e-9; t -= h) {
    const step = Math.min(h, t);
    s.vel += (-stiffness * s.pos - damping * s.vel) * step;
    s.pos += s.vel * step;
  }
}
