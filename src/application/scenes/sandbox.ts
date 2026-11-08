import { at, defineComponent } from '../../domain/ecs/component';
import type { EntityId } from '../../domain/ecs/entity';
import type { System } from '../../domain/ecs/schedule';
import { World } from '../../domain/ecs/world';
import { actionBit } from '../../domain/input/commands';
import type { Seed } from '../../domain/core/brand';
import { generateStreetLayout, type StreetLayout } from '../../domain/world/street-layout';
import { createStimulus, type BodycamStimulus } from '../../domain/bodycam/stimulus';
import { surfaceAcoustics, type SurfaceId } from '../../domain/world/surfaces';
import {
  applyFeedback,
  createMotorOutput,
  createMotorState,
  eyeHeight,
  stepMotor,
  type Landing,
  type MotorFeedback,
  type MotorInput,
} from '../../domain/player/movement';
import { PLAYER_TUNING, type PlayerTuning } from '../../domain/player/tuning';
import { Simulation, type SimContext } from '../simulation';
import type { CharacterId, CharacterMove, PhysicsPort, Point } from '../physics/ports';
import { buildStaticColliders } from '../physics/static-world';
import { PlayerIntent, TICK_RATE, intentSystem } from './empty-world';

/**
 * Stage-2 sandbox: the test street with Rapier collision, a first-person
 * motor (walk/sprint/crouch/jump, stamina), footstep and landing events per
 * surface, and a battery flashlight. Pose keeps the previous tick so the
 * renderer can interpolate.
 */
export const Pose = defineComponent('Pose', {
  /** Feet position. */
  x: 'f64',
  y: 'f64',
  z: 'f64',
  /** Eye height above the feet (drops when crouching). */
  eye: 'f64',
  yaw: 'f64',
  pitch: 'f64',
  prevX: 'f64',
  prevY: 'f64',
  prevZ: 'f64',
  prevEye: 'f64',
  prevYaw: 'f64',
  prevPitch: 'f64',
  /** Horizontal speed m/s. */
  speed: 'f64',
  /** Distance walked on the ground, drives footstep/bob phase. */
  stride: 'f64',
});

export const Motor = defineComponent('Motor', {
  vx: 'f64',
  vy: 'f64',
  vz: 'f64',
  grounded: 'u8',
  crouch: 'f64',
  stamina: 'f64',
  ceilingBlocked: 'u8',
  airTime: 'f64',
  /** Stride distance at which the next footstep sounds. */
  nextStep: 'f64',
  foot: 'u8',
  sprinting: 'u8',
  character: 'u32',
});

export const Flashlight = defineComponent('Flashlight', { on: 'u8', battery: 'f32' });

/** Seconds of continuous use from full charge. */
export const BATTERY_SECONDS = 20 * 60;
/** Landings slower than this are silent. */
const LAND_EVENT_SPEED = 1.2;

