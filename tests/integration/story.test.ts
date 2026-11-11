import { describe, expect, it } from 'vitest';
import { Ammo } from '../../src/application/combat/components';
import { Mob } from '../../src/application/ai/components';
import {
  Flashlight,
  Pose,
  createSandbox,
  type Sandbox,
} from '../../src/application/scenes/sandbox';
import { RACES } from '../../src/domain/combat/races';
import { RANGE } from '../../src/domain/world/range-layout';
import { WEAPON_IDS } from '../../src/domain/weapons/registry';
import { seed } from '../../src/domain/core/brand';
import { mobIndex } from '../../src/domain/mobs/registry';
import type { StoryNote } from '../../src/domain/story/engine';
import { SITES, type SiteId } from '../../src/domain/story/sites';
import { newPhysics } from '../fixtures/physics';
import { CAMPAIGN } from '../../src/domain/story/campaign';

/**
 * Stage 8 acceptance, in the real simulation: the campaign plays from the
 * first radio call to each of its three endings by walking (teleporting) to
 * the sites and pressing "use", through the same input commands a player
 * sends. Everything the story does reaches the event bus.
 */
function world(s = 8): { sb: Sandbox; notes: StoryNote[] } {
  const sb = createSandbox(seed(s), newPhysics(), { kind: 'world' });
  const notes: StoryNote[] = [];
  const step = sb.simulation.step.bind(sb.simulation);
  sb.simulation.step = (commands) => {
    step(commands);
    const ev = sb.simulation.events.story;
    for (let i = 0; i < ev.size; i++) {
      const e = ev.at(i);
      if (e) notes.push(e.note);
    }
  };
  sb.simulation.step([{ type: 'cheat', key: 'god', on: true }]);
  return { sb, notes };
}

function go(sb: Sandbox, site: SiteId, ticks = 20): void {
  const [x, y, z] = SITES[site];
  sb.simulation.step([{ type: 'teleport', x, y: y + 0.05, z }]);
  for (let i = 0; i < ticks; i++) sb.simulation.step([]);
}

function use(sb: Sandbox): void {
  sb.simulation.step([{ type: 'action', action: 'use', pressed: true }]);
  sb.simulation.step([{ type: 'action', action: 'use', pressed: false }]);
  for (let i = 0; i < 5; i++) sb.simulation.step([]);
}

const ROUTE: readonly (readonly [SiteId, boolean])[] = [
  ['rallyPoint', false],
  ['reyesCamera', true],
  ['generatorA', true],
  ['generatorB', true],
  ['mainBreaker', true],
  ['stationGate', false],
  ['reyesLast', true],
  ['keycard', true],
  ['forestEdge', false],
  ['seedStation', true],
  ['instituteGate', false],
  ['sorelLab', true],
  ['coreTerminal', true],
];

function playToTheCore(): { sb: Sandbox; notes: StoryNote[] } {
  const run = world();
  for (const [site, press] of ROUTE) {
    go(run.sb, site);
    if (press) use(run.sb);
  }
  return run;
}

