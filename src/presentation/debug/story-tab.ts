import type { CommandQueue } from '../../application/replay/command-queue';
import type { Sandbox } from '../../application/scenes/sandbox';
import type { QuestStatus } from '../../domain/story/schema';
import type { SaveSlot, SlotInfo } from '../../infrastructure/browser/save-store';
import type { StoryUi } from '../session';
import { el } from './widgets';

/** What tests and the console can read and do with the story. */
export interface StoryDebugApi {
  storyState(): {
    chapter: string;
    ending: string | null;
    quests: Record<string, QuestStatus>;
    logs: string[];
    used: string[];
    flags: Record<string, number>;
    onAir: string | null;
    prompt: string | null;
    toasts: string[];
    journalOpen: boolean;
    /** Where the story last saw the player (x, z). */
    at: [number, number];
  } | null;
  /** Teleport next to an interactable (through the command queue: replayable). */
  storyGo(id: string): boolean;
  /** Press and release "use" on the next ticks. */
  storyUse(): void;
  saveGame(slot: SaveSlot): boolean;
  loadGame(slot: SaveSlot): void;
  saveSlots(): SlotInfo[];
}

/**
 * Debug view of the story (stage 8): the chapter, every quest and its
 * status, flags, logs; jump to any interactable and use it; save and load.
 */
export function installStoryTab(
  section: HTMLElement,
  sandbox: Sandbox,
  queue: CommandQueue | null,
  ui: StoryUi | null,
): { refresh(): void; api: StoryDebugApi } {
  const story = sandbox.story;
  const info = el('pre');
  section.append(info);

  const go = (id: string): boolean => {
    const i = story?.data.interactables.find((x) => x.id === id);
    if (i === undefined || queue === null) return false;
    // Stand a metre off it, on the road.
    queue.push({ type: 'teleport', x: i.at[0] + 1, y: i.at[1] + 0.05, z: i.at[2] });
    return true;
  };
  const use = (): void => {
    queue?.push({ type: 'action', action: 'use', pressed: true });
    window.setTimeout(() => {
      queue?.push({ type: 'action', action: 'use', pressed: false });
    }, 50);
  };

  if (story !== null) {
    const pick = el('select');
    for (const i of story.data.interactables) pick.append(new Option(`${i.id} — ${i.label}`, i.id));
    const goBtn = el('button', '', 'Go');
    goBtn.type = 'button';
    goBtn.addEventListener('click', () => go(pick.value));
    const useBtn = el('button', '', 'Use');
    useBtn.type = 'button';
    useBtn.addEventListener('click', use);
    section.append(el('label', '', 'interactable '), pick, el('br'), goBtn, useBtn);
  }
  if (ui !== null) {
    const box = el('fieldset');
    box.append(el('legend', '', 'saves (F5 quicksave · F9 quickload · auto at each chapter)'));
    for (const slot of ['quick', 'auto'] as const) {
      const save = el('button', '', `Save ${slot}`);
      save.type = 'button';
      save.addEventListener('click', () => ui.save(slot));
      const load = el('button', '', `Load ${slot}`);
      load.type = 'button';
      load.addEventListener('click', () => {
        ui.load(slot);
      });
      box.append(save, load);
    }
    section.append(box);
  }

  const state: StoryDebugApi['storyState'] = () => {
    if (story === null) return null;
    const e = story.engine;
    const v = story.view;
    return {
      chapter: e.chapter,
      ending: e.ending,
      quests: Object.fromEntries(e.questStatus),
      logs: [...e.logs],
      used: [...e.used].sort(),
      flags: Object.fromEntries(e.flags),
      onAir: e.onAir === null ? null : `${e.onAir.line.speaker}: ${e.onAir.line.text}`,
      prompt: story.usableAt(v.x, v.z)?.label ?? null,
      toasts: [...(ui?.hud?.recent ?? [])],
      journalOpen: ui?.hud?.journalOpen ?? false,
      at: [v.x, v.z],
    };
  };

  return {
    refresh() {
      if (section.hidden) return;
      const s = state();
      if (s === null) {
        info.textContent = 'no story in this scene (open world only)';
        return;
      }
      info.textContent = [
        `chapter ${s.chapter}${s.ending === null ? '' : `   ENDING ${s.ending}`}`,
        `on air  ${s.onAir ?? '—'}`,
        `prompt  ${s.prompt ?? '—'}`,
        'quests',
        ...Object.entries(s.quests).map(([q, st]) => `  ${q.padEnd(12)} ${st}`),
        `flags   ${
          Object.entries(s.flags)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(' ') || '—'
        }`,
        `logs    ${s.logs.join(', ') || '—'}`,
        `kills   ${JSON.stringify(story?.engine.kills ?? {})}`,
        `saves   ${(ui?.slots() ?? []).map((x) => `${x.slot}: ${x.label}`).join(' · ') || '—'}`,
      ].join('\n');
    },
    api: {
      storyState: state,
      storyGo: go,
      storyUse: use,
      saveGame: (slot) => ui?.save(slot) ?? false,
      loadGame: (slot) => {
        ui?.load(slot);
      },
      saveSlots: () => ui?.slots() ?? [],
    },
  };
}
