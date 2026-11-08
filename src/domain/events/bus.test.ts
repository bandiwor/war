import { describe, expect, it } from 'vitest';
import { EventChannel, GameEvents } from './bus';

describe('event bus', () => {
  it('pools records, exposes them until cleared', () => {
    const ch = new EventChannel(() => ({ v: 0 }));
    const a = ch.emit();
    a.v = 1;
    ch.emit().v = 2;
    expect(ch.size).toBe(2);
    expect(ch.at(1)?.v).toBe(2);
    expect(ch.at(2)).toBeUndefined();
    ch.clear();
    expect(ch.size).toBe(0);
    expect(ch.emit()).toBe(a); // reused, no allocation
  });

  it('GameEvents clears every channel', () => {
    const e = new GameEvents();
    e.footstep.emit();
    e.land.emit();
    e.jump.emit();
    e.shot.emit();
    e.hit.emit();
    e.impact.emit();
    e.explosion.emit();
    e.weaponFx.emit();
    e.clear();
    expect(
      e.footstep.size +
        e.land.size +
        e.jump.size +
        e.shot.size +
        e.hit.size +
        e.impact.size +
        e.explosion.size +
        e.weaponFx.size,
    ).toBe(0);
  });
});
