import type { Tick } from '../../domain/core/brand';
import type { InputCommand } from '../../domain/input/commands';
import type { InputSource } from '../loop/ports';

/**
 * Lets tools (debug menu, tests) inject commands into the next tick as if
 * the player had typed them. They travel the normal input path, so they are
 * recorded in replays and stay deterministic.
 */
export class CommandQueue implements InputSource {
  private readonly pending: InputCommand[] = [];
  private readonly merged: InputCommand[] = [];

  constructor(private readonly inner: InputSource) {}

  push(...commands: InputCommand[]): void {
    this.pending.push(...commands);
  }

  commandsFor(tick: Tick): readonly InputCommand[] {
    const base = this.inner.commandsFor(tick);
    if (this.pending.length === 0) return base;
    this.merged.length = 0;
    for (const c of base) this.merged.push(c);
    // One action edge per tick per action: a press and its release must land on different ticks.
    const seen = new Set<string>();
    const rest: InputCommand[] = [];
    for (const c of this.pending) {
      const key = c.type === 'action' ? `a:${c.action}` : c.type;
      if (seen.has(key)) rest.push(c);
      else {
        seen.add(key);
        this.merged.push(c);
      }
    }
    this.pending.length = 0;
    this.pending.push(...rest);
    return this.merged;
  }
}
