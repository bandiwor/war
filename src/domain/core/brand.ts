/**
 * Nominal ("branded") types. A brand exists only at the type level; at runtime
 * the value is the underlying primitive, so brands cost nothing.
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Seed of a deterministic run. Unsigned 32-bit integer. */
export type Seed = Brand<number, 'Seed'>;
/** Simulation tick number, starting at 0. */
export type Tick = Brand<number, 'Tick'>;

export function seed(value: number): Seed {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`Seed must be a u32, got ${String(value)}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand constructor: the only place a number becomes a Seed
  return value as Seed;
}

export function tick(value: number): Tick {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Tick must be a non-negative integer, got ${String(value)}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand constructor
  return value as Tick;
}
