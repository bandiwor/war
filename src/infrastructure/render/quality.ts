/** Render quality presets. Automatic scaling between them arrives in stage 10. */
export interface QualitySettings {
  readonly name: QualityName;
  /** Internal resolution relative to the canvas. */
  readonly renderScale: number;
  readonly maxPixelRatio: number;
  readonly textureSize: number;
  readonly shadowMapSize: number;
  readonly msaa: number;
  readonly bloomLevels: number;
  readonly motionBlurSamples: number;
}

export type QualityName = 'low' | 'medium' | 'high';

export const QUALITY_PRESETS: Readonly<Record<QualityName, QualitySettings>> = {
  low: {
    name: 'low',
    renderScale: 0.6,
    maxPixelRatio: 1,
    textureSize: 256,
    shadowMapSize: 512,
    msaa: 0,
    bloomLevels: 4,
    motionBlurSamples: 4,
  },
  medium: {
    name: 'medium',
    renderScale: 0.85,
    maxPixelRatio: 1.5,
    textureSize: 512,
    shadowMapSize: 1024,
    msaa: 2,
    bloomLevels: 5,
    motionBlurSamples: 8,
  },
  high: {
    name: 'high',
    renderScale: 1,
    maxPixelRatio: 2,
    textureSize: 512,
    shadowMapSize: 2048,
    msaa: 4,
    bloomLevels: 6,
    motionBlurSamples: 12,
  },
};

export function isQualityName(v: string): v is QualityName {
  return v === 'low' || v === 'medium' || v === 'high';
}
