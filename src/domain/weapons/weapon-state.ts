import { assertNever } from '../core/assert';
import type { Rng } from '../math/prng';
import { degToRad, moaToRad } from './ballistics';
import type { Firearm, FireMode, Melee, Throwable, Weapon } from './registry';

/**
 * Weapon state machine (pure, deterministic). One mutable record per carried
 * weapon; `phase` is the discriminant and every transition is in one
 * exhaustive switch. Firearms model the chamber separately from the magazine:
 * a tactical reload keeps the chambered round (17+1), an empty reload ends
 * with chambering. Jams become more likely with wear and are cleared with the
 * reload key.
 */
export type WeaponPhase =
  'ready' | 'cycling' | 'reloading' | 'jammed' | 'clearing' | 'drawing' | 'swinging';
export type ReloadStage = 'magOut' | 'magIn' | 'chamber' | 'shell';

export interface WeaponState {
  phase: WeaponPhase;
  stage: ReloadStage;
  /** Seconds left in the current phase/stage. */
  timer: number;
  mag: number;
  chambered: boolean;
  /** 0 = new, 1 = worn out. */
  wear: number;
  bloomDeg: number;
  /** Accumulated recoil offset on the aim, degrees (pitch up, yaw right). */
  recoilPitch: number;
  recoilYaw: number;
  patternIndex: number;
  sinceShot: number;
  cooldown: number;
  fireModeIndex: number;
  burstLeft: number;
  /** Fraction of the current melee swing completed. */
  swing: number;
  /** Reload started on an empty chamber (needs chambering at the end). */
  wasEmpty: boolean;
}

export interface WeaponInput {
  trigger: boolean;
  triggerPressed: boolean;
  reloadPressed: boolean;
  fireModePressed: boolean;
  aiming: boolean;
  /** 0 = still, 1 = full speed. */
  moving: number;
  /** Rounds available in reserve for this weapon's ammo. */
  reserve: number;
}

/** Event bits raised during one tick. */
export const WeaponEvent = {
  SHOT: 1,
  DRY_FIRE: 2,
  JAMMED: 4,
  RELOAD_START: 8,
  MAG_OUT: 16,
  MAG_IN: 32,
  CHAMBERED: 64,
  SHELL_IN: 128,
  JAM_CLEARED: 256,
  CYCLED: 512,
  MODE_CHANGED: 1024,
  DRAWN: 2048,
  SWING: 4096,
  MELEE_IMPACT: 8192,
  THROW: 16384,
} as const;

export interface WeaponOutput {
  events: number;
  /** Full cone angle (radians) for this tick's shot. */
  spreadRad: number;
  /** Recoil applied by this tick's shot (degrees). */
  kickPitch: number;
  kickYaw: number;
  /** Rounds taken from reserve this tick (negative = returned). */
  reserveDelta: number;
}

export function createWeaponOutput(): WeaponOutput {
  return { events: 0, spreadRad: 0, kickPitch: 0, kickYaw: 0, reserveDelta: 0 };
}

export function createWeaponState(w: Weapon): WeaponState {
  const loaded = w.kind === 'firearm';
  return {
    phase: 'drawing',
    stage: 'magOut',
    timer: w.drawSeconds,
    // Single-shot launchers hold their one round in the tube (the "chamber"), nothing behind it.
    mag: loaded && w.action !== 'single' ? w.magazine : 0,
    chambered: loaded && w.chamber,
    wear: 0,
    bloomDeg: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    patternIndex: 0,
    sinceShot: 10,
    cooldown: 0,
    fireModeIndex: 0,
    burstLeft: 0,
    swing: 0,
    wasEmpty: false,
  };
}

/** Start drawing (weapon switch). Interrupts reloads safely: rounds only move at stage boundaries. */
export function drawWeapon(s: WeaponState, w: Weapon): void {
  s.phase = 'drawing';
  s.timer = w.drawSeconds;
  s.burstLeft = 0;
}

export function currentMode(s: WeaponState, w: Firearm): FireMode {
  return w.modes[s.fireModeIndex % w.modes.length] ?? 'semi';
}

/** Total rounds ready to fire (magazine + chamber). */
export function roundsLoaded(s: WeaponState): number {
  return s.mag + (s.chambered ? 1 : 0);
}

export function jamProbability(w: Firearm, wear: number): number {
  return w.wear.jamBase + (w.wear.jamAtFullWear - w.wear.jamBase) * wear * wear;
}

export function tickWeapon(
  s: WeaponState,
  w: Weapon,
  input: WeaponInput,
  rng: Rng,
  dt: number,
  out: WeaponOutput,
): WeaponOutput {
  out.events = 0;
  out.spreadRad = 0;
  out.kickPitch = 0;
  out.kickYaw = 0;
  out.reserveDelta = 0;
  switch (w.kind) {
    case 'firearm':
      tickFirearm(s, w, input, rng, dt, out);
      break;
    case 'melee':
      tickMelee(s, w, input, dt, out);
      break;
    case 'throwable':
      tickThrowable(s, w, input, dt, out);
      break;
    default:
      assertNever(w, 'weapon kind');
  }
  return out;
}

