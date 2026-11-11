import { VULNERABILITY, damageTo, type BodyPart, type Race } from '../combat/races';
import { MOBS, MOB_IDS, type MobId } from '../mobs/registry';
import { cos, sin } from '../math/dmath';
import { falloffFactor } from '../weapons/ballistics';
import { WEAPONS, WEAPON_IDS, type WeaponId } from '../weapons/registry';

/**
 * The balance model (stage 10): exactly what the combat systems compute,
 * evaluated headlessly for every weapon × mob × aim × range, plus every
 * mob's threat to the player. Design targets are tests over these numbers
 * (balance.test.ts) and the balance sheet (docs/balance.md) is generated
 * from them, so tuning a registry value shows its consequences everywhere.
 */
export const PLAYER_HEALTH = 100;
export const RANGES = [5, 20, 60, 150] as const;
export type Aim = 'weak' | 'body';

/** The part an aimed shot hits: each race's weak spot, or centre mass. */
export const AIM_PARTS: Readonly<Record<Race, Readonly<Record<Aim, BodyPart>>>> = {
  zombie: { weak: 'head', body: 'torso' },
  robot: { weak: 'sensor', body: 'chassis' },
  plant: { weak: 'bulb', body: 'stem' },
  animal: { weak: 'head', body: 'torso' },
};

/**
 * Front-on cross-section of each aim part as an equivalent circle radius (m),
 * from the hitboxes (scaled per mob): what a pellet cone has to land in.
 */
const PART_RADIUS: Readonly<Record<Race, Readonly<Record<Aim, number>>>> = {
  zombie: { weak: 0.115, body: 0.3 },
  robot: { weak: 0.09, body: 0.36 },
  plant: { weak: 0.3, body: 0.28 },
  animal: { weak: 0.17, body: 0.26 },
};

/**
 * Damage of one shot of a multi-pellet weapon aimed at a part: pellets land
 * uniformly in the cone, so the share hitting the aimed part (and the rest
 * of the body) is its area against the cone's at that distance.
 */
function pelletShot(
  race: Race,
  aim: Aim,
  scale: number,
  perPellet: number,
  pellets: number,
  spreadDeg: number,
  distance: number,
): number {
  const half = ((spreadDeg / 2) * Math.PI) / 180;
  const cone = Math.max(1e-6, (distance * sin(half)) / cos(half));
  const share = (r: number): number => Math.min(1, ((r * scale) / cone) ** 2);
  const onAim = share(PART_RADIUS[race][aim]);
  const onBody = aim === 'weak' ? Math.max(0, share(PART_RADIUS[race].body) - onAim) : 0;
  const v = VULNERABILITY[race];
  const aimed = v.parts[AIM_PARTS[race][aim]] ?? 1;
  const body = v.parts[AIM_PARTS[race].body] ?? 1;
  return perPellet * v.types.ballistic * pellets * (onAim * aimed + onBody * body);
}

export function mobHealth(id: MobId): number {
  const spec = MOBS[id];
  return VULNERABILITY[spec.race].maxHealth * spec.healthScale;
}

export interface Kill {
  /** Hits (shots, swings, throws) to kill; Infinity when it cannot. */
  readonly hits: number;
  /** Seconds from the first hit to the kill, including cycling and reloads; Infinity when it cannot. */
  readonly seconds: number;
}

const NEVER: Kill = { hits: Infinity, seconds: Infinity };

/** One weapon against one mob, every hit landing on `aim` at `distance` metres. */
export function killWith(weapon: WeaponId, mob: MobId, aim: Aim, distance: number): Kill {
  const w = WEAPONS[weapon];
  const race = MOBS[mob].race;
  const hp = mobHealth(mob);
  const part = AIM_PARTS[race][aim];
  switch (w.kind) {
    case 'firearm': {
      const k = falloffFactor(distance, w.falloff.start, w.falloff.end, w.falloff.min);
      const direct =
        w.projectile.kind === 'rocket'
          ? damageTo(race, w.damage, 'explosive', part) +
            damageTo(race, w.projectile.explosion.damage, w.projectile.explosion.damageType, null)
          : w.pellets > 1
            ? pelletShot(
                race,
                aim,
                MOBS[mob].body.scale,
                w.damage * k,
                w.pellets,
                w.pelletSpreadDeg,
                distance,
              )
            : damageTo(race, w.damage * k, 'ballistic', part);
      if (direct < hp / 1000) return NEVER;
      const hits = Math.ceil(hp / direct - 1e-9);
      const between = Math.max(60 / w.rpm, w.cycleSeconds);
      const reloads = Math.floor((hits - 1) / w.magazine);
      return { hits, seconds: (hits - 1) * between + reloads * w.reload.tacticalSeconds };
    }
    case 'melee': {
      if (distance > w.reach) return NEVER;
      const d = damageTo(race, w.damage, w.damageType, part);
      if (d <= 0) return NEVER;
      const hits = Math.ceil(hp / d - 1e-9);
      return { hits, seconds: (hits - 1) * w.swingSeconds };
    }
    case 'throwable': {
      const e = w.effect;
      if (e.type === 'explosion') {
        const d = damageTo(race, e.damage, e.damageType, null);
        if (d <= 0) return NEVER;
        const hits = Math.ceil(hp / d - 1e-9);
        return { hits, seconds: (hits - 1) * (w.drawSeconds + 0.5) };
      }
      // Fire and light: damage over time while it stands in the pool (one throw).
      const dps =
        e.type === 'fire'
          ? damageTo(race, e.dps, 'fire', null)
          : damageTo(race, e.lightDps, 'light', null);
      if (dps <= 0) return NEVER;
      const seconds = hp / dps;
      return seconds <= e.seconds ? { hits: 1, seconds } : NEVER;
    }
  }
}