describe('the campaign in the simulation', () => {
  it('opens with the first quest and Overwatch on the radio', () => {
    const { sb, notes } = world();
    for (let i = 0; i < 10; i++) sb.simulation.step([]);
    expect(notes[0]).toEqual({ kind: 'quest', quest: 'rally', status: 'active' });
    expect(notes.find((n) => n.kind === 'line')).toMatchObject({ source: 'radio', id: 'intro' });
    expect(sb.story?.engine.chapter).toBe('arrival');
  });

  it('walks every chapter to the core, and each terminal ends the story its own way', () => {
    for (const [terminal, ending] of [
      ['transmitter', 'broadcast'],
      ['incinerator', 'purge'],
      ['wardenTerminal', 'custodian'],
    ] as const) {
      const { sb, notes } = playToTheCore();
      const chapters = notes.filter((n) => n.kind === 'chapter').map((n) => n.chapter);
      expect(chapters).toEqual(['power', 'descent', 'overgrowth', 'source']);
      go(sb, terminal);
      use(sb);
      expect(sb.story?.engine.ending).toBe(ending);
      expect(notes.filter((n) => n.kind === 'ending')).toEqual([{ kind: 'ending', ending }]);
      expect(sb.story?.engine.status('core')).toBe('done');
    }
  }, 60_000);

  it('using only works in reach and when available; loot, batteries and ambushes are real', () => {
    const { sb } = world();
    // Out of reach: nothing happens.
    go(sb, 'rallyPoint');
    use(sb);
    expect(sb.story?.engine.used.size).toBe(0);
    // The corner shop: ammunition into the pouch.
    const ammo = sb.simulation.world.store(Ammo);
    const before = ammo.fields.r9x19[ammo.rowOf(sb.player)] ?? 0;
    go(sb, 'cityCache');
    use(sb);
    expect(ammo.fields.r9x19[ammo.rowOf(sb.player)]).toBe(before + 30);
    use(sb); // once only
    expect(ammo.fields.r9x19[ammo.rowOf(sb.player)]).toBe(before + 30);
    // The pharmacy: a fresh battery in the flashlight.
    const fl = sb.simulation.world.store(Flashlight);
    fl.fields.battery[fl.rowOf(sb.player)] = 0.2;
    go(sb, 'pharmacy');
    use(sb);
    expect(fl.fields.battery[fl.rowOf(sb.player)]).toBeGreaterThan(0.99);
    // The breaker is dead until both generators run.
    go(sb, 'mainBreaker');
    use(sb);
    expect(sb.story?.engine.used.has('mainBreaker')).toBe(false);
  });

  it('throwing the breaker brings the robots: the ambush spawns where the story says', () => {
    const { sb } = world();
    for (const [site, press] of ROUTE.slice(0, 5)) {
      go(sb, site);
      if (press) use(sb);
    }
    const mobs = sb.simulation.world.store(Mob);
    let sentries = 0;
    for (let r = 0; r < mobs.size; r++) if (mobs.fields.kind[r] === mobIndex('sentry')) sentries++;
    expect(sb.story?.engine.flag('power.on')).toBe(1);
    expect(sentries).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic: the same inputs give the same story and state hash', () => {
    const a = playToTheCore();
    const b = playToTheCore();
    expect(b.sb.story?.engine.snapshot()).toEqual(a.sb.story?.engine.snapshot());
    expect(b.sb.simulation.stateHash()).toBe(a.sb.simulation.stateHash());
  }, 60_000);
});

describe('the story outside the open world', () => {
  it('runs in any scene it is given, counting the player’s kills from the combat events', () => {
    // The shooting range: a rifle headshot on the 100 m zombie dummy (as in range.test.ts).
    const sb = createSandbox(seed(7), newPhysics(), { kind: 'range', story: CAMPAIGN });
    sb.simulation.step([{ type: 'select', slot: WEAPON_IDS.indexOf('rifle') }]);
    for (let i = 0; i < 90; i++) sb.simulation.step([]);
    const p = sb.simulation.world.store(Pose);
    const r = p.rowOf(sb.player);
    const ex = p.fields.x[r] ?? 0;
    const ey = (p.fields.y[r] ?? 0) + (p.fields.eye[r] ?? 0);
    const ez = p.fields.z[r] ?? 0;
    const [x, y, z] = [RANGE.laneX[RACES.indexOf('zombie')] ?? 0, 1.62, 100];
    sb.simulation.step([
      {
        type: 'look',
        yaw: Math.atan2(-(x - ex), -(z - ez)) - (p.fields.yaw[r] ?? 0),
        pitch: Math.atan2(y - ey, Math.hypot(x - ex, z - ez)) - (p.fields.pitch[r] ?? 0),
      },
      { type: 'action', action: 'aim', pressed: true },
    ]);
    sb.simulation.step([{ type: 'action', action: 'fire', pressed: true }]);
    sb.simulation.step([{ type: 'action', action: 'fire', pressed: false }]);
    for (let i = 0; i < 60; i++) sb.simulation.step([]);
    expect(sb.story?.engine.kills.zombie).toBe(1);
    expect(sb.story?.engine.kills.any).toBe(1);
    // No world clock here: the story treats it as night.
    expect(sb.story?.view.night).toBe(1);
  }, 30_000);
});
