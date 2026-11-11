import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AddEntity,
  Batch,
  EditorDocument,
  HISTORY_LIMIT,
  anchorOf,
  decorBrush,
  eraseDecor,
  movedTo,
  pickAt,
  snap,
  snapAngle,
  terrainBrush,
} from './editor';
import { heightAt, newLevel, parseLevel, serializeLevel, type Level } from './level';

const yard = (): Level =>
  parseLevel(
    JSON.parse(readFileSync(new URL('../../../levels/yard.level.json', import.meta.url), 'utf8')),
  );

describe('editor document', () => {
  it('add, move, edit, delete — each undoes and redoes exactly', () => {
    const doc = new EditorDocument(yard());
    const original = serializeLevel(doc.level);
    const id = doc.nextId('barrel');
    expect(id).toBe('barrel1');
    doc.add('decor', { id, kind: 'barrel', material: 'rustedMetal', at: [1, 1], yaw: 0, scale: 1 });
    doc.move({ collection: 'decor', id }, 4, 5);
    doc.update('decor', id, (e) => ({ ...e, scale: 2 }));
    doc.remove({ collection: 'decor', id });
    expect(doc.find('decor', id)).toBeUndefined();
    expect(doc.undoLabel).toBe(`Delete ${id}`);
    doc.undo();
    expect(doc.find('decor', id)).toMatchObject({ at: [4, 5], scale: 2 });
    doc.undo();
    doc.undo();
    expect(doc.find('decor', id)?.at).toEqual([1, 1]);
    doc.undo();
    expect(serializeLevel(doc.level)).toBe(original);
    expect(doc.canUndo).toBe(false);
    for (let i = 0; i < 4; i++) doc.redo();
    expect(doc.find('decor', id)).toBeUndefined();
    expect(doc.canRedo).toBe(false);
    expect(doc.redo()).toBe(false);
  });

  it('a drag is one undo step; a new action clears the redo stack', () => {
    const doc = new EditorDocument(yard());
    const ref = { collection: 'mobs', id: 'shamblerA' } as const;
    for (let i = 1; i <= 30; i++) doc.move(ref, -14 + i * 0.1, 8, 'drag:1');
    expect(doc.find('mobs', 'shamblerA')?.at[0]).toBeCloseTo(-11);
    doc.undo();
    expect(doc.find('mobs', 'shamblerA')?.at).toEqual([-14, 8]);
    doc.redo();
    doc.undo();
    doc.setSpawn(1, 2, 0);
    expect(doc.canRedo).toBe(false);
    expect(doc.dirty).toBe(true);
  });

  it('moves every kind of entity by its anchor; paths and zones move as a whole', () => {
    const l = yard();
    const patrol = l.patrols[0];
    const zone = l.spawnZones[0];
    if (patrol === undefined || zone === undefined) throw new Error('fixture');
    const p2 = movedTo('patrols', patrol, 20, 12);
    expect(p2.points[0]).toEqual([20, 12]);
    expect(p2.points[1]).toEqual([20, 30]);
    const z2 = movedTo('spawnZones', zone, 0, 0);
    expect(anchorOf('spawnZones', z2)).toEqual([0, 0]);
    expect(z2.max[0] - z2.min[0]).toBe(zone.max[0] - zone.min[0]);
    const doc = new EditorDocument(l);
    for (const ref of [
      { collection: 'objects', id: 'wallA' },
      { collection: 'lights', id: 'lampA' },
      { collection: 'interactables', id: 'shiftLog' },
    ] as const) {
      doc.move(ref, 3, 4);
      const e = doc.find(ref.collection, ref.id);
      expect(anchorOf(ref.collection, e)).toEqual([3, 4]);
    }
    // Heights are kept: a lamp stays up on its pole.
    expect(doc.find('lights', 'lampA')?.at[1]).toBe(6);
  });

  it('picks the nearest thing, a patrol by any point, a zone from inside', () => {
    const l = yard();
    expect(pickAt(l, -14.3, 8.2)).toEqual({ collection: 'mobs', id: 'shamblerA' });
    expect(pickAt(l, 0.2, 24.1)).toEqual({ collection: 'patrols', id: 'yardLoop' });
    expect(pickAt(l, -30, 26)).toEqual({ collection: 'spawnZones', id: 'wolfWoods' });
    expect(pickAt(l, 35, -25)).toBeNull();
  });

  it('meta, story and loading', () => {
    const doc = new EditorDocument(yard());
    doc.setMeta('title', 'Renamed');
    doc.setStory(null);
    expect(doc.level.story).toBeNull();
    expect(doc.find('interactables', 'shiftLog')).toBeUndefined();
    expect(() => {
      doc.add('interactables', {
        id: 'x',
        kind: 'cache',
        label: 'x',
        at: [0, 0, 0],
        radius: 2,
        once: true,
        effects: [{ do: 'battery' }],
      });
    }).toThrow('no story');
    doc.undo();
    expect(doc.level.story?.interactables.length).toBe(2);
    doc.undo();
    expect(doc.level.title).toBe('The Yard');
    doc.load(newLevel({}));
    expect(doc.canUndo).toBe(false);
    expect(doc.dirty).toBe(false);
  });

  it('merging: a spawn drag is one step; a drag key reused on another entity is not merged', () => {
    const doc = new EditorDocument(yard());
    for (let i = 0; i < 10; i++) doc.setSpawn(i, 0, 0, 'drag:spawn');
    expect(doc.level.spawn.at).toEqual([9, 0]);
    doc.undo();
    expect(doc.level.spawn.at).toEqual([0, -26]);
    doc.move({ collection: 'mobs', id: 'shamblerA' }, 1, 1, 'drag:x');
    doc.move({ collection: 'mobs', id: 'shamblerB' }, 2, 2, 'drag:x');
    doc.setMeta('seed', 9);
    doc.undo();
    expect(doc.redoLabel).toBe('Set seed');
    doc.undo();
    expect(doc.find('mobs', 'shamblerB')?.at).toEqual([-16, 9]);
    expect(doc.find('mobs', 'shamblerA')?.at).toEqual([1, 1]);
    // Inserting at an index (redo of a delete keeps the order).
    doc.exec(
      new AddEntity('mobs', { id: 'first', mob: 'wolf', at: [0, 0], yaw: 0, patrol: null }, 0),
    );
    expect(doc.level.mobs[0]?.id).toBe('first');
    // Removing something that is not there changes nothing.
    const v = doc.version;
    doc.remove({ collection: 'mobs', id: 'ghost' });
    expect(doc.version).toBe(v);
  });

  it('keeps a bounded history', () => {
    const doc = new EditorDocument(newLevel({}));
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) doc.setSpawn(i, 0, 0);
    let n = 0;
    while (doc.undo()) n++;
    expect(n).toBe(HISTORY_LIMIT);
  });

  it('a batch undoes in reverse', () => {
    const doc = new EditorDocument(newLevel({}));
    doc.exec(
      new Batch('two', [
        new AddEntity('patrols', {
          id: 'p1',
          points: [
            [0, 0],
            [2, 2],
          ],
          loop: false,
        }),
        new AddEntity('mobs', { id: 'm1', mob: 'wolf', at: [0, 0], yaw: 0, patrol: 'p1' }, 0),
      ]),
    );
    expect(doc.level.mobs[0]?.patrol).toBe('p1');
    doc.undo();
    expect(doc.level.mobs).toEqual([]);
    expect(doc.level.patrols).toEqual([]);
  });

  it('undo after any sequence of edits restores the level exactly (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ op: fc.constant('add' as const), x: fc.integer({ min: -20, max: 20 }) }),
            fc.record({ op: fc.constant('move' as const), x: fc.integer({ min: -20, max: 20 }) }),
            fc.record({ op: fc.constant('paint' as const), x: fc.integer({ min: -30, max: 30 }) }),
            fc.record({ op: fc.constant('del' as const), x: fc.constant(0) }),
          ),
          { maxLength: 25 },
        ),
        (ops) => {
          const doc = new EditorDocument(newLevel({}));
          const start = serializeLevel(doc.level);
          for (const o of ops) {
            const last = doc.level.decor.at(-1);
            if (o.op === 'add')
              doc.add('decor', {
                id: doc.nextId('rock'),
                kind: 'rock',
                material: 'concrete',
                at: [o.x, 0],
                yaw: 0,
                scale: 1,
              });
            else if (o.op === 'move' && last !== undefined)
              doc.move({ collection: 'decor', id: last.id }, o.x, o.x);
            else if (o.op === 'del' && last !== undefined)
              doc.remove({ collection: 'decor', id: last.id });
            else if (o.op === 'paint') {
              const c = terrainBrush(doc.level, o.x, -o.x, 3, { kind: 'raise' });
              if (c !== null) doc.exec(c);
            }
          }
          const end = serializeLevel(doc.level);
          while (doc.undo());
          expect(serializeLevel(doc.level)).toBe(start);
          while (doc.redo());
          expect(serializeLevel(doc.level)).toBe(end);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('snapping and brushes', () => {
  it('snaps positions and angles', () => {
    expect(snap(1.26, 0.5)).toBe(1.5);
    expect(snap(1.26, 0)).toBe(1.26);
    expect(snapAngle(0.3)).toBeCloseTo(Math.PI / 12);
  });

  it('a terrain stroke raises, lowers, flattens and paints, and undoes as one step', () => {
    const doc = new EditorDocument(newLevel({ cells: [16, 16] }));
    for (let k = 0; k < 5; k++) {
      const c = terrainBrush(doc.level, 0, 0, 3, { kind: 'raise' }, 'stroke:1');
      if (c !== null) doc.exec(c);
    }
    const [i, k] = [16, 16].map((n) => n / 2);
    expect(heightAt(doc.level, i ?? 0, k ?? 0)).toBe(5);
    doc.undo();
    expect(heightAt(doc.level, i ?? 0, k ?? 0)).toBe(0);
    const top = terrainBrush(doc.level, 0, 0, 2, { kind: 'flatten', height: 99 });
    if (top !== null) doc.exec(top);
    expect(heightAt(doc.level, i ?? 0, k ?? 0)).toBe(9);
    const down = terrainBrush(doc.level, 0, 0, 2, { kind: 'lower' });
    if (down !== null) doc.exec(down);
    expect(heightAt(doc.level, i ?? 0, k ?? 0)).toBe(8);
    const paint = terrainBrush(doc.level, 0, 0, 2, { kind: 'paint', material: 2 });
    expect(paint?.size).toBeGreaterThan(0);
    if (paint !== null) doc.exec(paint);
    expect(doc.level.terrain.materials[k ?? 0]?.[i ?? 0]).toBe('2');
    // Nothing to change: no command.
    expect(terrainBrush(doc.level, 0, 0, 2, { kind: 'paint', material: 2 })).toBeNull();
    expect(terrainBrush(doc.level, 999, 999, 2, { kind: 'raise' })).toBeNull();
  });

  it('the decor brush scatters deterministically, spaced and inside the level; the eraser removes', () => {
    const a = new EditorDocument(newLevel({ seed: 5 }));
    const b = new EditorDocument(newLevel({ seed: 5 }));
    const template = { kind: 'tree', material: 'bark', scale: 1 } as const;
    const ca = decorBrush(a, 0, 0, 6, template, 8, 1);
    const cb = decorBrush(b, 0, 0, 6, template, 8, 1);
    if (ca === null || cb === null) throw new Error('nothing scattered');
    a.exec(ca);
    b.exec(cb);
    expect(a.level.decor).toEqual(b.level.decor);
    expect(a.level.decor).toHaveLength(8);
    const pts = a.level.decor.map((p) => p.at);
    for (const [i, p] of pts.entries())
      for (const q of pts.slice(i + 1))
        expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeGreaterThanOrEqual(1);
    // At the edge of the level only what fits inside is placed.
    const edge = decorBrush(a, 31.9, 31.9, 1, template, 50, 2);
    expect(edge === null || edge.commands.length < 50).toBe(true);
    const erase = eraseDecor(a.level, 0, 0, 20);
    if (erase === null) throw new Error('nothing to erase');
    a.exec(erase);
    expect(a.level.decor).toEqual([]);
    a.undo();
    expect(a.level.decor).toHaveLength(8);
    expect(eraseDecor(a.level, 25, 25, 1)).toBeNull();
  });
});
