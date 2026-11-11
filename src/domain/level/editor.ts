import { cos, sin } from '../math/dmath';
import { Rng } from '../math/prng';
import type { Interactable, StoryData } from '../story/schema';
import {
  CELL_DIGITS,
  MAX_HEIGHT,
  TERRAIN_CELL,
  levelBounds,
  type Level,
  type LevelDecor,
  type LevelLight,
  type LevelObject,
  type MobPlacement,
  type Patrol,
  type SpawnZone,
} from './level';

/**
 * The level editor's document (stage 9): a level plus an undo history of
 * commands. Every change is a command with `do` and `undo` (the command
 * pattern), so undo/redo is exact and cheap; dragging and brush strokes
 * merge into one step. Pure and DOM-free: the editor UI and the tests drive
 * the same API.
 */
export interface EntityMap {
  objects: LevelObject;
  decor: LevelDecor;
  lights: LevelLight;
  mobs: MobPlacement;
  patrols: Patrol;
  spawnZones: SpawnZone;
  interactables: Interactable;
}
export type Collection = keyof EntityMap;
export const COLLECTIONS: readonly Collection[] = [
  'objects',
  'decor',
  'lights',
  'mobs',
  'patrols',
  'spawnZones',
  'interactables',
];

export interface EntityRef {
  readonly collection: Collection;
  readonly id: string;
}

