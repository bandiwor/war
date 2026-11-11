import { parseSave, serializeSave, type SaveGame } from '../../domain/save/save';

/**
 * Save slots in the browser (localStorage). Saves are stored as their
 * diff-friendly text and parsed through the migrations on read, so a save
 * written by an older build loads in a newer one. A corrupt or unknown
 * save reads as missing (and is reported), never as a crash.
 */
export const SAVE_SLOTS = ['quick', 'auto'] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number];

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SlotInfo {
  readonly slot: SaveSlot;
  readonly label: string;
  readonly playSeconds: number;
  readonly scene: SaveGame['scene'];
}

const key = (slot: SaveSlot): string => `war.save.${slot}`;

export class SaveStore {
  /** Problems met while reading (corrupt slots), for the debug menu. */
  readonly problems: string[] = [];

  constructor(private readonly storage: KeyValueStorage) {}

  write(slot: SaveSlot, save: SaveGame): boolean {
    try {
      this.storage.setItem(key(slot), serializeSave(save));
      return true;
    } catch (e) {
      this.problems.push(`${slot}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  read(slot: SaveSlot): SaveGame | null {
    let text: string | null;
    try {
      text = this.storage.getItem(key(slot));
    } catch {
      return null;
    }
    if (text === null) return null;
    try {
      return parseSave(JSON.parse(text));
    } catch (e) {
      this.problems.push(`${slot}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  list(): SlotInfo[] {
    const out: SlotInfo[] = [];
    for (const slot of SAVE_SLOTS) {
      const s = this.read(slot);
      if (s !== null)
        out.push({ slot, label: s.meta.label, playSeconds: s.meta.playSeconds, scene: s.scene });
    }
    return out;
  }

  remove(slot: SaveSlot): void {
    try {
      this.storage.removeItem(key(slot));
    } catch {
      // Storage unavailable (private mode): nothing to remove.
    }
  }
}

/** The page's storage, or an in-memory stand-in where it is blocked. */
export function browserStorage(): KeyValueStorage {
  try {
    const probe = '__war_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => {
        mem.set(k, v);
      },
      removeItem: (k) => {
        mem.delete(k);
      },
    };
  }
}
