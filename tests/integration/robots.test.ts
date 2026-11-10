import { describe, expect, it } from 'vitest';
import type { Sandbox } from '../../src/application/scenes/sandbox';
import { arena, at, face, place, player, run, state } from '../fixtures/arena';

/** Stage 7, robots: cameras, lasers, the network, flanking, cover, reinforcements. */
const lasers = (sb: Sandbox, ticks: number): { shots: number; hits: number } => {
  let shots = 0;
  let hits = 0;
  for (let t = 0; t < ticks; t++) {
    run(sb, 1);
    const ev = sb.simulation.events.mobRanged;
    for (let i = 0; i < ev.size; i++) {
      const e = ev.at(i);
      if (e?.kind !== 0) continue;
      shots++;
      if (e.hit) hits++;
    }
  }
  return { shots, hits };
};

describe('robots: the laser', () => {
  it('fires down a clear line at what its camera sees, within range', () => {
    const sb = arena(30);
    run(sb, 2, [at(-10, 10)]);
    const sentry = place(sb, 'sentry', -10, -2, -10, 10);
    const { shots, hits } = lasers(sb, 60 * 4);
    expect(state(sb, sentry).sensing).toBe(true);
    expect(shots).toBeGreaterThan(0);
    expect(hits).toBe(shots);
    expect(player(sb).vitals.health).toBeLessThan(100);
  });

  it('does not fire through a wall or at what it cannot see', () => {
    const sb = arena(31);
    run(sb, 2, [at(8, 0)]); // behind the wall from the robot
    const sentry = place(sb, 'sentry', -8, 0, 8, 0);
    face(sb, sentry, 8, 0);
    expect(lasers(sb, 60 * 3).shots).toBe(0);
  });
});