export interface Command {
  readonly label: string;
  do(level: Level): void;
  undo(level: Level): void;
  /** Commands with the same key merge into one undo step (one drag, one brush stroke). */
  readonly mergeKey?: string | undefined;
  /** Absorbs a later command of the same key; returns false to keep them separate. */
  merge?(next: Command): boolean;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The live list of a collection (interactables live in the level's story). */
export function listOf<C extends Collection>(level: Level, c: C): EntityMap[C][] {
  switch (c) {
    case 'interactables':
      if (level.story === null) throw new Error('This level has no story: add one first');
      return listCast<C>(level.story.interactables);
    case 'objects':
      return listCast<C>(level.objects);
    case 'decor':
      return listCast<C>(level.decor);
    case 'lights':
      return listCast<C>(level.lights);
    case 'mobs':
      return listCast<C>(level.mobs);
    case 'patrols':
      return listCast<C>(level.patrols);
    case 'spawnZones':
      return listCast<C>(level.spawnZones);
  }
  /* v8 ignore next -- unreachable: the switch covers every collection */
  throw new Error(`unknown collection ${String(c)}`);
}

function listCast<C extends Collection>(list: unknown[]): EntityMap[C][] {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the collection key selects the element type; listOf's callers keep it consistent
  return list as EntityMap[C][];
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

export class AddEntity<C extends Collection> implements Command {
  readonly label: string;
  constructor(
    readonly collection: C,
    readonly entity: EntityMap[C],
    readonly index = -1,
  ) {
    this.label = `Add ${entity.id}`;
  }
  do(level: Level): void {
    const list = listOf(level, this.collection);
    const e = clone(this.entity);
    if (this.index < 0 || this.index >= list.length) list.push(e);
    else list.splice(this.index, 0, e);
  }
  undo(level: Level): void {
    const list = listOf(level, this.collection);
    const i = list.findIndex((e) => e.id === this.entity.id);
    if (i >= 0) list.splice(i, 1);
  }
}

export class RemoveEntity<C extends Collection> implements Command {
  readonly label: string;
  private removed: { entity: EntityMap[C]; index: number } | null = null;
  constructor(
    readonly collection: C,
    readonly id: string,
  ) {
    this.label = `Delete ${id}`;
  }
  do(level: Level): void {
    const list = listOf(level, this.collection);
    const index = list.findIndex((e) => e.id === this.id);
    const entity = list[index];
    if (entity === undefined) return;
    list.splice(index, 1);
    this.removed = { entity, index };
  }
  undo(level: Level): void {
    if (this.removed === null) return;
    listOf(level, this.collection).splice(this.removed.index, 0, clone(this.removed.entity));
  }
}

export class UpdateEntity<C extends Collection> implements Command {
  constructor(
    readonly collection: C,
    readonly id: string,
    private readonly before: EntityMap[C],
    private after: EntityMap[C],
    readonly label = `Edit ${id}`,
    readonly mergeKey?: string,
  ) {}
  private replace(level: Level, value: EntityMap[C]): void {
    const list = listOf(level, this.collection);
    const i = list.findIndex((e) => e.id === this.id);
    if (i >= 0) list[i] = clone(value);
  }
  do(level: Level): void {
    this.replace(level, this.after);
  }
  undo(level: Level): void {
    this.replace(level, this.before);
  }
  merge(next: Command): boolean {
    if (
      !(next instanceof UpdateEntity) ||
      next.id !== this.id ||
      next.collection !== this.collection
    )
      return false;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- same collection checked above
    this.after = (next as UpdateEntity<C>).after;
    return true;
  }
}

export interface CellChange {
  readonly i: number;
  readonly k: number;
  readonly before: { readonly h: string; readonly m: string };
  readonly after: { readonly h: string; readonly m: string };
}

function writeCell(level: Level, i: number, k: number, h: string, m: string): void {
  const hr = level.terrain.heights[k];
  const mr = level.terrain.materials[k];
  if (hr === undefined || mr === undefined) return;
  level.terrain.heights[k] = hr.slice(0, i) + h + hr.slice(i + 1);
  level.terrain.materials[k] = mr.slice(0, i) + m + mr.slice(i + 1);
}

export class PaintTerrain implements Command {
  private readonly changes = new Map<number, CellChange>();
  constructor(
    changes: readonly CellChange[],
    readonly label = 'Paint terrain',
    readonly mergeKey?: string,
  ) {
    for (const c of changes) this.changes.set(c.k * 4096 + c.i, c);
  }
  get size(): number {
    return this.changes.size;
  }
  do(level: Level): void {
    for (const c of this.changes.values()) writeCell(level, c.i, c.k, c.after.h, c.after.m);
  }
  undo(level: Level): void {
    for (const c of this.changes.values()) writeCell(level, c.i, c.k, c.before.h, c.before.m);
  }
  merge(next: Command): boolean {
    if (!(next instanceof PaintTerrain)) return false;
    // A stroke: keep each cell's first "before" and its last "after".
    for (const [key, c] of next.changes) {
      const prev = this.changes.get(key);
      this.changes.set(key, prev === undefined ? c : { ...c, before: prev.before });
    }
    return true;
  }
}

/** Replaces a top-level field (spawn, title, zone, seed, story). */
export class SetField<K extends 'spawn' | 'title' | 'zone' | 'seed' | 'story'> implements Command {
  constructor(
    readonly key: K,
    private readonly before: Level[K],
    private after: Level[K],
    readonly label = `Set ${key}`,
    readonly mergeKey?: string,
  ) {}
  do(level: Level): void {
    Object.assign(level, { [this.key]: clone(this.after) });
  }
  undo(level: Level): void {
    Object.assign(level, { [this.key]: clone(this.before) });
  }
  merge(next: Command): boolean {
    if (!(next instanceof SetField) || next.key !== this.key) return false;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- same key checked above
    this.after = (next as SetField<K>).after;
    return true;
  }
}

export class Batch implements Command {
  constructor(
    readonly label: string,
    readonly commands: readonly Command[],
  ) {}
  do(level: Level): void {
    for (const c of this.commands) c.do(level);
  }
  undo(level: Level): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i]?.undo(level);
  }
}

/** History depth: older steps fall off (a long session stays bounded). */
export const HISTORY_LIMIT = 300;

export class EditorDocument {
  private readonly done: Command[] = [];
  private readonly undone: Command[] = [];
  /** Bumped on every change (the view and the checks key their caches on it). */
  version = 0;
  /** Saved version (for the "unsaved" marker). */
  savedVersion = 0;

  constructor(public level: Level) {}

  get dirty(): boolean {
    return this.version !== this.savedVersion;
  }

  exec(cmd: Command): void {
    cmd.do(this.level);
    const last = this.done.at(-1);
    const merged =
      cmd.mergeKey !== undefined && last?.mergeKey === cmd.mergeKey && last.merge?.(cmd) === true;
    if (!merged) {
      this.done.push(cmd);
      if (this.done.length > HISTORY_LIMIT) this.done.shift();
    }
    this.undone.length = 0;
    this.version++;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  get undoLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }

