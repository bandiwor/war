import type { Action } from '../domain/input/commands';
import type { TouchInput } from '../infrastructure/browser/touch-input';

/** How a button behaves: held while touched, toggled per tap, or a single tap. */
type Mode = 'hold' | 'toggle' | 'tap';

interface ButtonSpec {
  readonly action: Action;
  readonly label: string;
  readonly mode: Mode;
  readonly cls: string;
}

const BUTTONS: readonly ButtonSpec[] = [
  { action: 'fire', label: 'FIRE', mode: 'hold', cls: 'tc-fire' },
  { action: 'aim', label: 'AIM', mode: 'toggle', cls: 'tc-aim' },
  { action: 'reload', label: 'R', mode: 'tap', cls: 'tc-reload' },
  { action: 'jump', label: 'JUMP', mode: 'tap', cls: 'tc-jump' },
  { action: 'crouch', label: 'DUCK', mode: 'toggle', cls: 'tc-crouch' },
  { action: 'sprint', label: 'RUN', mode: 'toggle', cls: 'tc-sprint' },
  { action: 'nextWeapon', label: 'WPN', mode: 'tap', cls: 'tc-weapon' },
  { action: 'fireMode', label: 'MODE', mode: 'tap', cls: 'tc-mode' },
  { action: 'flashlight', label: 'LIGHT', mode: 'tap', cls: 'tc-light' },
  { action: 'use', label: 'USE', mode: 'tap', cls: 'tc-use' },
];

const STICK_RADIUS = 56;

/**
 * The on-screen controls for phones and tablets: a floating stick on the left
 * half, a look pad on the right half and action buttons. Pointer events only
 * (they cover touch, pen and mouse), each finger tracked by pointerId.
 */
export function mountTouchControls(root: HTMLElement, input: TouchInput): () => void {
  const abort = new AbortController();
  const signal = abort.signal;
  const layer = document.createElement('div');
  layer.className = 'touch-controls';
  layer.dataset['testid'] = 'touch-controls';

  const stickZone = document.createElement('div');
  stickZone.className = 'tc-stick-zone';
  stickZone.dataset['testid'] = 'touch-stick';
  const base = document.createElement('div');
  base.className = 'tc-stick-base';
  const knob = document.createElement('div');
  knob.className = 'tc-stick-knob';
  base.append(knob);
  stickZone.append(base);

  const lookZone = document.createElement('div');
  lookZone.className = 'tc-look-zone';
  lookZone.dataset['testid'] = 'touch-look';
  layer.append(stickZone, lookZone);

  // Stick: floating, centred where the thumb lands.
  let stickId = -1;
  let ox = 0;
  let oy = 0;
  const placeStick = (dx: number, dy: number): void => {
    const len = Math.hypot(dx, dy);
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    knob.style.transform = `translate(${String(dx * k)}px, ${String(dy * k)}px)`;
  };
  stickZone.addEventListener(
    'pointerdown',
    (e) => {
      if (stickId !== -1) return;
      stickId = e.pointerId;
      stickZone.setPointerCapture(e.pointerId);
      const r = stickZone.getBoundingClientRect();
      ox = e.clientX;
      oy = e.clientY;
      base.style.left = `${String(ox - r.left)}px`;
      base.style.top = `${String(oy - r.top)}px`;
      base.classList.add('active');
      placeStick(0, 0);
      e.preventDefault();
    },
    { signal },
  );
  stickZone.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerId !== stickId) return;
      const dx = e.clientX - ox;
      const dy = e.clientY - oy;
      input.stick(dx, dy, STICK_RADIUS);
      placeStick(dx, dy);
    },
    { signal },
  );
  const endStick = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    input.stickReleased();
    base.classList.remove('active');
    base.style.removeProperty('left');
    base.style.removeProperty('top');
    placeStick(0, 0);
  };
  stickZone.addEventListener('pointerup', endStick, { signal });
  stickZone.addEventListener('pointercancel', endStick, { signal });

  // Look pad: relative drag, any number of fingers each contributing its own motion.
  const lastPos = new Map<number, { x: number; y: number }>();
  const trackLook = (el: HTMLElement): void => {
    el.addEventListener(
      'pointerdown',
      (e) => {
        lastPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      },
      { signal },
    );
    el.addEventListener(
      'pointermove',
      (e) => {
        const p = lastPos.get(e.pointerId);
        if (p === undefined) return;
        input.look(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX;
        p.y = e.clientY;
      },
      { signal },
    );
    const end = (e: PointerEvent): void => {
      lastPos.delete(e.pointerId);
    };
    el.addEventListener('pointerup', end, { signal });
    el.addEventListener('pointercancel', end, { signal });
  };
  lookZone.addEventListener(
    'pointerdown',
    (e) => {
      lookZone.setPointerCapture(e.pointerId);
    },
    { signal },
  );
  trackLook(lookZone);

  for (const spec of BUTTONS) {
    const b = document.createElement('div');
    b.className = `tc-btn ${spec.cls}`;
    b.textContent = spec.label;
    b.dataset['testid'] = `touch-${spec.action}`;
    b.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        if (spec.mode === 'hold') {
          input.button(spec.action, true);
          b.classList.add('on');
        } else if (spec.mode === 'toggle') {
          b.classList.toggle('on', input.toggle(spec.action));
        } else {
          input.tap(spec.action);
          b.classList.add('on');
        }
      },
      { signal },
    );
    const up = (): void => {
      if (spec.mode === 'hold') input.button(spec.action, false);
      if (spec.mode !== 'toggle') b.classList.remove('on');
    };
    b.addEventListener('pointerup', up, { signal });
    b.addEventListener('pointercancel', up, { signal });
    // Fire doubles as a look pad: the shooting thumb can keep aiming while held.
    if (spec.action === 'fire') trackLook(b);
    layer.append(b);
  }

  // Long-press menus and double-tap zoom would steal the game's gestures.
  layer.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    { signal },
  );
  root.append(layer);
  return () => {
    abort.abort();
    layer.remove();
  };
}

/** True for phones and tablets: the primary pointer is a finger. */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}
