import type { EntityId } from '../../domain/ecs/entity';
import type { CharacterId } from '../physics/ports';
import { AMMO_KINDS, type AmmoKind } from '../../domain/story/schema';
import { SAVE_FORMAT, SAVE_VERSION, SaveSchema, type SaveGame } from '../../domain/save/save';
import { WEAPON_IDS } from '../../domain/weapons/registry';
import { PlayerVitals } from '../ai/components';
import { Ammo, Loadout, SLOT_FIELDS, WeaponItem } from '../combat/components';
import { restoreWeapon } from '../combat/combat-systems';
import { PlayerIntent } from '../scenes/empty-world';
import { Flashlight, Motor, Pose, type Sandbox } from '../scenes/sandbox';
import { Environment } from '../world/environment-system';

/**
 * Captures the player's progress from a running sandbox, and puts it back
 * into a fresh sandbox built from the same seed and scene. A loaded game
 * then runs deterministically from (seed, save, commands): two loads of one
 * save given the same input reach the same state hash (tests/integration/saves.test.ts).
 */
const playedBefore = new WeakMap<Sandbox, number>();

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: loadout slots only store handles returned by World.spawn
  return raw as EntityId;
}

function characterId(raw: number): CharacterId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: the Motor column only stores ids returned by PhysicsPort.createCharacter
  return raw as CharacterId;
}

const num = (col: ArrayLike<number>, row: number): number => col[row] ?? 0;

function sceneOf(sb: Sandbox): SaveGame['scene'] {
  return sb.kind === 'street' ? 'sandbox' : sb.kind;
}

export function captureSave(sb: Sandbox): SaveGame {
  const w = sb.simulation.world;
  const player = sb.player;
  const pose = w.store(Pose);
  const pr = pose.rowOf(player);
  const vit = w.store(PlayerVitals);
  const vr = vit.rowOf(player);
  const motor = w.store(Motor);
  const mr = motor.rowOf(player);
  const fl = w.store(Flashlight);
  const fr = fl.rowOf(player);
  const ammo = w.store(Ammo);
  const ar = ammo.rowOf(player);
  const ammoOut: Partial<Record<AmmoKind, number>> = {};
  if (ar >= 0) for (const k of AMMO_KINDS) ammoOut[k] = num(ammo.fields[k], ar);

  const loadout = w.store(Loadout);
  const lr = loadout.rowOf(player);
  const items = w.store(WeaponItem);
  const slots: NonNullable<SaveGame['weapons']>['slots'] = [];
  if (lr >= 0)
    for (const field of SLOT_FIELDS) {
      const ir = items.rowOf(entity(num(loadout.fields[field], lr)));
      if (ir < 0) continue;
      slots.push({
        weapon: WEAPON_IDS[num(items.fields.weapon, ir)] ?? '',
        mag: num(items.fields.mag, ir),
        chambered: items.fields.chambered[ir] === 1,
        wear: Math.min(1, Math.max(0, num(items.fields.wear, ir))),
        mode: num(items.fields.mode, ir),
      });
    }

  const env = w.tryStore(Environment);
  const ef = env !== null && env.size > 0 ? env.fields : null;
  const story = sb.story?.engine ?? null;
  const chapter = story?.data.chapters.find((c) => c.id === story.chapter);
  const playSeconds = (playedBefore.get(sb) ?? 0) + sb.simulation.tick / sb.simulation.tickRate;
  return SaveSchema.parse({
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    seed: sb.simulation.seed,
    scene: sceneOf(sb),
    meta: { label: chapter?.title ?? sb.kind, playSeconds },
    player: {
      x: num(pose.fields.x, pr),
      y: num(pose.fields.y, pr),
      z: num(pose.fields.z, pr),
      yaw: num(pose.fields.yaw, pr),
      pitch: num(pose.fields.pitch, pr),
      health: vr >= 0 ? num(vit.fields.health, vr) : 100,
      deaths: vr >= 0 ? num(vit.fields.deaths, vr) : 0,
      stamina: mr >= 0 ? Math.min(1, Math.max(0, num(motor.fields.stamina, mr))) : 1,
      flashlight: fr >= 0 && fl.fields.on[fr] === 1,
      battery: fr >= 0 ? Math.min(1, Math.max(0, num(fl.fields.battery, fr))) : 1,
    },
    ammo: ammoOut,
    weapons: lr >= 0 ? { active: num(loadout.fields.active, lr), slots } : null,
    environment:
      ef === null
        ? null
        : {
            timeOfDay: num(ef.timeOfDay, 0),
            timeScale: num(ef.timeScale, 0),
            clock: num(ef.clock, 0),
            fogOverride: num(ef.fogOverride, 0),
            rainOverride: num(ef.rainOverride, 0),
            windOverride: num(ef.windOverride, 0),
          },
    story: story?.snapshot() ?? null,
  });
}

