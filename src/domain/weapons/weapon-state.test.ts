import { describe, expect, it } from 'vitest';
import { Rng } from '../math/prng';
import { WEAPONS, type Firearm, type Weapon } from './registry';
import {
  WeaponEvent,
  createWeaponOutput,
  createWeaponState,
  currentMode,
  drawWeapon,
  jamProbability,
  roundsLoaded,
  tickWeapon,
  type WeaponInput,
  type WeaponState,
} from './weapon-state';

const DT = 1 / 60;
const fa = (id: 'pistol' | 'carbine' | 'shotgun' | 'rifle'): Firearm => {
  const w = WEAPONS[id];
  if (w.kind !== 'firearm') throw new Error(id);
  return w;
};

class Harness {
  readonly s: WeaponState;
  readonly out = createWeaponOutput();
  reserve = 120;
  events: number[] = [];
  shots = 0;
  private held = false;

  constructor(
    readonly w: Weapon,
    readonly rng = Rng.fromSeed(1),
  ) {
    this.s = createWeaponState(w);
    this.ticks(Math.ceil(w.drawSeconds / DT) + 1);
  }

  tick(over: Partial<WeaponInput> = {}): number {
    const trigger = over.trigger ?? false;
    const input: WeaponInput = {
      trigger,
      triggerPressed: trigger && !this.held,
      reloadPressed: false,
      fireModePressed: false,
      aiming: false,
      moving: 0,
      reserve: this.reserve,
      ...over,
    };
    this.held = trigger;
    tickWeapon(this.s, this.w, input, this.rng, DT, this.out);
    this.reserve -= this.out.reserveDelta;
    if (this.out.events & WeaponEvent.SHOT) this.shots++;
    this.events.push(this.out.events);
    return this.out.events;
  }

  ticks(n: number, over: Partial<WeaponInput> = {}): void {
    for (let i = 0; i < n; i++) this.tick(over);
  }

  seen(bit: number): boolean {
    return this.events.some((e) => (e & bit) !== 0);
  }
}

describe('firearm basics', () => {
  it('starts drawn after drawSeconds with a full magazine plus one in the chamber', () => {
    const h = new Harness(fa('pistol'));
    expect(h.s.phase).toBe('ready');
    expect(h.seen(WeaponEvent.DRAWN)).toBe(true);
    expect(roundsLoaded(h.s)).toBe(18);
  });

  it('semi-auto: one shot per trigger press, never while held', () => {
    const h = new Harness(fa('pistol'));
    h.ticks(60, { trigger: true });
    expect(h.shots).toBe(1);
    for (let i = 0; i < 5; i++) {
      h.tick({ trigger: false });
      h.ticks(10, { trigger: true });
    }
    expect(h.shots).toBe(6);
    expect(roundsLoaded(h.s)).toBe(12);
  });

  it('full auto fires at the rated rpm', () => {
    const h = new Harness(fa('carbine'));
    h.tick({ fireModePressed: true });
    expect(currentMode(h.s, fa('carbine'))).toBe('auto');
    h.ticks(120, { trigger: true }); // 2 s at 750 rpm = 25 rounds
    expect(h.shots).toBeGreaterThanOrEqual(24);
    expect(h.shots).toBeLessThanOrEqual(26);
  });

  it('burst mode stops after the burst count', () => {
    const burstGun: Firearm = { ...fa('carbine'), modes: ['burst'], burst: 3 };
    const h = new Harness(burstGun);
    h.ticks(60, { trigger: true });
    expect(h.shots).toBe(3);
  });

  it('runs dry: last round leaves the chamber empty; next press is a dry fire', () => {
    const h = new Harness(fa('pistol'));
    for (let i = 0; i < 18; i++) {
      h.tick({ trigger: true });
      h.ticks(8);
    }
    expect(h.shots).toBe(18);
    expect(roundsLoaded(h.s)).toBe(0);
    expect(h.tick({ trigger: true }) & WeaponEvent.DRY_FIRE).toBeTruthy();
  });
});

