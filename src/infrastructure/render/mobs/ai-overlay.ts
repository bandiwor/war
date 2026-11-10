import * as THREE from 'three';
import { DEAD_ACTION, Mob } from '../../../application/ai/components';
import { Target } from '../../../application/combat/components';
import type { Sandbox } from '../../../application/scenes/sandbox';
import type { EntityId } from '../../../domain/ecs/entity';
import { MOBS, mobAt } from '../../../domain/mobs/registry';

function entity(raw: number): EntityId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand restore: dense rows hold live entity ids
  return raw as EntityId;
}

export interface AiOverlayOptions {
  cones: boolean;
  paths: boolean;
  nav: boolean;
}

/**
 * Debug view of the AI: vision cones (red while the mob sees its target,
 * amber otherwise), each mob's remaining path, and the nav grid around the
 * player (green walkable, red blocked). Rebuilt a few times per second.
 */
export class AiOverlay {
  readonly group = new THREE.Group();
  readonly options: AiOverlayOptions = { cones: false, paths: false, nav: false };
  private readonly lines: THREE.LineSegments;
  private readonly points: THREE.Points;
  private frame = 0;

  constructor(private readonly sandbox: Sandbox) {
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        vertexColors: true,
        toneMapped: false,
        fog: false,
        depthTest: false,
      }),
    );
    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        vertexColors: true,
        size: 3,
        sizeAttenuation: false,
        toneMapped: false,
        fog: false,
      }),
    );
    this.lines.frustumCulled = false;
    this.points.frustumCulled = false;
    this.lines.renderOrder = 20;
    this.group.add(this.lines, this.points);
    this.group.name = 'ai-overlay';
  }

  get active(): boolean {
    return this.options.cones || this.options.paths || this.options.nav;
  }

  update(playerX: number, playerZ: number): void {
    this.group.visible = this.active;
    if (!this.active || this.frame++ % 6 !== 0) return;
    const pos: number[] = [];
    const col: number[] = [];
    const seg = (
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      c: readonly number[],
    ): void => {
      pos.push(ax, ay, az, bx, by, bz);
      col.push(...c, ...c);
    };
    const world = this.sandbox.simulation.world;
    const mob = world.store(Mob);
    const t = world.store(Target);
    for (let row = 0; row < mob.size; row++) {
      const e = entity(mob.dense[row] ?? 0);
      const tr = t.rowOf(e);
      if (tr < 0 || mob.fields.action[row] === DEAD_ACTION) continue;
      const spec = MOBS[mobAt(mob.fields.kind[row] ?? 0) ?? 'shambler'];
      const x = t.fields.x[tr] ?? 0;
      const z = t.fields.z[tr] ?? 0;
      const y = (t.fields.y[tr] ?? 0) + spec.body.eyeHeight * spec.body.scale;
      const yaw = t.fields.yaw[tr] ?? 0;
      const sees = mob.fields.sensing[row] === 1;
      const eyes = spec.senses.sight;
      if (this.options.cones && eyes !== null) {
        const c = sees ? [4, 0.3, 0.2] : [3, 2, 0.2];
        const half = (eyes.fovDeg * Math.PI) / 360;
        const steps = 10;
        let px = x;
        let pz = z;
        for (let i = 0; i <= steps; i++) {
          const a = yaw - half + (2 * half * i) / steps;
          const ex = x - Math.sin(a) * eyes.range;
          const ez = z - Math.cos(a) * eyes.range;
          if (i === 0 || i === steps) seg(x, y, z, ex, y, ez, c);
          if (i > 0) seg(px, y, pz, ex, y, ez, c);
          px = ex;
          pz = ez;
        }
      }
      // Proximity sense: a ring.
      const nose = spec.senses.proximity;
      if (this.options.cones && nose !== null) {
        const c = sees ? [4, 0.3, 0.2] : [0.6, 2, 2];
        for (let i = 0; i < 16; i++) {
          const a0 = (i / 16) * Math.PI * 2;
          const a1 = ((i + 1) / 16) * Math.PI * 2;
          seg(
            x + Math.sin(a0) * nose,
            0.2,
            z + Math.cos(a0) * nose,
            x + Math.sin(a1) * nose,
            0.2,
            z + Math.cos(a1) * nose,
            c,
          );
        }
      }
      const path = this.sandbox.ai.paths.get(e);
      if (this.options.paths && path !== undefined && path.count > 0) {
        let px = x;
        let pz = z;
        for (let i = path.next; i < path.count; i++) {
          const wx = path.points[i * 2] ?? 0;
          const wz = path.points[i * 2 + 1] ?? 0;
          seg(px, 0.3, pz, wx, 0.3, wz, [0.3, 1.5, 4]);
          px = wx;
          pz = wz;
        }
      }
    }
    const ppos: number[] = [];
    const pcol: number[] = [];
    if (this.options.nav) {
      const nav = this.sandbox.ai.nav;
      const cx = Math.floor(playerX);
      const cz = Math.floor(playerZ);
      for (let dz = -16; dz <= 16; dz++) {
        for (let dx = -16; dx <= 16; dx++) {
          const ix = cx + dx;
          const iz = cz + dz;
          const ok = nav.walkable(ix, iz);
          ppos.push(ix + 0.5, nav.floorAt(ix + 0.5, iz + 0.5) + 0.05, iz + 0.5);
          pcol.push(...(ok ? [0.2, 1.2, 0.3] : [2.5, 0.2, 0.15]));
        }
      }
    }
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.lines.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.points.geometry.setAttribute('position', new THREE.Float32BufferAttribute(ppos, 3));
    this.points.geometry.setAttribute('color', new THREE.Float32BufferAttribute(pcol, 3));
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.points.geometry.dispose();
  }
}
