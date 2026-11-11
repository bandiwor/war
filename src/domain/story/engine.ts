import type { ZoneId } from '../audio/zones';
import { RACES, type Race } from '../combat/races';
import type { StateHasher } from '../math/hash';
import type { MobId } from '../mobs/registry';
import type {
  AmmoKind,
  Condition,
  Effect,
  Interactable,
  Line,
  Quest,
  QuestStatus,
  StoryData,
} from './schema';

/**
 * The story at runtime: pure, deterministic, serialisable. The engine reads
 * the world through a tiny `StoryWorld` view (where the player is, the hour)
 * and reports what happened as notes; the application turns notes into
 * events, mobs and loot. Everything it owns is in `StorySnapshot`, which a
 * save stores verbatim and the state hash covers.
 */
export interface StoryWorld {
  x: number;
  z: number;
  zone: ZoneId;
  /** 0 = day, 1 = deep night. */
  night: number;
}

/** What the story did this tick, in order. */
export type StoryNote =
  | { readonly kind: 'quest'; readonly quest: string; readonly status: QuestStatus }
  | { readonly kind: 'objective'; readonly quest: string; readonly objective: string }
  | { readonly kind: 'log'; readonly log: string }
  | { readonly kind: 'chapter'; readonly chapter: string }
  | { readonly kind: 'ending'; readonly ending: string }
  | {
      readonly kind: 'line';
      readonly source: 'radio' | 'log';
      readonly id: string;
      readonly line: Line;
    }
  | {
      readonly kind: 'spawn';
      readonly mob: MobId;
      readonly x: number;
      readonly z: number;
      readonly count: number;
    }
  | { readonly kind: 'supply'; readonly ammo: AmmoKind; readonly amount: number }
  | { readonly kind: 'battery' }
  | { readonly kind: 'used'; readonly interactable: string };

/** Serialisable story state (the save stores it as is). */
export interface StorySnapshot {
  chapter: string;
  ending: string | null;
  /** Sorted by name. */
  flags: [string, number][];
  /** Quests that left `inactive`, sorted by id. */
  quests: [string, QuestStatus][];
  /** Done objectives as "quest.objective", sorted. */
  objectives: string[];
  /** In the order found (the journal's order). */
  logs: string[];
  used: string[];
  fired: string[];
  kills: Record<Race | 'any', number>;
  /** Lines still to play: each entry a source and the index of its next line. */
  playing: { source: 'radio' | 'log'; id: string; next: number }[];
  /** Seconds left on the line currently up. */
  lineLeft: number;
  started: boolean;
}

export function newStorySnapshot(data: StoryData): StorySnapshot {
  return {
    chapter: data.chapters[0]?.id ?? '',
    ending: null,
    flags: [],
    quests: [],
    objectives: [],
    logs: [],
    used: [],
    fired: [],
    kills: { zombie: 0, robot: 0, plant: 0, animal: 0, any: 0 },
    playing: [],
    lineLeft: 0,
    started: false,
  };
}

const sorted = <T>(it: Iterable<T>, key: (t: T) => string): T[] =>
  [...it].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** Passes over the triggers per tick: effects that enable further triggers resolve the same tick. */
const PASSES = 4;

export class StoryEngine {
  private readonly quests: ReadonlyMap<string, Quest>;
  private readonly things: ReadonlyMap<string, Interactable>;
  private readonly chapterIndex: ReadonlyMap<string, number>;
  private readonly lines: ReadonlyMap<string, readonly Line[]>;

  chapter = '';
  ending: string | null = null;
  readonly flags = new Map<string, number>();
  readonly questStatus = new Map<string, QuestStatus>();
  readonly objectives = new Set<string>();
  readonly logs: string[] = [];
  readonly used = new Set<string>();
  readonly fired = new Set<string>();
  readonly kills: Record<Race | 'any', number> = {
    zombie: 0,
    robot: 0,
    plant: 0,
    animal: 0,
    any: 0,
  };
  private playing: { source: 'radio' | 'log'; id: string; next: number }[] = [];
  private lineLeft = 0;
  private started = false;
  private readonly notes: StoryNote[] = [];
  private killsSeen = 0;

