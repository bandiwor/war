import { DEAD_ACTION, Mob } from '../../application/ai/components';
import { Target } from '../../application/combat/components';
import type { Sandbox } from '../../application/scenes/sandbox';
import { airAbsorptionCutoff } from '../../domain/audio/acoustics';
import { UTILITY_ACTIONS } from '../../domain/ai/utility';
import type { EntityId } from '../../domain/ecs/entity';
import type { GameEvents } from '../../domain/events/bus';
import { MOBS, MOB_IDS, mobAt, type MobId } from '../../domain/mobs/registry';
import type { AudioEngine } from './audio-engine';
import { MOB_SOUNDS, RACE_VOICES, synthesizeMobSound, type MobSound } from './dsp/mob-sounds';

/**
 * The races' voices in the world: attacks and ranged attacks from the
 * event bus, and the ambient calls (breath, servo hum, rustles, growls)
 * that give a mob away in the dark before you see it. Calls come at a
 * rate that rises with how hunted you are; each mob keeps its own timer.
 */
const VARIANTS = 3;
/** Mobs farther than this are not voiced (also caps the per-frame scan cost). */
export const VOICE_RANGE = 28;
/** Calls playing at once: the nearest win. */
const MAX_CALLS_PER_SECOND = 6;

const CHASE = UTILITY_ACTIONS.indexOf('chase');
const ATTACK = UTILITY_ACTIONS.indexOf('attack');
const WARN = UTILITY_ACTIONS.indexOf('warn');
const SEARCH = UTILITY_ACTIONS.indexOf('search');
const INVESTIGATE = UTILITY_ACTIONS.indexOf('investigate');

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: dense rows hold live entity ids
  return raw as EntityId;
}

export interface VocalChoice {
  readonly sound: MobSound;
  /** Seconds until this mob's next call. */
  readonly interval: number;
  readonly gain: number;
}

/**
 * What a mob says now, from its race and state, or null for silence.
 * Hunting mobs call more often and louder; a warning animal growls
 * steadily (the warning is the point); a wolf on the hunt howls to its pack.
 */
export function vocalFor(
  id: MobId,
  action: number,
  speed: number,
  awareness: number,
  roll: number,
): VocalChoice | null {
  if (action === DEAD_ACTION) return null;
  const spec = MOBS[id];
  const voice = RACE_VOICES[spec.race];
  const hunting = action === CHASE || action === ATTACK || action === SEARCH;
  if (action === WARN) return { sound: voice.idle, interval: 1.4 + roll * 0.6, gain: 1.4 };
  if (hunting) {
    if (id === 'wolf' && roll < 0.15) return { sound: 'howl', interval: 6, gain: 2 };
    return { sound: voice.alert, interval: 1.6 + roll * 1.6, gain: 1.3 };
  }
  if (speed > 0.2) return { sound: voice.move, interval: 0.9 + roll * 0.8, gain: 0.7 };
  if (action === INVESTIGATE || awareness > 0.3)
    return { sound: voice.idle, interval: 2.5 + roll * 2, gain: 0.9 };
  return { sound: voice.idle, interval: 5 + roll * 6, gain: 0.6 };
}

export class MobAudio {
  private readonly bank = new Map<MobSound, AudioBuffer[]>();
  private readonly timers = new Map<number, number>();
  private readonly seen = new Set<number>();
  private pick = 0;
  private static = 0;
  private budget = MAX_CALLS_PER_SECOND;
  /** Listener position (the player's head). */
  readonly listener = { x: 0, y: 0, z: 0 };
  played = 0;

  constructor(
    private readonly engine: AudioEngine,
    seed: number,
  ) {
    const sr = engine.context.sampleRate;
    for (const k of MOB_SOUNDS)
      this.bank.set(
        k,
        Array.from({ length: VARIANTS }, (_, v) =>
          engine.toBuffer(synthesizeMobSound(k, sr, seed + v * 7919 + k.length)),
        ),
      );
  }

