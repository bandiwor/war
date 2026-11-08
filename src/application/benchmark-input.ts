import type { Tick } from '../domain/core/brand';
import type { InputCommand } from '../domain/input/commands';
import { sin } from '../domain/math/dmath';
import type { InputSource } from './loop/ports';

/**
 * Scripted input for the in-game benchmark (?bench=N): walk down the street
 * while sweeping the view left and right, with periodic fast turns to load
 * the motion effects. Deterministic per tick, so runs are comparable.
 */
export class BenchmarkInput implements InputSource {
  private readonly out: InputCommand[] = [];
  private readonly move: InputCommand = { type: 'move', forward: 1, strafe: 0 };
  private readonly look = { type: 'look' as const, yaw: 0, pitch: 0 };

  commandsFor(tick: Tick): readonly InputCommand[] {
    const out = this.out;
    out.length = 0;
    if (tick === 0) out.push(this.move);
    const t = tick / 60;
    // Gentle sweep plus a whip pan every 6 s.
    const whip = tick % 360 < 20 ? 0.09 : 0;
    this.look.yaw = 0.012 * sin(t * 0.8) + whip;
    this.look.pitch = 0.002 * sin(t * 1.3);
    out.push(this.look);
    return out;
  }
}
