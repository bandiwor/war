import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayInput } from '../../src/application/replay/replay-input';
import { ReplayRecorder, formatReplay, parseReplay, playReplay, type Replay } from '../../src/application/replay/replay';
import { createEmptyWorld } from '../../src/application/scenes/empty-world';
import { createRenderView, createSandbox, readRenderView, type Sandbox } from '../../src/application/scenes/sandbox';
import { seed } from '../../src/domain/core/brand';
import type { InputCommand } from '../../src/domain/input/commands';
import { STREET } from '../../src/domain/world/street-layout';
import type { SurfaceId } from '../../src/domain/world/surfaces';
import { newPhysics } from '../fixtures/physics';

/**
 * Stage-2 acceptance: a golden replay of the physics sandbox. The route below
 * is recorded once (npm run golden:update) into a replay file; afterwards the
 * file is the source of truth and every hash checkpoint (ECS + RNG + Rapier
 * snapshot) must match on playback. Semantic assertions check that what the
 * route is meant to exercise actually happened.
 */
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const FILE = fileURLToPath(new URL('replays/sandbox-route.replay.json', import.meta.url));
const SEED = 1337;

type Step = readonly [seconds: number, commands: InputCommand[]];
const look = (yaw: number): InputCommand => ({ type: 'look', yaw, pitch: 0 });
const press = (action: 'jump' | 'crouch' | 'sprint' | 'flashlight', pressed: boolean): InputCommand => ({ type: 'action', action, pressed });
const move = (forward: number, strafe = 0): InputCommand => ({ type: 'move', forward, strafe });

/** Yaw deltas from the spawn yaw (PI = facing +Z). */
const ROUTE: readonly Step[] = [
  [2, [move(1)]], // walk up the road
  [0.5, [look(Math.PI / 2), move(0)]], // turn to face +X (yaw PI -> 3PI/2 ≡ -PI/2)
  [4, [move(1)]], // cross to the curb and step up onto the sidewalk
  [1.5, [press('jump', true)]], // jump on the sidewalk
  [0.1, [press('jump', false), look(Math.PI / 2)]], // face +Z (north) along the facades
  [2, [press('crouch', true), move(1)]], // crouch-walk
  [0.5, [press('crouch', false)]],
  [3.5, [press('sprint', true)]], // sprint (may brush lamp posts and props)
  [0.5, [press('sprint', false), press('flashlight', true), move(0)]],
  [0.2, [press('flashlight', false)]],
  [0.3, [press('flashlight', true), look(Math.PI / 2)]], // light back on, face -X (back to the road)
  [0.1, [press('flashlight', false)]],
  [4, [move(1)]], // step down off the curb back onto the asphalt
  [1.8, [move(0)]], // settle; total 21 s so the last checkpoint is the final tick
];

function routeCommands(): InputCommand[][] {
  const ticks: InputCommand[][] = [];
  for (const [seconds, cmds] of ROUTE) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) ticks.push(i === 0 ? cmds : []);
  }
  return ticks;
}

function record(): Replay {
  const sb = createSandbox(seed(SEED), newPhysics());
  const rec = new ReplayRecorder('sandbox', seed(SEED), sb.simulation.tickRate, 60);
  for (const cmds of routeCommands()) {
    rec.record(sb.simulation.tick, cmds);
    sb.simulation.step(cmds);
    rec.afterStep(sb.simulation);
  }
  return rec.finish();
}

if (UPDATE) writeFileSync(FILE, formatReplay(record()));

interface Trace {
  surfaces: Set<SurfaceId>;
  footsteps: number;
  jumps: number;
  lands: number;
  maxEye: number;
  minEyeGrounded: number;
  maxX: number;
  onSidewalk: boolean;
  flashlightOff: boolean;
}

/** Plays the file through the same input path the browser uses, tracing behaviour. */
function trace(replay: Replay): { sb: Sandbox; t: Trace } {
  const sb = createSandbox(seed(replay.seed), newPhysics());
  const input = new ReplayInput(replay);
  const v = createRenderView();
  const t: Trace = { surfaces: new Set(), footsteps: 0, jumps: 0, lands: 0, maxEye: 0, minEyeGrounded: Infinity, maxX: -Infinity, onSidewalk: false, flashlightOff: false };
  for (let i = 0; i < replay.length; i++) {
    sb.simulation.step(input.commandsFor(sb.simulation.tick));
    const e = sb.simulation.events;
    for (let k = 0; k < e.footstep.size; k++) {
      const f = e.footstep.at(k);
      if (f) t.surfaces.add(f.surface);
    }
    t.footsteps += e.footstep.size;
    t.jumps += e.jump.size;
    t.lands += e.land.size;
    readRenderView(sb, 1, v);
    t.maxEye = Math.max(t.maxEye, v.y);
    if (v.grounded) t.minEyeGrounded = Math.min(t.minEyeGrounded, v.y);
    t.maxX = Math.max(t.maxX, v.x);
    if (v.grounded && Math.abs(v.y - (STREET.curbHeight + 1.7)) < 0.03 && v.x > STREET.roadHalfWidth) t.onSidewalk = true;
    if (!v.flashlightOn) t.flashlightOff = true;
  }
  return { sb, t };
}

describe('golden sandbox replay (stage 2 acceptance)', () => {
  const replay = parseReplay(JSON.parse(readFileSync(FILE, 'utf8')));

  it('is a v2 sandbox replay of the expected route', () => {
    expect(replay.scene).toBe('sandbox');
    expect(replay.length).toBe(routeCommands().length);
    expect(replay.length % 60).toBe(0);
    expect(replay.checkpoints.length).toBeGreaterThanOrEqual(20);
  });

  it('plays back with every checkpoint matching (ECS + RNG + physics)', () => {
    const result = playReplay(replay, (s) => createSandbox(s, newPhysics()).simulation);
    expect(result.divergence).toBeNull();
    expect(result.finalHash).toBe(replay.checkpoints.at(-1)?.hash);
  });

  it('exercises the controller as intended', () => {
    const { sb, t } = trace(replay);
    expect(t.onSidewalk).toBe(true); // stepped up the 15 cm curb
    expect(t.surfaces).toEqual(new Set(['asphalt', 'concrete']));
    expect(t.footsteps).toBeGreaterThan(20);
    expect(t.jumps).toBe(1);
    expect(t.lands).toBe(1);
    expect(t.minEyeGrounded).toBeLessThan(1.25); // crouched
    expect(t.maxX).toBeLessThan(STREET.roadHalfWidth + STREET.sidewalkWidth + 3); // never through a facade or blocker
    expect(t.flashlightOff).toBe(true);
    const end = readRenderView(sb, 1, createRenderView());
    expect(end.flashlightOn).toBe(true);
    expect(end.y).toBeCloseTo(1.7, 1); // back on the road
  });
});

describe('legacy v1 replay (migration fixture, never regenerated)', () => {
  it('migrates and still plays back on the empty world', () => {
    const legacy = parseReplay(JSON.parse(readFileSync(fileURLToPath(new URL('replays/legacy-v1-empty.replay.json', import.meta.url)), 'utf8')));
    expect(legacy.scene).toBe('empty');
    const result = playReplay(legacy, (s) => createEmptyWorld(s).simulation);
    expect(result.ticks).toBe(legacy.length);
  });
});
