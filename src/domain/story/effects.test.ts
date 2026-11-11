import { describe, expect, it } from 'vitest';
import { StoryEngine, type StoryNote, type StoryWorld } from './engine';
import { StorySchema, validateStory, type StoryData, type StoryInput } from './schema';

const W: StoryWorld = { x: 0, z: 0, zone: 'forest', night: 0 };
const L = (text: string, seconds = 1) => ({ speaker: 'S', text, seconds });

const RAW: StoryInput = {
  title: 'test',
  start: [
    { do: 'startQuest', quest: 'a' },
    { do: 'startQuest', quest: 'b' },
  ],
  chapters: [
    { id: 'one', title: '1', zone: 'forest', summary: '' },
    { id: 'two', title: '2', zone: 'forest', summary: '' },
  ],
  quests: [
    {
      id: 'a',
      title: 'A',
      chapter: 'one',
      main: true,
      summary: '',
      objectives: [
        { id: 'x', text: 'x' },
        { id: 'y', text: 'y' },
      ],
      onComplete: [
        { do: 'addFlag', flag: 'score', by: 5 },
        { do: 'chapter', chapter: 'two' },
      ],
    },
    {
      id: 'b',
      title: 'B',
      chapter: 'two',
      main: true,
      summary: '',
      objectives: [{ id: 'z', text: 'z' }],
      onComplete: [],
    },
  ],
  logs: [
    { id: 'tape', kind: 'audio', title: 't', author: 'S', date: 'd', lines: [L('one'), L('two')] },
    { id: 'paper', kind: 'note', title: 'p', author: 'S', date: 'd', lines: [L('read')] },
  ],
  radio: [{ id: 'call', channel: 'CH', lines: [L('hello', 0.5)] }],
  interactables: [
    {
      id: 'lever',
      kind: 'terminal',
      label: 'lever',
      at: [0, 0, 0],
      once: false,
      effects: [
        { do: 'addFlag', flag: 'pulls', by: 1 },
        { do: 'objective', quest: 'a', objective: 'x' },
        { do: 'radio', radio: 'call' },
        { do: 'radio', radio: 'call' },
      ],
    },
    {
      id: 'box',
      kind: 'cache',
      label: 'box',
      at: [0, 0, 0],
      effects: [
        { do: 'log', log: 'tape' },
        { do: 'log', log: 'paper' },
        { do: 'log', log: 'tape' },
        { do: 'supply', ammo: 'flare', amount: 2 },
        { do: 'battery' },
        { do: 'spawn', mob: 'wolf', at: [3, 4], count: 2 },
      ],
    },
    {
      id: 'door',
      kind: 'door',
      label: 'door',
      at: [0, 0, 0],
      available: { is: 'flag', flag: 'pulls', op: 'gte', value: 2 },
      effects: [
        { do: 'completeQuest', quest: 'a' },
        { do: 'failQuest', quest: 'b' },
      ],
    },
    {
      id: 'end',
      kind: 'terminal',
      label: 'end',
      at: [0, 0, 0],
      effects: [
        { do: 'ending', ending: 'fin' },
        { do: 'setFlag', flag: 'after', value: 1 },
      ],
    },
  ],
  triggers: [
    {
      id: 'repeat',
      when: { is: 'flag', flag: 'pulls', op: 'gte', value: 1 },
      once: false,
      effects: [{ do: 'addFlag', flag: 'ticks', by: 1 }],
    },
  ],
  endings: [{ id: 'fin', title: 'Fin', epilogue: ['.'] }],
};
const DATA: StoryData = StorySchema.parse(RAW);

const kinds = (notes: readonly StoryNote[]): string[] => notes.map((n) => n.kind);

