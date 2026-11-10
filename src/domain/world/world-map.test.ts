import { describe, expect, it } from 'vitest';
import { ZONE_IDS } from '../audio/zones';
import { CHUNK_SIZE } from './chunks';
import {
  CELL,
  HUBS,
  MAX_CHUNK,
  MIN_CHUNK,
  ROADS,
  WORLD_MAX,
  WORLD_MIN,
  WORLD_SPAWN,
  cellClassAt,
  chunkHub,
  hubAt,
  inWorld,
} from './world-map';

describe('world map', () => {
  it('has one hub per zone, inside the world', () => {
    expect(HUBS.map((h) => h.zone).sort()).toEqual([...ZONE_IDS].sort());
    for (const h of HUBS) {
      expect(h.min[0]).toBeGreaterThanOrEqual(WORLD_MIN);
      expect(h.max[1]).toBeLessThanOrEqual(WORLD_MAX);
      expect(hubAt((h.min[0] + h.max[0]) / 2, (h.min[1] + h.max[1]) / 2)).toBe(h);
    }
  });

  it('puts the spawn and every hub anchor on a road', () => {
    expect(cellClassAt(WORLD_SPAWN.position[0], WORLD_SPAWN.position[2])).toBe(CELL.road);
    for (const h of HUBS) expect(cellClassAt(h.anchor[0], h.anchor[2]), h.label).toBe(CELL.road);
  });

  it('keeps roads inside the quarantine wall', () => {
    for (const r of ROADS) {
      expect(r.from).toBeGreaterThan(WORLD_MIN);
      expect(r.to).toBeLessThan(WORLD_MAX);
    }
  });

  it('classifies the main avenue as road and a city block interior as ground', () => {
    expect(cellClassAt(40, -16)).toBe(CELL.road);
    expect(cellClassAt(-176, -176)).toBe(CELL.ground);
    // City: a street on every chunk border, with pavement alongside.
    expect(cellClassAt(-160, -170)).toBe(CELL.road);
    expect(cellClassAt(-160 + 4.5, -170)).toBe(CELL.sidewalk);
  });

  it('decides a chunk zone at its centre, for every system alike', () => {
    for (let cz = MIN_CHUNK; cz <= MAX_CHUNK; cz++) {
      for (let cx = MIN_CHUNK; cx <= MAX_CHUNK; cx++) {
        expect(chunkHub(cx, cz)).toBe(hubAt((cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE));
      }
    }
    expect(inWorld(MIN_CHUNK, MAX_CHUNK)).toBe(true);
    expect(inWorld(MAX_CHUNK + 1, 0)).toBe(false);
    expect(chunkHub(MAX_CHUNK + 3, 0).zone).toBe(hubAt((MAX_CHUNK + 3.5) * CHUNK_SIZE, 16).zone);
  });
});
