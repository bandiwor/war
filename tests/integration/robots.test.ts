import { describe, expect, it } from 'vitest';
import type { Sandbox } from '../../src/application/scenes/sandbox';
import { Mob } from '../../src/application/ai/components';
import { Hazard } from '../../src/application/combat/components';
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
  player,
  run,
  state,
} from '../fixtures/arena';

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
    run(sb, 2, [at(-10, 5)]);
    // Flashlight off: in its lens it would blind the camera. Unlit, it sees you to ~8 m.
    flashlightOff(sb);
    const sentry = place(sb, 'sentry', -10, -2, -10, 5);
    run(sb, 10);
    expect(state(sb, sentry).sensing).toBe(true);
    const { shots, hits } = lasers(sb, 60 * 4);
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

describe('robots: the network', () => {
  it('one robot sees you, the others in range know where you are; one out of range does not', () => {
    const sb = arena(32);
    run(sb, 2, [at(-10, 10)]);
    const seer = place(sb, 'sentry', -10, -2, -10, 10);
    const near = place(sb, 'stalker', 10, 0, 20, 0); // behind the wall, looking away
    face(sb, near, 25, 0);
    run(sb, 30);
    expect(state(sb, seer).sensing).toBe(true);
    expect(state(sb, near).sensing).toBe(false);
    expect(state(sb, near).informed).toBe(true);
    expect(state(sb, near).hasLast).toBe(true);
  });
});

describe('robots: tactics', () => {
  it('several engaged robots flank: they close in from different sides', () => {
    const sb = arena(33);
    run(sb, 2, [at(-15, 15)]);
    god(sb);
    const robots = [
      place(sb, 'sentry', -15, -5, -15, 15),
      place(sb, 'sentry', -13, -6, -15, 15),
      place(sb, 'sentry', -17, -6, -15, 15),
    ];
    run(sb, 60 * 10);
    const angles = robots.map((r) => {
      const s = state(sb, r);
      return Math.atan2(s.x + 15, s.z - 15);
    });
    let spread = 0;
    for (const a of angles)
      for (const b of angles)
        spread = Math.max(spread, Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))));
    expect(spread).toBeGreaterThan(1.5); // ~86°: not one queue
  });

  it('hurt, a robot takes cover where you cannot see it', () => {
    const sb = arena(34);
    run(sb, 2, [at(-10, 12)]);
    god(sb);
    const sentry = place(sb, 'sentry', -4, 2, -10, 12); // near the wall's end: cover close by
    run(sb, 30);
    hit(sb, sentry, 180); // badly hurt
    run(sb, 60 * 12);
    // From the player's eyes, something solid now stands between them and the robot.
    const s = state(sb, sentry);
    const p = player(sb);
    const dx = s.x - p.x;
    const dy = 1 - p.y;
    const dz = s.z - p.z;
    const len = Math.hypot(dx, dy, dz);
    const ray = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
    const blocked = sb.physics.raycast(
      { x: p.x, y: p.y, z: p.z },
      { x: dx / len, y: dy / len, z: dz / len },
      len,
      ray,
    );
    expect(blocked && ray.distance < len - 0.4).toBe(true);
  });

  it('calls in reinforcements once, and they arrive out of sight knowing where you are', () => {
    const sb = arena(35);
    run(sb, 2, [at(-10, 10)]);
    god(sb);
    place(sb, 'sentry', -10, -2, -10, 10);
    const count = (): number => sb.simulation.world.store(Mob).size;
    run(sb, 60 * 2);
    expect(count()).toBe(1);
    run(sb, 60 * 4);
    expect(count()).toBe(3); // MOBS.sentry.tactics.reinforce = 2
    run(sb, 60 * 8);
    expect(count()).toBe(3); // called once
  });
});

describe('robots: cameras can be beaten', () => {
  it('the flashlight in its lens blinds it: no sight, no laser, for a few seconds', () => {
    const sb = arena(36);
    run(sb, 2, [at(-10, 6)]);
    flashlightOff(sb);
    god(sb);
    const sentry = place(sb, 'sentry', -10, -1, -10, 6);
    lookAt(sb, -10, -1);
    flashlightToggle(sb); // into its lens, 7 m away
    run(sb, 10);
    expect(state(sb, sentry).blind).toBeGreaterThan(0);
    expect(state(sb, sentry).sensing).toBe(false);
    flashlightToggle(sb);
    expect(lasers(sb, 60 * 2).shots).toBe(0);
    run(sb, 60 * 2);
    expect(state(sb, sentry).blind).toBe(0);
  });

  it('approached from behind, it notices nothing', () => {
    const sb = arena(37);
    run(sb, 2, [at(-10, 12)]);
    const sentry = place(sb, 'sentry', -10, 0, -10, -20); // looking away
    run(sb, 1, [at(-10, 3)]);
    run(sb, 60 * 2);
    expect(state(sb, sentry).sensing).toBe(false);
  });

  it('a lit flare in its view draws it: deceived', () => {
    const sb = arena(38);
    run(sb, 2, [at(20, 20)]);
    flashlightOff(sb);
    const sentry = place(sb, 'sentry', -10, 0, -10, -20);
    flare(sb, -10, -12);
    run(sb, 60 * 6);
    const s = state(sb, sentry);
    expect(s.sensing).toBe(false);
    expect(Math.hypot(s.x + 10, s.z + 12)).toBeLessThan(6);
  });

  it('their radio interference breaks up the bodycam picture close by', () => {
    const sb = arena(39);
    run(sb, 2, [at(-10, 4)]);
    god(sb);
    place(sb, 'sentry', -10, 0, -10, -20);
    run(sb, 10);
    expect(player(sb).vitals.emi).toBeGreaterThan(0.4);
    expect(player(sb).stimulus.emi).toBeGreaterThan(0.4);
  });
});

function flare(sb: Sandbox, x: number, z: number): void {
  const h = sb.simulation.world.store(Hazard);
  const e = sb.simulation.world.spawn();
  const r = h.add(e);
  h.fields.x[r] = x;
  h.fields.z[r] = z;
  h.fields.kind[r] = 0;
  h.fields.radius[r] = 6;
  h.fields.remaining[r] = 60;
}
