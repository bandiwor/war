/**
 * Streaming 64-bit (two 32-bit lanes) non-cryptographic hash for world-state
 * fingerprints. Allocation-free: feed numbers, read hex digest at the end.
 * Floats are hashed by their exact IEEE-754 bit pattern, so -0 !== 0 and every
 * NaN payload is canonicalised to one value.
 */
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class StateHasher {
  private a = 0x9e3779b9;
  private b = 0x85ebca77;
  private length = 0;

  reset(): this {
    this.a = 0x9e3779b9;
    this.b = 0x85ebca77;
    this.length = 0;
    return this;
  }

  u32(value: number): this {
    const v = value >>> 0;
    this.a = Math.imul(this.a ^ v, 0x01000193) >>> 0;
    this.a = ((this.a << 13) | (this.a >>> 19)) >>> 0;
    this.b = Math.imul(this.b ^ mix32(v + this.length), 0x27d4eb2f) >>> 0;
    this.b = ((this.b << 17) | (this.b >>> 15)) >>> 0;
    this.length++;
    return this;
  }

  f64(value: number): this {
    f64[0] = Number.isNaN(value) ? Number.NaN : value;
    return this.u32(u32[0] ?? 0).u32(u32[1] ?? 0);
  }

  bool(value: boolean): this {
    return this.u32(value ? 1 : 0);
  }

  string(value: string): this {
    this.u32(value.length);
    for (let i = 0; i < value.length; i++) this.u32(value.charCodeAt(i));
    return this;
  }

  /** Final 64-bit digest as 16 lowercase hex chars. */
  digest(): string {
    const fa = mix32(this.a ^ this.length ^ mix32(this.b));
    const fb = mix32(this.b ^ fa);
    return fa.toString(16).padStart(8, '0') + fb.toString(16).padStart(8, '0');
  }
}

/** FNV-1a 32-bit of a string. Used to derive stable sub-seeds from names. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
