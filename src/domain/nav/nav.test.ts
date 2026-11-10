import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seed } from '../core/brand';
import { generateChunk } from '../world/chunk-gen';
import { generateStreetLayout } from '../world/street-layout';
import { HUBS } from '../world/world-map';
import { PathFinder, type PathResult } from './astar';
import { NavGrid } from './nav-grid';

const floor = { material: 'asphalt' as const, solid: true, yaw: 0 };

/** A 32 m floor with a wall across x = 10 that has a gap at z ∈ [26, 30]. */
function walledRoom(): NavGrid {
  const g = new NavGrid(0.35);
  g.rasterize({
    boxes: [
      { ...floor, center: [16, -0.2, 16], size: [32, 0.4, 32] },
      { ...floor, material: 'brick', center: [10, 1.5, 12.5], size: [1, 3, 25] },
    ],
    blockers: [],
    props: [],
  });
  return g;
}

const result = (): PathResult => ({ status: 'failed', points: 0, expansions: 0 });

describe('nav grid', () => {
  it('rasterises floors as walkable, walls and props as blocked (inflated by the agent radius)', () => {
    const g = walledRoom();
    expect(g.walkableAt(5, 5)).toBe(true);
    expect(g.walkableAt(10.2, 5)).toBe(false);
    expect(g.walkableAt(9.4, 5)).toBe(false); // within the agent radius of the wall face (9.5)
    expect(g.walkableAt(10.2, 28)).toBe(true); // the gap
    expect(g.walkableAt(-5, 5)).toBe(false); // no tile there
    expect(g.floorAt(5, 5)).toBeCloseTo(0, 5);
  });

  it('keeps pavements as raised floor, roofs as headroom', () => {
    const g = new NavGrid();
    g.rasterize({
      boxes: [
        { ...floor, center: [8, -0.2, 8], size: [16, 0.4, 16] },
        { ...floor, material: 'concrete', center: [4, -0.125, 4], size: [4, 0.55, 4] },
        { ...floor, material: 'paintedMetal', center: [12, 3.3, 12], size: [4, 0.3, 4] },
      ],
      blockers: [],
      props: [{ kind: 'barrel', material: 'rustedMetal', position: [8, 0, 3], yaw: 0, scale: 1 }],
    });
    expect(g.floorAt(4, 4)).toBeCloseTo(0.15, 5);
    expect(g.walkableAt(12, 12)).toBe(true);
    expect(g.walkableAt(8, 3)).toBe(false);
  });

  it('streamed tiles own their chunk; removing one blocks it again', () => {
    const g = new NavGrid();
    const c = generateChunk(seed(1), -3, -1);
    g.rasterize(c, [-3, -1]);
    expect(g.hasTile(-3, -1)).toBe(true);
    expect(g.walkableAt(-72, -14)).toBe(true); // the player start, on the avenue
    expect(g.walkableAt(-72, -40)).toBe(false); // chunk (-3, -2): not loaded
    g.removeTile(-3, -1);
    expect(g.walkableAt(-72, -14)).toBe(false);
    expect(g.tileCount).toBe(0);
  });
});

describe('A*', () => {
  const finder = new PathFinder(96);
  const out = new Float64Array(64);

  it('goes around a wall through its gap, with a smoothed path', () => {
    const g = walledRoom();
    const r = finder.find(g, 4, 4, 16, 4, 10_000, out, 32, result());
    expect(r.status).toBe('found');
    // Must pass through the gap (z ≥ 25.5) to cross x = 10.
    let crossed = false;
    let px = 4;
    let pz = 4;
    for (let i = 0; i < r.points; i++) {
      const x = out[i * 2] ?? 0;
      const z = out[i * 2 + 1] ?? 0;
      expect(g.lineWalkable(px, pz, x, z)).toBe(true);
      if ((px - 10) * (x - 10) <= 0) crossed ||= Math.min(pz, z) > 25;
      px = x;
      pz = z;
    }
    expect(crossed).toBe(true);
    expect([px, pz]).toEqual([16, 4]);
    expect(r.points).toBeLessThanOrEqual(4); // string pulling: a few corners, not every cell
  });

  it('stops at the expansion budget with the best partial path', () => {
    const g = walledRoom();
    const r = finder.find(g, 4, 4, 16, 4, 20, out, 32, result());
    expect(r.status).toBe('partial');
    expect(r.expansions).toBe(20);
  });

  it('fails cleanly when the goal is unreachable or outside the window', () => {
    const g = walledRoom();
    expect(finder.find(g, 4, 4, 400, 4, 10_000, out, 32, result()).status).toBe('failed');
    const sealed = new NavGrid();
    sealed.rasterize({
      boxes: [{ ...floor, center: [2, -0.2, 2], size: [4, 0.4, 4] }],
      blockers: [],
      props: [],
    });
    expect(finder.find(sealed, 1, 1, 30, 30, 10_000, out, 32, result()).status).not.toBe('found');
  });

  it('is deterministic and every path step stays walkable (random walls)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 2, max: 28 }), fc.integer({ min: 2, max: 28 })), {
          maxLength: 12,
        }),
        (walls) => {
          const g = new NavGrid(0.3);
          g.rasterize({
            boxes: [
              { ...floor, center: [16, -0.2, 16], size: [32, 0.4, 32] },
              ...walls.map(([x, z]) => ({
                ...floor,
                material: 'brick' as const,
                center: [x, 1, z] as const,
                size: [1, 2, 4] as const,
              })),
            ],
            blockers: [],
            props: [],
          });
          const a = finder.find(g, 1, 1, 30, 30, 5000, out, 32, result());
          const pts = Array.from(out.subarray(0, a.points * 2));
          const b = finder.find(g, 1, 1, 30, 30, 5000, out, 32, result());
          expect(Array.from(out.subarray(0, b.points * 2))).toEqual(pts);
          if (a.status === 'failed' || !g.walkableAt(1.5, 1.5)) return;
          let px = 1.5;
          let pz = 1.5;
          for (let i = 0; i < a.points; i++) {
            expect(g.lineWalkable(px, pz, pts[i * 2] ?? 0, pts[i * 2 + 1] ?? 0)).toBe(true);
            px = pts[i * 2] ?? 0;
            pz = pts[i * 2 + 1] ?? 0;
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('finds routes on real content: the street and a world hub', () => {
    const street = new NavGrid();
    street.rasterize(generateStreetLayout(seed(1337)));
    expect(finder.find(street, 1.5, -56, 1.5, -20, 20_000, out, 32, result()).status).toBe('found');
    const world = new NavGrid();
    for (let cz = -1; cz <= 1; cz++)
      for (let cx = -5; cx <= -3; cx++)
        world.rasterize(generateChunk(seed(1337), cx, cz), [cx, cz]);
    const city = HUBS.find((h) => h.zone === 'abandonedCity');
    expect(city).toBeDefined();
    expect(finder.find(world, -72, -14, -140, -14, 20_000, out, 32, result()).status).toBe('found');
  });
});