export interface Threat {
  /** Best sustained damage per second against the player, and how it is dealt. */
  readonly dps: number;
  readonly how: 'melee' | 'laser' | 'spit' | 'leap';
  /** Seconds to kill a full-health, unresisting player. */
  readonly secondsToKill: number;
}

/** Acid from a spit burns this many seconds per glob if you stand in it (ACID in the AI components). */
const ACID_SECONDS = 5;

export function threatOf(mob: MobId): Threat {
  const spec = MOBS[mob];
  const options: { dps: number; how: Threat['how'] }[] = [
    { dps: spec.attack.damage / spec.attack.cooldown, how: 'melee' },
  ];
  const r = spec.ranged;
  if (r !== null) {
    if (r.kind === 'laser') options.push({ dps: r.damage / r.cooldown, how: 'laser' });
    // Acid burns its damage per second for its lifetime, one pool per cooldown.
    if (r.kind === 'spit')
      options.push({
        dps: (r.damage * Math.min(ACID_SECONDS, r.cooldown)) / r.cooldown,
        how: 'spit',
      });
    // A latched creeper drains `damage` per second until shaken off.
    if (r.kind === 'leap') options.push({ dps: r.damage, how: 'leap' });
  }
  const best = options.reduce((a, b) => (b.dps > a.dps ? b : a));
  return { ...best, secondsToKill: PLAYER_HEALTH / best.dps };
}

/** The fastest way (any weapon) to kill each mob at a distance, aimed at its weak spot. */
export function bestWeapon(mob: MobId, distance: number, aim: Aim = 'weak'): WeaponId {
  let best: WeaponId = 'pistol';
  let bestT = Infinity;
  for (const id of WEAPON_IDS) {
    const k = killWith(id, mob, aim, distance);
    if (
      k.seconds < bestT ||
      (k.seconds === bestT && k.hits < killWith(best, mob, aim, distance).hits)
    ) {
      bestT = k.seconds;
      best = id;
    }
  }
  return best;
}

const fmt = (k: Kill): string =>
  k.hits === Infinity ? '—' : `${String(k.hits)} · ${k.seconds.toFixed(2)} s`;

/** The balance sheet (docs/balance.md), generated: regenerate with `npm run balance`. */
export function balanceSheet(): string {
  const lines: string[] = [
    '# Balance sheet',
    '',
    '_Generated by `npm run balance` from the weapon and mob registries (`src/domain/balance/balance.ts`).',
    'Do not edit by hand: a test fails when it is out of date. Design targets: `balance.test.ts`._',
    '',
    'Each cell: hits to kill · seconds from first hit to kill (cycling and reloads included).',
    '— = cannot kill (out of reach, immune, or a pool that burns out first).',
    '',
  ];
  for (const aim of ['weak', 'body'] as const)
    for (const distance of RANGES) {
      lines.push(`## ${aim === 'weak' ? 'Weak spot' : 'Centre mass'} at ${String(distance)} m`, '');
      lines.push(
        `| weapon | ${MOB_IDS.map((m) => `${MOBS[m].label} (${String(Math.round(mobHealth(m)))} hp)`).join(' | ')} |`,
      );
      lines.push(`| --- | ${MOB_IDS.map(() => '---').join(' | ')} |`);
      for (const w of WEAPON_IDS) {
        if (WEAPONS[w].kind === 'throwable' && (aim === 'body' || distance !== 20)) continue;
        if (WEAPONS[w].kind === 'melee' && distance !== 5) continue;
        const d = WEAPONS[w].kind === 'melee' ? 1 : distance;
        lines.push(`| ${w} | ${MOB_IDS.map((m) => fmt(killWith(w, m, aim, d))).join(' | ')} |`);
      }
      lines.push('');
    }
  lines.push(
    '## Threat to the player',
    '',
    `| mob | best attack | dps | seconds to kill ${String(PLAYER_HEALTH)} hp |`,
    '| --- | --- | --- | --- |',
  );
  for (const m of MOB_IDS) {
    const t = threatOf(m);
    lines.push(
      `| ${MOBS[m].label} | ${t.how} | ${t.dps.toFixed(1)} | ${t.secondsToKill.toFixed(1)} |`,
    );
  }
  lines.push(
    '',
    '## Fastest weapon per mob (weak spot)',
    '',
    `| mob | ${RANGES.map((r) => `${String(r)} m`).join(' | ')} |`,
    `| --- | ${RANGES.map(() => '---').join(' | ')} |`,
  );
  for (const m of MOB_IDS)
    lines.push(`| ${MOBS[m].label} | ${RANGES.map((r) => bestWeapon(m, r)).join(' | ')} |`);
  lines.push('');
  return lines.join('\n');
}
