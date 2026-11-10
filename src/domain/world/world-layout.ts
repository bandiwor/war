import { CHUNK_SIZE } from './chunks';
import type { StreetLayout, ZoneVolume } from './street-layout';
import { chunkHub, MAX_CHUNK, MIN_CHUNK, WORLD_MAX, WORLD_MIN, WORLD_SPAWN } from './world-map';

/**
 * The open world's static layout as the rest of the game sees a layout: zones
 * (one volume per chunk, for the soundscape and later spawns), spawn and
 * bounds. Its geometry is empty: chunk content is streamed (chunk-gen.ts).
 */
export function generateWorldLayout(): StreetLayout {
  const zones: ZoneVolume[] = [];
  for (let cz = MIN_CHUNK; cz <= MAX_CHUNK; cz++) {
    for (let cx = MIN_CHUNK; cx <= MAX_CHUNK; cx++) {
      const x0 = cx * CHUNK_SIZE;
      const z0 = cz * CHUNK_SIZE;
      zones.push({
        zone: chunkHub(cx, cz).zone,
        min: [x0, z0],
        max: [x0 + CHUNK_SIZE, z0 + CHUNK_SIZE],
      });
    }
  }
  return {
    kind: 'world',
    targets: [],
    zones,
    boxes: [],
    blockers: [],
    props: [],
    lights: [],
    spawn: WORLD_SPAWN,
    walkBounds: [WORLD_MIN + 1, WORLD_MIN + 1, WORLD_MAX - 1, WORLD_MAX - 1],
  };
}
