import { describe, expect, it } from 'vitest';
import { ACTIONS, InputCommandSchema, actionBit } from './commands';

describe('InputCommand', () => {
  it('parses valid commands and rejects invalid ones', () => {
    expect(InputCommandSchema.parse({ type: 'move', forward: 1, strafe: -0.5 })).toEqual({
      type: 'move',
      forward: 1,
      strafe: -0.5,
    });
    expect(InputCommandSchema.safeParse({ type: 'move', forward: 2, strafe: 0 }).success).toBe(
      false,
    );
    expect(
      InputCommandSchema.safeParse({ type: 'look', yaw: Number.POSITIVE_INFINITY, pitch: 0 })
        .success,
    ).toBe(false);
    expect(
      InputCommandSchema.safeParse({ type: 'action', action: 'dance', pressed: true }).success,
    ).toBe(false);
    expect(InputCommandSchema.safeParse({ type: 'teleport' }).success).toBe(false);
    expect(InputCommandSchema.safeParse({ type: 'select', slot: 3 }).success).toBe(true);
    expect(InputCommandSchema.safeParse({ type: 'select', slot: 12 }).success).toBe(false);
  });

  it('assigns a unique bit per action', () => {
    const bits = ACTIONS.map(actionBit);
    expect(new Set(bits).size).toBe(ACTIONS.length);
    expect(bits.reduce((a, b) => a | b, 0)).toBe((1 << ACTIONS.length) - 1);
  });
});
