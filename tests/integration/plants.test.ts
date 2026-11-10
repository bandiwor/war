import { describe, expect, it } from 'vitest';
import { Acid } from '../../src/application/ai/components';
import { SHAKE_OFF } from '../../src/application/ai/ranged-system';
import type { Sandbox } from '../../src/application/scenes/sandbox';
import { MOBS } from '../../src/domain/mobs/registry';
import { Target } from '../../src/application/combat/components';
import { arena, at, face, place, player, run, state } from '../fixtures/arena';

/**
 * Stage 7, plants: rooted flytraps bite inside their reach and spit acid at
 * what stays outside it; creepers leap, latch on and hurt until torn off.
 */
const health = (sb: Sandbox): number => player(sb).vitals.health;

describe('plants: the flytrap', () => {
  it('bites inside its reach, never moves, and spits acid at what keeps its distance', () => {
    const sb = arena(20);
    run(sb, 2, [at(-10, 6)]);
    const trap = place(sb, 'flytrap', -10, 0, -10, 6);
    run(sb, 60 * 2);
    // 6 m away: out of reach, inside its trigger zone. A spit, an acid pool where you stood.
    expect(sb.simulation.world.store(Acid).size).toBeGreaterThan(0);
    const before = health(sb);
    run(sb, 60 * 2);
    expect(health(sb)).toBeLessThan(before); // standing in the acid
    // Step out of the pool and in close: the bite.
    run(sb, 1, [{ type: 'cheat', key: 'heal', on: true }, at(-10, 2)]);
    const attacks = sb.ai.stats.attacks;
    run(sb, 60 * 3);
    expect(sb.ai.stats.attacks).toBeGreaterThan(attacks);
    const s = state(sb, trap);
    expect([s.x, s.z]).toEqual([-10, 0]);
  });

  it('acid soaks away; standing outside it does no harm', () => {
    const sb = arena(21);
    run(sb, 2, [at(-10, 7)]);
    place(sb, 'flytrap', -10, 0, -10, 7);
    run(sb, 60);
    run(sb, 1, [at(-14, 7), { type: 'cheat', key: 'heal', on: true }]); // out of the pool and out of its trigger zone
    run(sb, 1, [at(-25, 20)]);
    const before = health(sb);
    run(sb, 60 * 6);
    expect(health(sb)).toBe(before);
    expect(sb.simulation.world.store(Acid).size).toBe(0);
  });
});

describe('plants: the creeper', () => {
  it('leaps from a few metres, latches on and hurts until torn off by struggling', () => {
    const sb = arena(22);
    run(sb, 2, [at(-10, 5)]);
    const creeper = place(sb, 'creeper', -10, 0, -10, 5);
    let latched = false;
    for (let t = 0; t < 60 * 6 && !latched; t++) {
      run(sb, 1);
      latched = state(sb, creeper).attached;
    }
    expect(latched).toBe(true);
    const before = health(sb);
    run(sb, 60 * 2); // standing still: it keeps hurting
    expect(health(sb)).toBeLessThan(before - (MOBS.creeper.ranged?.damage ?? 0));
    expect(state(sb, creeper).attached).toBe(true);
    // Thrash: whip the view left and right.
    let ticks = 0;
    while (state(sb, creeper).attached && ticks < 120) {
      run(sb, 1, [{ type: 'look', yaw: ticks % 2 === 0 ? 0.6 : -0.6, pitch: 0 }]);
      ticks++;
    }
    expect(state(sb, creeper).attached).toBe(false);
    expect(ticks).toBeLessThan(Math.ceil(SHAKE_OFF / 0.6) + 4);
    expect(state(sb, creeper).stun).toBeGreaterThan(0);
    const s = state(sb, creeper);
    expect(Math.hypot(s.x - player(sb).x, s.z - player(sb).z)).toBeGreaterThan(1.5);
  });

  it('a clinging creeper that dies drops off', () => {
    const sb = arena(23);
    run(sb, 2, [at(-10, 5)]);
    const creeper = place(sb, 'creeper', -10, 0, -10, 5);
    for (let t = 0; t < 60 * 6 && !state(sb, creeper).attached; t++) run(sb, 1);
    expect(state(sb, creeper).attached).toBe(true);
    // Shot dead while clinging.
    const t = sb.simulation.world.store(Target);
    t.fields.health[t.rowOf(creeper)] = 0;
    run(sb, 30);
    expect(state(sb, creeper).attached).toBe(false);
    expect(player(sb).vitals.health).toBeGreaterThan(0);
  });

  it('does not leap from too far or too close: it walks', () => {
    const sb = arena(24);
    run(sb, 2, [at(-10, 7.5)]); // inside its 8 m nose, beyond its 6 m leap
    const creeper = place(sb, 'creeper', -10, 0, -10, 7.5);
    face(sb, creeper, -10, 7.5);
    run(sb, 30);
    expect(state(sb, creeper).attached).toBe(false);
    const leaps = sb.simulation.world.store(Acid).size; // no acid from creepers either
    expect(leaps).toBe(0);
  });
});