  /** Call after every simulation tick: attacks, spits, lasers, leaps, calls. */
  consume(events: GameEvents): void {
    for (let i = 0; i < events.mobAttack.size; i++) {
      const e = events.mobAttack.at(i);
      const id = e === undefined ? undefined : MOB_IDS[e.kind];
      if (e === undefined || id === undefined) continue;
      this.play(RACE_VOICES[MOBS[id].race].attack, e.x, e.y + 1, e.z, 1.6);
    }
    for (let i = 0; i < events.mobRanged.size; i++) {
      const e = events.mobRanged.at(i);
      if (e === undefined) continue;
      switch (e.kind) {
        case 0:
          this.play('laser', e.x, e.y, e.z, 2.2);
          break;
        case 1:
          this.play('spit', e.x, e.y, e.z, 1.5);
          break;
        case 2:
          this.play('snap', e.x, e.y, e.z, 1.2);
          this.play('rustle', e.x, e.y, e.z, 1.2);
          break;
        case 3:
          this.play('creak', e.tx, e.ty, e.tz, 1.4);
          break;
        case 4:
          this.play('snap', e.x, e.y, e.z, 1);
          break;
        case 5:
          // A robot calls reinforcements: a beep burst over the radio.
          this.play('beep', e.x, e.y, e.z, 2);
          this.play('static', e.x, e.y, e.z, 1.2);
          break;
      }
    }
  }

  /** Call every frame: ambient calls of mobs near the listener. */
  update(sandbox: Sandbox, dt: number): void {
    const world = sandbox.simulation.world;
    const mob = world.tryStore(Mob);
    const t = world.tryStore(Target);
    if (mob === null || t === null) return;
    this.budget = Math.min(MAX_CALLS_PER_SECOND, this.budget + MAX_CALLS_PER_SECOND * dt);
    const f = mob.fields;
    const seen = this.seen;
    seen.clear();
    for (let row = 0; row < mob.size; row++) {
      const e = mob.dense[row] ?? 0;
      seen.add(e);
      const tr = t.rowOf(entity(e));
      if (tr < 0) continue;
      const x = t.fields.x[tr] ?? 0;
      const y = t.fields.y[tr] ?? 0;
      const z = t.fields.z[tr] ?? 0;
      const dx = x - this.listener.x;
      const dz = z - this.listener.z;
      if (dx * dx + dz * dz > VOICE_RANGE * VOICE_RANGE) continue;
      const left = (this.timers.get(e) ?? ((e * 0.618) % 1) * 3) - dt;
      if (left > 0) {
        this.timers.set(e, left);
        continue;
      }
      const id = mobAt(f.kind[row] ?? 0) ?? 'shambler';
      const roll = (this.pick * 0.618 + e * 0.37) % 1;
      const call = vocalFor(id, f.action[row] ?? 0, f.speed[row] ?? 0, f.awareness[row] ?? 0, roll);
      this.timers.set(e, call?.interval ?? 2);
      if (call === null || this.budget < 1) continue;
      this.budget--;
      this.play(call.sound, x, y + MOBS[id].body.eyeHeight * MOBS[id].body.scale, z, call.gain);
    }
    for (const e of this.timers.keys()) if (!seen.has(e)) this.timers.delete(e);
  }

  /**
   * Robots' radio interference reaching the bodycam (vitals `emi`, 0..1):
   * static bursts in the camera's own microphone, denser the closer they are.
   */
  interference(emi: number, dt: number): void {
    if (emi < 0.05) {
      this.static = 0;
      return;
    }
    this.static -= dt;
    if (this.static > 0) return;
    this.static = 1.4 - emi;
    const bank = this.bank.get('static');
    const buffer = bank?.[this.pick++ % (bank.length || 1)];
    if (buffer === undefined) return;
    this.engine.playLocal(buffer, 0.25 + 0.5 * emi, 1, 0, 0.1);
    this.played++;
  }

  private play(kind: MobSound, x: number, y: number, z: number, gain: number): void {
    const bank = this.bank.get(kind);
    if (bank === undefined || bank.length === 0) return;
    const buffer = bank[this.pick++ % bank.length];
    if (buffer === undefined) return;
    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const dz = z - this.listener.z;
    this.engine.playAt(
      buffer,
      x,
      y,
      z,
      gain,
      0.94 + 0.12 * ((this.pick * 0.618) % 1),
      airAbsorptionCutoff(Math.sqrt(dx * dx + dy * dy + dz * dz)),
    );
    this.played++;
  }
}
