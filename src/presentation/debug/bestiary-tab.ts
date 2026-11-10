import * as THREE from 'three';
import { DEAD_ACTION, Mob, SCORE_FIELDS } from '../../application/ai/components';
import { Target } from '../../application/combat/components';
import type { CommandQueue } from '../../application/replay/command-queue';
import type { Sandbox } from '../../application/scenes/sandbox';
import { UTILITY_ACTIONS } from '../../domain/ai/utility';
import { EFFECT_IDS } from '../../domain/bodycam/effects';
import type { EntityId } from '../../domain/ecs/entity';
import { MOBS, MOB_IDS, mobAt, type AnimationId, type MobId } from '../../domain/mobs/registry';
import { MATERIAL_IDS } from '../../domain/procgen/materials';
import { WEAPONS, WEAPON_IDS } from '../../domain/weapons/registry';
import type { BodycamPresenter } from '../../infrastructure/render/bodycam-presenter';
import {
  buildMobModel,
  disposeMobModel,
  hitboxWireframe,
  poseMob,
  type MobModel,
} from '../../infrastructure/render/mobs/mob-models';
import { el, slider } from './widgets';

/** What tests and the console can do with the bestiary and the AI. */
export interface BestiaryApi {
  /** Everything the bestiary lists, straight from the registries. */
  bestiary(): { mobs: string[]; weapons: string[]; effects: string[]; materials: string[] };
  /** Show a mob on the test stage, optionally playing an animation. */
  previewMob(id: string, anim?: string): boolean;
  previewState(): { mob: string | null; anim: string; frames: number } | null;
  /** Spawn a mob `distance` metres in front of the player (through the command queue). */
  spawnMob(id: string, distance?: number): boolean;
  mobCount(): number;
  inspectNearest(): {
    id: string;
    action: string;
    awareness: number;
    sensing: boolean;
    health: number;
    distance: number;
    scores: Record<string, number>;
  } | null;
  setAiOverlay(opts: Partial<{ cones: boolean; paths: boolean; nav: boolean }>): void;
  cheat(key: 'god' | 'noclip' | 'heal', on: boolean): void;
}

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: dense rows hold live entity ids
  return raw as EntityId;
}