function recover(s: WeaponState, w: Firearm, dt: number): void {
  s.sinceShot += dt;
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.bloomDeg = Math.max(0, s.bloomDeg - w.spread.bloomRecoveryDegPerSec * dt);
  // Aim settles back proportionally on both axes.
  const mag = Math.sqrt(s.recoilPitch * s.recoilPitch + s.recoilYaw * s.recoilYaw);
  if (mag > 0) {
    const k = Math.max(0, mag - w.recoil.recovery * dt) / mag;
    s.recoilPitch *= k;
    s.recoilYaw *= k;
  }
  if (s.sinceShot > 0.35) s.patternIndex = 0;
}

function chamberFromMag(s: WeaponState, out: WeaponOutput): void {
  if (s.mag > 0 && !s.chambered) {
    s.mag--;
    s.chambered = true;
    out.events |= WeaponEvent.CHAMBERED;
  }
}

function tickFirearm(
  s: WeaponState,
  w: Firearm,
  input: WeaponInput,
  rng: Rng,
  dt: number,
  out: WeaponOutput,
): void {
  recover(s, w, dt);
  const capacity = w.magazine;

  switch (s.phase) {
    case 'drawing':
      s.timer -= dt;
      if (s.timer <= 0) {
        s.phase = 'ready';
        out.events |= WeaponEvent.DRAWN;
      }
      return;
    case 'cycling':
      s.timer -= dt;
      if (s.timer <= 0) {
        s.phase = 'ready';
        out.events |= WeaponEvent.CYCLED;
        if (s.mag > 0 && rng.nextFloat() < jamProbability(w, s.wear)) {
          s.phase = 'jammed';
          out.events |= WeaponEvent.JAMMED;
          return;
        }
        chamberFromMag(s, out);
      }
      return;
    case 'jammed':
      if (input.reloadPressed) {
        s.phase = 'clearing';
        s.timer = w.wear.clearSeconds;
      } else if (input.triggerPressed) {
        out.events |= WeaponEvent.DRY_FIRE;
      }
      return;
    case 'clearing':
      s.timer -= dt;
      if (s.timer <= 0) {
        // The stuck round is ejected and lost; feed the next one.
        s.chambered = false;
        s.phase = 'ready';
        out.events |= WeaponEvent.JAM_CLEARED;
        chamberFromMag(s, out);
      }
      return;
    case 'reloading':
      tickReload(s, w, input, dt, out);
      return;
    case 'swinging':
      s.phase = 'ready';
      return;
    case 'ready':
      break;
    default:
      assertNever(s.phase, 'firearm phase');
  }

  if (input.fireModePressed && w.modes.length > 1) {
    s.fireModeIndex = (s.fireModeIndex + 1) % w.modes.length;
    out.events |= WeaponEvent.MODE_CHANGED;
  }

  const full =
    w.action === 'single' ? s.chambered : s.mag >= capacity && (s.chambered || !w.chamber);
  if (input.reloadPressed && !full && input.reserve > 0) {
    s.phase = 'reloading';
    s.wasEmpty = !s.chambered;
    s.burstLeft = 0;
    out.events |= WeaponEvent.RELOAD_START;
    if (w.tubeFed) {
      s.stage = 'shell';
      s.timer = w.reload.shellSeconds;
    } else {
      s.stage = 'magOut';
      s.timer = s.wasEmpty ? w.reload.emptySeconds * 0.35 : w.reload.tacticalSeconds * 0.45;
    }
    return;
  }

  const mode = currentMode(s, w);
  if (input.triggerPressed && mode === 'burst') s.burstLeft = w.burst;
  const wantsShot =
    mode === 'auto' ? input.trigger : mode === 'burst' ? s.burstLeft > 0 : input.triggerPressed;
  if (!wantsShot || s.cooldown > 0) return;

  if (!s.chambered) {
    if (input.triggerPressed) out.events |= WeaponEvent.DRY_FIRE;
    s.burstLeft = 0;
    return;
  }

  // Fire.
  s.chambered = false;
  s.cooldown = 60 / w.rpm;
  s.sinceShot = 0;
  if (s.burstLeft > 0) s.burstLeft--;
  s.wear = Math.min(1, s.wear + w.wear.perShot);
  out.events |= WeaponEvent.SHOT;

  const coneDeg =
    (input.aiming ? w.spread.adsDeg : w.spread.hipDeg) +
    input.moving * w.spread.movingDeg +
    s.bloomDeg;
  out.spreadRad = (degToRad(coneDeg) + moaToRad(w.accuracyMoa)) * (1 + 0.5 * s.wear);
  s.bloomDeg = Math.min(w.spread.bloomMaxDeg, s.bloomDeg + w.spread.bloomPerShotDeg);

  const pattern = w.recoil.pattern;
  const idx =
    s.patternIndex < pattern.length
      ? s.patternIndex
      : w.recoil.loopFrom +
        ((s.patternIndex - pattern.length) % Math.max(1, pattern.length - w.recoil.loopFrom));
  const [kp, ky] = pattern[idx] ?? [0, 0];
  const steady = input.aiming ? 0.75 : 1;
  out.kickPitch = kp * steady;
  out.kickYaw = (ky + rng.range(-w.recoil.jitter, w.recoil.jitter)) * steady;
  s.recoilPitch += out.kickPitch;
  s.recoilYaw += out.kickYaw;
  s.patternIndex++;

  // Cycle the action.
  if (w.action === 'semiauto') {
    if (s.mag > 0 && rng.nextFloat() < jamProbability(w, s.wear)) {
      s.phase = 'jammed';
      out.events |= WeaponEvent.JAMMED;
      s.burstLeft = 0;
      return;
    }
    if (s.mag > 0) {
      s.mag--;
      s.chambered = true;
    }
  } else if (w.action !== 'single') {
    s.phase = 'cycling';
    s.timer = w.cycleSeconds;
  }
}

