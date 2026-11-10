import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LightPiece } from '../../../domain/world/street-layout';
import { LightPool, type PoolCandidate } from './light-pool';

const lamp = (x: number, z: number): PoolCandidate => ({
  piece: {
    kind: 'sodiumLamp',
    position: [x, 6, z],
    color: [1, 0.5, 0.2],
    intensity: 60,
    range: 22,
    flicker: 0,
  },
  phase: 0,
});
const of = (kind: LightPiece['kind'], x: number): PoolCandidate => ({
  piece: { kind, position: [x, 1, 0], color: [0, 1, 1], intensity: 3, range: 5, flicker: 0 },
  phase: 0,
});

describe('light pool', () => {
  it('gives the real lights to the nearest sources and keeps the light count fixed', () => {
    const pool = new LightPool({ lamps: 2, glows: 1, beacons: 1 });
    const countBefore = pool.group.children.length;
    const candidates = [
      lamp(40, 0),
      lamp(5, 0),
      lamp(-3, 0),
      lamp(200, 0),
      of('bioluminescence', 2),
      of('window', 1),
    ];
    pool.update(candidates, new THREE.Vector3(0, 1.7, 0), 0);
    const lamps = pool.group.children.filter(
      (c): c is THREE.SpotLight => c instanceof THREE.SpotLight,
    );
    const lit = lamps
      .filter((l) => l.intensity > 0)
      .map((l) => l.position.x)
      .sort((a, b) => a - b);
    expect(lit).toEqual([-3, 5]);
    expect(pool.active).toBe(3); // two lamps + one glow; windows never get a light
    expect(pool.group.children.length).toBe(countBefore);
    expect(pool.group.children.every((c) => c.visible)).toBe(true);
  });

  it('switches lights off (intensity 0, still present) when nothing is in reach', () => {
    const pool = new LightPool({ lamps: 2, glows: 2, beacons: 1 });
    pool.update([lamp(500, 500)], new THREE.Vector3(), 0);
    expect(pool.active).toBe(0);
    const lights = pool.group.children.filter((c): c is THREE.Light => c instanceof THREE.Light);
    expect(lights.every((l) => l.intensity === 0)).toBe(true);
    pool.dispose();
  });
});
