import type { InputSource } from '../../application/loop/ports';
import type { Tick } from '../../domain/core/brand';
import type { Action, InputCommand } from '../../domain/input/commands';

const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  KeyR: 'reload',
  Space: 'jump',
  ControlLeft: 'crouch',
  ShiftLeft: 'sprint',
  KeyE: 'use',
  KeyF: 'flashlight',
  KeyB: 'fireMode',
};

/** Number row selects loadout slots 1–9, 0. */
const SLOT_KEYS: Readonly<Record<string, number>> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Digit5: 4,
  Digit6: 5,
  Digit7: 6,
  Digit8: 7,
  Digit9: 8,
  Digit0: 9,
};

/**
 * Translates DOM keyboard/mouse events into per-tick commands. Events are
 * buffered and drained once per tick, so the simulation never sees the DOM.
 */
export class KeyboardMouseInput implements InputSource {
  private readonly held = new Set<string>();
  private readonly pending: InputCommand[] = [];
  private readonly releaseNext: InputCommand[] = [];
  private lookYaw = 0;
  private lookPitch = 0;
  private lastForward = 0;
  private lastStrafe = 0;
  private readonly out: InputCommand[] = [];
  private readonly abort = new AbortController();

  constructor(
    target: HTMLElement,
    private readonly sensitivity = 0.0025,
  ) {
    const signal = this.abort.signal;
    window.addEventListener(
      'keydown',
      (e) => {
        this.onKey(e.code, true, e.repeat);
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (e) => {
        this.onKey(e.code, false, false);
      },
      { signal },
    );
    target.addEventListener(
      'mousemove',
      (e) => {
        // Only a captured mouse looks around: a free cursor crossing the canvas must not turn the camera.
        if (document.pointerLockElement !== target) return;
        this.lookYaw -= e.movementX * this.sensitivity;
        this.lookPitch -= e.movementY * this.sensitivity;
      },
      { signal },
    );
    target.addEventListener(
      'mousedown',
      (e) => {
        this.onButton(e.button, true);
      },
      { signal },
    );
    target.addEventListener(
      'mouseup',
      (e) => {
        this.onButton(e.button, false);
      },
      { signal },
    );
  }

  dispose(): void {
    this.abort.abort();
  }

  commandsFor(_tick: Tick): readonly InputCommand[] {
    const out = this.out;
    out.length = 0;
    const forward = (this.held.has('KeyW') ? 1 : 0) - (this.held.has('KeyS') ? 1 : 0);
    const strafe = (this.held.has('KeyD') ? 1 : 0) - (this.held.has('KeyA') ? 1 : 0);
    if (forward !== this.lastForward || strafe !== this.lastStrafe) {
      out.push({ type: 'move', forward, strafe });
      this.lastForward = forward;
      this.lastStrafe = strafe;
    }
    if (this.lookYaw !== 0 || this.lookPitch !== 0) {
      out.push({ type: 'look', yaw: this.lookYaw, pitch: this.lookPitch });
      this.lookYaw = 0;
      this.lookPitch = 0;
    }
    for (const cmd of this.pending) out.push(cmd);
    this.pending.length = 0;
    for (const cmd of this.releaseNext) this.pending.push(cmd);
    this.releaseNext.length = 0;
    return out;
  }

  private onKey(code: string, down: boolean, repeat: boolean): void {
    if (repeat) return;
    if (down) this.held.add(code);
    else this.held.delete(code);
    const action = KEY_ACTIONS[code];
    if (action !== undefined) this.pending.push({ type: 'action', action, pressed: down });
    const slot = SLOT_KEYS[code];
    if (down && slot !== undefined) this.pending.push({ type: 'select', slot });
  }

  private onButton(button: number, down: boolean): void {
    if (button === 0) this.pending.push({ type: 'action', action: 'fire', pressed: down });
    if (button === 2) this.pending.push({ type: 'action', action: 'aim', pressed: down });
  }
}
