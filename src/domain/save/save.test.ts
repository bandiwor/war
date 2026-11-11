import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../story/campaign';
import { StoryEngine } from '../story/engine';
import { SAVE_VERSION, parseSave, serializeSave, type SaveGame } from './save';

const fixture = (v: number): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../tests/fixtures/saves/v${String(v)}.json`, import.meta.url),
      'utf8',
    ),
  );

describe('save migrations', () => {
  it('v1 (a position and loose flags) migrates to the current version', () => {
    const s = parseSave(fixture(1));
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.player).toMatchObject({ x: 128, z: -60, health: 64, flashlight: true, pitch: 0 });
    expect(s.story?.flags).toEqual([
      ['keycard', 0],
      ['power.genA', 1],
    ]);
    expect(s.story?.chapter).toBe('arrival');
    expect(s.weapons).toBeNull();
  });

  it('v2 (quests, logs, ammo) migrates to the current version and loads into the story engine', () => {
    const s = parseSave(fixture(2));
    expect(s.ammo).toEqual({ r9x19: 12, flare: 1 });
    expect(s.meta.label).toContain('power');
    const e = new StoryEngine(CAMPAIGN);
    if (s.story === null) throw new Error('no story');
    e.restore(s.story);
    expect(e.status('substation')).toBe('active');
    expect(e.kills.zombie).toBe(3);
    // It was saved mid-story: the start effects do not run again.
    const notes = e.tick(1 / 60, { x: 128, z: -130, zone: 'industrial', night: 1 }, null);
    expect(notes.some((n) => n.kind === 'quest' && n.quest === 'rally')).toBe(false);
  });

  it('rejects unknown versions and malformed saves', () => {
    expect(() => parseSave({ format: 'war-save', version: 99 })).toThrow('Unknown save version');
    expect(() => parseSave(null)).toThrow();
    expect(() => parseSave(Object.assign({}, fixture(2), { ammo: { r9x19: -1 } }))).toThrow();
  });

  it('serialises diff-friendly and round-trips exactly (property)', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.stringMatching(/^[a-z][a-z.]{0,8}$/), fc.integer({ min: -9, max: 9 })),
        fc.double({ min: -200, max: 200, noNaN: true }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (flags, x, seed) => {
          const s: SaveGame = parseSave({
            format: 'war-save',
            version: 1,
            seed,
            scene: 'world',
            player: { x, y: 0, z: -x, yaw: 0, health: 100 },
            flags,
          });
          const text = serializeSave(s);
          const back = parseSave(JSON.parse(text));
          expect(back.player.x).toBe(s.player.x === 0 ? 0 : s.player.x); // −0 is written as 0
          expect(serializeSave(back)).toBe(text);
          expect(text.split('\n').length).toBeGreaterThan(20); // one value per line
        },
      ),
      { numRuns: 80 },
    );
  });
});
