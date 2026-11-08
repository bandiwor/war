import type { GameEvents } from '../../domain/events/bus';
import { raceAt } from '../../domain/combat/races';
import { WEAPONS, WEAPON_IDS, weaponAt, type WeaponId } from '../../domain/weapons/registry';
import { WeaponEvent } from '../../domain/weapons/weapon-state';
import { airAbsorptionCutoff } from '../../domain/audio/acoustics';
import type { SurfaceId } from '../../domain/world/surfaces';
import type { AudioEngine } from './audio-engine';
import {
  EXPLOSION_SOUNDS,
  IMPACT_SOUNDS,
  MECHANICAL_SOUNDS,
  synthesizeCasing,
  synthesizeExplosion,
  synthesizeGunshot,
  synthesizeImpact,
  synthesizeMechanical,
  type ImpactSound,
  type MechanicalSound,
} from './dsp/weapon-sounds';

/**
 * Turns combat events into sound. Every sound is pre-synthesised into a
 * few seeded variants at startup; playback adds position, distance, air
 * absorption and the geometry-driven reverb (gunshots excite the space).
 */
const VARIANTS = 3;

const SURFACE_IMPACT: Readonly<Record<SurfaceId, ImpactSound>> = {
  asphalt: 'concrete',
  concrete: 'concrete',
  metal: 'metal',
  wood: 'wood',
  dirt: 'dirt',
  water: 'dirt',
};

export class WeaponAudio {
  private readonly gunshots = new Map<WeaponId, AudioBuffer[]>();
  private readonly mechanical = new Map<MechanicalSound, AudioBuffer[]>();
  private readonly impacts = new Map<ImpactSound, AudioBuffer[]>();
  private readonly explosions = new Map<string, AudioBuffer[]>();
  private readonly casings: { brass: AudioBuffer[]; shell: AudioBuffer[] };
  private pick = 0;
  /** Player hand position (mechanics, own shots). */
  readonly hands = { x: 0, y: 0, z: 0 };
  played = 0;

  constructor(
    private readonly engine: AudioEngine,
    seed: number,
  ) {
    const sr = engine.context.sampleRate;
    const bank = (f: (s: number) => Float32Array<ArrayBuffer>): AudioBuffer[] =>
      Array.from({ length: VARIANTS }, (_, v) => engine.toBuffer(f(seed + v * 7919)));
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      if (w.kind === 'firearm')
        this.gunshots.set(
          id,
          bank((s) => synthesizeGunshot({ ...w.sound, suppressed: false }, sr, s)),
        );
    }
    for (const k of MECHANICAL_SOUNDS)
      this.mechanical.set(
        k,
        bank((s) => synthesizeMechanical(k, sr, s)),
      );
    for (const k of IMPACT_SOUNDS)
      this.impacts.set(
        k,
        bank((s) => synthesizeImpact(k, sr, s)),
      );
    for (const k of EXPLOSION_SOUNDS)
      this.explosions.set(
        k,
        bank((s) => synthesizeExplosion(k, sr, s)),
      );
    this.casings = {
      brass: bank((s) => synthesizeCasing(false, sr, s)),
      shell: bank((s) => synthesizeCasing(true, sr, s)),
    };
  }

  /** Call after every simulation tick. */
  consume(events: GameEvents): void {
    for (let i = 0; i < events.shot.size; i++) {
      const e = events.shot.at(i);
      const id = e === undefined ? undefined : weaponAt(e.weapon);
      if (e === undefined || id === undefined) continue;
      this.play(this.gunshots.get(id), e.x, e.y, e.z, 1.6, 1);
    }
    for (let i = 0; i < events.weaponFx.size; i++) {
      const e = events.weaponFx.at(i);
      if (e) this.mechanics(e.flags, weaponAt(e.weapon));
    }
    for (let i = 0; i < events.impact.size; i++) {
      const e = events.impact.at(i);
      if (e)
        this.play(
          this.impacts.get(SURFACE_IMPACT[e.surface]),
          e.x,
          e.y,
          e.z,
          1.2 * Math.max(0.3, e.energy),
          1,
        );
    }
    for (let i = 0; i < events.hit.size; i++) {
      const e = events.hit.at(i);
      if (e === undefined || e.part === -1) continue;
      const race = raceAt(e.race);
      this.play(
        this.impacts.get(race === 'robot' ? 'robot' : race === 'plant' ? 'plant' : 'flesh'),
        e.x,
        e.y,
        e.z,
        1.4,
        1,
      );
    }
    for (let i = 0; i < events.explosion.size; i++) {
      const e = events.explosion.at(i);
      if (e === undefined) continue;
      const kind = e.kind === 0 ? 'frag' : e.kind === 1 ? 'emp' : e.kind === 2 ? 'fire' : 'flare';
      this.play(this.explosions.get(kind), e.x, e.y, e.z, kind === 'frag' ? 30 : 6, 1);
    }
  }

  casingLanded(x: number, y: number, z: number, shell: boolean): void {
    this.play(
      shell ? this.casings.shell : this.casings.brass,
      x,
      y,
      z,
      0.5,
      0.95 + ((this.pick * 0.37) % 0.1),
    );
  }

  private mechanics(flags: number, id: WeaponId | undefined): void {
    if (id === undefined) return;
    const w = WEAPONS[id];
    const at = (k: MechanicalSound, gain = 0.6): void => {
      this.play(this.mechanical.get(k), this.hands.x, this.hands.y, this.hands.z, gain, 1);
    };
    if (flags & WeaponEvent.DRY_FIRE) at('dryFire', 0.5);
    if (flags & WeaponEvent.MAG_OUT) at('magOut');
    if (flags & WeaponEvent.MAG_IN) at('magIn');
    if (flags & WeaponEvent.SHELL_IN) at('shellIn');
    if (flags & (WeaponEvent.CHAMBERED | WeaponEvent.JAM_CLEARED))
      at(w.kind === 'firearm' && w.action === 'bolt' ? 'bolt' : 'rack');
    if (flags & WeaponEvent.CYCLED)
      at(w.kind === 'firearm' && w.action === 'pump' ? 'pump' : 'bolt');
    if (flags & WeaponEvent.JAMMED) at('jam', 0.7);
    if (flags & WeaponEvent.MODE_CHANGED) at('modeSwitch', 0.4);
    if (flags & (WeaponEvent.SWING | WeaponEvent.THROW)) at('swing', 0.7);
    if (flags & WeaponEvent.DRAWN) at('draw', 0.3);
  }

  private play(
    bank: readonly AudioBuffer[] | undefined,
    x: number,
    y: number,
    z: number,
    gain: number,
    rate: number,
  ): void {
    if (bank === undefined || bank.length === 0) return;
    const buffer = bank[this.pick++ % bank.length];
    if (buffer === undefined) return;
    const dx = x - this.hands.x;
    const dy = y - this.hands.y;
    const dz = z - this.hands.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.engine.playAt(
      buffer,
      x,
      y,
      z,
      gain,
      rate * (0.97 + 0.06 * ((this.pick * 0.618) % 1)),
      airAbsorptionCutoff(distance),
    );
    this.played++;
  }
}
