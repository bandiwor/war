import { uniform } from '../../gl/fullscreen';
import { simpleChainPass } from '../simple-pass';
import type { EffectPass, PassContext } from '../types';

/**
 * CMOS rolling shutter: rows are read top to bottom over `readout` seconds,
 * so a fast turn skews verticals and a fast tilt stretches the frame.
 */
export function createRollingShutter(ctx: PassContext): EffectPass<'rollingShutter'> {
  return simpleChainPass(
    'rollingShutter',
    ctx,
    { uSkewX: uniform(0), uSkewY: uniform(0) },
    /* glsl */ `
    uniform float uSkewX, uSkewY;
    void main() {
      float row = (1.0 - vUv.y) - 0.5; // read order: top row first
      vec2 uv = vUv + vec2(uSkewX * row, uSkewY * row);
      outColor = vec4(texture(tInput, clamp(uv, 0.0, 1.0)).rgb, 1.0);
    }`,
    (u, p, f) => {
      const fovX = 2 * Math.atan(Math.tan(f.fovY / 2) * f.aspect);
      // Angle turned during readout, as a fraction of the field of view.
      u.uSkewX.value = (-f.yawVelocity * p.readout) / fovX;
      u.uSkewY.value = (f.pitchVelocity * p.readout) / f.fovY;
    },
  );
}

/** Luminance-dependent digital noise: strongest in the shadows, with low-frequency chroma blotches. */
export function createShadowNoise(ctx: PassContext): EffectPass<'shadowNoise'> {
  return simpleChainPass(
    'shadowNoise',
    ctx,
    { uAmount: uniform(0.07), uChroma: uniform(0.6), uThreshold: uniform(0.25) },
    /* glsl */ `
    uniform float uAmount, uChroma, uThreshold;
    void main() {
      vec3 c = texture(tInput, vUv).rgb;
      float dark = 1.0 - smoothstep(0.0, uThreshold, luma(c));
      vec2 px = vUv * uResolution;
      float n = hash12(px, uFrame) - 0.5;
      vec3 chroma = vec3(vnoise(px / 3.0, uFrame + 1.0), vnoise(px / 3.0, uFrame + 2.0), vnoise(px / 3.0, uFrame + 3.0)) - 0.5;
      c += (vec3(n) + chroma * uChroma) * uAmount * dark;
      outColor = vec4(max(c, 0.0), 1.0);
    }`,
    (u, p) => {
      u.uAmount.value = p.amount;
      u.uChroma.value = p.chroma;
      u.uThreshold.value = p.threshold;
    },
  );
}

/** Fine animated sensor grain, strongest in the midtones. */
export function createGrain(ctx: PassContext): EffectPass<'grain'> {
  return simpleChainPass(
    'grain',
    ctx,
    { uAmount: uniform(0.04), uSize: uniform(1.3) },
    /* glsl */ `
    uniform float uAmount, uSize;
    void main() {
      vec3 c = texture(tInput, vUv).rgb;
      float g = vnoise(vUv * uResolution / uSize, uFrame * 7.0 + 5.0) - 0.5;
      float l = luma(c);
      c += g * uAmount * (0.4 + 2.4 * l * (1.0 - l));
      outColor = vec4(c, 1.0);
    }`,
    (u, p) => {
      u.uAmount.value = p.amount;
      u.uSize.value = p.size;
    },
  );
}

/**
 * Low-bitrate encoder look: during fast motion the bitrate budget runs out,
 * so blocks collapse to their DC colour, chroma is subsampled and colours
 * quantise. `motion` drives intensity, so standing still looks clean.
 */