function motorSystem(player: EntityId, physics: PhysicsPort, t: PlayerTuning): System<SimContext> {
  // Scratch objects reused every tick: the motor loop allocates nothing.
  const state = createMotorState();
  const input: MotorInput = {
    forward: 0,
    strafe: 0,
    yaw: 0,
    sprint: false,
    crouch: false,
    jumpPressed: false,
  };
  const out = createMotorOutput();
  const move: CharacterMove = { dx: 0, dy: 0, dz: 0, grounded: false };
  const feedback: MotorFeedback = { dx: 0, dy: 0, dz: 0, grounded: false, heightApplied: true };
  const landing: Landing = { landed: false, impactSpeed: 0 };
  const feet: Point = { x: 0, y: 0, z: 0 };
  const SPRINT = actionBit('sprint');
  const CROUCH = actionBit('crouch');
  const JUMP = actionBit('jump');

  return {
    name: 'player.motor',
    after: ['input.intent'],
    run(ctx) {
      const motor = ctx.world.store(Motor);
      const row = motor.rowOf(player);
      const intent = ctx.world.store(PlayerIntent);
      const irow = intent.rowOf(player);
      if (row < 0 || irow < 0) return;
      const m = motor.fields;
      const i = intent.fields;
      const id = characterId(at(m.character, row));

      state.vx = at(m.vx, row);
      state.vy = at(m.vy, row);
      state.vz = at(m.vz, row);
      state.grounded = m.grounded[row] === 1;
      state.crouch = at(m.crouch, row);
      state.stamina = at(m.stamina, row);
      state.ceilingBlocked = m.ceilingBlocked[row] === 1;
      state.airTime = at(m.airTime, row);

      const buttons = at(i.buttons, irow);
      input.forward = at(i.forward, irow);
      input.strafe = at(i.strafe, irow);
      input.yaw = at(i.yaw, irow);
      input.sprint = (buttons & SPRINT) !== 0;
      input.crouch = (buttons & CROUCH) !== 0;
      input.jumpPressed = (at(i.pressed, irow) & JUMP) !== 0;

      stepMotor(state, input, t, ctx.dt, out);
      feedback.heightApplied = physics.setCharacterHeight(id, out.height);
      physics.moveCharacter(id, out.dx, out.dy, out.dz, move);
      feedback.dx = move.dx;
      feedback.dy = move.dy;
      feedback.dz = move.dz;
      feedback.grounded = move.grounded;
      applyFeedback(state, feedback, out.dy, ctx.dt, landing);

      if (out.jumped || landing.landed) {
        physics.characterFeet(id, feet);
        const surface = physics.surfaceBelow(id) ?? 'concrete';
        if (out.jumped) {
          const e = ctx.events.jump.emit();
          e.x = feet.x;
          e.y = feet.y;
          e.z = feet.z;
          e.surface = surface;
        }
        if (landing.landed && landing.impactSpeed > LAND_EVENT_SPEED) {
          const e = ctx.events.land.emit();
          e.x = feet.x;
          e.y = feet.y;
          e.z = feet.z;
          e.surface = surface;
          e.impactSpeed = landing.impactSpeed;
          e.noiseRadius =
            t.footstepNoise.sprint *
            Math.min(2, landing.impactSpeed / 4) *
            surfaceAcoustics(surface).loudness;
        }
      }

      m.vx[row] = state.vx;
      m.vy[row] = state.vy;
      m.vz[row] = state.vz;
      m.grounded[row] = state.grounded ? 1 : 0;
      m.crouch[row] = state.crouch;
      m.stamina[row] = state.stamina;
      m.ceilingBlocked[row] = state.ceilingBlocked ? 1 : 0;
      m.airTime[row] = state.airTime;
      m.sprinting[row] = out.sprinting ? 1 : 0;
    },
  };
}

function physicsStepSystem(physics: PhysicsPort): System<SimContext> {
  return {
    name: 'physics.step',
    after: ['player.motor'],
    run(ctx) {
      physics.step(ctx.dt);
    },
  };
}

