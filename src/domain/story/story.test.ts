import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StateHasher } from '../math/hash';
import { hubAt, roadDistance } from '../world/world-map';
import { CAMPAIGN } from './campaign';
import { StoryEngine, type StoryWorld } from './engine';
import { SITES, SITE_POINTS } from './sites';
import { StorySchema, validateStory, type StoryData, type StoryInput } from './schema';

const DT = 1 / 60;

function world(x = 0, z = 0, night = 1): StoryWorld {
  return { x, z, zone: hubAt(x, z).zone, night };
}

/** Walks the engine to an interactable and uses it, ticking a little on each side. */
function visit(e: StoryEngine, id: string): void {
  const i = CAMPAIGN.interactables.find((t) => t.id === id);
  if (i === undefined) throw new Error(id);
  const w = world(i.at[0], i.at[2]);
  for (let k = 0; k < 3; k++) e.tick(DT, w, null);
  expect(e.canUse(id, w), `${id} usable`).toBe(true);
  e.tick(DT, w, id);
  for (let k = 0; k < 3; k++) e.tick(DT, w, null);
}

const MAIN_PATH = [
  'reyesCamera',
  'generatorA',
  'generatorB',
  'mainBreaker',
  'reyesLast',
  'keycard',
  'seedStation',
  'sorelLab',
  'coreTerminal',
] as const;

function playToChoice(): StoryEngine {
  const e = new StoryEngine(CAMPAIGN);
  e.tick(DT, world(...[SITES.rallyPoint[0], SITES.rallyPoint[2]]), null);
  for (const id of MAIN_PATH) {
    // The main quests' "reach" objectives: pass by the sites on the way.
    if (id === 'reyesLast') e.tick(DT, world(SITES.stationGate[0], SITES.stationGate[2]), null);
    if (id === 'seedStation') e.tick(DT, world(SITES.forestEdge[0], SITES.forestEdge[2]), null);
    if (id === 'sorelLab') e.tick(DT, world(SITES.instituteGate[0], SITES.instituteGate[2]), null);
    if (id === 'generatorA') e.tick(DT, world(SITES.generatorA[0], SITES.generatorA[2]), null);
    visit(e, id);
  }
  return e;
}

describe('the campaign', () => {
  it('is valid: every reference resolves, every chapter has a main quest, every race its lore', () => {
    expect(validateStory(CAMPAIGN)).toEqual([]);
    expect(CAMPAIGN.chapters).toHaveLength(5);
    expect(CAMPAIGN.endings.map((x) => x.id)).toEqual(['broadcast', 'purge', 'custodian']);
  });

  it('places every interactable on a road or pavement in its chapter’s hub', () => {
    for (const p of SITE_POINTS) expect(roadDistance(p[0], p[2]), String(p)).toBeLessThan(2);
    for (const i of CAMPAIGN.interactables) {
      expect(
        SITE_POINTS.some((p) => p[0] === i.at[0] && p[2] === i.at[2]),
        i.id,
      ).toBe(true);
    }
    const zoneOf = (id: string): string => {
      const i = CAMPAIGN.interactables.find((t) => t.id === id);
      return i === undefined ? '' : hubAt(i.at[0], i.at[2]).zone;
    };
    expect(zoneOf('generatorA')).toBe('industrial');
    expect(zoneOf('keycard')).toBe('subway');
    expect(zoneOf('seedStation')).toBe('forest');
    expect(zoneOf('coreTerminal')).toBe('researchComplex');
  });

  it('can be played through to each of its three endings, chapter by chapter', () => {
    for (const [terminal, ending] of [
      ['transmitter', 'broadcast'],
      ['incinerator', 'purge'],
      ['wardenTerminal', 'custodian'],
    ] as const) {
      const e = playToChoice();
      expect(e.chapter).toBe('source');
      expect(e.status('descent')).toBe('done');
      // The three choices exist side by side.
      for (const t of ['transmitter', 'incinerator', 'wardenTerminal'])
        expect(e.canUse(t, world(SITES.transmitter[0], SITES.transmitter[2]))).toBe(true);
      visit(e, terminal);
      expect(e.ending).toBe(ending);
      expect(e.status('core')).toBe('done');
      // After the end nothing more can be used.
      expect(e.canUse('pharmacy', world())).toBe(false);
    }
  });

  it('gates the plot: the breaker needs both generators, the core needs the keycard', () => {
    const e = new StoryEngine(CAMPAIGN);
    const w = world(SITES.mainBreaker[0], SITES.mainBreaker[2]);
    e.tick(DT, w, null);
    expect(e.canUse('mainBreaker', w)).toBe(false);
    expect(e.canUse('generatorA', w)).toBe(false); // the substation quest has not started
    expect(e.canUse('coreTerminal', w)).toBe(false);
    expect(e.canUse('keycard', w)).toBe(false); // Reyes first
  });
});

