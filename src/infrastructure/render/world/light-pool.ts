import * as THREE from 'three';
import type { LightPiece } from '../../../domain/world/street-layout';
import { flickerAt } from '../scene/street-scene';

/** A streamed light the pool may give a real light to. */
export interface PoolCandidate {
  readonly piece: LightPiece;
  /** Flicker phase (stable per light). */
  readonly phase: number;
}

export interface LightPoolCounts {
  readonly lamps: number;
  readonly glows: number;
  readonly beacons: number;
}

interface Beacon {
  readonly rig: THREE.Object3D;
  readonly spots: readonly THREE.SpotLight[];
  readonly glow: THREE.PointLight;
}

/**
 * A fixed set of real lights handed each frame to the nearest streamed light
 * sources. The light count never changes, so material shaders never
 * recompile while chunks stream (adding or removing a Three.js light would).
 * Sources without a pooled light still glow through their emissive meshes.
 * Unused lights stay visible at zero intensity: hiding one would change the
 * light count, which recompiles shaders too.
 */
export class LightPool {
  readonly group = new THREE.Group();
  private readonly lamps: THREE.SpotLight[] = [];
  private readonly glows: THREE.PointLight[] = [];
  private readonly beacons: Beacon[] = [];
  // Selection scratch (no per-frame allocation).
  private readonly bestIdx: Int32Array;
  private readonly bestDist: Float64Array;
  /** Lights currently assigned (debug). */
  active = 0;

  constructor(counts: LightPoolCounts) {
    for (let i = 0; i < counts.lamps; i++) {
      const s = new THREE.SpotLight(0xffffff, 0, 22, 1.05, 0.7, 2);
      this.group.add(s, s.target);
      this.lamps.push(s);
    }
    for (let i = 0; i < counts.glows; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 5, 2);
      this.group.add(p);
      this.glows.push(p);
    }
    for (let i = 0; i < counts.beacons; i++) {
      const rig = new THREE.Object3D();
      const spots: THREE.SpotLight[] = [];
      for (const dir of [1, -1]) {
        const spot = new THREE.SpotLight(0xff1408, 0, 18, 0.35, 0.5, 2);
        spot.position.set(0, 0.05, 0);
        spot.target.position.set(dir, -0.05, 0);
        rig.add(spot, spot.target);
        spots.push(spot);
      }
      const glow = new THREE.PointLight(0xff1408, 0, 6, 2);
      rig.add(glow);
      this.group.add(rig);
      this.beacons.push({ rig, spots, glow });
    }
    const n = Math.max(counts.lamps, counts.glows, counts.beacons, 1);
    this.bestIdx = new Int32Array(n);
    this.bestDist = new Float64Array(n);
  }

  /** Picks the `slots` nearest candidates of `kind` into bestIdx; returns how many. */
  private nearest(
    candidates: readonly PoolCandidate[],
    kind: LightPiece['kind'],
    slots: number,
    x: number,
    y: number,
    z: number,
  ): number {
    let found = 0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c?.piece.kind !== kind) continue;
      const p = c.piece.position;
      const dx = p[0] - x;
      const dy = p[1] - y;
      const dz = p[2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      const reach = c.piece.range + 30;
      if (d > reach * reach) continue;
      // Insertion into the sorted top-`slots` list.
      let at = found < slots ? found : slots;
      while (at > 0 && (this.bestDist[at - 1] ?? 0) > d) {
        if (at < slots) {
          this.bestDist[at] = this.bestDist[at - 1] ?? 0;
          this.bestIdx[at] = this.bestIdx[at - 1] ?? 0;
        }
        at--;
      }
      if (at < slots) {
        this.bestDist[at] = d;
        this.bestIdx[at] = i;
        if (found < slots) found++;
      }
    }
    return found;
  }

  update(candidates: readonly PoolCandidate[], camera: THREE.Vector3, time: number): void {
    const { x, y, z } = camera;
    this.active = 0;
    const lampCount = this.nearest(candidates, 'sodiumLamp', this.lamps.length, x, y, z);
    for (let i = 0; i < this.lamps.length; i++) {
      const light = this.lamps[i];
      if (light === undefined) continue;
      const c = i < lampCount ? candidates[this.bestIdx[i] ?? 0] : undefined;
      if (c === undefined) {
        light.intensity = 0;
        continue;
      }
      const p = c.piece;
      light.position.set(p.position[0], p.position[1], p.position[2]);
      light.target.position.set(p.position[0], 0, p.position[2]);
      light.target.updateMatrixWorld();
      light.color.setRGB(p.color[0], p.color[1], p.color[2]);
      light.distance = p.range;
      light.intensity = p.intensity * flickerAt(time, p.flicker, c.phase);
      this.active++;
    }
    const glowCount = this.nearest(candidates, 'bioluminescence', this.glows.length, x, y, z);
    for (let i = 0; i < this.glows.length; i++) {
      const light = this.glows[i];
      if (light === undefined) continue;
      const c = i < glowCount ? candidates[this.bestIdx[i] ?? 0] : undefined;
      if (c === undefined) {
        light.intensity = 0;
        continue;
      }
      const p = c.piece;
      light.position.set(p.position[0], p.position[1], p.position[2]);
      light.color.setRGB(p.color[0], p.color[1], p.color[2]);
      light.distance = p.range;
      light.intensity = p.intensity * flickerAt(time, p.flicker, c.phase);
      this.active++;
    }
    const beaconCount = this.nearest(candidates, 'emergencyBeacon', this.beacons.length, x, y, z);
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(time * Math.PI * 1.5));
    for (let i = 0; i < this.beacons.length; i++) {
      const b = this.beacons[i];
      if (b === undefined) continue;
      const c = i < beaconCount ? candidates[this.bestIdx[i] ?? 0] : undefined;
      if (c === undefined) {
        for (const s of b.spots) s.intensity = 0;
        b.glow.intensity = 0;
        continue;
      }
      const p = c.piece;
      b.rig.position.set(p.position[0], p.position[1], p.position[2]);
      b.rig.rotation.y = time * Math.PI * 2 * 0.75 + c.phase;
      for (const s of b.spots) {
        s.intensity = p.intensity;
        s.distance = p.range;
      }
      b.glow.intensity = p.intensity * 0.06 * pulse;
      this.active++;
    }
  }

  dispose(): void {
    for (const l of [...this.lamps, ...this.glows]) l.dispose();
    for (const b of this.beacons) {
      for (const s of b.spots) s.dispose();
      b.glow.dispose();
    }
  }
}
