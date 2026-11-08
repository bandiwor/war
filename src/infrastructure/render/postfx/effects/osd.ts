import { uniform } from '../../gl/fullscreen';
import { OsdCanvas } from '../../osd/osd-canvas';
import { simpleChainPass } from '../simple-pass';
import type { EffectPass, PassContext } from '../types';

/** Composites the recorder OSD over the footage (after the lens: it is burned in by the recorder). */
export function createOsd(ctx: PassContext): EffectPass<'osd'> {
  const canvas = new OsdCanvas();
  const pass = simpleChainPass(
    'osd',
    ctx,
    { tOsd: uniform(canvas.texture), uOpacity: uniform(0.9) },
    /* glsl */ `
    uniform sampler2D tOsd; uniform float uOpacity;
    void main() {
      vec3 c = texture(tInput, vUv).rgb;
      // Keep the 16:9 overlay undistorted on other aspects by fitting its height.
      float aspect = uResolution.x / uResolution.y;
      vec2 ouv = vec2((vUv.x - 0.5) * aspect / (16.0 / 9.0) + 0.5, vUv.y);
      vec4 o = texture(tOsd, ouv);
      if (ouv.x < 0.0 || ouv.x > 1.0) o = vec4(0.0);
      outColor = vec4(mix(c, o.rgb, o.a * uOpacity), 1.0);
    }`,
    (u, p, f) => {
      const blink = f.frozen || Math.floor(f.time * 1.25) % 2 === 0;
      canvas.update(f.osd, blink);
      u.uOpacity.value = p.opacity;
    },
  );
  return {
    ...pass,
    dispose() {
      pass.dispose();
      canvas.dispose();
    },
  };
}
