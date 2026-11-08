import type { FootstepEvent, LandEvent } from '../../domain/events/bus';
import { Rng } from '../../domain/math/prng';
import { SURFACE_IDS, surfaceAcoustics, type SurfaceId } from '../../domain/world/surfaces';
import type { AudioEngine } from './audio-engine';
import { synthesizeFootstep } from './dsp/footstep';

/**
 * Plays footstep/landing sounds per surface. Variants are synthesised once
 * from a seed at startup (a few ms each) and replayed with small random pitch
 * and gain changes, so no two consecutive steps sound identical.
 */
const VARIANTS = 6;

export class FootstepPlayer {
  private readonly banks = new Map<SurfaceId, AudioBuffer[]>();
  private readonly rng: Rng;
  private lastVariant = -1;
  readonly lastSurface: { value: SurfaceId | null } = { value: null };

  constructor(
    private readonly engine: AudioEngine,
    seed: number,
  ) {
    this.rng = Rng.fromSeed(seed ^ 0xf007);
    const sampleRate = engine.context.sampleRate;
    for (const id of SURFACE_IDS) {
      const bank: AudioBuffer[] = [];
      for (let v = 0; v < VARIANTS; v++) {
        const samples = synthesizeFootstep(
          surfaceAcoustics(id),
          Rng.fromSeed(seed + v * 97 + id.length * 13),
          { sampleRate, intensity: 1 },
        );
        bank.push(engine.toBuffer(samples));
      }
      this.banks.set(id, bank);
    }
  }

  footstep(e: FootstepEvent): void {
    this.play(e.surface, e.x, e.y, e.z, 0.25 + 0.75 * e.intensity, 1);
  }

  land(e: LandEvent): void {
    // Landings: louder and lower, like a heavier heel strike.
    this.play(e.surface, e.x, e.y, e.z, Math.min(1.6, 0.6 + e.impactSpeed * 0.25), 0.85);
  }

  private play(
    surface: SurfaceId,
    x: number,
    y: number,
    z: number,
    gain: number,
    rate: number,
  ): void {
    const bank = this.banks.get(surface);
    if (bank === undefined || bank.length === 0) return;
    let v = this.rng.int(0, bank.length - 1);
    if (v === this.lastVariant) v = (v + 1) % bank.length;
    this.lastVariant = v;
    const buffer = bank[v];
    if (buffer === undefined) return;
    this.lastSurface.value = surface;
    this.engine.playAt(
      buffer,
      x,
      y + 0.05,
      z,
      gain * this.rng.range(0.85, 1.1),
      rate * this.rng.range(0.94, 1.06),
    );
  }
}
