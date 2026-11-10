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
  /** Open world: chunk rings drawn around the camera, and rings with small props. */
  readonly viewChunks: number;
  readonly detailChunks: number;
  readonly rainDrops: number;
  /** Real lights handed to the nearest streamed lamps / glows / beacons. */
  readonly lightPool: { readonly lamps: number; readonly glows: number; readonly beacons: number };
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
    viewChunks: 2,
    detailChunks: 1,
    rainDrops: 2500,
    lightPool: { lamps: 4, glows: 3, beacons: 1 },
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
    viewChunks: 3,
    detailChunks: 2,
    rainDrops: 5000,
    lightPool: { lamps: 6, glows: 4, beacons: 2 },
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
    viewChunks: 3,
    detailChunks: 2,
    rainDrops: 8000,
    lightPool: { lamps: 8, glows: 6, beacons: 2 },
  },
};

export function isQualityName(v: string): v is QualityName {
  return v === 'low' || v === 'medium' || v === 'high';
}
