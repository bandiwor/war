/**
 * Deep in-place update of registry data (dev hot reload). Every reference the
 * running game holds stays valid; only the values underneath change. Arrays
 * and primitives are replaced, plain objects are patched recursively, keys
 * missing from `next` are removed.
 */
export function hotPatch(target: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    if (!Object.hasOwn(next, key)) Reflect.deleteProperty(target, key);
  }
  for (const [key, value] of Object.entries(next)) {
    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) hotPatch(current, value);
    else target[key] = value;
  }
}

/** True when both registries have exactly the same ids (otherwise a reload is needed). */
export function sameKeys(a: object, b: object): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
