import { checkLevel, type CheckReport } from '../../domain/level/checks';
import {
  COLLECTIONS,
  EditorDocument,
  anchorOf,
  decorBrush,
  eraseDecor,
  listOf,
  pickAt,
  snap,
  snapAngle,
  terrainBrush,
  type Collection,
  type EntityRef,
  type TerrainMode,
} from '../../domain/level/editor';
import {
  LIGHT_KINDS,
  PROP_KINDS,
  levelBounds,
  newLevel,
  parseLevel,
  serializeLevel,
  type Level,
} from '../../domain/level/level';
import { MOB_IDS, MOBS } from '../../domain/mobs/registry';
import { MATERIAL_IDS, MATERIALS, type MaterialId } from '../../domain/procgen/materials';
import { INTERACTABLE_KINDS, StorySchema, type InteractableKind } from '../../domain/story/schema';
import { ZONE_IDS } from '../../domain/audio/zones';
import { EditorView } from '../../infrastructure/render/editor/editor-view';
import { MaterialLibrary } from '../../infrastructure/render/textures/material-library';
import { createTextureBaker } from '../../infrastructure/render/textures/texture-baker';
import sampleText from '../../../levels/yard.level.json?raw';
import { EDITOR_LEVEL_KEY, PLAY_FROM_KEY, PLAY_LEVEL_KEY } from './handoff';

/**
 * The level editor (stage 9), built into the game: the same registries
 * fill its palettes, the same scene builder and materials draw the level,
 * the same serialisation saves it, and "play from here" boots the real game
 * on it. Everything the UI does goes through the EditorDocument's commands,
 * so it all undoes.
 */

type Tool = 'select' | 'place' | 'zone' | 'patrol' | 'terrain' | 'decor';
const TOOLS: readonly Tool[] = ['select', 'place', 'zone', 'patrol', 'terrain', 'decor'];

/** What the place tool puts down: a collection and a kind from its registry. */
interface PlaceItem {
  readonly collection: Collection | 'spawn';
  readonly kind: string;
  readonly label: string;
}

function placeItems(): PlaceItem[] {
  return [
    { collection: 'spawn', kind: 'spawn', label: 'player spawn' },
    { collection: 'objects', kind: 'wall', label: 'object: wall' },
    { collection: 'objects', kind: 'block', label: 'object: block' },
    { collection: 'objects', kind: 'container', label: 'object: container' },
    ...MOB_IDS.map((id) => ({
      collection: 'mobs' as const,
      kind: id,
      label: `mob: ${MOBS[id].label}`,
    })),
    ...PROP_KINDS.map((k) => ({ collection: 'decor' as const, kind: k, label: `decor: ${k}` })),
    ...LIGHT_KINDS.map((k) => ({ collection: 'lights' as const, kind: k, label: `light: ${k}` })),
    ...INTERACTABLE_KINDS.map((k) => ({
      collection: 'interactables' as const,
      kind: k,
      label: `story: ${k}`,
    })),
  ];
}

const PROP_MATERIAL: Readonly<Record<(typeof PROP_KINDS)[number], MaterialId>> = {
  barrel: 'rustedMetal',
  crate: 'woodPlanks',
  lampPost: 'paintedMetal',
  fungus: 'foliage',
  tree: 'bark',
  rock: 'concrete',
};

const LIGHT_LOOK: Readonly<
  Record<
    (typeof LIGHT_KINDS)[number],
    { color: [number, number, number]; intensity: number; range: number; y: number }
  >
