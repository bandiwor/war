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
import { PlayerIntent, SelectIntent, TICK_RATE, intentSystem } from './empty-world';
import { generateRangeLayout } from '../../domain/world/range-layout';
import { generateWorldLayout } from '../../domain/world/world-layout';
import { ChunkColliders } from '../world/chunk-colliders';
import {
  createEnvironmentView,
  Environment,
  environmentSystem,
  readEnvironment,
  spawnEnvironment,
  type EnvironmentView,
} from '../world/environment-system';
import {
  Ammo,
  Hazard,
  Loadout,
  Projectile,
  Target,
  Rocket,
  Thrown,
  WeaponItem,
} from '../combat/components';
import { WEAPONS, weaponAt, type WeaponId } from '../../domain/weapons/registry';
import type { ReloadStage, WeaponPhase } from '../../domain/weapons/weapon-state';
import {
  activeItemRow,
  aimOffset,
  giveLoadout,
  hazardSystem,
  projectileSystem,
  reserveKey,
  spawnTargets,
  targetSystem,
  rocketSystem,
  thrownSystem,
  weaponFireSystem,
  weaponSelectSystem,
} from '../combat/combat-systems';

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
  const AIM = actionBit('aim');

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
      // Aiming down sights: deliberate, slower movement.
      input.speedScale = (buttons & AIM) !== 0 ? 0.6 : 1;

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
  const recoil = { pitch: 0, yaw: 0 };
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
      aimOffset(ctx.world, player, recoil);
      p.yaw[row] = at(i.yaw, irow) + recoil.yaw;
      p.pitch[row] = Math.max(-1.5, Math.min(1.5, at(i.pitch, irow) + recoil.pitch));
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

/**
 * Debug teleports, then collider streaming around the player's feet. Runs
 * before the motor so the floor under a teleported player already exists.
 */
function worldStreamingSystem(
  player: EntityId,
  physics: PhysicsPort,
  colliders: ChunkColliders,
): System<SimContext> {
  const feet: Point = { x: 0, y: 0, z: 0 };
  return {
    name: 'world.streaming',
    after: ['input.intent'],
    before: ['player.motor'],
    run(ctx) {
      const pose = ctx.world.store(Pose);
      const row = pose.rowOf(player);
      const motor = ctx.world.store(Motor);
      const mrow = motor.rowOf(player);
      if (row < 0 || mrow < 0) return;
      const id = characterId(at(motor.fields.character, mrow));
      const commands = ctx.commands;
      for (let i = 0; i < commands.length; i++) {
        const c = commands[i];
        if (c?.type !== 'teleport') continue;
        physics.setCharacterFeet(id, [c.x, c.y, c.z]);
        const p = pose.fields;
        p.x[row] = p.prevX[row] = c.x;
        p.y[row] = p.prevY[row] = c.y;
        p.z[row] = p.prevZ[row] = c.z;
        motor.fields.vx[mrow] = 0;
        motor.fields.vy[mrow] = 0;
        motor.fields.vz[mrow] = 0;
      }
      physics.characterFeet(id, feet);
      colliders.update(feet.x, feet.z);
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
  readonly kind: SandboxKind;
  /** Collider streaming (open world only). */
  readonly chunks: ChunkColliders | null;
}

export type SandboxKind = 'street' | 'range' | 'world';

export interface SandboxOptions {
  readonly kind?: SandboxKind;
  readonly tuning?: PlayerTuning;
}

/** `physics` must be a fresh, empty world for this sandbox (it is populated here). */
export function createSandbox(
  seed: Seed,
  physics: PhysicsPort,
  options: SandboxOptions = {},
): Sandbox {
  const kind = options.kind ?? 'street';
  const tuning = options.tuning ?? PLAYER_TUNING;
  const layout =
    kind === 'range'
      ? generateRangeLayout(seed)
      : kind === 'world'
        ? generateWorldLayout()
        : generateStreetLayout(seed);
  buildStaticColliders(layout, physics);
  const chunks = kind === 'world' ? new ChunkColliders(seed, physics) : null;
  chunks?.loadAllAround(layout.spawn.position[0], layout.spawn.position[2]);
  const world = new World();
  world.register(PlayerIntent);
  world.register(Pose);
  world.register(Motor);
  world.register(Flashlight);
  world.register(SelectIntent);
  world.register(Loadout);
  world.register(Ammo);
  world.register(WeaponItem);
  world.register(Projectile);
  world.register(Thrown);
  world.register(Rocket);
  world.register(Hazard);
  world.register(Target);
  if (kind === 'world') world.register(Environment);
  const player = world.spawn();
  world.store(SelectIntent).fields.slot[world.store(SelectIntent).add(player)] = -1;
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
  giveLoadout(world, player, { infinite: kind === 'range', startSlot: kind === 'range' ? 2 : 0 });
  spawnTargets(world, layout.targets);
  const worldSystems: System<SimContext>[] = [];
  if (chunks !== null) {
    worldSystems.push(
      worldStreamingSystem(player, physics, chunks),
      environmentSystem(spawnEnvironment(world), seed),
    );
  }
  const eyeOf = (
    w: World,
    out: { x: number; y: number; z: number; yaw: number; pitch: number; speed: number },
  ): boolean => {
    const pose = w.store(Pose);
    const r = pose.rowOf(player);
    if (r < 0) return false;
    const f = pose.fields;
    out.x = at(f.x, r);
    out.y = at(f.y, r) + at(f.eye, r);
    out.z = at(f.z, r);
    out.yaw = at(f.yaw, r);
    out.pitch = at(f.pitch, r);
    out.speed = at(f.speed, r);
    return true;
  };
  const spendStamina = (w: World, amount: number): boolean => {
    const motor = w.store(Motor);
    const r = motor.rowOf(player);
    if (r < 0) return false;
    const stamina = at(motor.fields.stamina, r);
    motor.fields.stamina[r] = Math.max(0, stamina - amount);
    return stamina >= amount;
  };

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
      weaponSelectSystem(player),
      weaponFireSystem({ player, physics, eye: eyeOf, spendStamina }),
      projectileSystem(physics),
      rocketSystem(physics),
      thrownSystem(physics),
      hazardSystem(),
      targetSystem(kind === 'range'),
      ...worldSystems,
    ],
    hashExtras: [
      (h) => {
        physics.hashInto(h);
      },
    ],
  });
  return { simulation, player, layout, physics, tuning, kind, chunks };
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
  weapon: WeaponView;
  env: EnvironmentView;
}

