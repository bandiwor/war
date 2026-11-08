import type { EffectFactories } from '../types';
import { createAutoExposure } from './auto-exposure';
import { createBloom } from './bloom';
import {
  createChromaticAberration,
  createLensDirt,
  createLensDistortion,
  createVignette,
} from './lens';
import { createMotionBlur } from './motion-blur';
import { createOsd } from './osd';
import { createOverexposure } from './overexposure';
import {
  createCompression,
  createGrain,
  createRollingShutter,
  createShadowNoise,
  createSignalLoss,
} from './sensor';

/**
 * Every post effect in the registry must have a factory here; the mapped type
 * makes a missing one a compile error. Injected by the composition root so
 * Vite HMR can hot-swap shaders without reloading the game.
 */
export const EFFECT_FACTORIES: EffectFactories = {
  autoExposure: createAutoExposure,
  motionBlur: createMotionBlur,
  bloom: createBloom,
  overexposure: createOverexposure,
  lensDistortion: createLensDistortion,
  chromaticAberration: createChromaticAberration,
  lensDirt: createLensDirt,
  vignette: createVignette,
  rollingShutter: createRollingShutter,
  shadowNoise: createShadowNoise,
  grain: createGrain,
  compression: createCompression,
  signalLoss: createSignalLoss,
  osd: createOsd,
};