> = {
  sodiumLamp: { color: [1, 0.55, 0.18], intensity: 60, range: 22, y: 6 },
  emergencyBeacon: { color: [1, 0.08, 0.04], intensity: 30, range: 14, y: 3 },
  bioluminescence: { color: [0.15, 1, 0.75], intensity: 8, range: 8, y: 0.5 },
  window: { color: [1, 0.62, 0.3], intensity: 12, range: 10, y: 3 },
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== '') e.className = cls;
  if (text !== '') e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void, title = ''): HTMLButtonElement {
  const b = el('button', '', text);
  b.type = 'button';
  if (title !== '') b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function select(
  options: readonly string[],
  value: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const s = el('select');
  for (const o of options) s.append(new Option(o, o));
  s.value = value;
  s.addEventListener('change', () => {
    onChange(s.value);
  });
  return s;
}

function isMaterial(v: string): v is MaterialId {
  return Object.hasOwn(MATERIALS, v);
}

function readStored(): Level | null {
  try {
    const text = sessionStorage.getItem(PLAY_LEVEL_KEY) ?? localStorage.getItem(EDITOR_LEVEL_KEY);
    return text === null ? null : parseLevel(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Test and console handle (the editor ships in every build; this is tiny). */
export interface EditorApi {
  level(): Level;
  text(): string;
  checks(): CheckReport;
  tool(t: Tool): void;
  selection(): EntityRef | null;
  select(ref: EntityRef | null): void;
  /** Place an item (as from the palette) at (x, z). Returns the new id. */
  place(kind: string, x: number, z: number): string | null;
  move(ref: EntityRef, x: number, z: number): void;
  paint(x: number, z: number, radius: number, mode: TerrainMode): void;
  scatter(x: number, z: number, radius: number, kind: string, count: number): void;
  undo(): boolean;
  redo(): boolean;
  load(text: string): void;
  play(): void;
  palette(): string[];
  stats(): { rebuilds: number; markers: number; mobs: number };
}

declare global {
  interface Window {
    __warEditor?: EditorApi;
  }
}

export async function startEditor(root: HTMLElement): Promise<void> {
  root.classList.add('editor');
  const doc = new EditorDocument(readStored() ?? parseLevel(JSON.parse(sampleText)));
  sessionStorage.removeItem(PLAY_LEVEL_KEY);

  // --- Layout ------------------------------------------------------------
  const top = el('div', 'ed-top');
  const left = el('div', 'ed-left');
  const right = el('div', 'ed-right');
  const canvas = el('canvas', 'ed-canvas');
  canvas.dataset['testid'] = 'editor-canvas';
  const status = el('div', 'ed-status');
  root.append(canvas, top, left, right, status);
  root.dataset['editor'] = '1';

  const baker = createTextureBaker();
  const materials = await MaterialLibrary.create(baker, doc.level.seed, 256, 4);
  baker.dispose();
  const view = new EditorView(canvas, materials);
  const frameLevel = (): void => {
    const [x0, z0, x1, z1] = levelBounds(doc.level);
    view.orbit.x = (x0 + x1) / 2;
    view.orbit.z = (z0 + z1) / 2;
    view.orbit.dist = Math.max(x1 - x0, z1 - z0) * 0.95;
  };
  frameLevel();

  // --- State -------------------------------------------------------------
  let tool: Tool = 'select';
  let selection: EntityRef | null = null;
  let report: CheckReport = checkLevel(doc.level);
  let seen = -1;
  let checkedAt = -1;
  let gridStep = 1;
  const items = placeItems();
  let placeItem: PlaceItem = items[0] ?? { collection: 'spawn', kind: 'spawn', label: 'spawn' };
  let terrainMode: TerrainMode = { kind: 'raise' };
  let brushRadius = 3;
  let decorKind: (typeof PROP_KINDS)[number] = 'crate';
  let decorCount = 4;
  let stroke = 0;
  let patrolDraft: [number, number][] = [];
  let zoneStart: [number, number] | null = null;

  const s = (v: number): number => snap(v, gridStep);

  // --- Toolbar -----------------------------------------------------------
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  TOOLS.forEach((t, i) => {
    const b = button(`${String(i + 1)} ${t}`, () => {
      setTool(t);
    });
    b.dataset['tool'] = t;
    toolButtons.set(t, b);
    left.append(b);
  });
  const toolOptions = el('div', 'ed-tool-options');
  left.append(toolOptions);

  const setTool = (t: Tool): void => {
    tool = t;
    patrolDraft = [];
    zoneStart = null;
    for (const [k, b] of toolButtons) b.classList.toggle('active', k === t);
    toolOptions.replaceChildren();
    if (t === 'place') {
      const list = el('select');
      list.size = 16;
      list.dataset['testid'] = 'palette';
      for (const it of items) list.append(new Option(it.label, `${it.collection}:${it.kind}`));
      list.value = `${placeItem.collection}:${placeItem.kind}`;
      list.addEventListener('change', () => {
        placeItem = items.find((x) => `${x.collection}:${x.kind}` === list.value) ?? placeItem;
      });
      toolOptions.append(el('div', 'ed-hint', 'click to place'), list);
    } else if (t === 'terrain') {
      const modes = [
        'raise',
        'lower',
        'flatten 0',
        'flatten 2',
        'flatten 4',
        ...doc.level.terrain.palette.map((m, i) => `paint ${String(i)} ${m}`),
      ];
      toolOptions.append(
        el('div', 'ed-hint', 'drag to paint · 0–0.3 m floor, 0.45 m+ blocks'),
        select(modes, 'raise', (v) => {
          const [kind, arg] = v.split(' ');
          terrainMode =
            kind === 'raise'
              ? { kind: 'raise' }
              : kind === 'lower'
                ? { kind: 'lower' }
                : kind === 'flatten'
                  ? { kind: 'flatten', height: Number(arg) }
                  : { kind: 'paint', material: Number(arg) };
        }),
      );
    } else if (t === 'decor') {
      toolOptions.append(
        el('div', 'ed-hint', 'drag to scatter · shift: erase'),
        select(PROP_KINDS, decorKind, (v) => {
          decorKind = PROP_KINDS.find((k) => k === v) ?? decorKind;
        }),
        select(['1', '2', '4', '8'], String(decorCount), (v) => {
          decorCount = Number(v);
        }),
      );
    } else if (t === 'patrol')
      toolOptions.append(el('div', 'ed-hint', 'click points · Enter to finish'));
    else if (t === 'zone') toolOptions.append(el('div', 'ed-hint', 'drag a rectangle'));
    else
      toolOptions.append(el('div', 'ed-hint', 'click to select · drag to move · Del · R rotate'));
    if (t === 'terrain' || t === 'decor') {
      const r = el('input');
      r.type = 'range';
      r.min = '1';
      r.max = '12';
      r.value = String(brushRadius);
      r.addEventListener('input', () => {
        brushRadius = Number(r.value);
      });
      toolOptions.append(el('div', 'ed-hint', 'radius'), r);
    }
  };

  // --- Top bar -----------------------------------------------------------
  const undoBtn = button('Undo', () => doc.undo(), 'Ctrl+Z');
  const redoBtn = button('Redo', () => doc.redo(), 'Ctrl+Shift+Z');
  const snapBtn = button(
    'Grid 1 m',
    () => {
      gridStep = gridStep === 1 ? 0.5 : gridStep === 0.5 ? 0 : gridStep === 0 ? 2 : 1;
      snapBtn.textContent = gridStep === 0 ? 'Grid off' : `Grid ${String(gridStep)} m`;
    },
    'G',
  );
  const lightBtn = button('Work light', () => {
    view.lightMode = view.lightMode === 'work' ? 'night' : 'work';
    lightBtn.textContent = view.lightMode === 'work' ? 'Work light' : 'Night (real lights)';
  });
  const file = el('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f === undefined) return;
    void f.text().then((t) => {
      api.load(t);
    });
  });
  const play = button(
    '▶ Play from here',
    () => {
      api.play();
    },
    'P',
  );
  play.dataset['testid'] = 'play-from-here';
  top.append(
    button('New', () => {
      doc.load(newLevel({ id: 'untitled', seed: doc.level.seed }));
      selection = null;
    }),
    button('Sample', () => {
      api.load(sampleText);
    }),
    button('Open…', () => {
      file.click();
    }),
    button('Export', () => {
      const url = URL.createObjectURL(
        new Blob([serializeLevel(doc.level)], { type: 'application/json' }),
      );
      const a = el('a');
      a.href = url;
      a.download = `${doc.level.id}.level.json`;
      a.click();
      URL.revokeObjectURL(url);
      doc.savedVersion = doc.version;
    }),
    file,
    undoBtn,
    redoBtn,
    snapBtn,
    lightBtn,
    play,
    button(
      'Back to game',
      () => {
        backToGame();
      },
      'F4',
    ),
  );

  function backToGame(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('editor');
    window.location.href = url.toString();
  }

  // --- Right panel: level, inspector, checks -------------------------------
  const levelBox = el('fieldset');
  const inspector = el('fieldset');
  inspector.dataset['testid'] = 'inspector';
  const checksBox = el('fieldset');
  checksBox.dataset['testid'] = 'checks';
  right.append(levelBox, inspector, checksBox);

  const renderLevelBox = (): void => {
    const l = doc.level;
    const title = el('input');
    title.value = l.title;
    title.addEventListener('change', () => {
      doc.setMeta('title', title.value);
    });
    const seedIn = el('input');
    seedIn.type = 'number';
    seedIn.value = String(l.seed);
    seedIn.addEventListener('change', () => {
      doc.setMeta('seed', Math.max(0, Math.floor(Number(seedIn.value))) >>> 0);
    });
    const story = el('textarea');
    story.rows = 6;
    story.value = l.story === null ? '' : JSON.stringify(l.story, null, 1);
    const storyMsg = el('div', 'ed-hint');
    const apply = button(l.story === null ? 'Add story' : 'Apply story', () => {
      try {
        doc.setStory(
          story.value.trim() === ''
            ? StorySchema.parse({
                title: l.title,
                start: [],
                chapters: [{ id: 'main', title: l.title, zone: l.zone, summary: '' }],
                quests: [
                  {
                    id: 'main',
                    title: l.title,
                    chapter: 'main',
                    main: true,
                    summary: '',
                    objectives: [{ id: 'done', text: 'Explore' }],
                    onComplete: [],
                  },
                ],
                logs: [],
                radio: [],
                interactables: [],
                triggers: [],
                endings: [{ id: 'end', title: 'End', epilogue: ['.'] }],
              })
            : StorySchema.parse(JSON.parse(story.value)),
        );
        storyMsg.textContent = 'story applied';
      } catch (e) {
        storyMsg.textContent = e instanceof Error ? e.message.slice(0, 300) : String(e);
      }
    });
    levelBox.replaceChildren(
      el('legend', '', 'level'),
      el('label', '', 'title '),
      title,
      el('label', '', ' zone '),
      select(ZONE_IDS, l.zone, (v) => {
        const z = ZONE_IDS.find((x) => x === v);
        if (z !== undefined) doc.setMeta('zone', z);
      }),
      el('label', '', ' seed '),
      seedIn,
      el(
        'div',
        'ed-hint',
        `${String(l.cells[0] * 2)} × ${String(l.cells[1] * 2)} m · quests, triggers, logs: story JSON`,
      ),
      story,
      apply,
      storyMsg,
    );
  };

  const renderInspector = (): void => {
    inspector.replaceChildren(el('legend', '', 'inspector'));
    if (selection === null) {
      inspector.append(el('div', 'ed-hint', 'nothing selected'));
      return;
    }
    const ref = selection;
    const e = doc.find(ref.collection, ref.id);
    if (e === undefined) {
      inspector.append(el('div', 'ed-hint', 'nothing selected'));
      return;
    }
    inspector.append(el('div', 'ed-sel', `${ref.collection} · ${ref.id}`));
    const text = el('textarea');
    text.rows = 10;
    text.dataset['testid'] = 'inspector-json';
    text.value = JSON.stringify(e, null, 1);
    const msg = el('div', 'ed-hint');
    const apply = button('Apply', () => {
      try {
        const next: unknown = JSON.parse(text.value);
        const test = structuredClone(doc.level);
        const list = listOf(test, ref.collection);
        const i = list.findIndex((x) => x.id === ref.id);
        // Validate by parsing a level with the change: the schema is the single source of truth.
        Object.assign(list, { [i]: next });
        parseLevel(test);
        doc.update(ref.collection, ref.id, () => parseEntity(test, ref));
        msg.textContent = 'applied';
      } catch (err) {
        msg.textContent = err instanceof Error ? err.message.slice(0, 300) : String(err);
      }
    });
    // Quick fields every entity with them shares.
    const quick = el('div', 'ed-quick');
    if (ref.collection === 'mobs') {
      const m = doc.find('mobs', ref.id);
      if (m !== undefined) {
        quick.append(
          el('label', '', 'mob '),
          select(MOB_IDS, m.mob, (v) => {
            const id = MOB_IDS.find((x) => x === v);
            if (id !== undefined) doc.update('mobs', ref.id, (x) => ({ ...x, mob: id }));
          }),
          el('label', '', ' patrol '),
          select(['—', ...doc.level.patrols.map((p) => p.id)], m.patrol ?? '—', (v) => {
            doc.update('mobs', ref.id, (x) => ({ ...x, patrol: v === '—' ? null : v }));
          }),
        );
      }
    }
    if (ref.collection === 'objects' || ref.collection === 'decor') {
      const cur = doc.find(ref.collection, ref.id);
      if (cur !== undefined)
        quick.append(
          el('label', '', 'material '),
          select(MATERIAL_IDS, cur.material, (v) => {
            if (isMaterial(v)) doc.update(ref.collection, ref.id, (x) => ({ ...x, material: v }));
          }),
        );
    }
    inspector.append(
      quick,
      text,
      apply,
      button('Delete', () => {
        doc.remove(ref);
        selection = null;
      }),
      msg,
    );
  };

  const renderChecks = (): void => {
    checksBox.replaceChildren(
      el(
        'legend',
        '',
        `checks · ${String(report.errors)} errors · ${String(report.warnings)} warnings`,
      ),
      el(
        'div',
        'ed-hint',
        `${String(report.reachable)} of ${String(report.walkable)} m² walkable ground reachable from the spawn`,
      ),
    );
    checksBox.dataset['errors'] = String(report.errors);
    if (report.issues.length === 0) checksBox.append(el('div', 'ed-ok', '✓ no issues'));
    for (const issue of report.issues.slice(0, 40)) {
      const row = el(
        'div',
        `ed-issue ${issue.severity}`,
        `${issue.severity === 'error' ? '✖' : '⚠'} ${issue.message}`,
      );
      row.dataset['code'] = issue.code;
      row.addEventListener('click', () => {
        if (issue.at !== null) {
          view.orbit.x = issue.at[0];
          view.orbit.z = issue.at[1];
          view.orbit.dist = Math.min(view.orbit.dist, 30);
        }
        const ref = issue.ref === null ? null : findRef(issue.ref);
        if (ref !== null) selection = ref;
      });
      checksBox.append(row);
    }
  };

  const findRef = (id: string): EntityRef | null => {
    for (const c of COLLECTIONS) {
      if (c === 'interactables' && doc.level.story === null) continue;
      if (listOf(doc.level, c).some((e) => e.id === id)) return { collection: c, id };
    }
    return null;
  };

  // --- Placing -----------------------------------------------------------
  const place = (it: PlaceItem, x: number, z: number): string | null => {
    const at: [number, number] = [s(x), s(z)];
    const yaw = 0;
    switch (it.collection) {
      case 'spawn':
        doc.setSpawn(at[0], at[1], doc.level.spawn.yaw);
        return 'spawn';
      case 'objects': {
        const id = doc.nextId(it.kind);
        const size: [number, number, number] =
          it.kind === 'wall' ? [6, 3, 0.4] : it.kind === 'container' ? [2.4, 2.6, 6] : [2, 1, 2];
        return doc.add('objects', {
          id,
          material:
            it.kind === 'wall' ? 'brick' : it.kind === 'container' ? 'rustedMetal' : 'concrete',
          center: [at[0], size[1] / 2, at[1]],
          size,
          yaw,
          solid: true,
        });
      }
      case 'mobs': {
        const mob = MOB_IDS.find((m) => m === it.kind);
        if (mob === undefined) return null;
        return doc.add('mobs', { id: doc.nextId(mob), mob, at, yaw, patrol: null });
      }
      case 'decor': {
        const kind = PROP_KINDS.find((k) => k === it.kind);
        if (kind === undefined) return null;
        return doc.add('decor', {
          id: doc.nextId(kind),
          kind,
          material: PROP_MATERIAL[kind],
          at,
          yaw,
          scale: 1,
        });
      }
      case 'lights': {
        const kind = LIGHT_KINDS.find((k) => k === it.kind);
        if (kind === undefined) return null;
        const look = LIGHT_LOOK[kind];
        return doc.add('lights', {
          id: doc.nextId(kind),
          kind,
          at: [at[0], look.y, at[1]],
          color: look.color,
          intensity: look.intensity,
          range: look.range,
          flicker: 0,
        });
      }
      case 'interactables': {
        const kind = INTERACTABLE_KINDS.find((k): k is InteractableKind => k === it.kind);
        if (kind === undefined) return null;
        if (doc.level.story === null) return null;
        return doc.add('interactables', {
          id: doc.nextId(kind),
          kind,
          label: `Use: ${kind}`,
          at: [at[0], 0, at[1]],
          radius: 2.2,
          once: true,
          effects: [{ do: 'setFlag', flag: `${kind}.used`, value: 1 }],
        });
      }
      case 'patrols':
      case 'spawnZones':
        return null;
    }
  };

  // --- Mouse ---------------------------------------------------------------
  let drag: { button: number; x: number; y: number; moved: boolean; key: string } | null = null;
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = {
      button: e.button,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      key: `drag:${String(++stroke)}`,
    };
    const g = view.groundAt(e.clientX, e.clientY);
    if (e.button !== 0 || g === null) return;
    const [gx, gz] = g;
    switch (tool) {
      case 'select':
        selection = pickAt(doc.level, gx, gz, 1.5);
        break;
      case 'place': {
        const id = place(placeItem, gx, gz);
        selection = id === null || id === 'spawn' ? null : findRef(id);
        break;
      }
      case 'zone':
        zoneStart = [s(gx), s(gz)];
        break;
      case 'patrol':
        patrolDraft.push([s(gx), s(gz)]);
        break;
      case 'terrain':
      case 'decor':
        dab(gx, gz, e.shiftKey);
        break;
    }
  });
  const dab = (gx: number, gz: number, erase: boolean): void => {
    if (drag === null) return;
    if (tool === 'terrain') {
      const c = terrainBrush(doc.level, gx, gz, brushRadius, terrainMode, drag.key);
      if (c !== null) doc.exec(c);
    } else if (erase) {
      const c = eraseDecor(doc.level, gx, gz, brushRadius);
      if (c !== null) doc.exec(c);
    } else {
      const c = decorBrush(
        doc,
        gx,
        gz,
        brushRadius,
        { kind: decorKind, material: PROP_MATERIAL[decorKind], scale: 1 },
        decorCount,
        ++stroke,
      );
      if (c !== null) doc.exec(c);
    }
  };
  canvas.addEventListener('pointermove', (e) => {
    const g = view.groundAt(e.clientX, e.clientY);
    view.setBrush(
      g?.[0] ?? 0,
      g?.[1] ?? 0,
      brushRadius,
      g !== null && (tool === 'terrain' || tool === 'decor'),
    );
    if (drag === null) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.button === 2 || drag.button === 1) {
      if (drag.button === 1 || e.shiftKey) {
        const k = view.orbit.dist / 600;
        const c = Math.cos(view.orbit.yaw);
        const sn = Math.sin(view.orbit.yaw);
        view.orbit.x -= (dx * c + dy * sn) * k;
        view.orbit.z -= (-dx * sn + dy * c) * k;
      } else {
        view.orbit.yaw -= dx * 0.008;
        view.orbit.pitch += dy * 0.006;
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    if (g === null) return;
    if (tool === 'select' && selection !== null && drag.moved) {
      if (selection.collection === 'interactables' && doc.level.story === null) return;
      doc.move(selection, s(g[0]), s(g[1]), drag.key);
    } else if ((tool === 'terrain' || tool === 'decor') && drag.moved) {
      dab(g[0], g[1], e.shiftKey);
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const g = view.groundAt(e.clientX, e.clientY);
    if (tool === 'zone' && zoneStart !== null && g !== null) {
      const [ax, az] = zoneStart;
      const bx = s(g[0]);
      const bz = s(g[1]);
      if (Math.abs(bx - ax) >= 2 && Math.abs(bz - az) >= 2) {
        const id = doc.add('spawnZones', {
          id: doc.nextId('zone'),
          min: [Math.min(ax, bx), Math.min(az, bz)],
          max: [Math.max(ax, bx), Math.max(az, bz)],
          mobs: ['shambler'],
          population: 2,
        });
        selection = { collection: 'spawnZones', id };
      }
      zoneStart = null;
    }
    drag = null;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      view.orbit.dist *= e.deltaY > 0 ? 1.12 : 1 / 1.12;
    },
    { passive: false },
  );

  // --- Keys ------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    )
      return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) doc.redo();
      else doc.undo();
    } else if (ctrl && e.code === 'KeyY') {
      e.preventDefault();
      doc.redo();
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      if (selection !== null) doc.remove(selection);
      selection = null;
    } else if (e.code === 'KeyR' && selection !== null) {
      const ref = selection;
      const e2 = doc.find(ref.collection, ref.id);
      if (e2 !== undefined && 'yaw' in e2)
        doc.update(ref.collection, ref.id, (x) => ({
          ...x,
          yaw: snapAngle(('yaw' in x ? x.yaw : 0) + Math.PI / 12),
        }));
    } else if (e.code === 'KeyG') snapBtn.click();
    else if (e.code === 'KeyP') api.play();
    else if (e.code === 'Enter' && tool === 'patrol' && patrolDraft.length >= 2) {
      const id = doc.add('patrols', { id: doc.nextId('patrol'), points: patrolDraft, loop: true });
      patrolDraft = [];
      selection = { collection: 'patrols', id };
    } else if (e.code === 'KeyF' && selection !== null) {
      const ent = doc.find(selection.collection, selection.id);
      if (ent !== undefined) [view.orbit.x, view.orbit.z] = anchorOf(selection.collection, ent);
    } else if (/^Digit[1-6]$/.test(e.code)) {
      const t = TOOLS[Number(e.code.slice(5)) - 1];
      if (t !== undefined) setTool(t);
    }
  });

  // --- API, loop -------------------------------------------------------------
  const api: EditorApi = {
    level: () => doc.level,
    text: () => serializeLevel(doc.level),
    checks: () => checkLevel(doc.level),
    tool: setTool,
    selection: () => selection,
    select: (ref) => {
      selection = ref;
    },
    place: (kind, x, z) => {
      const it = items.find((i) => i.kind === kind || `${i.collection}:${i.kind}` === kind);
      return it === undefined ? null : place(it, x, z);
    },
    move: (ref, x, z) => {
      doc.move(ref, x, z);
    },
    paint: (x, z, radius, mode) => {
      const c = terrainBrush(doc.level, x, z, radius, mode);
      if (c !== null) doc.exec(c);
    },
    scatter: (x, z, radius, kind, count) => {
      const k = PROP_KINDS.find((p) => p === kind);
      if (k === undefined) return;
      const c = decorBrush(
        doc,
        x,
        z,
        radius,
        { kind: k, material: PROP_MATERIAL[k], scale: 1 },
        count,
        ++stroke,
      );
      if (c !== null) doc.exec(c);
    },
    undo: () => doc.undo(),
    redo: () => doc.redo(),
    load: (text) => {
      doc.load(parseLevel(JSON.parse(text)));
      selection = null;
      frameLevel();
    },
    play: () => {
      const text = serializeLevel(doc.level);
      localStorage.setItem(EDITOR_LEVEL_KEY, text);
      sessionStorage.setItem(PLAY_LEVEL_KEY, text);
      // From where the camera looks, facing the way it faces (a walkable spot, or the spawn).
      const from = { at: [s(view.orbit.x), s(view.orbit.z)], yaw: view.orbit.yaw };
      sessionStorage.setItem(PLAY_FROM_KEY, JSON.stringify(from));
      const url = new URL(window.location.href);
      url.searchParams.delete('editor');
      url.searchParams.set('level', 'session');
      window.location.href = url.toString();
    },
    palette: () => items.map((i) => i.label),
    stats: () => ({ ...view.stats }),
  };
  window.__warEditor = api;

  setTool('select');
  let last = performance.now();
  let autosave = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (doc.version !== seen) {
      seen = doc.version;
      view.setLevel(doc.level, selection, report.issues);
      renderLevelBox();
      renderInspector();
      undoBtn.disabled = !doc.canUndo;
      redoBtn.disabled = !doc.canRedo;
      undoBtn.title = doc.undoLabel ?? '';
      autosave = now + 800;
    }
    // Checks run a moment after editing stops (they rasterise the whole level).
    if (checkedAt !== doc.version && now > autosave - 500) {
      checkedAt = doc.version;
      report = checkLevel(doc.level);
      renderChecks();
      view.setLevel(doc.level, selection, report.issues);
    }
    if (autosave > 0 && now > autosave) {
      autosave = 0;
      try {
        localStorage.setItem(EDITOR_LEVEL_KEY, serializeLevel(doc.level));
      } catch {
        // Storage full or blocked: the Export button still works.
      }
    }
    status.textContent = `${doc.level.title}${doc.dirty ? ' •' : ''} · tool ${tool} · ${gridStep === 0 ? 'no grid' : `grid ${String(gridStep)} m`} · ${doc.undoLabel === null ? '' : `undo: ${doc.undoLabel}`}${patrolDraft.length > 0 ? ` · patrol: ${String(patrolDraft.length)} points` : ''}`;
    view.render(dt);
    requestAnimationFrame(frame);
  };
  let lastSelection: EntityRef | null = null;
  const watchSelection = (): void => {
    if (selection !== lastSelection) {
      lastSelection = selection;
      renderInspector();
      view.setLevel(doc.level, selection, report.issues);
    }
    window.setTimeout(watchSelection, 100);
  };
  watchSelection();
  root.dataset['ready'] = '1';
  requestAnimationFrame(frame);
}

/** The entity of `ref` re-read from a parsed level (validated through the schema). */
function parseEntity<C extends Collection>(level: Level, ref: { collection: C; id: string }) {
  const parsed = parseLevel(level);
  const e = listOf(parsed, ref.collection).find((x) => x.id === ref.id);
  if (e === undefined) throw new Error('entity vanished');
  return e;
}
