import type { Tick } from '../../domain/core/brand';
import type { InputCommand } from '../../domain/input/commands';
import type { InputSource } from '../loop/ports';
import type { Replay, ReplayRecorder } from './replay';

const NONE: readonly InputCommand[] = [];

/** Feeds a recorded replay back into the game loop, tick by tick. */
export class ReplayInput implements InputSource {
  private index = 0;

  constructor(private readonly replay: Replay) {}

  get finished(): boolean {
    return this.index >= this.replay.frames.length;
  }

  commandsFor(tick: Tick): readonly InputCommand[] {
    if (tick >= this.replay.length) return NONE;
    let frame = this.replay.frames[this.index];
    while (frame !== undefined && frame.t < tick) frame = this.replay.frames[++this.index];
    if (frame?.t !== tick) return NONE;
    this.index++;
    return frame.c;
  }
}

/** Decorator: records every command another input source produces. */
export class RecordingInput implements InputSource {
  recorder: ReplayRecorder | null = null;

  constructor(private readonly inner: InputSource) {}

  commandsFor(tick: Tick): readonly InputCommand[] {
    const cmds = this.inner.commandsFor(tick);
    this.recorder?.record(tick, cmds);
    return cmds;
  }
}