describe('the story engine', () => {
  it('starts the first quest and the intro radio on the first tick, and plays lines in order', () => {
    const e = new StoryEngine(CAMPAIGN);
    const notes = e.tick(DT, world(-72, -14, 0), null).map((n) => n.kind);
    expect(notes).toEqual(['quest', 'line']);
    expect(e.status('rally')).toBe('active');
    const lines: string[] = [];
    for (let t = 0; t < 60 * 30; t++)
      for (const n of e.tick(DT, world(-72, -14, 0), null))
        if (n.kind === 'line') lines.push(n.line.speaker);
    expect(lines).toEqual(['OVERWATCH', 'KESTREL-2']);
    expect(e.onAir).toBeNull();
  });

  it('counts kills for conditions and fires a once-trigger once', () => {
    const e = new StoryEngine(CAMPAIGN);
    e.tick(DT, world(), null);
    e.killed('zombie');
    const radioIds = (): string[] =>
      e
        .snapshot()
        .playing.filter((p) => p.source === 'radio')
        .map((p) => p.id);
    e.tick(DT, world(-72, -14, 0), null);
    expect(radioIds()).toContain('firstKill');
    e.killed('robot');
    e.tick(DT, world(-72, -14, 0), null);
    expect(e.snapshot().fired.filter((f) => f === 'firstKill')).toHaveLength(1);
    expect(e.kills.any).toBe(2);
  });

  it('evaluates every condition kind and comparison', () => {
    const data: StoryData = StorySchema.parse({
      title: 't',
      start: [{ do: 'setFlag', flag: 'a', value: 2 }],
      chapters: [
        { id: 'one', title: '1', zone: 'forest', summary: '' },
        { id: 'two', title: '2', zone: 'forest', summary: '' },
      ],
      quests: [
        {
          id: 'q',
          title: 'q',
          chapter: 'one',
          main: true,
          summary: '',
          objectives: [{ id: 'o', text: 'o' }],
          onComplete: [{ do: 'addFlag', flag: 'a', by: 1 }],
        },
      ],
      logs: [],
      radio: [],
      interactables: [],
      triggers: [],
      endings: [{ id: 'end', title: 'e', epilogue: ['x'] }],
    } satisfies StoryInput);
    const e = new StoryEngine(data);
    const w = world(-128, 140, 0.5);
    e.tick(DT, w, null);
    const h = (c: Parameters<StoryEngine['holds']>[0]): boolean => e.holds(c, w);
    for (const [op, want] of [
      ['eq', true],
      ['ne', false],
      ['gt', false],
      ['gte', true],
      ['lt', false],
      ['lte', true],
    ] as const)
      expect(h({ is: 'flag', flag: 'a', op, value: 2 }), op).toBe(want);
    expect(h({ is: 'zone', zone: 'forest' })).toBe(true);
    expect(h({ is: 'near', at: [-128, 141], radius: 2 })).toBe(true);
    expect(h({ is: 'near', at: [0, 0], radius: 2 })).toBe(false);
    expect(h({ is: 'night', min: 0.6 })).toBe(false);
    expect(h({ is: 'chapter', chapter: 'one' })).toBe(true);
    expect(h({ is: 'chapter', chapter: 'two' })).toBe(false);
    expect(h({ is: 'not', c: { is: 'log', log: 'x' } })).toBe(true);
    expect(
      h({
        is: 'any',
        of: [
          { is: 'used', interactable: 'x' },
          { is: 'kills', race: 'any', count: 1 },
        ],
      }),
    ).toBe(false);
    expect(h({ is: 'quest', quest: 'q', status: 'inactive' })).toBe(true);
    // Effects through the API: start, objective, complete → onComplete; fail does nothing once done.
    expect(e.flag('a')).toBe(2);
  });

  it('snapshots round-trip and hash identically, whatever the history (property)', () => {
    const ids = CAMPAIGN.interactables.map((i) => i.id);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...ids, null), fc.integer({ min: 0, max: 3 })), {
          maxLength: 40,
        }),
        (steps) => {
          const a = new StoryEngine(CAMPAIGN);
          for (const [use, kills] of steps) {
            const i = CAMPAIGN.interactables.find((t) => t.id === use);
            for (let k = 0; k < kills; k++) a.killed('animal');
            a.tick(0.5, i === undefined ? world() : world(i.at[0], i.at[2]), use);
          }
          const snap = a.snapshot();
          const b = new StoryEngine(CAMPAIGN);
          b.restore(structuredClone(snap));
          expect(b.snapshot()).toEqual(snap);
          const hash = (e: StoryEngine): string => {
            const h = new StateHasher();
            e.hashInto(h);
            return h.digest();
          };
          expect(hash(b)).toBe(hash(a));
          // Both continue identically.
          a.tick(1, world(), null);
          b.tick(1, world(), null);
          expect(b.snapshot()).toEqual(a.snapshot());
        },
      ),
      { numRuns: 60 },
    );
  });

  it('reports invalid stories', () => {
    const bad: StoryData = {
      ...CAMPAIGN,
      quests: CAMPAIGN.quests.map((q) =>
        q.id === 'rally' ? { ...q, onComplete: [{ do: 'startQuest', quest: 'nope' }] } : q,
      ),
      logs: CAMPAIGN.logs.filter((l) => l.id !== 'ranger'),
      triggers: [...CAMPAIGN.triggers, ...CAMPAIGN.triggers.slice(0, 1)],
    };
    const errors = validateStory(bad);
    expect(errors).toEqual(
      expect.arrayContaining([
        'quest rally: unknown quest nope',
        'duplicate trigger id dark',
        'no log tells the animals’ origin',
      ]),
    );
  });
});
