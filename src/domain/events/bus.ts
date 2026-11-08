import type { SurfaceId } from '../world/surfaces';

/**
 * Typed per-tick event channels. The simulation emits, outer layers
 * (audio, render, AI later) read after each tick; channels are cleared at the
 * start of the next tick. Records are pooled: `emit()` hands out a reused
 * object to fill, so steady-state emission allocates nothing.
 */
export class EventChannel<T> {
  private readonly pool: T[] = [];
  private count = 0;

  constructor(private readonly create: () => T) {}

  emit(): T {
    let item = this.pool[this.count];
    if (item === undefined) {
      item = this.create();
      this.pool.push(item);
    }
    this.count++;
    return item;
  }

  get size(): number {
    return this.count;
  }

  /** i-th event this tick; valid until the channel is cleared. */
  at(i: number): T | undefined {
    return i < this.count ? this.pool[i] : undefined;
  }

  clear(): void {
    this.count = 0;
  }
}

export interface FootstepEvent {
  x: number;
  y: number;
  z: number;
  surface: SurfaceId;
  /** 0..1 loudness from gait (crouch quiet, sprint loud). */
  intensity: number;
  /** AI hearing radius in metres (gait × surface loudness). */
  noiseRadius: number;
  foot: 0 | 1;
}

export interface LandEvent {
  x: number;
  y: number;
  z: number;
  surface: SurfaceId;
  impactSpeed: number;
  noiseRadius: number;
}

export interface JumpEvent {
  x: number;
  y: number;
  z: number;
  surface: SurfaceId;
}

export class GameEvents {
  readonly footstep = new EventChannel<FootstepEvent>(() => ({
    x: 0,
    y: 0,
    z: 0,
    surface: 'concrete',
    intensity: 0,
    noiseRadius: 0,
    foot: 0,
  }));
  readonly land = new EventChannel<LandEvent>(() => ({
    x: 0,
    y: 0,
    z: 0,
    surface: 'concrete',
    impactSpeed: 0,
    noiseRadius: 0,
  }));
  readonly jump = new EventChannel<JumpEvent>(() => ({ x: 0, y: 0, z: 0, surface: 'concrete' }));

  clear(): void {
    this.footstep.clear();
    this.land.clear();
    this.jump.clear();
  }
}
