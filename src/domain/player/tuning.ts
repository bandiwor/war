import { z } from 'zod';

/**
 * First-person body tuning, as data. Values aim at a realistic, slightly
 * heavy feel: a loaded civilian walking at 1.5 m/s, jogging at 3.6 m/s, a
 * 0.45 m jump, and stamina that runs out.
 */
export const PlayerTuningSchema = z.object({
  radius: z.number().positive(),
  standHeight: z.number().positive(),
  crouchHeight: z.number().positive(),
  /** Eyes sit this far below the top of the head. */
  eyeFromTop: z.number().nonnegative(),
  walkSpeed: z.number().positive(),
  sprintSpeed: z.number().positive(),
  crouchSpeed: z.number().positive(),
  backpedalFactor: z.number().min(0).max(1),
  strafeFactor: z.number().min(0).max(1),
  groundAccel: z.number().positive(),
  groundFriction: z.number().positive(),
  airAccel: z.number().nonnegative(),
  gravity: z.number().positive(),
  jumpSpeed: z.number().positive(),
  crouchTransitionSeconds: z.number().positive(),
  staminaSprintDrain: z.number().nonnegative(),
  staminaRegen: z.number().nonnegative(),
  staminaJumpCost: z.number().nonnegative(),
  staminaMinToSprint: z.number().min(0).max(1),
  stepLength: z.object({
    walk: z.number().positive(),
    sprint: z.number().positive(),
    crouch: z.number().positive(),
  }),
  /** Radius (m) within which a footstep is audible to AI, before surface loudness. */
  footstepNoise: z.object({
    walk: z.number().nonnegative(),
    sprint: z.number().nonnegative(),
    crouch: z.number().nonnegative(),
  }),
  maxStepHeight: z.number().nonnegative(),
  maxSlopeDegrees: z.number().min(0).max(89),
});

export type PlayerTuning = z.infer<typeof PlayerTuningSchema>;

export const PLAYER_TUNING: PlayerTuning = {
  radius: 0.3,
  standHeight: 1.8,
  crouchHeight: 1.2,
  eyeFromTop: 0.1,
  walkSpeed: 1.5,
  sprintSpeed: 3.6,
  crouchSpeed: 0.9,
  backpedalFactor: 0.7,
  strafeFactor: 0.85,
  groundAccel: 10,
  groundFriction: 9,
  airAccel: 1.2,
  gravity: 9.81,
  jumpSpeed: 3.0,
  crouchTransitionSeconds: 0.25,
  staminaSprintDrain: 0.1,
  staminaRegen: 0.07,
  staminaJumpCost: 0.12,
  staminaMinToSprint: 0.15,
  stepLength: { walk: 0.7, sprint: 1.05, crouch: 0.5 },
  footstepNoise: { walk: 8, sprint: 18, crouch: 2.5 },
  maxStepHeight: 0.35,
  maxSlopeDegrees: 45,
};