  constructor(readonly data: StoryData) {
    this.quests = new Map(data.quests.map((q) => [q.id, q]));
    this.things = new Map(data.interactables.map((i) => [i.id, i]));
    this.chapterIndex = new Map(data.chapters.map((c, i) => [c.id, i]));
    this.lines = new Map([
      ...data.radio.map((r): [string, readonly Line[]] => [`radio:${r.id}`, r.lines]),
      ...data.logs
        .filter((l) => l.kind !== 'note')
        .map((l): [string, readonly Line[]] => [`log:${l.id}`, l.lines]),
    ]);
    this.restore(newStorySnapshot(data));
  }

  // --- State -------------------------------------------------------------

  snapshot(): StorySnapshot {
    return {
      chapter: this.chapter,
      ending: this.ending,
      flags: sorted(this.flags, ([k]) => k).map(([k, v]) => [k, v]),
      quests: sorted(this.questStatus, ([k]) => k).map(([k, v]) => [k, v]),
      objectives: sorted(this.objectives, (s) => s),
      logs: [...this.logs],
      used: sorted(this.used, (s) => s),
      fired: sorted(this.fired, (s) => s),
      kills: { ...this.kills },
      playing: this.playing.map((p) => ({ ...p })),
      lineLeft: this.lineLeft,
      started: this.started,
    };
  }

  restore(s: StorySnapshot): void {
    this.chapter = s.chapter;
    this.ending = s.ending;
    this.flags.clear();
    for (const [k, v] of s.flags) this.flags.set(k, v);
    this.questStatus.clear();
    for (const [k, v] of s.quests) this.questStatus.set(k, v);
    this.objectives.clear();
    for (const o of s.objectives) this.objectives.add(o);
    this.logs.length = 0;
    this.logs.push(...s.logs);
    this.used.clear();
    for (const u of s.used) this.used.add(u);
    this.fired.clear();
    for (const f of s.fired) this.fired.add(f);
    for (const r of [...RACES, 'any'] as const) this.kills[r] = s.kills[r];
    this.playing = s.playing.map((p) => ({ ...p }));
    this.lineLeft = s.lineLeft;
    this.started = s.started;
  }

  hashInto(h: StateHasher): void {
    const s = this.snapshot();
    h.string(s.chapter).string(s.ending ?? '');
    h.u32(s.flags.length);
    for (const [k, v] of s.flags) h.string(k).f64(v);
    h.u32(s.quests.length);
    for (const [k, v] of s.quests) h.string(k).string(v);
    for (const list of [s.objectives, s.logs, s.used, s.fired]) {
      h.u32(list.length);
      for (const x of list) h.string(x);
    }
    for (const r of [...RACES, 'any'] as const) h.u32(s.kills[r]);
    h.u32(s.playing.length);
    for (const p of s.playing) h.string(p.source).string(p.id).u32(p.next);
    h.f64(s.lineLeft).bool(s.started);
  }

  /** Effects can end the story mid-tick, so this is read fresh (not narrowed). */
  get ended(): boolean {
    return this.ending !== null;
  }

  flag(name: string): number {
    return this.flags.get(name) ?? 0;
  }

  status(quest: string): QuestStatus {
    return this.questStatus.get(quest) ?? 'inactive';
  }

  /** The line on air now, if any. */
  get onAir(): { source: 'radio' | 'log'; id: string; line: Line; left: number } | null {
    const p = this.playing[0];
    if (p === undefined || p.next === 0) return null;
    const line = this.lines.get(`${p.source}:${p.id}`)?.[p.next - 1];
    return line === undefined ? null : { source: p.source, id: p.id, line, left: this.lineLeft };
  }

