import type { GameEvents } from '../domain/events/bus';
import { BODY_PARTS, raceAt } from '../domain/combat/races';
import { weaponAt } from '../domain/weapons/registry';

/** Debug/range record of recent hits (what the Range tab and e2e tests read). */
export interface HitRecord {
  readonly weapon: string;
  readonly race: string;
  readonly part: string;
  readonly distance: number;
  readonly damage: number;
  readonly dropCm: number;
  readonly timeMs: number;
  readonly killed: boolean;
}

export class CombatLog {
  shots = 0;
  hits = 0;
  kills = 0;
  impacts = 0;
  explosions = 0;
  readonly recent: HitRecord[] = [];

  constructor(private readonly keep = 20) {}

  record(events: GameEvents): void {
    this.shots += events.shot.size;
    this.impacts += events.impact.size;
    this.explosions += events.explosion.size;
    for (let i = 0; i < events.hit.size; i++) {
      const e = events.hit.at(i);
      if (e === undefined) continue;
      this.hits++;
      if (e.killed) this.kills++;
      this.recent.unshift({
        weapon: weaponAt(e.weapon) ?? (e.weapon === 255 ? 'hazard' : '?'),
        race: raceAt(e.race),
        part: e.part >= 0 ? (BODY_PARTS[e.part] ?? '?') : 'area',
        distance: e.distance,
        damage: e.damage,
        dropCm: e.drop * 100,
        timeMs: e.time * 1000,
        killed: e.killed,
      });
      if (this.recent.length > this.keep) this.recent.pop();
    }
  }
}
