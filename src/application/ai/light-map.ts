import { cos, sin } from '../../domain/math/dmath';
import { chunkCoord, chunkKey } from '../../domain/world/chunks';
import type { LightPiece } from '../../domain/world/street-layout';

/** Sky light at which open ground counts as fully lit (zombies stay in the dark by day). */
const DAY_LIGHT = 0.9;

/** The flashlight as the AI sees it: a cone of light from the player's chest. */
export const FLASHLIGHT_BEAM = {
  /** Half-angle of the beam (rad), matching the rendered spot light. */
  halfAngle: 0.62,
  /** Where the beam stops frightening anything (m). */
  reach: 22,
} as const;

/**
 * How lit each point of the world is, for the AI: zombies avoid lit ground
 * and panic in the flashlight beam; wolves are wary of it; robots' cameras are
 * blinded by it. Static sources come from loaded chunk content (lit lamps,
 * beacons), dynamic ones are updated each tick: the flashlight, lit flares
 * and the sky. Pure reads, no allocation.
 */
export class LightMap {
  /** Static sources binned by chunk: x, z, radius, strength per light. */
  private readonly bins = new Map<number, Float64Array>();
  // Dynamic state (written by the light system each tick).
  sky = 0;
  flashOn = false;
  flashPower = 1;
  flashX = 0;
  flashZ = 0;
  flashYaw = 0;
  private flashFx = 0;
  private flashFz = -1;
  /** Lit flares: x, z, radius triples. */
  readonly flares = new Float64Array(3 * 16);
  flareCount = 0;

  /** Registers a chunk's (or a layout's) lights. Only lit sources are in content. */
  addLights(lights: readonly LightPiece[]): void {
    const groups = new Map<number, number[]>();
    for (const l of lights) {
      if (l.kind !== 'sodiumLamp' && l.kind !== 'emergencyBeacon') continue;
      const lamp = l.kind === 'sodiumLamp';
      const radius = lamp ? l.range * 0.45 : 5;
      const strength = lamp ? 1 : 0.55;
      const key = chunkKey(chunkCoord(l.position[0]), chunkCoord(l.position[2]));
      const g = groups.get(key) ?? [];
      g.push(l.position[0], l.position[2], radius, strength);
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      const prev = this.bins.get(key);
      const merged = new Float64Array((prev?.length ?? 0) + g.length);
      if (prev !== undefined) merged.set(prev);
      merged.set(g, prev?.length ?? 0);
      this.bins.set(key, merged);
    }
  }

  removeChunk(cx: number, cz: number): void {
    this.bins.delete(chunkKey(cx, cz));
  }

  setFlashlight(on: boolean, power: number, x: number, z: number, yaw: number): void {
    this.flashOn = on && power > 0;
    this.flashPower = power;
    this.flashX = x;
    this.flashZ = z;
    this.flashYaw = yaw;
    this.flashFx = -sin(yaw);
    this.flashFz = -cos(yaw);
  }

  /** Light from static sources, flares and the sky (no flashlight). */
  ambientAt(x: number, z: number): number {
    let light = this.sky >= DAY_LIGHT ? 1 : this.sky / DAY_LIGHT;
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bin = this.bins.get(chunkKey(cx + dx, cz + dz));
        if (bin === undefined) continue;
        for (let i = 0; i + 3 < bin.length; i += 4) {
          const lx = (bin[i] ?? 0) - x;
          const lz = (bin[i + 1] ?? 0) - z;
          const r = bin[i + 2] ?? 1;
          const d2 = lx * lx + lz * lz;
          if (d2 >= r * r) continue;
          light = Math.max(light, (bin[i + 3] ?? 0) * (1 - Math.sqrt(d2) / r));
        }
      }
    }
    for (let i = 0; i < this.flareCount; i++) {
      const fx = (this.flares[i * 3] ?? 0) - x;
      const fz = (this.flares[i * 3 + 1] ?? 0) - z;
      const r = this.flares[i * 3 + 2] ?? 1;
      const d2 = fx * fx + fz * fz;
      if (d2 < r * r) light = Math.max(light, 1 - Math.sqrt(d2) / r);
    }
    return light;
  }

  /** The flashlight beam at a point 0..1: inside the cone, brighter near and on axis. */
  beamAt(x: number, z: number): number {
    if (!this.flashOn) return 0;
    const dx = x - this.flashX;
    const dz = z - this.flashZ;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > FLASHLIGHT_BEAM.reach) return 0;
    if (d < 0.5) return this.flashPower;
    const along = (dx * this.flashFx + dz * this.flashFz) / d;
    const edge = cos(FLASHLIGHT_BEAM.halfAngle);
    if (along <= edge) return 0;
    const onAxis = (along - edge) / (1 - edge);
    return this.flashPower * Math.min(1, onAxis * 2) * (1 - d / FLASHLIGHT_BEAM.reach);
  }

  /** All light at a point. */
  at(x: number, z: number): number {
    return Math.max(this.ambientAt(x, z), this.beamAt(x, z));
  }
}
