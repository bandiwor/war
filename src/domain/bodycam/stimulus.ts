import { clamp } from '../math/dmath';
import type { PostFxConfig } from './effects';

/**
 * How gameplay feeds the footage look. All values 0..1.
 *  - damage: recent hits (red-shifted aberration, vignette, shake, signal drops)
 *  - fear:   panic/darkness stress (vignette tunnel, faster breathing, grain)
 *  - emi:    electromagnetic interference from nearby robots (noise, tearing, signal loss)
 */
export interface BodycamStimulus {
  damage: number;
  fear: number;
  emi: number;
}

export function createStimulus(): BodycamStimulus {
  return { damage: 0, fear: 0, emi: 0 };
}

/**
 * Writes `base` modulated by `s` into `out` (allocation-free). Only scales
 * parameters; enabling/disabling stays the user's choice.
 */
export function modulatePostFx(
  base: PostFxConfig,
  s: BodycamStimulus,
  out: PostFxConfig,
): PostFxConfig {
  const damage = clamp(s.damage, 0, 1);
  const fear = clamp(s.fear, 0, 1);
  const emi = clamp(s.emi, 0, 1);

  out.chromaticAberration.params.amount =
    base.chromaticAberration.params.amount * (1 + 3 * damage + 2 * emi);
  out.vignette.params.amount = base.vignette.params.amount * (1 + 0.8 * damage + 0.9 * fear);
  out.vignette.params.softness = base.vignette.params.softness * (1 - 0.35 * fear);
  out.grain.params.amount = base.grain.params.amount * (1 + 1.5 * fear + emi);
  out.shadowNoise.params.amount = base.shadowNoise.params.amount * (1 + 0.8 * fear + 3 * emi);
  out.compression.params.base = clamp(
    base.compression.params.base + 0.6 * emi + 0.3 * damage,
    0,
    1,
  );
  out.signalLoss.params.ratePerMinute =
    base.signalLoss.params.ratePerMinute * (1 + 4 * damage) + 40 * emi * emi;
  out.rollingShutter.params.readout = base.rollingShutter.params.readout * (1 + 1.5 * emi);
  out.cameraShake.params.breathing = base.cameraShake.params.breathing * (1 + 2 * fear + damage);
  out.cameraShake.params.roll = base.cameraShake.params.roll * (1 + 2 * damage);
  out.lensDistortion.params.strength = base.lensDistortion.params.strength;
  return out;
}
