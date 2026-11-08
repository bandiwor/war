import type { StateHasher } from '../math/hash';
import { ComponentStore, type ComponentDef, type Schema } from './component';
import { EntityAllocator, entityGeneration, entityIndex, type EntityId } from './entity';

/**
 * Entity + component container. Knows nothing about systems, rendering or time.
 * Stores are kept in registration order, which is part of the deterministic
 * contract (the hash walks them in that order).
 */
export class World {
  readonly entities = new EntityAllocator();
  private readonly stores: ComponentStore[] = [];
  private readonly byDef = new Map<ComponentDef, ComponentStore>();
  private readonly byName = new Map<string, ComponentStore>();

  register<S extends Schema>(def: ComponentDef<S>): ComponentStore<S> {
    if (this.byName.has(def.name)) throw new Error(`Component ${def.name} already registered`);
    const store = new ComponentStore(def);
    this.stores.push(store);
    this.byDef.set(def, store);
    this.byName.set(def.name, store);
    return store;
  }

  store<S extends Schema>(def: ComponentDef<S>): ComponentStore<S> {
    const store = this.byDef.get(def);
    if (store === undefined) throw new Error(`Component ${def.name} is not registered`);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- byDef maps each def to the store built from that same def in register()
    return store as unknown as ComponentStore<S>;
  }

  componentNames(): readonly string[] {
    return this.stores.map((s) => s.def.name);
  }

  spawn(): EntityId {
    return this.entities.create();
  }

  despawn(id: EntityId): boolean {
    if (!this.entities.isAlive(id)) return false;
    for (const store of this.stores) store.remove(id);
    return this.entities.destroy(id);
  }

  isAlive(id: EntityId): boolean {
    return this.entities.isAlive(id);
  }

  /**
   * Feeds the full logical state into `h`. Rows are visited in entity-slot
   * order, not packed order, so two worlds with the same entities and values
   * hash equal regardless of the add/remove history that produced them.
   */
  hashInto(h: StateHasher): void {
    const ents = this.entities;
    h.u32(ents.count).u32(ents.highWater);
    for (let i = 0; i < ents.highWater; i++) {
      const id = ents.idAt(i);
      h.u32(id === -1 ? 0xffffffff : entityGeneration(id));
    }
    for (const store of this.stores) {
      h.string(store.def.name).u32(store.size);
      const names = store.fieldNamesInOrder();
      for (let i = 0; i < ents.highWater; i++) {
        const id = ents.idAt(i);
        if (id === -1) continue;
        const row = store.rowOf(id);
        if (row < 0) continue;
        h.u32(entityIndex(id));
        for (const name of names) h.f64(store.fields[name]?.[row] ?? 0);
      }
    }
  }
}