export function createCompression(ctx: PassContext): EffectPass<'compression'> {
  return simpleChainPass(
    'compression',
    ctx,
    { uStrength: uniform(0), uBlock: uniform(8), uLevels: uniform(28) },
    /* glsl */ `
    uniform float uStrength, uBlock, uLevels;
    void main() {
      vec3 c = texture(tInput, vUv).rgb;
      if (uStrength <= 0.001) { outColor = vec4(c, 1.0); return; }
      vec2 px = vUv * uResolution;
      vec2 block = floor(px / uBlock);
      vec2 blockUv = (block + 0.5) * uBlock / uResolution;
      // Coarse DC estimate from a 2x2 sample of the block.
      vec2 q = uBlock * 0.25 / uResolution;
      vec3 dc = (texture(tInput, blockUv + vec2(-q.x, -q.y)).rgb + texture(tInput, blockUv + vec2(q.x, -q.y)).rgb
               + texture(tInput, blockUv + vec2(-q.x, q.y)).rgb + texture(tInput, blockUv + vec2(q.x, q.y)).rgb) * 0.25;
      float detail = length(c - dc);
      float starved = step(1.0 - uStrength, hash12(block, floor(uFrame / 2.0)));
      float k = clamp(uStrength * 1.5, 0.0, 1.0) * starved * smoothstep(0.02, 0.2, detail + 0.05);
      vec3 outc = mix(c, dc, k);
      // Chroma subsampling: keep luma, average chroma over 2x2 pixels.
      vec3 cAvg = texture(tInput, (floor(px / 2.0) * 2.0 + 1.0) / uResolution).rgb;
      outc = mix(outc, outc - luma(outc) + luma(outc) * (cAvg / max(luma(cAvg), 1e-3)), 0.5 * uStrength);
      float levels = mix(256.0, uLevels, uStrength);
      outc = floor(outc * levels + 0.5) / levels;
      outColor = vec4(outc, 1.0);
    }`,
    (u, p, f) => {
      u.uStrength.value = Math.min(1, p.base + f.motion * p.motionGain);
      u.uBlock.value = p.blockSize;
      u.uLevels.value = p.levels;
    },
  );
}

/**
 * Transmission/recorder dropouts: horizontal tearing bands, block dropouts,
 * channel desync and luminance flicker, scaled by an event envelope that the
 * pipeline schedules (rate from params, boosted by EMI from robots).
 */
export function createSignalLoss(ctx: PassContext): EffectPass<'signalLoss'> {
  return simpleChainPass(
    'signalLoss',
    ctx,
    { uLevel: uniform(0), uSeed: uniform(0) },
    /* glsl */ `
    uniform float uLevel, uSeed;
    void main() {
      if (uLevel <= 0.001) { outColor = texture(tInput, vUv); return; }
      vec2 uv = vUv;
      float band = floor(uv.y * mix(6.0, 40.0, hash11(uSeed)));
      float tear = (hash12(vec2(band, 0.0), uSeed + floor(uTime * 24.0)) - 0.5) * 0.25 * uLevel;
      uv.x += tear * step(0.55, hash12(vec2(band, 1.0), uSeed));
      vec3 c;
      c.r = texture(tInput, uv + vec2(0.012 * uLevel, 0.0)).r;
      c.g = texture(tInput, uv).g;
      c.b = texture(tInput, uv - vec2(0.008 * uLevel, 0.0)).b;
      vec2 blk = floor(vUv * uResolution / 16.0);
      float drop = step(1.0 - 0.35 * uLevel * uLevel, hash12(blk, uSeed + floor(uTime * 12.0)));
      c = mix(c, vec3(0.02, 0.09, 0.03) + 0.05 * hash12(blk, uSeed + 9.0), drop);
      float line = step(0.985, hash12(vec2(0.0, floor(vUv.y * uResolution.y)), uSeed + floor(uTime * 30.0)));
      c = mix(c, vec3(0.8), line * uLevel);
      c *= 1.0 - 0.4 * uLevel * hash11(floor(uTime * 20.0) + uSeed);
      outColor = vec4(c, 1.0);
    }`,
    (u, p, f) => {
      u.uLevel.value = f.signalLoss * p.intensity;
      u.uSeed.value = f.signalSeed;
    },
  );
}