  // --- Queries -----------------------------------------------------------

  /** Whether an interactable can be used now (unused or reusable, and available). */
  canUse(id: string, w: StoryWorld): boolean {
    const i = this.things.get(id);
    if (i === undefined || this.ending !== null) return false;
    if (i.once && this.used.has(id)) return false;
    return i.available === undefined || this.holds(i.available, w);
  }

  holds(c: Condition, w: StoryWorld): boolean {
    switch (c.is) {
      case 'all':
        return c.of.every((x) => this.holds(x, w));
      case 'any':
        return c.of.some((x) => this.holds(x, w));
      case 'not':
        return !this.holds(c.c, w);
      case 'flag': {
        const v = this.flag(c.flag);
        switch (c.op) {
          case 'eq':
            return v === c.value;
          case 'ne':
            return v !== c.value;
          case 'gt':
            return v > c.value;
          case 'gte':
            return v >= c.value;
          case 'lt':
            return v < c.value;
          case 'lte':
            return v <= c.value;
        }
        break;
      }
      case 'zone':
        return w.zone === c.zone;
      case 'near': {
        const dx = w.x - c.at[0];
        const dz = w.z - c.at[1];
        return dx * dx + dz * dz <= c.radius * c.radius;
      }
      case 'kills':
        return this.kills[c.race] >= c.count;
      case 'chapter':
        return (
          (this.chapterIndex.get(this.chapter) ?? -1) >= (this.chapterIndex.get(c.chapter) ?? 0)
        );
      case 'quest':
        return this.status(c.quest) === c.status;
      case 'log':
        return this.logs.includes(c.log);
      case 'used':
        return this.used.has(c.interactable);
      case 'night':
        return w.night >= c.min;
    }
    return false;
  }

  // --- Ticking -----------------------------------------------------------

  /** A kill the player made (from the hit events). */
  killed(race: Race): void {
    this.kills[race]++;
    this.kills.any++;
  }

  /**
   * One simulation tick: the start effects (first tick), the interactable the
   * player used (if any), triggers and objectives until nothing changes, and
   * the line queue. Returns this tick's notes (reused array: copy to keep).
   *
   * `evaluate = false` skips the condition scan (the simulation scans a few
   * times a second); a use, a new kill or the first tick always scan.
   */
  tick(dt: number, w: StoryWorld, use: string | null, evaluate = true): readonly StoryNote[] {
    this.notes.length = 0;
    if (this.ending !== null) {
      this.advanceLines(dt);
      return this.notes;
    }
    if (!this.started) {
      this.started = true;
      this.applyAll(this.data.start);
    }
    if (use !== null && this.canUse(use, w)) {
      const i = this.things.get(use);
      if (i !== undefined) {
        this.used.add(use);
        this.notes.push({ kind: 'used', interactable: use });
        this.applyAll(i.effects);
      }
    }
    const scan =
      evaluate || use !== null || this.notes.length > 0 || this.kills.any !== this.killsSeen;
    this.killsSeen = this.kills.any;
    for (let pass = 0; scan && pass < PASSES; pass++) {
      const before = this.notes.length;
      // After an ending only the bookkeeping runs (the choice objective completes).
      if (!this.ended)
        for (const t of this.data.triggers) {
          if (t.once && this.fired.has(t.id)) continue;
          if (!this.holds(t.when, w)) continue;
          this.fired.add(t.id);
          this.applyAll(t.effects);
        }
      this.checkObjectives(w);
      if (this.notes.length === before) break;
    }
    this.advanceLines(dt);
    return this.notes;
  }

  private checkObjectives(w: StoryWorld): void {
    for (const q of this.data.quests) {
      if (this.status(q.id) !== 'active') continue;
      for (const o of q.objectives)
        if (
          o.done !== undefined &&
          !this.objectives.has(`${q.id}.${o.id}`) &&
          this.holds(o.done, w)
        )
          this.completeObjective(q.id, o.id);
    }
  }