/** Copies the physics result into Pose and turns walked distance into footsteps. */
function poseSystem(player: EntityId, physics: PhysicsPort, t: PlayerTuning): System<SimContext> {
  const feet: Point = { x: 0, y: 0, z: 0 };
  return {
    name: 'player.pose',
    after: ['physics.step'],
    run(ctx) {
      const pose = ctx.world.store(Pose);
      const row = pose.rowOf(player);
      const motor = ctx.world.store(Motor);
      const mrow = motor.rowOf(player);
      const irow = ctx.world.store(PlayerIntent).rowOf(player);
      if (row < 0 || mrow < 0 || irow < 0) return;
      const p = pose.fields;
      const m = motor.fields;
      const i = ctx.world.store(PlayerIntent).fields;
      p.prevX[row] = at(p.x, row);
      p.prevY[row] = at(p.y, row);
      p.prevZ[row] = at(p.z, row);
      p.prevEye[row] = at(p.eye, row);
      p.prevYaw[row] = at(p.yaw, row);
      p.prevPitch[row] = at(p.pitch, row);

      physics.characterFeet(characterId(at(m.character, mrow)), feet);
      const dx = feet.x - at(p.x, row);
      const dz = feet.z - at(p.z, row);
      const moved = Math.sqrt(dx * dx + dz * dz);
      p.x[row] = feet.x;
      p.y[row] = feet.y;
      p.z[row] = feet.z;
      const crouch = at(m.crouch, mrow);
      p.eye[row] = eyeHeight(t, crouch);
      p.yaw[row] = at(i.yaw, irow);
      p.pitch[row] = at(i.pitch, irow);
      p.speed[row] = moved / ctx.dt;

      if (m.grounded[mrow] !== 1) return;
      const stride = at(p.stride, row) + moved;
      p.stride[row] = stride;
      if (stride < at(m.nextStep, mrow)) return;

      const sprinting = m.sprinting[mrow] === 1;
      const crouched = crouch > 0.5;
      const gait = sprinting ? 'sprint' : crouched ? 'crouch' : 'walk';
      m.nextStep[mrow] = stride + t.stepLength[gait];
      const surface: SurfaceId =
        physics.surfaceBelow(characterId(at(m.character, mrow))) ?? 'concrete';
      const foot = m.foot[mrow] === 1 ? 1 : 0;
      m.foot[mrow] = foot === 1 ? 0 : 1;
      const e = ctx.events.footstep.emit();
      e.x = feet.x;
      e.y = feet.y;
      e.z = feet.z;
      e.surface = surface;
      e.foot = foot;
      e.intensity = sprinting ? 1 : crouched ? 0.3 : 0.6;
      e.noiseRadius = t.footstepNoise[gait] * surfaceAcoustics(surface).loudness;
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

function characterId(raw: number): CharacterId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: the u32 column only ever stores ids returned by PhysicsPort.createCharacter
  return raw as CharacterId;
}

export interface Sandbox {
  readonly simulation: Simulation;
  readonly player: EntityId;
  readonly layout: StreetLayout;
  readonly physics: PhysicsPort;
  readonly tuning: PlayerTuning;
}

/** `physics` must be a fresh, empty world for this sandbox (it is populated here). */
export function createSandbox(
  seed: Seed,
  physics: PhysicsPort,
  tuning: PlayerTuning = PLAYER_TUNING,
): Sandbox {
  const layout = generateStreetLayout(seed);
  buildStaticColliders(layout, physics);
  const world = new World();
  world.register(PlayerIntent);
  world.register(Pose);
  world.register(Motor);
  world.register(Flashlight);
  const player = world.spawn();
  const irow = world.store(PlayerIntent).add(player);
  world.store(PlayerIntent).fields.yaw[irow] = layout.spawn.yaw;

  const [sx, sy, sz] = layout.spawn.position;
  const character = physics.createCharacter({
    feet: layout.spawn.position,
    radius: tuning.radius,
    height: tuning.standHeight,
    maxStepHeight: tuning.maxStepHeight,
    maxSlopeDegrees: tuning.maxSlopeDegrees,
  });
  const pose = world.store(Pose);
  const prow = pose.add(player);
  const p = pose.fields;
  p.x[prow] = p.prevX[prow] = sx;
  p.y[prow] = p.prevY[prow] = sy;
  p.z[prow] = p.prevZ[prow] = sz;
  p.eye[prow] = p.prevEye[prow] = eyeHeight(tuning, 0);
  p.yaw[prow] = p.prevYaw[prow] = layout.spawn.yaw;
  const motor = world.store(Motor);
  const mrow = motor.add(player);
  motor.fields.stamina[mrow] = 1;
  motor.fields.character[mrow] = character;
  motor.fields.nextStep[mrow] = tuning.stepLength.walk * 0.5;
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
      motorSystem(player, physics, tuning),
      physicsStepSystem(physics),
      poseSystem(player, physics, tuning),
      flashlightSystem(player),
    ],
    hashExtras: [
      (h) => {
        physics.hashInto(h);
      },
    ],
  });
  return { simulation, player, layout, physics, tuning };
}

/** Everything the renderer needs for one frame, interpolated. Reused, never reallocated. */
export interface RenderView {
  /** Eye position. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  stride: number;
  crouch: number;
  grounded: boolean;
  flashlightOn: boolean;
  battery: number;
  stamina: number;
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
    crouch: 0,
    grounded: true,
    flashlightOn: false,
    battery: 0,
    stamina: 1,
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
    const lerp = (prev: number, cur: number): number => prev + (cur - prev) * a;
    out.x = lerp(at(p.prevX, row), at(p.x, row));
    out.y = lerp(at(p.prevY, row) + at(p.prevEye, row), at(p.y, row) + at(p.eye, row));
    out.z = lerp(at(p.prevZ, row), at(p.z, row));
    out.yaw = lerp(at(p.prevYaw, row), at(p.yaw, row));
    out.pitch = lerp(at(p.prevPitch, row), at(p.pitch, row));
    out.speed = at(p.speed, row);
    out.stride = at(p.stride, row);
  }
  const motor = simulation.world.store(Motor);
  const mrow = motor.rowOf(player);
  if (mrow >= 0) {
    out.crouch = at(motor.fields.crouch, mrow);
    out.grounded = motor.fields.grounded[mrow] === 1;
    out.stamina = at(motor.fields.stamina, mrow);
  }
  const fl = simulation.world.store(Flashlight);
  const frow = fl.rowOf(player);
  out.flashlightOn = frow >= 0 && fl.fields.on[frow] === 1;
  out.battery = frow >= 0 ? at(fl.fields.battery, frow) : 0;
  out.tick = simulation.tick;
  out.simTime = Math.max(0, (simulation.tick - 1 + a) / simulation.tickRate);
  return out;
}
