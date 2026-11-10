import { describe, expect, it } from 'vitest';
import { Mob } from '../../src/application/ai/components';
import type { Sandbox } from '../../src/application/scenes/sandbox';
import type { EntityId } from '../../src/domain/ecs/entity';
import type { MobId } from '../../src/domain/mobs/registry';
import {
  arena,
  at,
  face,
  flashlightOff,
  flashlightToggle,
  god,
  hit,
  lookAt,
  place,
  run,
  state,
} from '../fixtures/arena';

/**
 * Stage 7, animals: hunger, fear and aggression, territory, packs. They do
 * not always attack first, and they do not all react the same way.
 */
function set(sb: Sandbox, e: EntityId, fields: Partial<Record<'hunger' | 'pack', number>>): void {
  const m = sb.simulation.world.store(Mob);
  const r = m.rowOf(e);
  if (fields.hunger !== undefined) m.fields.hunger[r] = fields.hunger;
  if (fields.pack !== undefined) m.fields.pack[r] = fields.pack;
}

function pack(
  sb: Sandbox,
  id: MobId,
  spots: readonly (readonly [number, number])[],
  hunger: number,
  look: readonly [number, number],
): EntityId[] {
  return spots.map(([x, z]) => {
    const e = place(sb, id, x, z, look[0], look[1]);
    set(sb, e, { hunger, pack: 7 });
    return e;
  });
}

const attacksOn = (sb: Sandbox, ticks: number): number => {
  const before = sb.ai.stats.attacks;
  run(sb, ticks);
  return sb.ai.stats.attacks - before;
};

describe('animals: territory', () => {
  it('a boar ignores you far off, warns at the edge of its ground and charges inside it', () => {
    const sb = arena(10);
    run(sb, 2, [at(-20, 22)]);
    god(sb);
    const boar = place(sb, 'boar', -20, 0, -20, 22); // home at (−20, 0), territory 9 m
    set(sb, boar, { hunger: 0.1 });
    run(sb, 60 * 2);
    expect(['idle', 'wander', 'home']).toContain(state(sb, boar).action);
    // Looking at you from 12 m: the edge of its ground.
    run(sb, 1, [at(-20, 12)]);
    face(sb, boar, -20, 12);
    run(sb, 60 * 2);
    expect(state(sb, boar).action).toBe('warn');
    expect(attacksOn(sb, 60 * 3)).toBe(0);
    run(sb, 1, [at(-20, 4)]); // inside
    expect(attacksOn(sb, 60 * 6)).toBeGreaterThan(0);
  });
});

describe('animals: hunger, packs, fear', () => {
  it('a fed lone wolf does not attack first; a hungry pack does', () => {
    const fed = arena(11);
    run(fed, 2, [at(-20, 8)]);
    god(fed);
    const lone = place(fed, 'wolf', -20, 0, -20, 8);
    set(fed, lone, { hunger: 0.05 });
    expect(attacksOn(fed, 60 * 10)).toBe(0);
    expect(state(fed, lone).sensing).toBe(true);

    const hungry = arena(11);
    run(hungry, 2, [at(-20, 8)]);
    god(hungry);
    pack(
      hungry,
      'wolf',
      [
        [-20, 0],
        [-18, -1],
        [-22, -1],
      ],
      0.9,
      [-20, 8],
    );
    expect(attacksOn(hungry, 60 * 10)).toBeGreaterThan(0);
  });

  it('a packmate that sees you tells the others, even those behind a wall', () => {
    const sb = arena(12);
    run(sb, 2, [at(-6, 14)]);
    god(sb);
    // The second wolf stands behind the wall (x = 0) and faces away: it cannot sense you.
    const [seer, hidden] = pack(
      sb,
      'wolf',
      [
        [-6, 4],
        [6, 4],
      ],
      0.9,
      [-6, 14],
    );
    if (seer === undefined || hidden === undefined) throw new Error('no pack');
    face(sb, hidden, 20, 4);
    run(sb, 60);
    expect(state(sb, seer).sensing).toBe(true);
    const h = state(sb, hidden);
    expect(h.sensing).toBe(false);
    expect(h.hasLast).toBe(true);
    expect(h.awareness).toBeGreaterThanOrEqual(0.6);
  });

  it('shot, a fed lone wolf runs; a hungry pack wolf turns on you', () => {
    const scenario = (packed: boolean): string => {
      const sb = arena(13);
      run(sb, 2, [at(-20, 8)]);
      god(sb);
      const spots: (readonly [number, number])[] = packed
        ? [
            [-20, 0],
            [-18, -1],
            [-22, -1],
          ]
        : [[-20, 0]];
      const [wolf] = pack(sb, 'wolf', spots, packed ? 0.9 : 0.05, [-20, 8]);
      if (wolf === undefined) throw new Error('no wolf');
      run(sb, 30);
      hit(sb, wolf, 30);
      run(sb, 45);
      return state(sb, wolf).action;
    };
    expect(scenario(false)).toBe('flee');
    expect(['chase', 'attack']).toContain(scenario(true));
  });

  it('the flashlight in a lone wolf’s eyes frightens it off', () => {
    const sb = arena(14);
    run(sb, 2, [at(-20, 8)]);
    flashlightOff(sb);
    god(sb);
    const wolf = place(sb, 'wolf', -20, 0, -20, 8);
    set(sb, wolf, { hunger: 0.6 });
    run(sb, 60);
    lookAt(sb, -20, 0);
    flashlightToggle(sb);
    let fled = false;
    for (let t = 0; t < 60 * 3; t++) {
      run(sb, 1);
      if (state(sb, wolf).action === 'flee') fled = true;
    }
    expect(state(sb, wolf).fear).toBeGreaterThan(0.2);
    expect(fled).toBe(true);
  });
});
