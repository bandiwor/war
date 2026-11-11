import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NavGrid } from '../nav/nav-grid';
import { checkLevel, type IssueCode } from './checks';
import { cellHeight, groundAt, levelToLayout } from './compile';
import {
  HEIGHT_STEP,
  LEVEL_VERSION,
  cellAt,
  levelBounds,
  newLevel,
  parseLevel,
  serializeLevel,
  type Level,
} from './level';

const yardText = readFileSync(new URL('../../../levels/yard.level.json', import.meta.url), 'utf8');
const yard = (): Level => parseLevel(JSON.parse(yardText));
const xz = (x: number, z: number): [number, number] => [x, z];
const xyz = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
const codes = (l: Level): IssueCode[] => checkLevel(l).issues.map((i) => i.code);

describe('level format', () => {
  it('the shipped sample parses, and serialises back byte for byte', () => {
    const l = yard();
    expect(l.version).toBe(LEVEL_VERSION);
    expect(serializeLevel(l)).toBe(yardText);
    // Diff-friendly: one terrain row per line, short arrays on one line.
    expect(yardText).toContain('"origin": [-40, -30]');
    expect(yardText.split('\n').filter((x) => /^\s+"[0-9]+",?$/.test(x)).length).toBe(60); // heights and materials
  });

  it('v1 levels (a flat floor, no patrols) migrate to the current version', () => {
    const v1 = {
      format: 'war-level',
      version: 1,
      id: 'old',
      title: 'Old',
      seed: 3,
      zone: 'forest',
      origin: [-8, -8],
      cells: [8, 8],
      spawn: { at: [0, 0], yaw: 0 },
      floor: 'forestFloor',
      objects: [],
      decor: [],
      lights: [],
      mobs: [{ id: 'w', mob: 'wolf', at: [4, 4], yaw: 0 }],
    };
    const l = parseLevel(v1);
    expect(l.version).toBe(LEVEL_VERSION);
    expect(l.terrain.palette).toEqual(['forestFloor']);
    expect(l.terrain.heights).toHaveLength(8);
    expect(l.mobs[0]?.patrol).toBeNull();
    expect(() => parseLevel({ ...v1, version: 7 })).toThrow('Unknown level version');
    expect(() => parseLevel({ ...v1, floor: 'cheese' })).toThrow();
  });

  it('round-trips any level exactly (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 24 }),
        fc.integer({ min: 4, max: 24 }),
        fc.array(
          fc.record({
            x: fc.double({ min: -8, max: 8, noNaN: true }),
            z: fc.double({ min: -8, max: 8, noNaN: true }),
            yaw: fc.double({ min: -3, max: 3, noNaN: true }),
          }),
          { maxLength: 12 },
        ),
        (w, d, crates) => {
          const l: Level = {
            ...newLevel({ cells: [w, d] }),
            decor: crates.map((c, i) => ({
              id: `crate${String(i)}`,
              kind: 'crate',
              material: 'woodPlanks',
              at: [c.x, c.z],
              yaw: c.yaw,
              scale: 1,
            })),
          };
          const text = serializeLevel(l);
          const back = parseLevel(JSON.parse(text));
          expect(serializeLevel(back)).toBe(text);
          expect(back.decor.map((x) => x.at)).toEqual(
            l.decor.map((x) => [x.at[0] === 0 ? 0 : x.at[0], x.at[1] === 0 ? 0 : x.at[1]]),
          );
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('level compiler', () => {
  it('merges terrain into few boxes, lifts props onto the ground, closes the edges', () => {
    const l = yard();
    const layout = levelToLayout(l);
    const terrain = layout.boxes.length - l.objects.length;
    expect(terrain).toBeGreaterThan(3);
    expect(terrain).toBeLessThan(40); // 1200 cells
    expect(layout.blockers).toHaveLength(4);
    expect(layout.spawn.position).toEqual([0, 0, -26]);
    expect(layout.zones[0]?.zone).toBe('industrial');
    // The dock is 0.6 m high; a kerb cell 0.15 m.
    expect(cellHeight(l, 26, 8)).toBeCloseTo(4 * HEIGHT_STEP);
    expect(groundAt(l, -40 + 16 * 2 + 1, 0)).toBeCloseTo(HEIGHT_STEP);
    expect(groundAt(l, 999, 0)).toBe(0);
    expect(cellAt(l, -40, -30)).toEqual([0, 0]);
    expect(cellAt(l, 40.5, 0)).toBeNull();
    expect(levelBounds(l)).toEqual([-40, -30, 40, 30]);
    // Play from here: the start moves, the level does not.
    expect(levelToLayout(l, { from: { at: [5, 5], yaw: 1 } }).spawn).toEqual({
      position: [5, 0, 5],
      yaw: 1,
    });
  });

  it('the nav grid sees the dock as a wall and the kerb as floor', () => {
    const l = yard();
    const grid = new NavGrid();
    grid.rasterize(levelToLayout(l));
    expect(grid.walkableAt(-40 + 29 * 2 + 1, -30 + 10 * 2 + 1)).toBe(false); // dock
    expect(grid.walkableAt(-40 + 16 * 2 + 1, -10)).toBe(true); // kerb
    expect(grid.floorAt(-40 + 16 * 2 + 1, -10)).toBeCloseTo(HEIGHT_STEP, 1);
  });
});

describe('level checks', () => {
  it('the sample level is clean', () => {
    const r = checkLevel(yard());
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.reachable).toBeGreaterThan(3000);
    expect(r.reachable).toBeLessThanOrEqual(r.walkable);
  });

  it('a spawn inside a container: the player would be stuck', () => {
    const l = yard();
    expect(codes({ ...l, spawn: { at: [16, -14], yaw: 0 } })).toContain('spawn-blocked');
  });

  it('a mob inside a wall is stuck; one walled off can never reach you', () => {
    const l = yard();
    const walled: Level = {
      ...l,
      objects: [
        ...l.objects,
        // A closed brick box around (32, 22).
        {
          id: 'pen1',
          material: 'brick',
          center: [32, 1, 18],
          size: [10, 2, 0.4],
          yaw: 0,
          solid: true,
        },
        {
          id: 'pen2',
          material: 'brick',
          center: [32, 1, 26],
          size: [10, 2, 0.4],
          yaw: 0,
          solid: true,
        },
        {
          id: 'pen3',
          material: 'brick',
          center: [27, 1, 22],
          size: [0.4, 2, 8.4],
          yaw: 0,
          solid: true,
        },
        {
          id: 'pen4',
          material: 'brick',
          center: [37, 1, 22],
          size: [0.4, 2, 8.4],
          yaw: 0,
          solid: true,
        },
      ],
      mobs: [
        ...l.mobs,
        { id: 'inWall', mob: 'shambler', at: [-22, 0], yaw: 0, patrol: null },
        { id: 'penned', mob: 'wolf', at: [32, 22], yaw: 0, patrol: null },
      ],
    };
    const r = checkLevel(walled);
    const by = (ref: string) => r.issues.filter((i) => i.ref === ref).map((i) => i.code);
    expect(by('inWall')).toEqual(['mob-stuck']);
    expect(by('penned')).toEqual(['unreachable']);
    expect(r.issues.some((i) => i.code === 'pocket')).toBe(true);
  });

  it('story objects out of reach, blocked patrols and dead spawn zones are errors', () => {
    const l = yard();
    const story = l.story;
    if (story === null) throw new Error('no story');
    const bad: Level = {
      ...l,
      patrols: [
        ...l.patrols,
        {
          id: 'intoDock',
          points: [
            [0, 0],
            [20, -10],
          ],
          loop: false,
        },
      ],
      spawnZones: [
        ...l.spawnZones,
        { id: 'onDock', min: [14, -12], max: [26, -6], mobs: ['wolf'], population: 1 },
      ],
      story: {
        ...story,
        interactables: [
          ...story.interactables,
          {
            id: 'onTheDock',
            kind: 'cache',
            label: 'x',
            at: [20, 0, -9],
            radius: 1,
            once: true,
            effects: [{ do: 'battery' }],
          },
        ],
      },
    };
    const c = codes(bad);
    expect(c).toContain('patrol-blocked');
    expect(c).toContain('zone-unreachable');
    expect(c).toContain('unreachable');
  });

  it('shape, references, bounds, story and budgets', () => {
    const l = yard();
    const story = l.story;
    if (story === null) throw new Error('no story');
    const lamp = l.lights[0];
    if (lamp === undefined) throw new Error('no lamp');
    const bad: Level = {
      ...l,
      terrain: {
        ...l.terrain,
        heights: l.terrain.heights.slice(1),
        materials: l.terrain.materials.map((r, i) => (i === 0 ? `z${r.slice(1)}` : r)),
      },
      decor: [
        ...l.decor,
        { id: 'barrelA', kind: 'barrel', material: 'rustedMetal', at: [99, 0], yaw: 0, scale: 1 },
      ],
      mobs: [...l.mobs, { id: 'lost', mob: 'wolf', at: [0, 0], yaw: 0, patrol: 'nowhere' }],
      lights: Array.from({ length: 30 }, (_, i) => ({ ...lamp, id: `lamp${String(i)}` })),
      story: {
        ...story,
        triggers: [
          {
            id: 't',
            when: { is: 'log', log: 'missing' },
            once: true,
            effects: [{ do: 'battery' }],
          },
        ],
      },
    };
    const c = codes(bad);
    for (const code of [
      'terrain-shape',
      'duplicate-id',
      'out-of-bounds',
      'unknown-patrol',
      'story',
      'budget',
    ] as const)
      expect(c, code).toContain(code);
    const r = checkLevel(bad);
    expect(r.errors + r.warnings).toBe(r.issues.length);
    // Over every budget at once.
    const crowd: Level = {
      ...l,
      mobs: Array.from({ length: 60 }, (_, i) => ({
        id: `m${String(i)}`,
        mob: 'wolf' as const,
        at: xz(-30 + (i % 10), -20 + Math.floor(i / 10)),
        yaw: 0,
        patrol: null,
      })),
      decor: Array.from({ length: 620 }, (_, i) => ({
        id: `d${String(i)}`,
        kind: 'fungus' as const,
        material: 'foliage' as const,
        at: xz(-39 + (i % 70), 20 + (i % 9)),
        yaw: 0,
        scale: 1,
      })),
      objects: Array.from({ length: 920 }, (_, i) => ({
        id: `o${String(i)}`,
        material: 'concrete' as const,
        center: xyz(-38 + (i % 70) * 0.1, 0.05, 25),
        size: xyz(0.05, 0.1, 0.05),
        yaw: 0,
        solid: false,
      })),
    };
    const budgets = checkLevel(crowd).issues.filter((i) => i.code === 'budget');
    expect(budgets.length).toBe(3);
    // A spawn outside the terrain is out of bounds and blocked (no component there).
    expect(codes({ ...l, spawn: { at: [500, 500], yaw: 0 } })).toEqual(
      expect.arrayContaining(['out-of-bounds', 'spawn-blocked']),
    );
  });
});