  private completeObjective(quest: string, objective: string): void {
    const key = `${quest}.${objective}`;
    if (this.objectives.has(key)) return;
    this.objectives.add(key);
    this.notes.push({ kind: 'objective', quest, objective });
    const q = this.quests.get(quest);
    if (
      q !== undefined &&
      this.status(quest) === 'active' &&
      q.objectives.every((o) => this.objectives.has(`${quest}.${o.id}`))
    )
      this.setStatus(q, 'done');
  }

  private setStatus(q: Quest, status: QuestStatus): void {
    if (this.status(q.id) === status) return;
    this.questStatus.set(q.id, status);
    this.notes.push({ kind: 'quest', quest: q.id, status });
    if (status === 'done') this.applyAll(q.onComplete);
  }

  private applyAll(effects: readonly Effect[]): void {
    for (const e of effects) this.apply(e);
  }

  private apply(e: Effect): void {
    if (this.ending !== null) return;
    switch (e.do) {
      case 'setFlag':
        this.flags.set(e.flag, e.value);
        break;
      case 'addFlag':
        this.flags.set(e.flag, this.flag(e.flag) + e.by);
        break;
      case 'startQuest': {
        const q = this.quests.get(e.quest);
        if (q !== undefined && this.status(q.id) === 'inactive') this.setStatus(q, 'active');
        break;
      }
      case 'objective':
        if (this.status(e.quest) === 'active') this.completeObjective(e.quest, e.objective);
        break;
      case 'completeQuest': {
        const q = this.quests.get(e.quest);
        if (q !== undefined && this.status(q.id) === 'active') {
          for (const o of q.objectives) this.objectives.add(`${q.id}.${o.id}`);
          this.setStatus(q, 'done');
        }
        break;
      }
      case 'failQuest': {
        const q = this.quests.get(e.quest);
        if (q !== undefined && this.status(q.id) === 'active') this.setStatus(q, 'failed');
        break;
      }
      case 'log':
        if (!this.logs.includes(e.log)) {
          this.logs.push(e.log);
          this.notes.push({ kind: 'log', log: e.log });
          if (this.lines.has(`log:${e.log}`)) this.queue('log', e.log);
        }
        break;
      case 'radio':
        this.queue('radio', e.radio);
        break;
      case 'chapter':
        if (this.chapter !== e.chapter) {
          this.chapter = e.chapter;
          this.notes.push({ kind: 'chapter', chapter: e.chapter });
        }
        break;
      case 'ending':
        this.ending = e.ending;
        this.notes.push({ kind: 'ending', ending: e.ending });
        break;
      case 'spawn':
        this.notes.push({ kind: 'spawn', mob: e.mob, x: e.at[0], z: e.at[1], count: e.count });
        break;
      case 'supply':
        this.notes.push({ kind: 'supply', ammo: e.ammo, amount: e.amount });
        break;
      case 'battery':
        this.notes.push({ kind: 'battery' });
        break;
    }
  }

  private queue(source: 'radio' | 'log', id: string): void {
    if (this.playing.some((p) => p.source === source && p.id === id)) return;
    this.playing.push({ source, id, next: 0 });
  }

  /** Plays queued transmissions one line at a time, one source after another. */
  private advanceLines(dt: number): void {
    this.lineLeft -= dt;
    while (this.lineLeft <= 0) {
      const p = this.playing[0];
      if (p === undefined) {
        this.lineLeft = 0;
        return;
      }
      const lines = this.lines.get(`${p.source}:${p.id}`) ?? [];
      const line = lines[p.next];
      if (line === undefined) {
        this.playing.shift();
        continue;
      }
      p.next++;
      this.lineLeft += line.seconds;
      this.notes.push({ kind: 'line', source: p.source, id: p.id, line });
    }
  }
}