  undo(): boolean {
    const c = this.done.pop();
    if (c === undefined) return false;
    c.undo(this.level);
    this.undone.push(c);
    this.version++;
    return true;
  }

  redo(): boolean {
    const c = this.undone.pop();
    if (c === undefined) return false;
    c.do(this.level);
    this.done.push(c);
    this.version++;
    return true;
  }

  /** Replaces the whole level (open, new): history starts over. */
  load(level: Level): void {
    this.level = level;
    this.done.length = 0;
    this.undone.length = 0;
    this.version++;
    this.savedVersion = this.version;
  }

  find<C extends Collection>(c: C, id: string): EntityMap[C] | undefined {
    if (c === 'interactables' && this.level.story === null) return undefined;
    return listOf(this.level, c).find((e) => e.id === id);
  }

  /** A fresh id: prefix + the smallest free number (stable, readable diffs). */
  nextId(prefix: string): string {
    const used = new Set<string>();
    for (const c of COLLECTIONS) {
      if (c === 'interactables' && this.level.story === null) continue;
      for (const e of listOf(this.level, c)) used.add(e.id);
    }
    for (let n = 1; ; n++) if (!used.has(`${prefix}${String(n)}`)) return `${prefix}${String(n)}`;
  }

  add<C extends Collection>(c: C, entity: EntityMap[C]): string {
    this.exec(new AddEntity(c, entity));
    return entity.id;
  }

  remove(ref: EntityRef): void {
    if (this.find(ref.collection, ref.id) !== undefined)
      this.exec(new RemoveEntity(ref.collection, ref.id));
  }

  update<C extends Collection>(
    c: C,
    id: string,
    change: (e: EntityMap[C]) => EntityMap[C],
    mergeKey?: string,
  ): void {
    const before = this.find(c, id);
    if (before === undefined) return;
    this.exec(
      new UpdateEntity(c, id, clone(before), change(clone(before)), `Edit ${id}`, mergeKey),
    );
  }

  /** Moves an entity so its anchor lands on (x, z). One drag = one undo step (same `mergeKey`). */
  move(ref: EntityRef, x: number, z: number, mergeKey?: string): void {
    this.update(ref.collection, ref.id, (e) => movedTo(ref.collection, e, x, z), mergeKey);
  }

  setSpawn(x: number, z: number, yaw: number, mergeKey?: string): void {
    this.exec(
      new SetField('spawn', clone(this.level.spawn), { at: [x, z], yaw }, 'Move spawn', mergeKey),
    );
  }

  setStory(story: StoryData | null): void {
    this.exec(
      new SetField(
        'story',
        clone(this.level.story),
        clone(story),
        story === null ? 'Remove story' : 'Edit story',
      ),
    );
  }