/** The test stage: its own small WebGL view with an orbit camera (debug builds only). */
class TestStage {
  readonly canvas = el('canvas', 'bestiary-stage');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.05, 50);
  private model: MobModel | null = null;
  private extras = new THREE.Group();
  orbit = { yaw: 0.6, pitch: 0.25, dist: 4 };
  anim: AnimationId = 'idle';
  slow = 1;
  time = 0;
  phase = 0;
  frames = 0;
  show = { bones: false, hitboxes: false, vision: false };

  constructor() {
    this.canvas.width = 320;
    this.canvas.height = 240;
    this.canvas.dataset['testid'] = 'bestiary-stage';
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(320, 240, false);
    this.scene.background = new THREE.Color(0x0b0e12);
    this.scene.add(new THREE.HemisphereLight(0x9fb2c8, 0x101010, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 2);
    this.scene.add(key, new THREE.GridHelper(8, 16, 0x40505c, 0x1c242c), this.extras);
    let drag: { x: number; y: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (drag === null) return;
      this.orbit.yaw -= (e.clientX - drag.x) * 0.01;
      this.orbit.pitch = Math.max(
        -0.2,
        Math.min(1.3, this.orbit.pitch + (e.clientY - drag.y) * 0.01),
      );
      drag = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', () => {
      drag = null;
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.orbit.dist = Math.max(1.5, Math.min(12, this.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      e.preventDefault();
    });
  }

  get mob(): MobId | null {
    return this.model?.id ?? null;
  }

  showMob(id: MobId): void {
    if (this.model !== null) {
      this.scene.remove(this.model.root);
      disposeMobModel(this.model);
    }
    this.model = buildMobModel(id);
    this.scene.add(this.model.root);
    this.anim = 'idle';
    this.time = 0;
    this.orbit.dist = 3 + 2 * MOBS[id].body.scale;
    this.rebuildExtras();
  }

  rebuildExtras(): void {
    this.scene.remove(this.extras);
    this.extras = new THREE.Group();
    this.scene.add(this.extras);
    const id = this.mob;
    if (id === null) return;
    const spec = MOBS[id];
    if (this.show.hitboxes) this.extras.add(hitboxWireframe(id));
    const eyes = spec.senses.sight;
    if (this.show.vision && eyes !== null) {
      const half = (eyes.fovDeg * Math.PI) / 360;
      const y = spec.body.eyeHeight * spec.body.scale;
      const r = Math.min(eyes.range, 6);
      const pts: THREE.Vector3[] = [new THREE.Vector3(0, y, 0)];
      for (let i = 0; i <= 16; i++) {
        const a = -half + (2 * half * i) / 16;
        pts.push(new THREE.Vector3(-Math.sin(a) * r, y, -Math.cos(a) * r));
      }
      pts.push(new THREE.Vector3(0, y, 0));
      this.extras.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0xffb020 }),
        ),
      );
    }
  }

  render(dt: number): void {
    const model = this.model;
    if (model === null) return;
    const step = dt * this.slow;
    this.time += step;
    const spec = MOBS[model.id];
    const speed =
      this.anim === 'run' ? spec.body.runSpeed : this.anim === 'walk' ? spec.body.walkSpeed : 0;
    this.phase += (speed * step * Math.PI * 2) / (1.4 * spec.body.scale);
    const cycle =
      this.anim === 'attack'
        ? 1
        : this.anim === 'hit'
          ? 0.6
          : this.anim === 'die'
            ? 2.5
            : this.anim === 'alert'
              ? 1.2
              : Infinity;
    poseMob(model, {
      anim: this.anim,
      time: this.time % cycle,
      phase: this.phase,
      alert: this.anim === 'alert' ? 1 : 0,
    });
    if (this.show.bones) {
      const pts: THREE.Vector3[] = [];
      model.root.updateMatrixWorld(true);
      for (const b of model.bones.values()) {
        if (b.parent === null || b === model.root) continue;
        pts.push(
          b.parent.getWorldPosition(new THREE.Vector3()),
          b.getWorldPosition(new THREE.Vector3()),
        );
      }
      const old = this.extras.getObjectByName('bones');
      if (old !== undefined) this.extras.remove(old);
      const lines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x60c0ff, depthTest: false }),
      );
      lines.name = 'bones';
      lines.renderOrder = 10;
      this.extras.add(lines);
    }
    const target = new THREE.Vector3(0, 0.8 * spec.body.scale, 0);
    const o = this.orbit;
    this.camera.position.set(
      target.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
      target.y + Math.sin(o.pitch) * o.dist,
      target.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist,
    );
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  dispose(): void {
    if (this.model !== null) disposeMobModel(this.model);
    this.renderer.dispose();
  }
}

