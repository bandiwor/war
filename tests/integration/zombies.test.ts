import { describe, expect, it } from 'vitest';
import type { Sandbox } from '../../src/application/scenes/sandbox';
import {
  arena,
  arenaLayout,
  at,
  flashlightOff,
  god,
  flashlightToggle,
  lamp,
  lookAt,
  place,
  player,
  run,
  state,
  walk,
} from '../fixtures/arena';

/**
 * Stage 7, zombies: no eyes, no ears. They follow the pheromone field's
 * gradient, recruit each other through the alarm they lay down (emergent
 * group behaviour, no commands), avoid lit ground and panic in the beam.
 */
const dist = (sb: Sandbox, x: number, z: number): number =>
  Math.hypot(player(sb).x - x, player(sb).z - z);

describe('zombies: the pheromone field', () => {
  it('ignore a silent player standing in the open: nothing to smell yet', () => {
    const sb = arena(1);
    run(sb, 2, [at(-10, 8)]);
    flashlightOff(sb);
    god(sb);
    const z = place(sb, 'shambler', -10, -8, -10, 8);
    run(sb, 60 * 5);
    expect(state(sb, z).sensing).toBe(false);
    expect(state(sb, z).action).not.toBe('chase');
  });

  it('follow the player’s trail around a corner, with no line of sight at any time', () => {
    const sb = arena(2);
    run(sb, 2, [at(-6, -14)]);
    flashlightOff(sb);
    god(sb);
    const z = place(sb, 'shambler', -8, -14, -20, -14);
    // Walk right past it, around the end of the wall, and up behind it.
    let crossedBelowWall = false;
    let crossedThroughWall = false;
    const track = (): void => {
      const s = state(sb, z);
      if (s.x > 0 && s.z < -10) crossedBelowWall = true;
      if (Math.abs(s.x) < 0.6 && s.z > -9.5 && s.z < 9.5) crossedThroughWall = true;
    };
    walk(
      sb,
      [
        [-6, -14],
        [6, -14],
        [6, 4],
      ],
      1.5,
      track,
    );
    for (let t = 0; t < 60 * 40; t++) {
      sb.simulation.step();
      track();
      const s = state(sb, z);
      if (dist(sb, s.x, s.z) < 2) break;
    }
    expect(crossedThroughWall).toBe(false);
    const s = state(sb, z);
    expect(dist(sb, s.x, s.z)).toBeLessThan(2.5);
    expect(crossedBelowWall).toBe(true); // it went around the wall, as the trail did
  });

  it('recruit each other: a zombie too far to smell the player follows the alarm another lays down', () => {
    const scenario = (withLeader: boolean): { aware: number; dist: number } => {
      const sb = arena(3);
      run(sb, 2, [at(-22, -24)]);
      flashlightOff(sb);
      god(sb);
      if (withLeader) place(sb, 'lurcher', -14, -20, -14, -24); // 4 m from the trail: it smells it
      const follower = place(sb, 'shambler', -14, -12, -14, 0); // 12 m away: it cannot
      let aware = 0;
      const track = (): void => {
        aware = Math.max(aware, state(sb, follower).awareness);
      };
      walk(
        sb,
        [
          [-22, -24],
          [-2, -24],
        ],
        1.4,
        track,
      );
      for (let t = 0; t < 60 * 20; t++) {
        sb.simulation.step();
        track();
      }
      const s = state(sb, follower);
      return { aware, dist: dist(sb, s.x, s.z) };
    };
    const alone = scenario(false);
    const recruited = scenario(true);
    // No commands pass between zombies: the follower only ever smells the leader's alarm.
    expect(alone.aware).toBe(0);
    expect(recruited.aware).toBeGreaterThan(0.5);
    expect(recruited.dist).toBeLessThan(alone.dist - 3);
  });
});

describe('zombies: light', () => {
  it('avoid the lit area: they stop at the edge of a lamp’s pool and wait in the dark', () => {
    const lit = arena(4, arenaLayout([lamp(18, -18)]));
    run(lit, 2, [at(-16, -24)]);
    flashlightOff(lit);
    god(lit);
    const z = place(lit, 'shambler', -9, -22, 0, -24);
    walk(
      lit,
      [
        [-16, -24],
        [18, -24],
        [18, -18],
      ],
      1.5,
    );
    // The player now stands under the lamp.
    const attacksBefore = lit.ai.stats.attacks;
    let closest = Infinity;
    for (let t = 0; t < 60 * 25; t++) {
      lit.simulation.step();
      const s = state(lit, z);
      closest = Math.min(closest, Math.hypot(s.x - 18, s.z + 18));
    }
    // Lit ground: light = 1 − d / 9.9 > 0.5 inside ~5 m of the lamp. It waits at the edge.
    expect(closest).toBeGreaterThan(4.3);
    expect(closest).toBeLessThan(7);
    expect(lit.ai.stats.attacks).toBe(attacksBefore);

    // Control: the same walk without the lamp ends with the zombie at the player.
    const dark = arena(4);
    run(dark, 2, [at(-16, -24)]);
    flashlightOff(dark);
    god(dark);
    const d = place(dark, 'shambler', -9, -22, 0, -24);
    walk(
      dark,
      [
        [-16, -24],
        [18, -24],
        [18, -18],
      ],
      1.5,
    );
    run(dark, 60 * 25);
    const s = state(dark, d);
    expect(Math.hypot(s.x - 18, s.z + 18)).toBeLessThan(2.5);
  });

  it('panic in the flashlight beam and come back when it goes off', () => {
    const sb = arena(5);
    run(sb, 2, [at(-10, -13)]);
    flashlightOff(sb);
    god(sb);
    const z = place(sb, 'shambler', -10, -8, -10, -13);
    walk(
      sb,
      [
        [-10, -13],
        [-10, -9.5], // right up to it
        [-10, -16],
      ],
      1.5,
    ); // a trail toward it, then back
    run(sb, 60 * 3);
    expect(['chase', 'attack']).toContain(state(sb, z).action);
    lookAt(sb, state(sb, z).x, state(sb, z).z);
    flashlightToggle(sb); // on, in its face
    run(sb, 20);
    expect(state(sb, z).light).toBeGreaterThan(0.3);
    expect(state(sb, z).action).toBe('flee');
    // It runs for the dark: out of the beam (sideways is as good as away; the beam only
    // protects where it points).
    run(sb, 60 * 2);
    expect(state(sb, z).light).toBeLessThan(0.25);
    flashlightToggle(sb); // off
    run(sb, 60 * 8);
    expect(['chase', 'attack', 'investigate']).toContain(state(sb, z).action);
  });
});
