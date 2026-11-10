import { describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/infrastructure/audio/audio-engine';
import { MobAudio } from '../../src/infrastructure/audio/mob-audio';
import { AiOverlay } from '../../src/infrastructure/render/mobs/ai-overlay';
import { MobRenderer } from '../../src/infrastructure/render/mobs/mob-renderer';
import type { Sandbox } from '../../src/application/scenes/sandbox';
import { Mob } from '../../src/application/ai/components';
import { Target } from '../../src/application/combat/components';
import { arena, at, god, place, run, walk } from '../fixtures/arena';

/** Records what would be played (the Web Audio graph itself is covered by e2e). */
function fakeEngine(): { engine: AudioEngine; played: string[] } {
  const played: string[] = [];
  const fake = {
    context: { sampleRate: 8000 },
    toBuffer: (s: Float32Array) => ({ length: s.length }),
    playAt: (b: { length: number }) => played.push(`at:${String(b.length)}`),
    playLocal: (b: { length: number }) => played.push(`local:${String(b.length)}`),
  };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- structural test double for the browser-bound engine
  return { engine: fake as unknown as AudioEngine, played };
}

function busy(): Sandbox {
  const sb = arena(40);
  run(sb, 2, [at(-10, 6)]);
  god(sb);
  place(sb, 'shambler', -14, 2, -10, 6);
  place(sb, 'sentry', -10, -2, -10, 6);
  place(sb, 'flytrap', -6, 6, -10, 6);
  place(sb, 'creeper', -10, 10, -10, 6);
  place(sb, 'wolf', -16, 8, -10, 6);
  place(sb, 'boar', 10, 10, -10, 6);
  return sb;
}

describe('mob presentation', () => {
  it('voices: attacks, ranged attacks, ambient calls and radio static reach the engine', () => {
    const sb = busy();
    const { engine, played } = fakeEngine();
    const audio = new MobAudio(engine, 1);
    audio.listener.x = -10;
    audio.listener.z = 6;
    walk(
      sb,
      [
        [-10, 6],
        [-10, 3],
        [-12, 6],
      ],
      1.5,
      () => {
        audio.consume(sb.simulation.events);
        audio.update(sb, 1 / 60);
      },
    );
    for (let i = 0; i < 60 * 4; i++) {
      sb.simulation.step([]);
      audio.consume(sb.simulation.events);
      audio.update(sb, 1 / 60);
      audio.interference(0.8, 1 / 60);
    }
    audio.interference(0, 1 / 60);
    expect(audio.played).toBe(played.length);
    expect(played.some((p) => p.startsWith('local:'))).toBe(true);
    expect(played.filter((p) => p.startsWith('at:')).length).toBeGreaterThan(5);
  });

  it('the renderer poses every mob, pools models and releases the dead and gone', () => {
    const sb = busy();
    const r = new MobRenderer(sb);
    const warm = r.warmupModels();
    r.releaseWarmup(warm);
    r.update(0.5, 1 / 60, 0);
    expect(r.visible).toBe(6);
    run(sb, 60 * 2);
    r.update(1, 1 / 60, 2);
    let moved = false;
    r.group.traverse((o) => {
      if (o.name === 'head' && o.rotation.x !== 0) moved = true;
    });
    expect(moved).toBe(true);
    // A kill: the body falls (die pose), then leaves the simulation and its model goes back to the pool.
    const tg = sb.simulation.world.store(Target);
    const victim = tg.dense[0] ?? 0;
    tg.fields.health[0] = 0;
    tg.fields.hits[0] = (tg.fields.hits[0] ?? 0) + 1;
    run(sb, 30);
    r.update(1, 1 / 60, 3);
    run(sb, 60 * 30);
    r.update(1, 1 / 60, 40);
    // (The sentry called reinforcements meanwhile: one model per mob still alive, none for the dead.)
    const mobs = sb.simulation.world.store(Mob);
    expect(mobs.dense.slice(0, mobs.size)).not.toContain(victim);
    expect(r.visible).toBe(mobs.size);
    r.dispose();
  });

  it('the AI overlay draws senses, paths, the nav grid, the pheromone field and the light map', () => {
    const sb = busy();
    walk(
      sb,
      [
        [-10, 6],
        [-10, 0],
        [-14, 0],
      ],
      2,
    );
    const o = new AiOverlay(sb);
    o.update(-14, 0);
    expect(o.group.visible).toBe(false);
    o.options.cones = o.options.paths = o.options.nav = o.options.scent = o.options.light = true;
    o.update(-14, 0);
    expect(o.group.visible).toBe(true);
    expect(o.stats.segments).toBeGreaterThan(0);
    expect(o.stats.points).toBeGreaterThan(33 * 33); // the nav grid plus scent and light samples
    o.dispose();
  });
});