function tickReload(
  s: WeaponState,
  w: Firearm,
  input: WeaponInput,
  dt: number,
  out: WeaponOutput,
): void {
  // Shell-by-shell reloads can be interrupted to shoot.
  if (s.stage === 'shell' && input.triggerPressed && (s.chambered || s.mag > 0)) {
    s.phase = 'ready';
    if (!s.chambered) {
      s.phase = 'cycling';
      s.timer = w.cycleSeconds;
    }
    return;
  }
  s.timer -= dt;
  if (s.timer > 0) return;
  switch (s.stage) {
    case 'magOut':
      // The partial magazine goes back into the pouch.
      out.reserveDelta -= s.mag;
      s.mag = 0;
      out.events |= WeaponEvent.MAG_OUT;
      s.stage = 'magIn';
      s.timer = s.wasEmpty ? w.reload.emptySeconds * 0.4 : w.reload.tacticalSeconds * 0.55;
      return;
    case 'magIn': {
      const take = Math.min(w.magazine, input.reserve - out.reserveDelta);
      s.mag = Math.max(0, take);
      out.reserveDelta += s.mag;
      out.events |= WeaponEvent.MAG_IN;
      if (!s.chambered && w.chamber) {
        s.stage = 'chamber';
        s.timer = w.reload.emptySeconds * 0.25;
      } else {
        s.phase = 'ready';
      }
      return;
    }
    case 'chamber':
      s.phase = 'ready';
      chamberFromMag(s, out);
      return;
    case 'shell':
      if (s.mag < w.magazine && input.reserve > 0) {
        s.mag++;
        out.reserveDelta += 1;
        out.events |= WeaponEvent.SHELL_IN;
      }
      if (s.mag < w.magazine && input.reserve - out.reserveDelta > 0) {
        s.timer = w.reload.shellSeconds;
        return;
      }
      if (!s.chambered) {
        s.stage = 'chamber';
        s.timer = w.cycleSeconds;
        return;
      }
      s.phase = 'ready';
      return;
    default:
      assertNever(s.stage, 'reload stage');
  }
}

function tickMelee(
  s: WeaponState,
  w: Melee,
  input: WeaponInput,
  dt: number,
  out: WeaponOutput,
): void {
  switch (s.phase) {
    case 'drawing':
      s.timer -= dt;
      if (s.timer <= 0) {
        s.phase = 'ready';
        out.events |= WeaponEvent.DRAWN;
      }
      return;
    case 'swinging': {
      const before = s.swing;
      s.swing += dt / w.swingSeconds;
      if (before < w.impactAt && s.swing >= w.impactAt) out.events |= WeaponEvent.MELEE_IMPACT;
      if (s.swing >= 1) {
        s.phase = 'ready';
        s.swing = 0;
      }
      return;
    }
    case 'ready':
      if (input.triggerPressed) {
        s.phase = 'swinging';
        s.swing = 0;
        out.events |= WeaponEvent.SWING;
      }
      return;
    case 'cycling':
    case 'reloading':
    case 'jammed':
    case 'clearing':
      s.phase = 'ready';
      return;
    default:
      assertNever(s.phase, 'melee phase');
  }
}

function tickThrowable(
  s: WeaponState,
  w: Throwable,
  input: WeaponInput,
  dt: number,
  out: WeaponOutput,
): void {
  switch (s.phase) {
    case 'drawing':
      s.timer -= dt;
      if (s.timer <= 0) {
        s.phase = 'ready';
        out.events |= WeaponEvent.DRAWN;
      }
      return;
    case 'ready':
      if (input.triggerPressed && input.reserve > 0) {
        out.events |= WeaponEvent.THROW;
        out.reserveDelta += 1;
        // Ready the next one if any remain.
        s.phase = 'drawing';
        s.timer = w.drawSeconds;
      } else if (input.triggerPressed) {
        out.events |= WeaponEvent.DRY_FIRE;
      }
      return;
    case 'cycling':
    case 'reloading':
    case 'jammed':
    case 'clearing':
    case 'swinging':
      s.phase = 'ready';
      return;
    default:
      assertNever(s.phase, 'throwable phase');
  }
}
