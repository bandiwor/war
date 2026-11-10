import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MobFx } from '../../src/infrastructure/render/mobs/mob-fx';
import type { Sandbox } from '../../src/application/scenes/sandbox';
import { arena, at, flashlightOff, god, place } from '../fixtures/arena';

/** Steps the sim, feeding its ranged events to the effects like the presenter does. */
function drive(sb: Sandbox, fx: MobFx, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sb.simulation.step([]);
    const ev = sb.simulation.events.mobRanged;
    for (let k = 0; k < ev.size; k++) {
      const e = ev.at(k);
      if (e) fx.ranged(e);
    }
    fx.update(1 / 60);
  }
}

describe('ranged attacks on screen', () => {
  it('a flytrap’s spit flies as a glob and leaves an acid pool you can see', () => {
    const sb = arena(20);
    sb.simulation.step([at(-10, 6)]);
    god(sb);
    const fx = new MobFx(sb);
    place(sb, 'flytrap', -10, 0, -10, 6);
    drive(sb, fx, 60 * 3);
    expect(fx.stats.globs).toBeGreaterThan(0);
    expect(fx.stats.pools).toBeGreaterThan(0);
    fx.dispose();
  });

  it('a sentry’s laser draws a beam that fades in a blink', () => {
    const sb = arena(30);
    sb.simulation.step([at(-10, 5)]);
    flashlightOff(sb);
    god(sb);
    const fx = new MobFx(sb);
    place(sb, 'sentry', -10, -2, -10, 5);
    drive(sb, fx, 60 * 6);
    expect(fx.stats.lasers).toBeGreaterThan(0);
    const beams = (): number =>
      fx.group.children.filter((c) => c.visible && !(c instanceof THREE.InstancedMesh)).length;
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    expect(beams()).toBe(0);
  });
});
