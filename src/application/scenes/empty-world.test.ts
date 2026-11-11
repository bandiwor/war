import { describe, expect, it } from 'vitest';
import { seed } from '../../domain/core/brand';
import { actionBit } from '../../domain/input/commands';
import { PlayerIntent, TICK_RATE, createEmptyWorld } from './empty-world';

describe('empty world', () => {
  it('starts with one player and ticks at 60 Hz', () => {
    const { simulation, player } = createEmptyWorld(seed(1));
    expect(simulation.tickRate).toBe(TICK_RATE);
    expect(simulation.world.entities.count).toBe(1);
    expect(simulation.world.store(PlayerIntent).has(player)).toBe(true);
  });

  it('applies move, look (with pitch clamp) and action commands', () => {
    const { simulation, player } = createEmptyWorld(seed(1));
    const store = simulation.world.store(PlayerIntent);
    simulation.step([
      { type: 'move', forward: 1, strafe: -1 },
      { type: 'look', yaw: 0.25, pitch: 3 },
      { type: 'action', action: 'fire', pressed: true },
      { type: 'action', action: 'flashlight', pressed: true },
    ]);
    const row = store.rowOf(player);
    expect(store.fields.forward[row]).toBe(1);
    expect(store.fields.strafe[row]).toBe(-1);
    expect(store.fields.yaw[row]).toBe(0.25);
    expect(store.fields.pitch[row]).toBe(1.5);
    expect(store.fields.buttons[row]).toBe(actionBit('fire') | actionBit('flashlight'));
    simulation.step([{ type: 'action', action: 'fire', pressed: false }]);
    expect(store.fields.buttons[row]).toBe(actionBit('flashlight'));
  });

  it('a tap inside one tick (down and up before it ends) is still a press', () => {
    const { simulation, player } = createEmptyWorld(seed(1));
    const store = simulation.world.store(PlayerIntent);
    const row = store.rowOf(player);
    simulation.step([
      { type: 'action', action: 'use', pressed: true },
      { type: 'action', action: 'use', pressed: false },
    ]);
    expect(store.fields.buttons[row]).toBe(0);
    expect(store.fields.pressed[row]).toBe(actionBit('use'));
    simulation.step([]);
    expect(store.fields.pressed[row]).toBe(0);
    // Holding is one press, not one per tick; a repeat while held is no new press.
    simulation.step([{ type: 'action', action: 'use', pressed: true }]);
    expect(store.fields.pressed[row]).toBe(actionBit('use'));
    simulation.step([{ type: 'action', action: 'use', pressed: true }]);
    expect(store.fields.pressed[row]).toBe(0);
  });

  it('does nothing if the player has lost its intent component', () => {
    const { simulation, player } = createEmptyWorld(seed(1));
    simulation.world.despawn(player);
    const before = simulation.stateHash();
    simulation.step([{ type: 'move', forward: 1, strafe: 0 }]);
    expect(simulation.world.entities.count).toBe(0);
    expect(simulation.stateHash()).not.toBe(before); // only the tick advanced
  });
});
