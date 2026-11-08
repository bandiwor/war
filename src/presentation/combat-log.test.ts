import { describe, expect, it } from 'vitest';
import { GameEvents } from '../domain/events/bus';
import { CombatLog } from './combat-log';

describe('CombatLog', () => {
  it('counts events and keeps the most recent hits first', () => {
    const log = new CombatLog(2);
    const ev = new GameEvents();
    ev.shot.emit();
    ev.impact.emit();
    ev.explosion.emit();
    for (const [part, killed] of [
      [0, false],
      [1, true],
      [-1, false],
    ] as const) {
      const h = ev.hit.emit();
      h.part = part;
      h.killed = killed;
      h.weapon = 3;
      h.drop = 0.5;
      h.time = 0.25;
    }
    log.record(ev);
    expect([log.shots, log.hits, log.kills, log.impacts, log.explosions]).toEqual([1, 3, 1, 1, 1]);
    expect(log.recent).toHaveLength(2);
    expect(log.recent[0]?.part).toBe('area');
    expect(log.recent[1]).toMatchObject({
      part: 'torso',
      killed: true,
      dropCm: 50,
      timeMs: 250,
      weapon: 'rifle',
    });
    ev.clear();
    const h = ev.hit.emit();
    h.weapon = 255;
    log.record(ev);
    expect(log.recent[0]?.weapon).toBe('hazard');
  });
});