describe('reloads', () => {
  it('tactical reload keeps the chambered round (17+1) and takes the tactical time', () => {
    const h = new Harness(fa('pistol'));
    h.tick({ trigger: true });
    h.ticks(10);
    h.tick({ reloadPressed: true });
    expect(h.s.phase).toBe('reloading');
    h.ticks(Math.round(1.6 / DT) + 2);
    expect(h.s.phase).toBe('ready');
    expect(h.s.mag).toBe(17);
    expect(h.s.chambered).toBe(true);
    expect(h.seen(WeaponEvent.MAG_OUT) && h.seen(WeaponEvent.MAG_IN)).toBe(true);
    expect(h.reserve).toBe(120 - 1); // 16 returned, 17 taken
  });

  it('empty reload ends with chambering and takes longer', () => {
    const h = new Harness(fa('pistol'));
    for (let i = 0; i < 18; i++) {
      h.tick({ trigger: true });
      h.ticks(8);
    }
    h.events = [];
    h.tick({ reloadPressed: true });
    h.ticks(Math.round(1.6 / DT));
    expect(h.s.phase).toBe('reloading'); // not done at tactical time
    h.ticks(Math.round(0.5 / DT));
    expect(h.s.phase).toBe('ready');
    expect(h.s.chambered).toBe(true);
    expect(h.s.mag).toBe(16);
    expect(h.seen(WeaponEvent.CHAMBERED)).toBe(true);
  });

  it('reload with a short reserve takes what is left; no reserve, no reload', () => {
    const h = new Harness(fa('pistol'));
    h.reserve = 5;
    h.tick({ trigger: true });
    h.ticks(10);
    h.tick({ reloadPressed: true });
    h.ticks(200);
    expect(h.s.mag).toBe(Math.min(17, 5 + 16));
    h.reserve = 0;
    h.s.mag = 3;
    expect(h.tick({ reloadPressed: true }) & WeaponEvent.RELOAD_START).toBe(0);
  });

  it('shotgun: pumps between shots, loads shell by shell, can interrupt, racks when empty', () => {
    const h = new Harness(fa('shotgun'));
    h.tick({ trigger: true });
    expect(h.s.phase).toBe('cycling');
    h.tick({ trigger: false });
    h.ticks(5, { trigger: true }); // still pumping: no shot
    expect(h.shots).toBe(1);
    h.ticks(40);
    expect(h.seen(WeaponEvent.CYCLED)).toBe(true);
    expect(h.s.chambered).toBe(true);
    // Fire three, then reload two shells and interrupt by firing.
    for (let i = 0; i < 3; i++) {
      h.tick({ trigger: true });
      h.ticks(40);
    }
    const magBefore = h.s.mag;
    h.tick({ reloadPressed: true });
    h.ticks(Math.round(1.05 / DT));
    expect(h.s.mag).toBe(magBefore + 2);
    h.tick({ trigger: true });
    expect(h.s.phase).toBe('ready');
  });

  it('shotgun: a full reload of an empty gun loads every shell, then racks one into the chamber', () => {
    const h = new Harness(fa('shotgun'));
    for (let i = 0; i < 7; i++) {
      h.tick({ trigger: true });
      h.ticks(40);
    }
    expect(roundsLoaded(h.s)).toBe(0);
    h.tick({ reloadPressed: true });
    h.ticks(Math.round((6 * 0.5 + 0.5) / DT) + 10); // each stage restarts on a tick boundary
    expect(h.s.phase).toBe('ready');
    expect(h.s.chambered).toBe(true);
    expect(h.s.mag).toBe(5);
    expect(h.seen(WeaponEvent.SHELL_IN)).toBe(true);
  });

  it('shotgun: topping up with a round chambered ends ready without racking', () => {
    const h = new Harness(fa('shotgun'));
    h.tick({ trigger: true });
    h.ticks(40);
    h.tick({ reloadPressed: true });
    h.ticks(Math.round(0.5 / DT) + 3);
    expect(h.s.phase).toBe('ready');
    expect(h.s.mag).toBe(6);
    expect(h.s.chambered).toBe(true);
  });

  it('a firearm left in a melee phase recovers to ready', () => {
    const h = new Harness(fa('pistol'));
    h.s.phase = 'swinging';
    h.tick();
    expect(h.s.phase).toBe('ready');
  });

  it('bolt action needs the bolt worked between shots', () => {
    const h = new Harness(fa('rifle'));
    h.tick({ trigger: true });
    h.tick({ trigger: false });
    h.ticks(20, { trigger: true });
    expect(h.shots).toBe(1);
    h.tick({ trigger: false });
    h.ticks(60);
    h.tick({ trigger: true });
    expect(h.shots).toBe(2);
  });
});

