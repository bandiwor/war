import { at, defineComponent } from '../../domain/ecs/component';
import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import { World } from '../../domain/ecs/world';
import { actionBit } from '../../domain/input/commands';
import type { Seed } from '../../domain/core/brand';
import { cos, sin } from '../../domain/math/dmath';
import { generateStreetLayout, type StreetLayout } from '../../domain/world/street-layout';
import { createStimulus, type BodycamStimulus } from '../../domain/bodycam/stimulus';
import { Simulation, type SimContext } from '../simulation';
import { PlayerIntent, TICK_RATE, intentSystem } from './empty-world';

/**
 * Stage-1 sandbox: the test street, a kinematic walker (real physics arrives
 * in stage 2) and a battery-powered flashlight. Previous-tick pose is stored so
 * the renderer can interpolate between fixed steps.
 */
export const Pose = defineComponent('Pose', {
  x: 'f64',
  y: 'f64',
  z: 'f64',
  yaw: 'f64',
  pitch: 'f64',
  prevX: 'f64',
  prevY: 'f64',
  prevZ: 'f64',
  prevYaw: 'f64',
  prevPitch: 'f64',
  /** Horizontal speed m/s, for footstep bob and compression motion. */
  speed: 'f32',
  /** Distance walked, drives footstep phase. */
  stride: 'f64',
});

export const Flashlight = defineComponent('Flashlight', { on: 'u8', battery: 'f32' });

export const WALK_SPEED = 1.5;
export const SPRINT_SPEED = 3.6;
/** Seconds of continuous use from full charge. */
export const BATTERY_SECONDS = 20 * 60;

function movementSystem(player: EntityId, bounds: StreetLayout['walkBounds']): System<SimContext> {
  return {
    name: 'player.move',
    after: ['input.intent'],
    run(ctx) {
      const pose = ctx.world.store(Pose);
      const row = pose.rowOf(player);
      const intent = ctx.world.store(PlayerIntent);
      const irow = intent.rowOf(player);
      if (row < 0 || irow < 0) return;
      const p = pose.fields;
      const i = intent.fields;
      p.prevX[row] = at(p.x, row);
      p.prevY[row] = at(p.y, row);
      p.prevZ[row] = at(p.z, row);
      p.prevYaw[row] = at(p.yaw, row);
      p.prevPitch[row] = at(p.pitch, row);
      const yaw = at(i.yaw, irow);
      p.yaw[row] = yaw;
      p.pitch[row] = at(i.pitch, irow);
      let fwd = at(i.forward, irow);
      let strafe = at(i.strafe, irow);
      const len = Math.sqrt(fwd * fwd + strafe * strafe);
      if (len > 1) {
        fwd /= len;
        strafe /= len;
      }
      const sprint = (at(i.buttons, irow) & actionBit('sprint')) !== 0 && fwd > 0;
      const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
      const s = sin(yaw);
      const c = cos(yaw);
      // Three.js convention: yaw 0 looks down -Z.
      const vx = (-s * fwd + c * strafe) * speed;
      const vz = (-c * fwd - s * strafe) * speed;
      const x0 = at(p.x, row);
      const z0 = at(p.z, row);
      const x = Math.min(bounds[2], Math.max(bounds[0], x0 + vx * ctx.dt));
      const z = Math.min(bounds[3], Math.max(bounds[1], z0 + vz * ctx.dt));
      p.x[row] = x;
      p.z[row] = z;
      const moved = Math.sqrt((x - x0) * (x - x0) + (z - z0) * (z - z0));
      p.speed[row] = moved / ctx.dt;
      p.stride[row] = at(p.stride, row) + moved;
    },
  };
}

