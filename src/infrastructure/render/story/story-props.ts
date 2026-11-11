import * as THREE from 'three';
import type { StoryRuntime } from '../../../application/story/story-system';
import type { Interactable, InteractableKind } from '../../../domain/story/schema';

/**
 * The story's things in the world, built in code: a bodycam or a sheet of
 * paper on the ground, a generator housing, a terminal with a lit screen, a
 * radio with its antenna, a supply crate. A faint amber halo on the ground
 * marks what can be used now; used things go dark; a generator's lamp comes
 * on once it runs. One small group per interactable, shared geometry.
 */
interface Prop {
  readonly def: Interactable;
  readonly group: THREE.Group;
  readonly halo: THREE.Mesh;
  readonly lamp: THREE.Mesh | null;
}

const box = (w: number, h: number, d: number, y = h / 2): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y, 0);
  return g;
};

export class StoryProps {
  readonly group = new THREE.Group();
  private readonly props: Prop[] = [];
  private readonly mats = {
    metal: new THREE.MeshStandardMaterial({ color: 0x3b4146, roughness: 0.6, metalness: 0.7 }),
    paint: new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.8, metalness: 0.2 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xc8c2b0, roughness: 0.95 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.9 }),
    screen: new THREE.MeshStandardMaterial({
      color: 0x041008,
      emissive: 0x2aff8a,
      emissiveIntensity: 1.2,
    }),
    led: new THREE.MeshStandardMaterial({
      color: 0x200000,
      emissive: 0xff2010,
      emissiveIntensity: 3,
    }),
    lampOn: new THREE.MeshStandardMaterial({
      color: 0x302010,
      emissive: 0xffb347,
      emissiveIntensity: 4,
    }),
    lampOff: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }),
    halo: new THREE.MeshBasicMaterial({
      color: 0xffa040,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  };
  private readonly geo = {
    halo: new THREE.RingGeometry(0.62, 0.7, 32).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
    sheet: box(0.3, 0.01, 0.4),
    camera: box(0.12, 0.08, 0.06),
    led: new THREE.SphereGeometry(0.012, 6, 4).translate(0.04, 0.06, -0.031),
    housing: box(1.4, 1.1, 0.9),
    exhaust: new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8).translate(0.5, 1.4, 0.2),
    lamp: new THREE.SphereGeometry(0.06, 8, 6).translate(-0.55, 1.18, -0.3),
    pedestal: box(0.6, 1.1, 0.4),
    screenPanel: new THREE.PlaneGeometry(0.5, 0.32).rotateX(-0.35).translate(0, 1.18, -0.16),
    radio: box(0.35, 0.22, 0.2, 0.11),
    antenna: new THREE.CylinderGeometry(0.006, 0.006, 0.5, 4).translate(0.12, 0.47, 0),
    crate: box(0.9, 0.6, 0.6),
  };
  /** Counters for tests and the debug menu. */
  readonly stats = { props: 0, usable: 0 };

  constructor(private readonly story: StoryRuntime) {
    this.group.name = 'story-props';
    for (const def of story.data.interactables) this.add(def);
    this.stats.props = this.props.length;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    return mesh;
  }

  private build(kind: InteractableKind, label: string, group: THREE.Group): THREE.Mesh | null {
    const g = this.geo;
    const m = this.mats;
    switch (kind) {
      case 'log':
        if (/bodycam/i.test(label))
          group.add(this.mesh(g.camera, m.metal), this.mesh(g.led, m.led));
        else group.add(this.mesh(g.sheet, m.paper));
        return null;
      case 'generator': {
        const lamp = this.mesh(g.lamp, m.lampOff);
        group.add(this.mesh(g.housing, m.paint), this.mesh(g.exhaust, m.metal), lamp);
        return lamp;
      }
      case 'terminal':
        group.add(this.mesh(g.pedestal, m.metal), this.mesh(g.screenPanel, m.screen));
        return null;
      case 'radio':
        group.add(
          this.mesh(g.radio, m.metal),
          this.mesh(g.antenna, m.metal),
          this.mesh(g.led, m.led),
        );
        return null;
      case 'cache':
        group.add(this.mesh(g.crate, m.wood));
        return null;
      case 'door':
        group.add(this.mesh(box(1.2, 2.2, 0.1), m.metal));
        return null;
    }
  }

  private add(def: Interactable): void {
    const group = new THREE.Group();
    group.name = `story:${def.id}`;
    group.position.set(def.at[0], def.at[1], def.at[2]);
    // Things sit beside the road's centre line, facing it.
    group.rotation.y = ((def.at[0] * 7 + def.at[2] * 13) % 6) * 0.5;
    const lamp = this.build(def.kind, def.label, group);
    const halo = new THREE.Mesh(this.geo.halo, this.mats.halo);
    halo.renderOrder = 5;
    group.add(halo);
    this.group.add(group);
    this.props.push({ def, group, halo, lamp });
  }

  /** Per frame: halos on what is usable now, lamps on running generators. */
  update(time: number): void {
    const e = this.story.engine;
    const w = this.story.view;
    let usable = 0;
    for (const p of this.props) {
      const can = e.canUse(p.def.id, w);
      p.halo.visible = can;
      if (can) usable++;
      const s = 1 + 0.08 * Math.sin(time * 3 + p.def.at[0]);
      p.halo.scale.set(s, 1, s);
      if (p.lamp !== null)
        p.lamp.material = e.used.has(p.def.id) ? this.mats.lampOn : this.mats.lampOff;
    }
    this.mats.halo.opacity = 0.07 + 0.04 * Math.sin(time * 2);
    this.mats.led.emissiveIntensity = Math.sin(time * Math.PI * 2) > 0 ? 3 : 0.3;
    this.stats.usable = usable;
  }

  dispose(): void {
    for (const m of Object.values(this.mats)) m.dispose();
    for (const g of Object.values(this.geo)) g.dispose();
  }
}
