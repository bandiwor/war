import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PLAYER_TUNING, PlayerTuningSchema } from './tuning';
import {
  applyFeedback,
  capsuleHeight,
  createMotorOutput,
  createMotorState,
  eyeHeight,
  stepMotor,
  GROUND_STICK,
  type MotorInput,
} from './movement';

const DT = 1 / 60;
const T = PLAYER_TUNING;
const input = (over: Partial<MotorInput> = {}): MotorInput => ({
  forward: 0,
  strafe: 0,
  yaw: 0,
  sprint: false,
  crouch: false,
  jumpPressed: false,
  ...over,
});

/** Runs the motor on flat, unobstructed ground. */
function simulate(
  ticks: number,
  inp: MotorInput,
  s = Object.assign(createMotorState(), { grounded: true }),
) {
  const out = createMotorOutput();
  const land = { landed: false, impactSpeed: 0 };
  let y = 0;
  let landings = 0;
  for (let i = 0; i < ticks; i++) {
    stepMotor(s, i === 0 ? inp : { ...inp, jumpPressed: false }, T, DT, out);
    let dy = out.dy;
    if (y + dy <= 0) dy = -y; // floor at y = 0
    y += dy;
    applyFeedback(
      s,
      { dx: out.dx, dy, dz: out.dz, grounded: y <= 1e-9, heightApplied: true },
      out.dy,
      DT,
      land,
    );
    if (land.landed) landings++;
  }
  return { s, out, y, landings };
}

describe('player tuning', () => {
  it('validates', () => {
    expect(PlayerTuningSchema.safeParse(T).success).toBe(true);
  });
});