function flashlightSystem(player: EntityId): System<SimContext> {
  return {
    name: 'player.flashlight',
    after: ['input.intent'],
    run(ctx) {
      const fl = ctx.world.store(Flashlight);
      const row = fl.rowOf(player);
      const irow = ctx.world.store(PlayerIntent).rowOf(player);
      if (row < 0 || irow < 0) return;
      const f = fl.fields;
      const pressed = at(ctx.world.store(PlayerIntent).fields.pressed, irow);
      const battery = at(f.battery, row);
      if ((pressed & actionBit('flashlight')) !== 0) f.on[row] = f.on[row] === 1 ? 0 : 1;
      if (f.on[row] === 1) {
        // Snap float32 leftovers to empty so the light dies on the tick the charge runs out.
        const next = battery - ctx.dt / BATTERY_SECONDS;
        f.battery[row] = next < 1e-7 ? 0 : next;
      }
      if (at(f.battery, row) <= 0) f.on[row] = 0;
    },
  };
}

export interface Sandbox {
  readonly simulation: Simulation;
  readonly player: EntityId;
  readonly layout: StreetLayout;
}

export function createSandbox(seed: Seed): Sandbox {
  const layout = generateStreetLayout(seed);
  const world = new World();
  world.register(PlayerIntent);
  world.register(Pose);
  world.register(Flashlight);
  const player = world.spawn();
  const irow = world.store(PlayerIntent).add(player);
  world.store(PlayerIntent).fields.yaw[irow] = layout.spawn.yaw;
  const pose = world.store(Pose);
  const prow = pose.add(player);
  const [sx, sy, sz] = layout.spawn.position;
  pose.fields.x[prow] = pose.fields.prevX[prow] = sx;
  pose.fields.y[prow] = pose.fields.prevY[prow] = sy;
  pose.fields.z[prow] = pose.fields.prevZ[prow] = sz;
  pose.fields.yaw[prow] = pose.fields.prevYaw[prow] = layout.spawn.yaw;
  const fl = world.store(Flashlight);
  const frow = fl.add(player);
  fl.fields.on[frow] = 1;
  fl.fields.battery[frow] = 1;
  const simulation = new Simulation({
    seed,
    tickRate: TICK_RATE,
    world,
    systems: [
      intentSystem(player),
      movementSystem(player, layout.walkBounds),
      flashlightSystem(player),
    ],
  });
  return { simulation, player, layout };
}

/** Everything the renderer needs for one frame, interpolated. Reused, never reallocated. */
export interface RenderView {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  stride: number;
  flashlightOn: boolean;
  battery: number;
  /** Interpolated simulation time in seconds. */
  simTime: number;
  tick: number;
  stimulus: BodycamStimulus;
}

export function createRenderView(): RenderView {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    speed: 0,
    stride: 0,
    flashlightOn: false,
    battery: 0,
    simTime: 0,
    tick: 0,
    stimulus: createStimulus(),
  };
}

export function readRenderView(sandbox: Sandbox, alpha: number, out: RenderView): RenderView {
  const { simulation, player } = sandbox;
  const pose = simulation.world.store(Pose);
  const row = pose.rowOf(player);
  const a = Math.min(1, Math.max(0, alpha));
  if (row >= 0) {
    const p = pose.fields;
    const lerp = (prev: number | undefined, cur: number | undefined): number =>
      (prev ?? 0) + ((cur ?? 0) - (prev ?? 0)) * a;
    out.x = lerp(p.prevX[row], p.x[row]);
    out.y = lerp(p.prevY[row], p.y[row]);
    out.z = lerp(p.prevZ[row], p.z[row]);
    out.yaw = lerp(p.prevYaw[row], p.yaw[row]);
    out.pitch = lerp(p.prevPitch[row], p.pitch[row]);
    out.speed = at(p.speed, row);
    out.stride = at(p.stride, row);
  }
  const fl = simulation.world.store(Flashlight);
  const frow = fl.rowOf(player);
  out.flashlightOn = frow >= 0 && fl.fields.on[frow] === 1;
  out.battery = frow >= 0 ? at(fl.fields.battery, frow) : 0;
  out.tick = simulation.tick;
  out.simTime = (simulation.tick - 1 + a) / simulation.tickRate;
  if (out.simTime < 0) out.simTime = 0;
  return out;
}
