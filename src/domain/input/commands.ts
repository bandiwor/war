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

export const InputCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move'),
    forward: z.number().min(-1).max(1),
    strafe: z.number().min(-1).max(1),
  }),
  z.object({ type: z.literal('look'), yaw: z.number(), pitch: z.number() }),
  z.object({ type: z.literal('action'), action: z.enum(ACTIONS), pressed: z.boolean() }),
  /** Select a loadout slot directly (number keys). */
  z.object({ type: z.literal('select'), slot: z.number().int().min(0).max(9) }),
]);

export type InputCommand = z.infer<typeof InputCommandSchema>;

export function actionBit(action: Action): number {
  return 1 << ACTIONS.indexOf(action);
}