describe('wear and jams', () => {
  it('jam probability grows with wear', () => {
    const w = fa('carbine');
    expect(jamProbability(w, 0)).toBe(w.wear.jamBase);
    expect(jamProbability(w, 1)).toBe(w.wear.jamAtFullWear);
    expect(jamProbability(w, 0.5)).toBeGreaterThan(jamProbability(w, 0.2));
  });

  it('a worn gun jams, refuses to fire, and the reload key clears it (the stuck round is lost)', () => {
    const worn: Firearm = {
      ...fa('pistol'),
      wear: { ...fa('pistol').wear, jamBase: 1, jamAtFullWear: 1 },
    };
    const h = new Harness(worn);
    h.tick({ trigger: true });
    expect(h.s.phase).toBe('jammed');
    expect(h.seen(WeaponEvent.JAMMED)).toBe(true);
    h.tick({ trigger: false });
    expect(h.tick({ trigger: true }) & WeaponEvent.DRY_FIRE).toBeTruthy();
    const loaded = roundsLoaded(h.s);
    h.tick({ reloadPressed: true });
    h.ticks(Math.round(worn.wear.clearSeconds / DT) + 1);
    expect(h.s.phase).toBe('ready');
    expect(h.seen(WeaponEvent.JAM_CLEARED)).toBe(true);
    expect(roundsLoaded(h.s)).toBe(loaded); // chamber was empty (casing stuck); next round fed
  });

  it('pump/bolt actions can jam on cycling too', () => {
    const worn: Firearm = {
      ...fa('shotgun'),
      wear: { ...fa('shotgun').wear, jamBase: 1, jamAtFullWear: 1 },
    };
    const h = new Harness(worn);
    h.tick({ trigger: true });
    h.ticks(40);
    expect(h.s.phase).toBe('jammed');
  });

  it('wear accumulates per shot and widens spread', () => {
    const h = new Harness(fa('carbine'));
    h.tick({ fireModePressed: true });
    h.tick({ trigger: true });
    const first = h.out.spreadRad;
    h.s.wear = 0.9;
    h.s.bloomDeg = 0;
    h.ticks(30);
    h.tick({ trigger: true });
    expect(h.out.spreadRad).toBeGreaterThan(first);
    expect(h.s.wear).toBeGreaterThan(0.9);
  });
});

describe('recoil, spread, modes', () => {
  it('recoil follows the pattern, aiming steadies it, and the aim recovers', () => {
    const w = fa('carbine');
    const h = new Harness(w);
    h.tick({ trigger: true });
    expect(h.out.kickPitch).toBeCloseTo(w.recoil.pattern[0]?.[0] ?? 0);
    h.ticks(10);
    h.tick({ trigger: true, aiming: true });
    expect(h.out.kickPitch).toBeCloseTo((w.recoil.pattern[1]?.[0] ?? 0) * 0.75);
    h.ticks(120);
    expect(Math.abs(h.s.recoilPitch) + Math.abs(h.s.recoilYaw)).toBeLessThan(0.01);
  });

  it('long auto strings loop the pattern tail; aiming and stillness shrink the cone', () => {
    const w = fa('carbine');
    const h = new Harness(w);
    h.tick({ fireModePressed: true });
    h.ticks(100, { trigger: true }); // ~20 rounds, still firing
    expect(h.s.patternIndex).toBeGreaterThan(w.recoil.pattern.length);
    h.ticks(60); // pause: the pattern restarts from the top
    expect(h.s.patternIndex).toBe(0);
    const ads = new Harness(w);
    ads.tick({ trigger: true, aiming: true });
    const hip = new Harness(w);
    hip.tick({ trigger: true, moving: 1 });
    expect(ads.out.spreadRad).toBeLessThan(hip.out.spreadRad / 5);
  });

  it('switching weapons re-draws; mode switch does nothing on single-mode guns', () => {
    const h = new Harness(fa('pistol'));
    expect(h.tick({ fireModePressed: true }) & WeaponEvent.MODE_CHANGED).toBe(0);
    drawWeapon(h.s, h.w);
    expect(h.s.phase).toBe('drawing');
    expect(h.tick({ trigger: true }) & WeaponEvent.SHOT).toBe(0);
  });
});

describe('melee and throwables', () => {
  it('melee swing lands its blow at impactAt, once', () => {
    const knife = WEAPONS.knife;
    if (knife.kind !== 'melee') throw new Error('knife');
    const h = new Harness(knife);
    h.events = [];
    h.tick({ trigger: true });
    expect(h.seen(WeaponEvent.SWING)).toBe(true);
    h.ticks(Math.round(knife.swingSeconds / DT) + 2, { trigger: true });
    expect(h.events.filter((e) => e & WeaponEvent.MELEE_IMPACT)).toHaveLength(1);
    expect(h.s.phase).toBe('ready');
  });

  it('throws consume reserve, re-draw, and click when none are left', () => {
    const h = new Harness(WEAPONS.frag);
    h.reserve = 1;
    expect(h.tick({ trigger: true }) & WeaponEvent.THROW).toBeTruthy();
    expect(h.reserve).toBe(0);
    h.tick({ trigger: false });
    h.ticks(60);
    expect(h.tick({ trigger: true }) & WeaponEvent.DRY_FIRE).toBeTruthy();
  });

  it('melee and throwables recover from firearm-only phases', () => {
    for (const w of [WEAPONS.knife, WEAPONS.flare]) {
      const h = new Harness(w);
      for (const phase of ['cycling', 'reloading', 'jammed', 'clearing'] as const) {
        h.s.phase = phase;
        h.tick();
        expect(h.s.phase).toBe('ready');
      }
    }
  });
});
