import { entityIndex, rawEntityIndex, type EntityId } from './entity';

/**
 * SoA component storage. Each field is its own typed array; entities are kept
 * packed (sparse set) so systems iterate dense arrays with no holes.
 *
 * Field arrays are replaced when the store grows, so never cache
 * `store.fields.x` across a call that may add entities.
 */
export type FieldType = 'f32' | 'f64' | 'i32' | 'u32' | 'u8';
export type Schema = Readonly<Record<string, FieldType>>;

export type FieldArray<T extends FieldType> = T extends 'f32'
  ? Float32Array
  : T extends 'f64'
    ? Float64Array
    : T extends 'i32'
      ? Int32Array
      : T extends 'u32'
        ? Uint32Array
        : Uint8Array;

export type Fields<S extends Schema> = { [K in keyof S]: FieldArray<S[K]> };

export interface ComponentDef<S extends Schema = Schema> {
  readonly name: string;
  readonly schema: S;
}

export function defineComponent<const S extends Schema>(name: string, schema: S): ComponentDef<S> {
  if (Object.keys(schema).length === 0) throw new Error(`Component ${name} has no fields`);
  return Object.freeze({ name, schema });
}

type AnyFieldArray = Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array;

function allocate(type: FieldType, capacity: number): AnyFieldArray {
  switch (type) {
    case 'f32':
      return new Float32Array(capacity);
    case 'f64':
      return new Float64Array(capacity);
    case 'i32':
      return new Int32Array(capacity);
    case 'u32':
      return new Uint32Array(capacity);
    case 'u8':
      return new Uint8Array(capacity);
  }
}

export class ComponentStore<S extends Schema = Schema> {
  /** Packed entity handles; `dense[i]` owns row i of every field array. */
  dense: Uint32Array;
  fields: Fields<S>;
  private sparse: Int32Array;
  private count = 0;
  private readonly fieldNames: readonly (keyof S & string)[];

  constructor(
    readonly def: ComponentDef<S>,
    initialCapacity = 64,
  ) {
    this.fieldNames = Object.keys(def.schema);
    this.dense = new Uint32Array(initialCapacity);
    this.sparse = new Int32Array(initialCapacity).fill(-1);
    this.fields = this.allocateFields(initialCapacity);
  }

  get size(): number {
    return this.count;
  }

  /** Row index of `id`, or -1. Does not check liveness; the World does. */
  rowOf(id: EntityId): number {
    const idx = entityIndex(id);
    if (idx >= this.sparse.length) return -1;
    const row = this.sparse[idx] ?? -1;
    return row >= 0 && this.dense[row] === id ? row : -1;
  }

  has(id: EntityId): boolean {
    return this.rowOf(id) >= 0;
  }

  /** Adds a zeroed row for `id` (or returns its existing row). */
  add(id: EntityId): number {
    const existing = this.rowOf(id);
    if (existing >= 0) return existing;
    const idx = entityIndex(id);
    if (idx >= this.sparse.length) this.growSparse(idx + 1);
    if (this.count >= this.dense.length) this.growDense(this.count + 1);
    const row = this.count++;
    this.dense[row] = id;
    this.sparse[idx] = row;
    for (const name of this.fieldNames) this.fields[name][row] = 0;
    return row;
  }

  /** Swap-remove: O(1), keeps rows packed. */
  remove(id: EntityId): boolean {
    const row = this.rowOf(id);
    if (row < 0) return false;
    const last = --this.count;
    if (row !== last) {
      const moved = this.dense[last] ?? 0;
      this.dense[row] = moved;
      this.sparse[rawEntityIndex(moved)] = row;
      for (const name of this.fieldNames) {
        const arr = this.fields[name];
        arr[row] = arr[last] ?? 0;
      }
    }
    this.sparse[entityIndex(id)] = -1;
    return true;
  }

  fieldNamesInOrder(): readonly (keyof S & string)[] {
    return this.fieldNames;
  }

  private allocateFields(capacity: number): Fields<S> {
    const out: Record<string, AnyFieldArray> = {};
    for (const name of this.fieldNames)
      out[name] = allocate(this.def.schema[name] ?? 'f64', capacity);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- built from the schema keys above; the mapped type cannot be expressed through Object.keys
    return out as Fields<S>;
  }

  private growDense(min: number): void {
    let cap = this.dense.length * 2;
    while (cap < min) cap *= 2;
    const dense = new Uint32Array(cap);
    dense.set(this.dense);
    this.dense = dense;
    const next = this.allocateFields(cap);
    for (const name of this.fieldNames) next[name].set(this.fields[name]);
    this.fields = next;
  }

  private growSparse(min: number): void {
    let cap = this.sparse.length * 2;
    while (cap < min) cap *= 2;
    const sparse = new Int32Array(cap).fill(-1);
    sparse.set(this.sparse);
    this.sparse = sparse;
  }
}
