import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { InputSource } from '../../application/loop/ports';
import { tick, type Tick } from '../../domain/core/brand';
import { InputCommandSchema, type InputCommand } from '../../domain/input/commands';
import { stickAxes, TouchInput } from './touch-input';

class FakeInner implements InputSource {
  next: InputCommand[] = [];
  commandsFor(_t: Tick): readonly InputCommand[] {
    const out = this.next;
    this.next = [];
    return out;
  }
}

const drain = (input: TouchInput, n: number): InputCommand[][] =>
  Array.from({ length: n }, (_, i) => [...input.commandsFor(tick(i))]);

describe('stickAxes', () => {
  it('maps up to forward, right to strafe, and clamps to the unit circle', () => {
    expect(stickAxes(0, -56, 56)).toEqual({ forward: 1, strafe: 0 });
    expect(stickAxes(200, 0, 56)).toEqual({ forward: 0, strafe: 1 });
    expect(stickAxes(0, 30, 56).forward).toBeLessThan(0);
  });

  it('has a dead zone', () => {
    expect(stickAxes(3, -3, 56)).toEqual({ forward: 0, strafe: 0 });
  });

  it('always yields valid move commands', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (dx, dy) => {
          const a = stickAxes(dx, dy, 56);
          expect(InputCommandSchema.safeParse({ type: 'move', ...a }).success).toBe(true);
          expect(Math.hypot(a.forward, a.strafe)).toBeLessThanOrEqual(1 + 1 / 16);
        },
      ),
    );
  });
});

describe('TouchInput', () => {
  it('emits move only when the stick changes, and centres on release', () => {
    const t = new TouchInput(new FakeInner());
    t.stick(0, -56, 56);
    const [a, b] = drain(t, 2);
    expect(a).toEqual([{ type: 'move', forward: 1, strafe: 0 }]);
    expect(b).toEqual([]);
    t.stickReleased();
    expect(drain(t, 1)[0]).toEqual([{ type: 'move', forward: 0, strafe: 0 }]);
  });

  it('accumulates look drags between ticks', () => {
    const t = new TouchInput(new FakeInner(), 0.01);
    t.look(10, 0);
    t.look(10, -5);
    const [a, b] = drain(t, 2);
    expect(a).toHaveLength(1);
    const look = a?.[0];
    expect(look?.type).toBe('look');
    if (look?.type === 'look') {
      expect(look.yaw).toBeCloseTo(-0.2);
      expect(look.pitch).toBeCloseTo(0.05);
    }
    expect(b).toEqual([]);
  });

  it('a tap presses and releases on different ticks', () => {
    const t = new TouchInput(new FakeInner());
    t.tap('reload');
    const [a, b, c] = drain(t, 3);
    expect(a).toEqual([{ type: 'action', action: 'reload', pressed: true }]);
    expect(b).toEqual([{ type: 'action', action: 'reload', pressed: false }]);
    expect(c).toEqual([]);
  });

  it('a quick fire press+release inside one tick still spans two ticks', () => {
    const t = new TouchInput(new FakeInner());
    t.button('fire', true);
    t.button('fire', false);
    t.tap('jump');
    const [a, b] = drain(t, 2);
    expect(a).toEqual([
      { type: 'action', action: 'fire', pressed: true },
      { type: 'action', action: 'jump', pressed: true },
    ]);
    expect(b).toEqual([
      { type: 'action', action: 'fire', pressed: false },
      { type: 'action', action: 'jump', pressed: false },
    ]);
  });

  it('toggles hold until tapped again', () => {
    const t = new TouchInput(new FakeInner());
    expect(t.toggle('crouch')).toBe(true);
    expect(t.isToggled('crouch')).toBe(true);
    expect(drain(t, 1)[0]).toEqual([{ type: 'action', action: 'crouch', pressed: true }]);
    expect(t.toggle('crouch')).toBe(false);
    expect(drain(t, 1)[0]).toEqual([{ type: 'action', action: 'crouch', pressed: false }]);
  });

  it('passes the keyboard through; the stick wins a same-tick move', () => {
    const inner = new FakeInner();
    const t = new TouchInput(inner);
    inner.next = [
      { type: 'move', forward: 1, strafe: 0 },
      { type: 'select', slot: 3 },
    ];
    expect(drain(t, 1)[0]).toEqual([
      { type: 'select', slot: 3 },
      { type: 'move', forward: 1, strafe: 0 },
    ]);
    inner.next = [{ type: 'move', forward: -1, strafe: 0 }];
    t.stick(56, 0, 56);
    expect(drain(t, 1)[0]).toEqual([{ type: 'move', forward: 0, strafe: 1 }]);
  });
});
