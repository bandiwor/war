import { z } from 'zod';

/**
 * Player input as the simulation sees it: device-independent, per tick.
 * This is the only external data that may influence the simulation, so it is
 * what replays record.
 */
export const ACTIONS = [
  'fire',
  'aim',
  'reload',
  'jump',
  'crouch',
  'sprint',
  'use',
  'flashlight',
  // Appended (never reorder: replays store action bits by index).
  'fireMode',
  'nextWeapon',
  'prevWeapon',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Environment settings a command can change; see domain/world/environment.ts. */
export const ENV_KEYS = ['timeOfDay', 'timeScale', 'fog', 'rain', 'wind'] as const;
export type EnvKey = (typeof ENV_KEYS)[number];

export const InputCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move'),
    forward: z.number().min(-1).max(1),
    strafe: z.number().min(-1).max(1),
  }),
  z.object({ type: z.literal('look'), yaw: z.number(), pitch: z.number() }),
  z.object({ type: z.literal('action'), action: z.enum(ACTIONS), pressed: z.boolean() }),
  /** Select a loadout slot directly (number keys). */
  z.object({ type: z.literal('select'), slot: z.number().int().min(0).max(15) }),
  /**
   * World controls (debug menu, scripted scenes). They are commands, not side
   * channels, so a replay reproduces a session in which the clock or the
   * weather was changed. Weather values of −1 return control to the simulation.
   */
  z.object({
    type: z.literal('env'),
    key: z.enum(ENV_KEYS),
    value: z.number().min(-1).max(86400),
  }),
  /** Spawn a mob (registry id) at a point (debug menu, bestiary, tests). */
  z.object({
    type: z.literal('spawn'),
    mob: z.string().max(64),
    x: z.number().min(-10000).max(10000),
    z: z.number().min(-10000).max(10000),
    yaw: z.number().min(-10).max(10),
  }),
  /** Debug cheats: invulnerability, flying through walls, full heal. */
  z.object({ type: z.literal('cheat'), key: z.enum(['god', 'noclip', 'heal']), on: z.boolean() }),
  /** Move the player's feet to a point (debug teleport). */
  z.object({
    type: z.literal('teleport'),
    x: z.number().min(-10000).max(10000),
    y: z.number().min(-1000).max(1000),
    z: z.number().min(-10000).max(10000),
  }),
]);

export type InputCommand = z.infer<typeof InputCommandSchema>;

export function actionBit(action: Action): number {
  return 1 << ACTIONS.indexOf(action);
}