describe('motor', () => {
  it('accelerates to walking speed forward (-Z at yaw 0) and to sprint speed', () => {
    const walk = simulate(120, input({ forward: 1 }));
    expect(walk.s.vz).toBeCloseTo(-T.walkSpeed, 6);
    expect(walk.s.vx).toBeCloseTo(0, 6);
    expect(walk.out.dy).toBe(-GROUND_STICK);
    const run = simulate(120, input({ forward: 1, sprint: true }));
    expect(Math.hypot(run.s.vx, run.s.vz)).toBeCloseTo(T.sprintSpeed, 6);
    expect(run.s.stamina).toBeLessThan(1);
  });

  it('backpedal and strafe are slower; diagonals are normalised', () => {
    expect(simulate(120, input({ forward: -1 })).s.vz).toBeCloseTo(
      T.walkSpeed * T.backpedalFactor,
      6,
    );
    expect(simulate(120, input({ strafe: 1 })).s.vx).toBeCloseTo(T.walkSpeed * T.strafeFactor, 6);
    const diag = simulate(120, input({ forward: 1, strafe: 1 })).s;
    expect(Math.hypot(diag.vx, diag.vz)).toBeLessThanOrEqual(T.walkSpeed + 1e-9);
  });

  it('yaw rotates the wish direction', () => {
    const s = simulate(120, input({ forward: 1, yaw: Math.PI / 2 })).s;
    expect(s.vx).toBeCloseTo(-T.walkSpeed, 6);
    expect(Math.abs(s.vz)).toBeLessThan(1e-6);
  });

  it('cannot sprint backwards, crouched, or exhausted', () => {
    const back = simulate(60, input({ forward: -1, sprint: true })).s;
    expect(Math.hypot(back.vx, back.vz)).toBeCloseTo(T.walkSpeed * T.backpedalFactor, 6);
    const crouched = simulate(120, input({ forward: 1, sprint: true, crouch: true })).s;
    expect(Math.abs(crouched.vz)).toBeCloseTo(T.crouchSpeed, 6);
    const tired = Object.assign(createMotorState(), { grounded: true, stamina: 0.1 });
    // 30 ticks: stamina regenerates but stays below the sprint threshold.
    expect(Math.abs(simulate(30, input({ forward: 1, sprint: true }), tired).s.vz)).toBeCloseTo(
      T.walkSpeed,
      6,
    );
  });

  it('jumps about 0.45 m and lands once with an impact speed', () => {
    const s = Object.assign(createMotorState(), { grounded: true });
    const out = createMotorOutput();
    const land = { landed: false, impactSpeed: 0 };
    let y = 0;
    let peak = 0;
    let impact = 0;
    for (let i = 0; i < 120; i++) {
      stepMotor(s, input({ jumpPressed: i === 0 }), T, DT, out);
      if (i === 0) {
        expect(out.jumped).toBe(true);
        expect(s.stamina).toBeCloseTo(1 - T.staminaJumpCost + T.staminaRegen * DT, 9);
      }
      let dy = out.dy;
      if (y + dy <= 0) dy = -y;
      y += dy;
      peak = Math.max(peak, y);
      applyFeedback(
        s,
        { dx: 0, dy, dz: 0, grounded: y <= 1e-9, heightApplied: true },
        out.dy,
        DT,
        land,
      );
      if (land.landed) impact = land.impactSpeed;
    }
    expect(peak).toBeCloseTo((T.jumpSpeed * T.jumpSpeed) / (2 * T.gravity), 1);
    expect(impact).toBeGreaterThan(2.5);
    expect(s.grounded).toBe(true);
  });

  it('cannot jump crouched, airborne or without stamina', () => {
    const out = createMotorOutput();
    stepMotor(
      Object.assign(createMotorState(), { grounded: true, crouch: 1 }),
      input({ jumpPressed: true, crouch: true }),
      T,
      DT,
      out,
    );
    expect(out.jumped).toBe(false);
    stepMotor(createMotorState(), input({ jumpPressed: true }), T, DT, out);
    expect(out.jumped).toBe(false);
    stepMotor(
      Object.assign(createMotorState(), { grounded: true, stamina: 0.01 }),
      input({ jumpPressed: true }),
      T,
      DT,
      out,
    );
    expect(out.jumped).toBe(false);
  });

  it('crouch blends the capsule height and is held while a ceiling blocks standing', () => {
    const s = simulate(30, input({ crouch: true })).s;
    expect(s.crouch).toBe(1);
    const out = createMotorOutput();
    s.ceilingBlocked = true;
    stepMotor(s, input({ crouch: false }), T, DT, out);
    expect(s.crouch).toBe(1);
    expect(out.height).toBeCloseTo(T.crouchHeight);
    s.ceilingBlocked = false;
    stepMotor(s, input({ crouch: false }), T, DT, out);
    expect(s.crouch).toBeLessThan(1);
    expect(eyeHeight(T, 0)).toBeCloseTo(1.7);
    expect(capsuleHeight(T, 1)).toBe(T.crouchHeight);
  });

  it('walls cancel velocity; ceilings stop upward motion; height feedback sets the ceiling flag', () => {
    const s = Object.assign(createMotorState(), { grounded: false, vy: 2, vx: 1 });
    const land = { landed: false, impactSpeed: 0 };
    applyFeedback(
      s,
      { dx: 0, dy: 0, dz: 0, grounded: false, heightApplied: false },
      0.03,
      DT,
      land,
    );
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.ceilingBlocked).toBe(true);
  });

  it('property: speed never exceeds sprint speed and stamina stays in [0,1]', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            forward: fc.double({ min: -2, max: 2, noNaN: true }),
            strafe: fc.double({ min: -2, max: 2, noNaN: true }),
            yaw: fc.double({ min: -10, max: 10, noNaN: true }),
            sprint: fc.boolean(),
            crouch: fc.boolean(),
            jumpPressed: fc.boolean(),
          }),
          { maxLength: 200 },
        ),
        (inputs) => {
          const s = Object.assign(createMotorState(), { grounded: true });
          const out = createMotorOutput();
          const land = { landed: false, impactSpeed: 0 };
          let y = 0;
          for (const inp of inputs) {
            stepMotor(s, inp, T, DT, out);
            let dy = out.dy;
            if (y + dy <= 0) dy = -y;
            y += dy;
            applyFeedback(
              s,
              { dx: out.dx, dy, dz: out.dz, grounded: y <= 1e-9, heightApplied: true },
              out.dy,
              DT,
              land,
            );
            expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(T.sprintSpeed + 1e-9);
            expect(s.stamina).toBeGreaterThanOrEqual(0);
            expect(s.stamina).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });
});
