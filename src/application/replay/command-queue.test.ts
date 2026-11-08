import { describe, expect, it } from 'vitest';
import { tick } from '../../domain/core/brand';
import type { InputCommand } from '../../domain/input/commands';
import { CommandQueue } from './command-queue';

describe('CommandQueue', () => {
  it('passes through, then merges injected commands, splitting same-action edges across ticks', () => {
    const base: InputCommand[] = [{ type: 'move', forward: 1, strafe: 0 }];
    const q = new CommandQueue({ commandsFor: () => base });
    expect(q.commandsFor(tick(0))).toBe(base);
    q.push(
      { type: 'action', action: 'fire', pressed: true },
      { type: 'action', action: 'fire', pressed: false },
      { type: 'select', slot: 2 },
    );
    expect(q.commandsFor(tick(1))).toEqual([
      ...base,
      { type: 'action', action: 'fire', pressed: true },
      { type: 'select', slot: 2 },
    ]);
    expect(q.commandsFor(tick(2))).toEqual([
      ...base,
      { type: 'action', action: 'fire', pressed: false },
    ]);
    expect(q.commandsFor(tick(3))).toBe(base);
  });
});
