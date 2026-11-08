/** Shared GLSL helpers, prepended to post shaders that need them. */
export const GLSL_COMMON = /* glsl */ `
precision highp float;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// PCG-style integer hash -> [0,1). Stable across GPUs (integer ops only).
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hash12(vec2 p, float seed) {
  uvec2 q = uvec2(ivec2(floor(p))) ;
  return float(pcg(q.x + pcg(q.y + pcg(uint(seed))))) / 4294967295.0;
}
float hash11(float x) { return float(pcg(uint(int(floor(x))) + 12345u)) / 4294967295.0; }
float vnoise(vec2 p, float seed) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i, seed), hash12(i + vec2(1, 0), seed), u.x), mix(hash12(i + vec2(0, 1), seed), hash12(i + vec2(1, 1), seed), u.x), u.y);
}
float fbm(vec2 p, float seed) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p, seed + float(i) * 17.0); p *= 2.03; a *= 0.5; }
  return s;
}
`;
