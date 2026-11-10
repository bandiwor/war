import * as THREE from 'three';
import { DEAD_ACTION, Mob } from '../../../application/ai/components';
import type { Sandbox } from '../../../application/scenes/sandbox';
import { Target } from '../../../application/combat/components';
import { UTILITY_ACTIONS } from '../../../domain/ai/utility';
import type { EntityId } from '../../../domain/ecs/entity';
import { MOBS, MOB_IDS, mobAt, type AnimationId, type MobId } from '../../../domain/mobs/registry';
import { buildMobModel, poseMob, signalMob, type MobModel } from './mob-models';

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: dense rows hold live entity ids
  return raw as EntityId;
}

interface Instance {
  model: MobModel;
  phase: number;
  seen: number;
}

const CHASE = UTILITY_ACTIONS.indexOf('chase');
const ATTACK = UTILITY_ACTIONS.indexOf('attack');

/** Which animation a mob's state shows (falls back to idle when the mob lacks one). */
export function animationFor(
  id: MobId,
  action: number,
  actionTime: number,
  speed: number,
  attackTime: number,
  hitTime: number,
): { anim: AnimationId; time: number } {
  const spec = MOBS[id];
  const has = (a: AnimationId): boolean => spec.animations.includes(a);
  if (action === DEAD_ACTION) return { anim: has('die') ? 'die' : 'idle', time: actionTime };
  if (attackTime < 0.65 && has('attack')) return { anim: 'attack', time: attackTime };
  if (hitTime < 0.3 && has('hit')) return { anim: 'hit', time: hitTime };
  if (speed > spec.body.walkSpeed * 1.25 && has('run')) return { anim: 'run', time: actionTime };
  if (speed > 0.1 && has('walk')) return { anim: 'walk', time: actionTime };
  if ((action === CHASE || action === ATTACK) && actionTime < 0.6 && has('alert'))
    return { anim: 'alert', time: actionTime };
  return { anim: 'idle', time: actionTime };
}

/**
 * Draws every mob of the simulation: one model per living (or dying) mob,
 * interpolated between ticks and posed by the procedural animator. Models
 * are pooled per kind, so mobs coming and going do not churn GPU objects.
 */
export class MobRenderer {
  readonly group = new THREE.Group();
  private readonly instances = new Map<number, Instance>();
  private readonly pool = new Map<MobId, MobModel[]>();
  private frame = 0;
  visible = 0;

  constructor(private readonly sandbox: Sandbox) {
    this.group.name = 'mobs';
  }

  /** One model of each kind, for shader warm-up before the first frame. */
  warmupModels(): THREE.Group {
    const g = new THREE.Group();
    for (const id of MOB_IDS) g.add(this.acquire(id).root);
    return g;
  }

  releaseWarmup(g: THREE.Group): void {
    for (const m of this.all) {
      if (m.root.parent !== g) continue;
      g.remove(m.root);
      this.release(m.id, m);
    }
  }

  private readonly all: MobModel[] = [];

  private acquire(id: MobId): MobModel {
    const free = this.pool.get(id);
    const m = free?.pop() ?? buildMobModel(id);
    if (!this.all.includes(m)) this.all.push(m);
    m.root.visible = true;
    return m;
  }

  private release(id: MobId, m: MobModel): void {
    m.root.visible = false;
    this.group.remove(m.root);
    const free = this.pool.get(id) ?? [];
    free.push(m);
    this.pool.set(id, free);
  }

  update(alpha: number, dt: number, time: number): void {
    const world = this.sandbox.simulation.world;
    const mob = world.tryStore(Mob);
    const t = world.tryStore(Target);
    if (mob === null || t === null) return;
    const f = mob.fields;
    const a = Math.min(1, Math.max(0, alpha));
    this.frame++;
    let visible = 0;
    for (let row = 0; row < mob.size; row++) {
      const e = mob.dense[row] ?? 0;
      const tr = t.rowOf(entity(e));
      if (tr < 0) continue;
      const id = mobAt(f.kind[row] ?? 0) ?? 'shambler';
      let inst = this.instances.get(e);
      if (inst === undefined) {
        const model = this.acquire(id);
        this.group.add(model.root);
        inst = { model, phase: (e % 97) * 0.37, seen: 0 };
        this.instances.set(e, inst);
      }
      inst.seen = this.frame;
      const x0 = f.prevX[row] ?? 0;
      const z0 = f.prevZ[row] ?? 0;
      const x1 = t.fields.x[tr] ?? 0;
      const z1 = t.fields.z[tr] ?? 0;
      const y0 = f.prevY[row] ?? 0;
      const y1 = t.fields.y[tr] ?? 0;
      const yaw0 = f.prevYaw[row] ?? 0;
      let dy = (t.fields.yaw[tr] ?? 0) - yaw0;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const root = inst.model.root;
      root.position.set(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, z0 + (z1 - z0) * a);
      root.rotation.y = yaw0 + dy * a;
      const speed = f.speed[row] ?? 0;
      const stride = 1.4 * MOBS[id].body.scale;
      inst.phase += (speed * dt * Math.PI * 2) / stride;
      const pose = animationFor(
        id,
        f.action[row] ?? 0,
        f.actionTime[row] ?? 0,
        speed,
        f.attackTime[row] ?? 99,
        f.hitTime[row] ?? 99,
      );
      poseMob(inst.model, {
        anim: pose.anim,
        time:
          pose.anim === 'idle' || pose.anim === 'walk' || pose.anim === 'run' ? time : pose.time,
        phase: inst.phase,
        alert: f.awareness[row] ?? 0,
      });
      signalMob(
        inst.model,
        time + (e % 13) * 0.21,
        f.awareness[row] ?? 0,
        f.blind[row] ?? 0,
        (f.action[row] ?? 0) === DEAD_ACTION,
      );
      visible++;
    }
    // Mobs that left the simulation go back to the pool.
    for (const [e, inst] of this.instances) {
      if (inst.seen === this.frame) continue;
      this.instances.delete(e);
      this.release(inst.model.id, inst.model);
    }
    this.visible = visible;
  }

  dispose(): void {
    for (const m of this.all) for (const mat of m.materials) mat.dispose();
  }
}