export function installBestiaryTab(
  section: HTMLElement,
  sandbox: Sandbox,
  presenter: BodycamPresenter,
  queue: CommandQueue | null,
  isOpen: () => boolean,
): { refresh(dt: number): void; api: BestiaryApi } {
  const stage = new TestStage();
  const info = el('pre');
  const inspector = el('pre');
  inspector.dataset['testid'] = 'ai-inspector';
  const list = el('div', 'bestiary-list');
  const anims = el('div', 'bestiary-anims');
  let selected: MobId | null = null;

  const select = (id: MobId): void => {
    selected = id;
    stage.showMob(id);
    const s = MOBS[id];
    info.textContent = [
      `${s.label}  (${s.race})`,
      s.description,
      `health ×${s.healthScale.toFixed(2)}  scale ${String(s.body.scale)}  walk ${String(s.body.walkSpeed)} / run ${String(s.body.runSpeed)} m/s`,
      `sight ${s.senses.sight === null ? '—' : `${String(s.senses.sight.range)} m, ${String(s.senses.sight.fovDeg)}°, needs light ${String(s.senses.sight.needsLight)}`}`,
      `hearing ${s.senses.hearing === null ? '—' : `×${String(s.senses.hearing)}`}   proximity ${s.senses.proximity === null ? '—' : `${String(s.senses.proximity)} m`}`,
      `memory forget ${String(s.memory.forget)} s, search ${String(s.memory.search)} s   attack ${String(s.attack.damage)} dmg, ${String(s.attack.range)} m, every ${String(s.attack.cooldown)} s`,
      `spawns in ${s.spawn.zones.join(', ')} (weight ${String(s.spawn.weight)}, group ${s.spawn.group.join('–')})`,
      `utility ${UTILITY_ACTIONS.map((a) => `${a} ${String(s.utility[a])}`).join(' · ')}`,
    ].join('\n');
    anims.replaceChildren();
    for (const a of s.animations) {
      const b = el('button', '', a);
      b.type = 'button';
      b.dataset['anim'] = a;
      b.addEventListener('click', () => {
        stage.anim = a;
        stage.time = 0;
      });
      anims.append(b);
    }
    for (const b of list.querySelectorAll('button'))
      b.classList.toggle('active', b.dataset['mob'] === id);
  };

  // Every registry entry, listed automatically.
  list.append(el('div', 'debug-label', `mobs (${String(MOB_IDS.length)})`));
  for (const id of MOB_IDS) {
    const b = el('button', '', `${MOBS[id].label} · ${MOBS[id].race}`);
    b.type = 'button';
    b.dataset['mob'] = id;
    b.addEventListener('click', () => {
      select(id);
    });
    list.append(b);
  }
  const catalog = el('details');
  catalog.append(
    el(
      'summary',
      '',
      `weapons (${String(WEAPON_IDS.length)}) · effects (${String(EFFECT_IDS.length)}) · materials (${String(MATERIAL_IDS.length)})`,
    ),
    el(
      'pre',
      '',
      [
        `weapons   ${WEAPON_IDS.map((w) => `${w} [${WEAPONS[w].kind}]`).join(', ')}`,
        `effects   ${EFFECT_IDS.join(', ')}`,
        `materials ${MATERIAL_IDS.join(', ')}`,
      ].join('\n'),
    ),
  );

  const toggles = el('div');
  for (const key of ['bones', 'hitboxes', 'vision'] as const) {
    const box = el('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      stage.show[key] = box.checked;
      stage.rebuildExtras();
    });
    const label = el('label', '', ` ${key} `);
    label.prepend(box);
    toggles.append(label);
  }
  const slow = slider('speed', 0.05, 1, 0.05, 1, (v) => {
    stage.slow = v;
  });
  const spawnBtn = el('button', '', 'Spawn 6 m ahead');
  spawnBtn.type = 'button';

  const spawnAhead = (id: string, distance = 6): boolean => {
    if (queue === null || !Object.hasOwn(MOBS, id)) return false;
    const v = presenter.view;
    const ax = v.x - Math.sin(v.yaw) * distance;
    const az = v.z - Math.cos(v.yaw) * distance;
    // Nearest walkable spot to the requested one (crates, cars and walls are in the way).
    const nav = sandbox.ai.nav;
    let found: readonly [number, number] | null = null;
    for (let r = 0; r <= 4 && found === null; r += 0.5) {
      for (let k = 0; k < 12 && found === null; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = ax + Math.sin(a) * r;
        const z = az + Math.cos(a) * r;
        if (nav.walkableAt(x, z)) found = [x, z];
      }
    }
    if (found === null) return false;
    // Facing back at the player (yaw + π, wrapped into [−π, π]).
    const back = v.yaw + Math.PI;
    queue.push({
      type: 'spawn',
      mob: id,
      x: found[0],
      z: found[1],
      yaw: back - 2 * Math.PI * Math.round(back / (2 * Math.PI)),
    });
    return true;
  };
  spawnBtn.addEventListener('click', () => {
    if (selected !== null) spawnAhead(selected);
  });

  // In-world AI: overlays, cheats, the nearest mob's mind.
  const world = el('fieldset');
  world.append(el('legend', '', 'in the world'));
  const overlayBoxes: Record<'cones' | 'paths' | 'nav', HTMLInputElement> = {
    cones: el('input'),
    paths: el('input'),
    nav: el('input'),
  };
  for (const key of ['cones', 'paths', 'nav'] as const) {
    const box = overlayBoxes[key];
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      presenter.aiOverlay.options[key] = box.checked;
    });
    const label = el(
      'label',
      '',
      ` ${key === 'cones' ? 'senses' : key === 'nav' ? 'nav grid' : 'paths'} `,
    );
    label.prepend(box);
    world.append(label);
  }
  const cheat = (key: 'god' | 'noclip' | 'heal', on: boolean): void => {
    queue?.push({ type: 'cheat', key, on });
  };
  for (const key of ['god', 'noclip'] as const) {
    const box = el('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      cheat(key, box.checked);
    });
    const label = el('label', '', ` ${key} `);
    label.prepend(box);
    world.append(label);
  }
  const heal = el('button', '', 'Heal');
  heal.type = 'button';
  heal.addEventListener('click', () => {
    cheat('heal', true);
  });
  world.append(heal, inspector);

  section.append(list, catalog, stage.canvas, anims, toggles, slow.row, spawnBtn, info, world);

  const inspectNearest = (): ReturnType<BestiaryApi['inspectNearest']> => {
    const w = sandbox.simulation.world;
    const mob = w.store(Mob);
    const t = w.store(Target);
    const v = presenter.view;
    let best = -1;
    let bestD = Infinity;
    for (let row = 0; row < mob.size; row++) {
      const tr = t.rowOf(entity(mob.dense[row] ?? 0));
      if (tr < 0) continue;
      const d = Math.hypot((t.fields.x[tr] ?? 0) - v.x, (t.fields.z[tr] ?? 0) - v.z);
      if (d < bestD) {
        bestD = d;
        best = row;
      }
    }
    if (best < 0) return null;
    const f = mob.fields;
    const tr = t.rowOf(entity(mob.dense[best] ?? 0));
    const action = f.action[best] ?? 0;
    const scores: Record<string, number> = {};
    UTILITY_ACTIONS.forEach((a, i) => {
      const field = SCORE_FIELDS[i];
      if (field !== undefined) scores[a] = f[field][best] ?? 0;
    });
    return {
      id: mobAt(f.kind[best] ?? 0) ?? '?',
      action: action === DEAD_ACTION ? 'dead' : (UTILITY_ACTIONS[action] ?? '?'),
      awareness: f.awareness[best] ?? 0,
      sensing: f.sensing[best] === 1,
      health: t.fields.health[tr] ?? 0,
      distance: bestD,
      scores,
    };
  };

  let shown = 0;
  return {
    refresh(dt) {
      if (!isOpen() || section.hidden) return;
      stage.render(dt);
      if (shown++ % 6 !== 0) return;
      const n = inspectNearest();
      const vitals = presenter.view.vitals;
      inspector.textContent = [
        `player  ${vitals.health.toFixed(0)}/${vitals.maxHealth.toFixed(0)} hp${vitals.god ? '  GOD' : ''}${vitals.noclip ? '  NOCLIP' : ''}${vitals.down ? '  DOWN' : ''}  threat ${vitals.threat.toFixed(2)}  deaths ${String(vitals.deaths)}`,
        `mobs    ${String(sandbox.simulation.world.store(Mob).size)} (${String(presenter.mobs.visible)} drawn)   searches ${String(sandbox.ai.stats.searches)}  rays ${String(sandbox.ai.stats.rays)}`,
        n === null
          ? 'nearest —'
          : `nearest ${n.id} @ ${n.distance.toFixed(1)} m: ${n.action}  awareness ${n.awareness.toFixed(2)}${n.sensing ? '  SENSING' : ''}  hp ${n.health.toFixed(0)}`,
        ...(n === null
          ? []
          : Object.entries(n.scores).map(
              ([a, s]) =>
                `  ${a.padEnd(12)} ${'█'.repeat(Math.round(Math.min(2, s) * 10)).padEnd(20)} ${s.toFixed(2)}`,
            )),
      ].join('\n');
    },
    api: {
      bestiary: () => ({
        mobs: [...list.querySelectorAll('button')].map((b) => b.dataset['mob'] ?? ''),
        weapons: [...WEAPON_IDS],
        effects: [...EFFECT_IDS],
        materials: [...MATERIAL_IDS],
      }),
      previewMob(id, anim) {
        if (!Object.hasOwn(MOBS, id)) return false;
        const mobId = MOB_IDS.find((m) => m === id);
        if (mobId === undefined) return false;
        select(mobId);
        const a = MOBS[mobId].animations.find((x) => x === anim);
        if (a !== undefined) {
          stage.anim = a;
          stage.time = 0;
        }
        return true;
      },
      previewState: () => ({ mob: stage.mob, anim: stage.anim, frames: stage.frames }),
      spawnMob: spawnAhead,
      mobCount: () => sandbox.simulation.world.store(Mob).size,
      inspectNearest,
      setAiOverlay(opts) {
        for (const key of ['cones', 'paths', 'nav'] as const) {
          const v = opts[key];
          if (v === undefined) continue;
          presenter.aiOverlay.options[key] = v;
          overlayBoxes[key].checked = v;
        }
      },
      cheat,
    },
  };
}