describe('story effects', () => {
  it('a reusable lever: flags add up, objectives complete once, a radio call queues once', () => {
    expect(validateStory(DATA)).toEqual([
      // A test story needs no race lore; everything else must be valid.
      ...['zombie', 'robot', 'plant', 'animal'].flatMap((r) =>
        ['origin', 'motive', 'weakness'].map((a) => `no log tells the ${r}s’ ${a}`),
      ),
    ]);
    const e = new StoryEngine(DATA);
    e.tick(0.1, W, null);
    expect(e.canUse('nothing', W)).toBe(false);
    expect(e.canUse('door', W)).toBe(false);
    e.tick(0.1, W, 'lever');
    expect(e.objectives.has('a.x')).toBe(true);
    expect(e.snapshot().playing).toEqual([{ source: 'radio', id: 'call', next: 1 }]);
    expect(e.onAir?.line.text).toBe('hello');
    expect(e.onAir?.source).toBe('radio');
    e.tick(0.1, W, 'lever');
    expect(e.flag('pulls')).toBe(2);
    expect(e.flag('ticks')).toBeGreaterThanOrEqual(2); // a repeating trigger fires every tick
    // Two pulls open the door: quest a completes (its onComplete runs), quest b fails.
    const notes = e.tick(0.1, W, 'door');
    expect(e.status('a')).toBe('done');
    expect(e.status('b')).toBe('failed');
    expect(e.flag('score')).toBe(5);
    expect(e.chapter).toBe('two');
    expect(kinds(notes)).toEqual(expect.arrayContaining(['used', 'quest', 'chapter']));
    expect(e.canUse('door', W)).toBe(false); // once
    // Failing or completing again changes nothing.
    e.tick(0.1, W, 'lever');
    expect(e.status('a')).toBe('done');
  });

  it('a box: logs once (a tape plays, a note does not), loot, a battery, an ambush', () => {
    const e = new StoryEngine(DATA);
    e.tick(0.1, W, null);
    const notes = e.tick(0.1, W, 'box');
    expect(notes.filter((n) => n.kind === 'log')).toHaveLength(2);
    expect(notes).toEqual(
      expect.arrayContaining([
        { kind: 'supply', ammo: 'flare', amount: 2 },
        { kind: 'battery' },
        { kind: 'spawn', mob: 'wolf', x: 3, z: 4, count: 2 },
      ]),
    );
    expect(e.logs).toEqual(['tape', 'paper']);
    // The tape plays line by line; the note is only read.
    const lines: string[] = notes.flatMap((n) => (n.kind === 'line' ? [n.line.text] : []));
    for (let t = 0; t < 40; t++)
      for (const n of e.tick(0.1, W, null)) if (n.kind === 'line') lines.push(n.line.text);
    expect(lines).toEqual(['one', 'two']);
    expect(e.onAir).toBeNull();
  });

  it('an ending stops the story: later effects and uses do nothing, a line on air finishes', () => {
    const e = new StoryEngine(DATA);
    e.tick(0.1, W, 'lever');
    const notes = e.tick(0.1, W, 'end');
    expect(e.ending).toBe('fin');
    expect(e.ended).toBe(true);
    expect(e.flag('after')).toBe(0);
    expect(kinds(notes)).toContain('ending');
    expect(e.canUse('lever', W)).toBe(false);
    expect(kinds(e.tick(0.1, W, 'lever'))).not.toContain('used');
    for (let t = 0; t < 20; t++) e.tick(0.1, W, null);
    expect(e.onAir).toBeNull();
  });

  it('validation finds unknown objectives and chapters without a main quest', () => {
    const [first] = RAW.quests;
    if (first === undefined) throw new Error('no quest');
    const bad = StorySchema.parse({
      ...RAW,
      quests: [
        {
          ...RAW.quests[0],
          main: false,
          onComplete: [{ do: 'objective', quest: 'a', objective: 'nope' }],
        },
      ],
      triggers: [
        {
          id: 't',
          when: { is: 'chapter', chapter: 'zzz' },
          effects: [{ do: 'ending', ending: 'none' }],
        },
        {
          id: 'u',
          when: { is: 'log', log: 'q' },
          effects: [
            { do: 'log', log: 'q' },
            { do: 'radio', radio: 'q' },
          ],
        },
        {
          id: 'v',
          when: { is: 'used', interactable: 'q' },
          effects: [{ do: 'chapter', chapter: 'q' }],
        },
      ],
    });
    const errors = validateStory(bad);
    expect(errors).toEqual(
      expect.arrayContaining([
        'quest a: quest a has no objective nope',
        'chapter one has no main quest',
        'trigger t: unknown chapter zzz',
        'trigger t: unknown ending none',
        'trigger u: unknown log q',
        'trigger u: unknown radio q',
        'trigger v: unknown interactable q',
        'trigger v: unknown chapter q',
      ]),
    );
  });
});
