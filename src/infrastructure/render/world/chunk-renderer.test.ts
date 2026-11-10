import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../../../domain/world/chunks';
import { WORLD_SPAWN } from '../../../domain/world/world-map';
import { PropLibrary } from '../scene/prop-library';
import { MaterialLibrary } from '../textures/material-library';
import { InlineTextureBaker } from '../textures/texture-baker';
import { ChunkRenderer } from './chunk-renderer';
import { InlineChunkSource } from './chunk-source';

const materials = await MaterialLibrary.create(new InlineTextureBaker(), 1, 16, 1);

function renderer(budgetMs: number, clock: () => number = () => 0): ChunkRenderer {
  return new ChunkRenderer(
    new InlineChunkSource(1337),
    materials,
    new PropLibrary(materials, 1),
    { radius: 2, detailRadius: 1, budgetMs, maxInFlight: 3 },
    clock,
  );
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('chunk renderer', () => {
  it('preloads the view radius before the first frame', async () => {
    const r = renderer(1.5);
    await r.preload(WORLD_SPAWN.position[0], WORLD_SPAWN.position[2], 2);
    expect(r.loadedCount).toBe(25);
    expect(r.group.children).toHaveLength(25);
    expect(r.lights.length).toBeGreaterThan(0);
    r.dispose();
  });

  it('streams in around the camera within the frame budget', async () => {
    // A fake clock that advances 1 ms per reading: a 1.5 ms budget allows two attaches per frame.
    let now = 0;
    const r = renderer(1.5, () => (now += 1));
    const x = WORLD_SPAWN.position[0];
    const z = WORLD_SPAWN.position[2];
    const perFrame: number[] = [];
    for (let frame = 0; frame < 60 && r.loadedCount < 25; frame++) {
      const before = r.attachedTotal;
      r.update(x, z);
      perFrame.push(r.attachedTotal - before);
      await flush();
    }
    expect(r.loadedCount).toBe(25);
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(2);
    expect(r.frameMs.count).toBe(perFrame.length);
    r.dispose();
  });

  it('attaches at least one chunk per frame even when one costs more than the budget', async () => {
    let now = 0;
    const r = renderer(0.5, () => (now += 2));
    r.update(0, 0);
    await flush();
    const before = r.attachedTotal;
    r.update(0, 0);
    expect(r.attachedTotal - before).toBe(1);
    r.dispose();
  });

  it('detaches chunks that fall behind and hides small props in far rings', async () => {
    const r = renderer(100);
    await r.preload(0, 0, 2);
    expect(r.isLoaded(0, 0)).toBe(true);
    const far = 6 * CHUNK_SIZE;
    for (let i = 0; i < 40; i++) {
      r.update(far, 0);
      await flush();
    }
    expect(r.isLoaded(0, 0)).toBe(false);
    expect(r.detachedTotal).toBeGreaterThan(0);
    for (const root of r.group.children) {
      const [, cxs, czs] = /chunk:(-?\d+),(-?\d+)/.exec(root.name) ?? [];
      const ring = Math.max(Math.abs(Number(cxs) - 6), Math.abs(Number(czs)));
      const detail = root.children.find((c) => c instanceof THREE.Group);
      expect(detail?.visible).toBe(ring <= 1);
    }
    r.dispose();
  });
});
