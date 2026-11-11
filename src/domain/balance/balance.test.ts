import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOBS, MOB_IDS, type MobId } from '../mobs/registry';
import { WEAPONS, WEAPON_IDS, type WeaponId } from '../weapons/registry';
import { CAMPAIGN } from '../story/campaign';
import { RANGES, balanceSheet, killWith, mobHealth, threatOf, type Aim } from './balance';

/**
 * Design targets (stage 10). The numbers come from the same formulas the
 * combat systems run; these tests are the balance contract. A registry change
 * that breaks one is a design decision, not a refactor.
 */
const FIREARMS = WEAPON_IDS.filter((w) => WEAPONS[w].kind === 'firearm' && w !== 'rpg7');
const MELEE = WEAPON_IDS.filter((w) => WEAPONS[w].kind === 'melee');
const byRace = (race: string): MobId[] => MOB_IDS.filter((m) => MOBS[m].race === race);

/** The firearm that kills fastest (ties: fewer hits). */
function fastest(mob: MobId, aim: Aim, d: number): WeaponId {
  return (
    [...FIREARMS].sort((a, b) => {
      const ka = killWith(a, mob, aim, d);
      const kb = killWith(b, mob, aim, d);
      return ka.seconds - kb.seconds || ka.hits - kb.hits;
    })[0] ?? 'pistol'
  );
}

describe('balance: aim and lore', () => {
  it('weak spots matter: aiming for them never takes more hits', () => {
    for (const w of FIREARMS)
      for (const m of MOB_IDS)
        for (const d of RANGES)
          expect(killWith(w, m, 'weak', d).hits, `${w} ${m} ${String(d)} m`).toBeLessThanOrEqual(
            killWith(w, m, 'body', d).hits,
          );
  });

  it('every race has the weakness its lore promises', () => {
    // Robots: one EMP charge drops any of them; bullets to the body barely scratch the armour.
    for (const m of byRace('robot')) expect(killWith('emp', m, 'body', 5).hits, m).toBe(1);
    // Plants: one molotov burns any of them down before it goes out.
    for (const m of byRace('plant')) expect(killWith('molotov', m, 'body', 5).hits, m).toBe(1);
    // Zombies: a pistol headshot within 20 m, the flare's light burns them (and nothing else).
    for (const m of byRace('zombie')) {
      expect(killWith('pistol', m, 'weak', 20).hits, m).toBe(1);
      expect(Number.isFinite(killWith('flare', m, 'body', 5).seconds), m).toBe(true);
    }
    for (const m of [...byRace('robot'), ...byRace('plant'), ...byRace('animal')])
      expect(killWith('flare', m, 'body', 5).hits, m).toBe(Infinity);
    // Robots are armoured: centre mass takes at least twice the carbine rounds a zombie does.
    expect(killWith('carbine', 'sentry', 'body', 20).hits).toBeGreaterThanOrEqual(
      2 * killWith('carbine', 'shambler', 'body', 20).hits,
    );
  });

  it('nothing is immune to guns: every firearm kills every mob at 20 m', () => {
    for (const w of FIREARMS)
      for (const m of MOB_IDS)
        expect(Number.isFinite(killWith(w, m, 'body', 20).seconds), `${w} ${m}`).toBe(true);
  });
});

describe('balance: every weapon has a job', () => {
  it('the shotgun owns close quarters', () => {
    const wins = MOB_IDS.filter((m) => fastest(m, 'body', 5) === 'shotgun');
    expect(wins.length).toBeGreaterThanOrEqual(MOB_IDS.length / 2);
  });

  it('the carbine owns the middle distance', () => {
    const wins = MOB_IDS.filter((m) => fastest(m, 'body', 60) === 'carbine');
    expect(wins.length).toBeGreaterThanOrEqual(MOB_IDS.length / 2);
  });

  it('the rifle owns long range: the fewest shots of any firearm, at most two, against everything', () => {
    for (const m of MOB_IDS) {
      const rifle = killWith('rifle', m, 'weak', 150).hits;
      expect(rifle, m).toBeLessThanOrEqual(2);
      for (const w of FIREARMS)
        expect(rifle, `${m} vs ${w}`).toBeLessThanOrEqual(killWith(w, m, 'weak', 150).hits);
    }
  });

  it('the pistol is the reliable sidearm; melee is a real option against the dead', () => {
    for (const m of MOB_IDS)
      expect(killWith('pistol', m, 'body', 20).hits, m).toBeLessThanOrEqual(
        WEAPONS.pistol.kind === 'firearm' ? WEAPONS.pistol.magazine : 0,
      );
    for (const w of MELEE)
      for (const m of byRace('zombie')) expect(killWith(w, m, 'weak', 1).hits, `${w} ${m}`).toBe(1);
  });
});

describe('balance: fairness', () => {
  it('no mob kills a full-health player in under 5 seconds; nothing out-damages a bite from range', () => {
    for (const m of MOB_IDS) {
      const t = threatOf(m);
      expect(t.secondsToKill, m).toBeGreaterThanOrEqual(5);
      const spec = MOBS[m];
      if (spec.ranged !== null && spec.ranged.kind !== 'leap')
        expect(spec.ranged.damage / spec.ranged.cooldown, m).toBeLessThan(
          spec.attack.damage / spec.attack.cooldown,
        );
    }
  });

  it('the campaign hands out enough ammunition', () => {
    const effects = CAMPAIGN.interactables.flatMap((i) => i.effects);
    const ambush = effects.flatMap((e) => (e.do === 'spawn' ? [e] : []));
    expect(ambush.length).toBeGreaterThan(0);
    expect(effects.filter((e) => e.do === 'supply').length).toBeGreaterThanOrEqual(4);
    // The 120 starting carbine rounds, centre mass at 20 m, cover every scripted ambusher
    // even if each were the toughest of them.
    const toughest = Math.max(...ambush.map((e) => killWith('carbine', e.mob, 'body', 20).hits));
    const ambushers = ambush.reduce((s, e) => s + e.count, 0);
    expect(120 / toughest).toBeGreaterThanOrEqual(ambushers);
    expect(Math.min(...ambush.map((e) => mobHealth(e.mob)))).toBeGreaterThan(0);
  });
});

describe('the balance sheet', () => {
  it('docs/balance.md is up to date (npm run balance)', () => {
    const doc = readFileSync(new URL('../../../docs/balance.md', import.meta.url), 'utf8');
    expect(doc).toBe(balanceSheet());
  });
});