/**
 * Applies a save to a freshly created sandbox (before its first tick). The
 * sandbox must be built from the save's seed and scene.
 */
export function restoreSave(sb: Sandbox, save: SaveGame): void {
  if (save.seed !== sb.simulation.seed)
    throw new Error(`Save seed ${String(save.seed)} != sandbox seed ${String(sb.simulation.seed)}`);
  if (save.scene !== sceneOf(sb))
    throw new Error(`Save scene ${save.scene} != sandbox scene ${sceneOf(sb)}`);
  const w = sb.simulation.world;
  const player = sb.player;
  const s = save.player;

  // Where you stood: the body, the camera, the colliders and nav grid around you.
  sb.chunks?.loadAllAround(s.x, s.z);
  const motor = w.store(Motor);
  const mr = motor.rowOf(player);
  if (mr >= 0) {
    sb.physics.setCharacterFeet(characterId(num(motor.fields.character, mr)), [
      s.x,
      s.y + 0.05,
      s.z,
    ]);
    motor.fields.vx[mr] = motor.fields.vy[mr] = motor.fields.vz[mr] = 0;
    motor.fields.stamina[mr] = s.stamina;
  }
  const pose = w.store(Pose);
  const pr = pose.rowOf(player);
  if (pr >= 0) {
    const p = pose.fields;
    p.x[pr] = p.prevX[pr] = s.x;
    p.y[pr] = p.prevY[pr] = s.y;
    p.z[pr] = p.prevZ[pr] = s.z;
    p.yaw[pr] = p.prevYaw[pr] = s.yaw;
    p.pitch[pr] = p.prevPitch[pr] = s.pitch;
  }
  const intent = w.store(PlayerIntent);
  const ir = intent.rowOf(player);
  if (ir >= 0) {
    intent.fields.yaw[ir] = s.yaw;
    intent.fields.pitch[ir] = s.pitch;
  }
  const vit = w.store(PlayerVitals);
  const vr = vit.rowOf(player);
  if (vr >= 0) {
    vit.fields.health[vr] = s.health;
    vit.fields.deaths[vr] = s.deaths;
  }
  const fl = w.store(Flashlight);
  const fr = fl.rowOf(player);
  if (fr >= 0) {
    fl.fields.on[fr] = s.flashlight ? 1 : 0;
    fl.fields.battery[fr] = s.battery;
  }

  // What you carry.
  const ammo = w.store(Ammo);
  const ar = ammo.rowOf(player);
  if (ar >= 0)
    for (const k of AMMO_KINDS) {
      const v = save.ammo[k];
      if (v !== undefined) ammo.fields[k][ar] = v;
    }
  const loadout = w.store(Loadout);
  const lr = loadout.rowOf(player);
  const items = w.store(WeaponItem);
  if (save.weapons !== null && lr >= 0) {
    loadout.fields.active[lr] = save.weapons.active;
    SLOT_FIELDS.forEach((field, i) => {
      const saved = save.weapons?.slots[i];
      const item = entity(num(loadout.fields[field], lr));
      const ir = items.rowOf(item);
      // A slot restores only onto the same weapon (a registry change voids it).
      if (saved === undefined || ir < 0) return;
      if (WEAPON_IDS[num(items.fields.weapon, ir)] !== saved.weapon) return;
      restoreWeapon(w, item, saved);
    });
  }

  // The hour and the weather.
  const env = w.tryStore(Environment);
  if (env !== null && env.size > 0 && save.environment !== null) {
    const e = env.fields;
    e.timeOfDay[0] = save.environment.timeOfDay;
    e.timeScale[0] = save.environment.timeScale;
    e.clock[0] = save.environment.clock;
    e.fogOverride[0] = save.environment.fogOverride;
    e.rainOverride[0] = save.environment.rainOverride;
    e.windOverride[0] = save.environment.windOverride;
  }

  if (save.story !== null) sb.story?.engine.restore(save.story);
  playedBefore.set(sb, save.meta.playSeconds);
}