/** What the viewmodel/HUD-less presentation needs about the weapon in hand. */
export interface WeaponView {
  id: WeaponId | null;
  phase: WeaponPhase;
  stage: ReloadStage;
  /** Seconds left in the current phase. */
  timer: number;
  /** Melee swing progress 0..1. */
  swing: number;
  mag: number;
  chambered: boolean;
  reserve: number;
  infinite: boolean;
  mode: number;
  aiming: boolean;
  wear: number;
}

export function createWeaponView(): WeaponView {
  return {
    id: null,
    phase: 'ready',
    stage: 'magOut',
    timer: 0,
    swing: 0,
    mag: 0,
    chambered: false,
    reserve: 0,
    infinite: false,
    mode: 0,
    aiming: false,
    wear: 0,
  };
}

const PHASE_ORDER: readonly WeaponPhase[] = [
  'ready',
  'cycling',
  'reloading',
  'jammed',
  'clearing',
  'drawing',
  'swinging',
];
const STAGE_ORDER: readonly ReloadStage[] = ['magOut', 'magIn', 'chamber', 'shell'];

function readWeaponView(sandbox: Sandbox, out: WeaponView): void {
  const world = sandbox.simulation.world;
  const row = activeItemRow(world, sandbox.player);
  if (row < 0) {
    out.id = null;
    return;
  }
  const f = world.store(WeaponItem).fields;
  const id = weaponAt(at(f.weapon, row)) ?? null;
  out.id = id;
  out.phase = PHASE_ORDER[at(f.phase, row)] ?? 'ready';
  out.stage = STAGE_ORDER[at(f.stage, row)] ?? 'magOut';
  out.timer = at(f.timer, row);
  out.swing = at(f.swing, row);
  out.mag = at(f.mag, row);
  out.chambered = f.chambered[row] === 1;
  out.mode = at(f.mode, row);
  out.wear = at(f.wear, row);
  const ammo = world.store(Ammo);
  const arow = ammo.rowOf(sandbox.player);
  out.infinite = arow >= 0 && ammo.fields.infinite[arow] === 1;
  out.reserve = 0;
  if (arow >= 0 && id !== null) {
    const key = reserveKey(id, WEAPONS[id]);
    if (key !== null) out.reserve = at(ammo.fields[key], arow);
  }
  const intent = world.store(PlayerIntent);
  const irow = intent.rowOf(sandbox.player);
  out.aiming = irow >= 0 && (at(intent.fields.buttons, irow) & actionBit('aim')) !== 0;
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
    weapon: createWeaponView(),
    env: createEnvironmentView(),
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
  readWeaponView(sandbox, out.weapon);
  readEnvironment(simulation.world, out.env);
  out.tick = simulation.tick;
  out.simTime = Math.max(0, (simulation.tick - 1 + a) / simulation.tickRate);
  return out;
}
