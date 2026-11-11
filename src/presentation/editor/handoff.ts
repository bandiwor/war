import { levelToLayout } from '../../domain/level/compile';
import { parseLevel, type Level } from '../../domain/level/level';
import { NavGrid } from '../../domain/nav/nav-grid';

/**
 * Editor ⇄ game handover (kept apart from the editor so the game does not
 * load the editor's code): the level travels in session storage, the
 * editor's working copy in local storage.
 */
export const EDITOR_LEVEL_KEY = 'war.editor.level';
export const PLAY_LEVEL_KEY = 'war.level';
export const PLAY_FROM_KEY = 'war.level.from';

export interface LevelHandoff {
  readonly level: Level;
  /** Where to start: the editor camera's spot if walkable, else the level's spawn. */
  readonly from: { readonly at: readonly [number, number]; readonly yaw: number } | undefined;
}

export function readLevelHandoff(): LevelHandoff | null {
  try {
    const text = sessionStorage.getItem(PLAY_LEVEL_KEY);
    if (text === null) return null;
    const level = parseLevel(JSON.parse(text));
    const raw: unknown = JSON.parse(sessionStorage.getItem(PLAY_FROM_KEY) ?? 'null');
    let from: LevelHandoff['from'];
    if (
      typeof raw === 'object' &&
      raw !== null &&
      Array.isArray(Reflect.get(raw, 'at')) &&
      typeof Reflect.get(raw, 'yaw') === 'number'
    ) {
      const atRaw: unknown = Reflect.get(raw, 'at');
      const at: readonly unknown[] = Array.isArray(atRaw) ? atRaw : [];
      const yaw: unknown = Reflect.get(raw, 'yaw');
      const [x, z] = at;
      if (typeof x === 'number' && typeof z === 'number' && typeof yaw === 'number') {
        const grid = new NavGrid();
        grid.rasterize(levelToLayout(level));
        from = grid.walkableAt(x, z) ? { at: [x, z], yaw } : undefined;
      }
    }
    return { level, from };
  } catch (error) {
    console.warn('Level handoff unreadable', error);
    return null;
  }
}

/** Goes to the editor, keeping the level being played (if any) for it to reopen. */
export function openEditor(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('level');
  url.searchParams.delete('load');
  url.searchParams.delete('replay');
  url.searchParams.set('editor', '1');
  window.location.href = url.toString();
}