  setMeta<K extends 'title' | 'zone' | 'seed'>(key: K, value: Level[K]): void {
    this.exec(new SetField(key, this.level[key], value));
  }
}

// --- Positions ---------------------------------------------------------------

/** Where an entity sits on the ground (its drag handle). */
export function anchorOf(c: Collection, e: unknown): [number, number] {
  const any = e;
  switch (c) {
    case 'objects': {
      const o = asObject(any);
      return [o.center[0], o.center[2]];
    }
    case 'lights':
    case 'interactables': {
      const p = asAt3(any);
      return [p.at[0], p.at[2]];
    }
    case 'patrols': {
      const p = asPatrol(any);
      return [p.points[0]?.[0] ?? 0, p.points[0]?.[1] ?? 0];
    }
    case 'spawnZones': {
      const z = asZone(any);
      return [(z.min[0] + z.max[0]) / 2, (z.min[1] + z.max[1]) / 2];
    }
    case 'decor':
    case 'mobs': {
      const p = asAt2(any);
      return [p.at[0], p.at[1]];
    }
  }
}

/** The entity moved so its anchor is at (x, z) (paths and zones move as a whole). */
export function movedTo<C extends Collection>(
  c: C,
  e: EntityMap[C],
  x: number,
  z: number,
): EntityMap[C] {
  const [ax, az] = anchorOf(c, e);
  const dx = x - ax;
  const dz = z - az;
  const out: unknown = clone(e);
  switch (c) {
    case 'objects': {
      const o = asObject(out);
      o.center = [o.center[0] + dx, o.center[1], o.center[2] + dz];
      break;
    }
    case 'lights':
    case 'interactables': {
      const p = asAt3(out);
      p.at = [p.at[0] + dx, p.at[1], p.at[2] + dz];
      break;
    }
    case 'patrols': {
      const p = asPatrol(out);
      p.points = p.points.map(([px, pz]) => [px + dx, pz + dz]);
      break;
    }
    case 'spawnZones': {
      const s = asZone(out);
      s.min = [s.min[0] + dx, s.min[1] + dz];
      s.max = [s.max[0] + dx, s.max[1] + dz];
      break;
    }
    case 'decor':
    case 'mobs': {
      const p = asAt2(out);
      p.at = [p.at[0] + dx, p.at[1] + dz];
    }
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a moved copy of the same entity
  return out as EntityMap[C];
}

// Narrowing helpers: the collection decides the shape (no runtime cost beyond the casts).
/* eslint-disable @typescript-eslint/consistent-type-assertions -- each helper is only called for the collection whose shape it names */
const asObject = (v: unknown): Mutable<LevelObject> => v as Mutable<LevelObject>;
const asAt3 = (v: unknown): { at: [number, number, number] } =>
  v as { at: [number, number, number] };
const asAt2 = (v: unknown): { at: [number, number] } => v as { at: [number, number] };
const asPatrol = (v: unknown): Mutable<Patrol> => v as Mutable<Patrol>;
const asZone = (v: unknown): Mutable<SpawnZone> => v as Mutable<SpawnZone>;
/* eslint-enable @typescript-eslint/consistent-type-assertions -- end of the narrowing helpers */

/** The entity at (x, z) within `radius` (nearest anchor; a zone when inside it). */
export function pickAt(level: Level, x: number, z: number, radius = 1.2): EntityRef | null {
  let best: EntityRef | null = null;
  let bestD = radius * radius;
  for (const c of COLLECTIONS) {
    if (c === 'interactables' && level.story === null) continue;
    for (const e of listOf(level, c)) {
      if (c === 'spawnZones') continue;
      const points: (readonly [number, number])[] =
        c === 'patrols' ? asPatrol(e).points : [anchorOf(c, e)];
      for (const [px, pz] of points) {
        const d = (px - x) * (px - x) + (pz - z) * (pz - z);
        if (d < bestD) {
          bestD = d;
          best = { collection: c, id: e.id };
        }
      }
    }
  }
  if (best !== null) return best;
  for (const s of level.spawnZones)
    if (x >= s.min[0] && x <= s.max[0] && z >= s.min[1] && z <= s.max[1])
      return { collection: 'spawnZones', id: s.id };
  return null;
}

// --- Snapping ---------------------------------------------------------------

export function snap(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

export const ANGLE_STEP = Math.PI / 12;

export function snapAngle(a: number, step = ANGLE_STEP): number {
  return snap(a, step);
}

// --- Brushes ----------------------------------------------------------------

export type TerrainMode =
  | { readonly kind: 'raise' }
  | { readonly kind: 'lower' }
  | { readonly kind: 'flatten'; readonly height: number }
  | { readonly kind: 'paint'; readonly material: number };

/**
 * A terrain dab at (x, z) with a radius in metres: the cells whose centre is
 * inside change by one height step (raise/lower), to a height (flatten) or
 * to a palette material (paint). Returns null when nothing would change.
 */
export function terrainBrush(
  level: Level,
  x: number,
  z: number,
  radius: number,
  mode: TerrainMode,
  stroke?: string,
): PaintTerrain | null {
  const changes: CellChange[] = [];
  const [w, d] = level.cells;
  const r = Math.max(TERRAIN_CELL / 2, radius);
  const ci = (x - level.origin[0]) / TERRAIN_CELL;
  const ck = (z - level.origin[1]) / TERRAIN_CELL;
  const rc = r / TERRAIN_CELL;
  for (let k = Math.max(0, Math.floor(ck - rc)); k <= Math.min(d - 1, Math.floor(ck + rc)); k++) {
    for (let i = Math.max(0, Math.floor(ci - rc)); i <= Math.min(w - 1, Math.floor(ci + rc)); i++) {
      const dx = i + 0.5 - ci;
      const dz = k + 0.5 - ck;
      if (dx * dx + dz * dz > rc * rc) continue;
      const h = level.terrain.heights[k]?.[i] ?? '0';
      const m = level.terrain.materials[k]?.[i] ?? '0';
      const hv = CELL_DIGITS.indexOf(h);
      let nh = hv;
      let nm = m;
      switch (mode.kind) {
        case 'raise':
          nh = Math.min(MAX_HEIGHT, hv + 1);
          break;
        case 'lower':
          nh = Math.max(0, hv - 1);
          break;
        case 'flatten':
          nh = Math.max(0, Math.min(MAX_HEIGHT, mode.height));
          break;
        case 'paint':
          nm =
            CELL_DIGITS[Math.max(0, Math.min(level.terrain.palette.length - 1, mode.material))] ??
            '0';
          break;
      }
      const nhs = CELL_DIGITS[nh] ?? '0';
      if (nhs !== h || nm !== m) changes.push({ i, k, before: { h, m }, after: { h: nhs, m: nm } });
    }
  }
  return changes.length === 0 ? null : new PaintTerrain(changes, `Terrain: ${mode.kind}`, stroke);
}

/**
 * The decor brush: scatters `count` props of a kind inside a circle, seeded
 * by the level seed and the stroke number (the same stroke places the same
 * props), keeping 1 m between props and inside the level.
 */
export function decorBrush(
  doc: EditorDocument,
  x: number,
  z: number,
  radius: number,
  template: Omit<LevelDecor, 'id' | 'at' | 'yaw'>,
  count: number,
  stroke: number,
): Batch | null {
  const level = doc.level;
  const rng = Rng.fromSeed((level.seed ^ Math.imul(stroke + 1, 0x9e3779b1)) >>> 0);
  const [x0, z0, x1, z1] = levelBounds(level);
  const taken: (readonly [number, number])[] = level.decor.map((p) => p.at);
  const cmds: Command[] = [];
  const ids = new Set<string>();
  for (let tries = 0; tries < count * 8 && cmds.length < count; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = radius * Math.sqrt(rng.nextFloat());
    const px = x + sin(a) * rr;
    const pz = z + cos(a) * rr;
    if (px < x0 + 0.5 || px > x1 - 0.5 || pz < z0 + 0.5 || pz > z1 - 0.5) continue;
    if (taken.some(([tx, tz]) => (tx - px) * (tx - px) + (tz - pz) * (tz - pz) < 1)) continue;
    let id = doc.nextId(template.kind);
    for (let n = 1; ids.has(id); n++) id = `${doc.nextId(template.kind)}x${String(n)}`;
    ids.add(id);
    taken.push([px, pz]);
    cmds.push(
      new AddEntity('decor', {
        ...template,
        id,
        at: [Math.round(px * 100) / 100, Math.round(pz * 100) / 100],
        yaw: Math.round(rng.range(-Math.PI, Math.PI) * 100) / 100,
        scale: Math.round(template.scale * rng.range(0.85, 1.15) * 100) / 100,
      }),
    );
  }
  return cmds.length === 0
    ? null
    : new Batch(`Scatter ${String(cmds.length)} ${template.kind}`, cmds);
}

/** Removes the decor inside a circle (the decor eraser). */
export function eraseDecor(level: Level, x: number, z: number, radius: number): Batch | null {
  const cmds = level.decor
    .filter((p) => (p.at[0] - x) * (p.at[0] - x) + (p.at[1] - z) * (p.at[1] - z) <= radius * radius)
    .map((p) => new RemoveEntity('decor', p.id));
  return cmds.length === 0 ? null : new Batch(`Erase ${String(cmds.length)} decor`, cmds);
}
