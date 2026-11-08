import { describe, expect, it } from 'vitest';
import { SignalLossScheduler } from './signal-loss-scheduler';

describe('SignalLossScheduler', () => {
  it('fires roughly at the requested rate and envelopes each event', () => {
    const s = new SignalLossScheduler(1);
    let events = 0;
    let wasActive = false;
    const dt = 1 / 60;
    for (let t = 0; t < 600; t += dt) {
      s.update(t, dt, 6);
      const active = s.level(t) > 0;
      if (active && !wasActive) events++;
      wasActive = active;
      expect(s.level(t)).toBeLessThanOrEqual(1);
    }
    expect(events).toBeGreaterThan(35);
    expect(events).toBeLessThan(90);
  });

  it('never fires at rate 0 and ignores huge frame gaps', () => {
    const s = new SignalLossScheduler(2);
    for (let t = 0; t < 100; t += 0.5) s.update(t, 0.5, 0);
    s.update(200, 5, 1000);
    expect(s.level(200)).toBe(0);
  });

  it('trigger and force for debugging and visual tests', () => {
    const s = new SignalLossScheduler(3);
    s.trigger(10, 1, 1);
    expect(s.level(10.5)).toBeGreaterThan(0.5);
    expect(s.level(12)).toBe(0);
    expect(s.seed).toBeGreaterThanOrEqual(0);
    s.force(0.7);
    s.update(20, 0.016, 100);
    expect(s.level(99)).toBe(0.7);
    s.force(0);
    expect(s.level(99)).toBe(0);
  });
});
