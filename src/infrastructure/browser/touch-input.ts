import type { InputSource } from '../../application/loop/ports';
import type { Tick } from '../../domain/core/brand';
import type { Action, InputCommand } from '../../domain/input/commands';

/** Stick output is snapped to this grid so a trembling thumb does not emit a move every tick. */
const STICK_STEPS = 16;
const STICK_DEADZONE = 0.12;

/** Snap to the stick grid; `+ 0` turns -0 into 0 so "centred" compares equal. */
function snap(v: number): number {
  return Math.round(v * STICK_STEPS) / STICK_STEPS + 0;
}

/**
 * Converts a thumb offset from the stick origin (screen pixels, y down) into
 * move axes: forward is up, length is clamped to 1 and a small dead zone is
 * removed and rescaled so the stick starts from zero.
 */
export function stickAxes(
  dx: number,
  dy: number,
  radius: number,
): { forward: number; strafe: number } {
  const x = dx / radius;
  const y = -dy / radius;
  const len = Math.hypot(x, y);
  if (len <= STICK_DEADZONE) return { forward: 0, strafe: 0 };
  const scaled = Math.min(1, (len - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  return { forward: snap((y / len) * scaled), strafe: snap((x / len) * scaled) };
}

/**
 * Touch controls as an input source: a virtual stick, a look pad and buttons.
 * The DOM overlay (presentation) calls the methods below; this class only
 * buffers and drains per tick, the same contract as KeyboardMouseInput.
 *
 * It wraps another source (the keyboard) so both work at once; when both
 * move in one tick, the touch stick wins.
 */
export class TouchInput implements InputSource {
  private forward = 0;
  private strafe = 0;
  private lastForward = 0;
  private lastStrafe = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private readonly pending: InputCommand[] = [];
  private readonly out: InputCommand[] = [];
  private readonly toggled = new Set<Action>();

  constructor(
    private readonly inner: InputSource,
    private readonly lookSensitivity = 0.006,
  ) {}

  /** Thumb moved on the stick, offset from where it went down. */
  stick(dx: number, dy: number, radius: number): void {
    const a = stickAxes(dx, dy, radius);
    this.forward = a.forward;
    this.strafe = a.strafe;
  }

  stickReleased(): void {
    this.forward = 0;
    this.strafe = 0;
  }

  /** Finger dragged on the look pad by (dx, dy) screen pixels. */
  look(dx: number, dy: number): void {
    this.lookYaw -= dx * this.lookSensitivity;
    this.lookPitch -= dy * this.lookSensitivity;
  }

  /** A hold button went down or up. */
  button(action: Action, pressed: boolean): void {
    this.pending.push({ type: 'action', action, pressed });
  }

  /** A tap-to-toggle button (aim, crouch, sprint): first tap holds, second releases. Returns the new state. */
  toggle(action: Action): boolean {
    const on = !this.toggled.has(action);
    if (on) this.toggled.add(action);
    else this.toggled.delete(action);
    this.pending.push({ type: 'action', action, pressed: on });
    return on;
  }

  isToggled(action: Action): boolean {
    return this.toggled.has(action);
  }

  /** A tap: press now, release on a later tick. */
  tap(action: Action): void {
    this.pending.push({ type: 'action', action, pressed: true });
    this.pending.push({ type: 'action', action, pressed: false });
  }

  commandsFor(tick: Tick): readonly InputCommand[] {
    const out = this.out;
    out.length = 0;
    let innerMove: InputCommand | null = null;
    for (const c of this.inner.commandsFor(tick)) {
      if (c.type === 'move') innerMove = c;
      else out.push(c);
    }
    if (this.forward !== this.lastForward || this.strafe !== this.lastStrafe) {
      out.push({ type: 'move', forward: this.forward, strafe: this.strafe });
      this.lastForward = this.forward;
      this.lastStrafe = this.strafe;
    } else if (innerMove !== null) {
      out.push(innerMove);
    }
    if (this.lookYaw !== 0 || this.lookPitch !== 0) {
      out.push({ type: 'look', yaw: this.lookYaw, pitch: this.lookPitch });
      this.lookYaw = 0;
      this.lookPitch = 0;
    }
    // One edge per action per tick: a quick tap's release waits for the next tick.
    const seen = new Set<Action>();
    let kept = 0;
    for (const c of this.pending) {
      if (c.type === 'action' && !seen.has(c.action)) {
        seen.add(c.action);
        out.push(c);
      } else {
        this.pending[kept++] = c;
      }
    }
    this.pending.length = kept;
    return out;
  }
}
