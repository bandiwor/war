import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, parseSave } from '../../domain/save/save';
import { SaveStore, type KeyValueStorage } from './save-store';

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > 1e6) throw new Error('quota');
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

const v2 = readFileSync(new URL('../../../tests/fixtures/saves/v2.json', import.meta.url), 'utf8');

describe('save slots', () => {
  it('writes, lists, reads back and removes', () => {
    const m = memory();
    const store = new SaveStore(m);
    expect(store.list()).toEqual([]);
    const save = parseSave(JSON.parse(v2));
    expect(store.write('quick', save)).toBe(true);
    expect(store.read('quick')).toEqual(save);
    expect(store.list()).toEqual([
      { slot: 'quick', label: save.meta.label, playSeconds: 0, scene: 'world' },
    ]);
    store.remove('quick');
    expect(store.read('quick')).toBeNull();
  });

  it('migrates old saves on read; corrupt ones read as missing and are reported', () => {
    const m = memory();
    m.data.set('war.save.auto', v2);
    m.data.set('war.save.quick', '{"format":"war-save","version":42}');
    const store = new SaveStore(m);
    expect(store.read('auto')?.version).toBe(SAVE_VERSION);
    expect(store.read('quick')).toBeNull();
    m.data.set('war.save.quick', 'not json');
    expect(store.read('quick')).toBeNull();
    expect(store.problems).toHaveLength(2);
  });

  it('a full disk fails the write without throwing', () => {
    const save = parseSave(JSON.parse(v2));
    const store = new SaveStore(memory());
    const huge = { ...save, meta: { ...save.meta, label: 'x'.repeat(2e6) } };
    expect(store.write('quick', huge)).toBe(false);
    expect(store.problems[0]).toContain('quota');
  });
});
